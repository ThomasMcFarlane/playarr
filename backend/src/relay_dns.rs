use std::{
    collections::HashMap,
    io,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    sync::Arc,
    time::{Duration, Instant},
};

use anyhow::Context;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream, UdpSocket},
    sync::Semaphore,
    time::timeout,
};

const ZONE: &[&[u8]] = &[b"relay", b"playarr", b"app"];
const PRIMARY_NS: &[&[u8]] = &[b"relay-ns1", b"playarr", b"app"];
const SOA_MAILBOX: &[&[u8]] = &[b"hostmaster", b"playarr", b"app"];
const TTL: u32 = 60;
const TCP_IDLE_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_TCP_CONNECTIONS: usize = 128;
const UDP_GLOBAL_BURST: f64 = 1_024.0;
const UDP_GLOBAL_RATE_PER_SECOND: f64 = 512.0;
const UDP_SOURCE_BURST: f64 = 32.0;
const UDP_SOURCE_RATE_PER_SECOND: f64 = 16.0;
const MAX_UDP_SOURCES: usize = 4_096;
const UDP_SOURCE_IDLE_TTL: Duration = Duration::from_secs(60);
const UDP_PRUNE_INTERVAL: usize = 1_024;

const TYPE_A: u16 = 1;
const TYPE_NS: u16 = 2;
const TYPE_SOA: u16 = 6;
const TYPE_AAAA: u16 = 28;
const TYPE_CAA: u16 = 257;
const TYPE_AXFR: u16 = 252;
const TYPE_ANY: u16 = 255;
const CLASS_IN: u16 = 1;

const RCODE_NOERROR: u16 = 0;
const RCODE_FORMERR: u16 = 1;
const RCODE_NXDOMAIN: u16 = 3;
const RCODE_NOTIMP: u16 = 4;
const RCODE_REFUSED: u16 = 5;

/// Serve Streamarr's authoritative `relay.playarr.app` DNS zone over UDP and TCP.
///
/// The server deliberately implements no recursive resolution. A hostname such as
/// `v4-11-22-33-44.relay.playarr.app` resolves directly to `11.22.33.44`.
pub async fn serve(bind_addr: SocketAddr) -> anyhow::Result<()> {
    let udp = UdpSocket::bind(bind_addr)
        .await
        .with_context(|| format!("failed to bind relay DNS UDP listener on {bind_addr}"))?;
    let tcp = TcpListener::bind(bind_addr)
        .await
        .with_context(|| format!("failed to bind relay DNS TCP listener on {bind_addr}"))?;

    let udp_task = run_udp(udp);
    let tcp_task = run_tcp(tcp);
    tokio::try_join!(udp_task, tcp_task)?;
    Ok(())
}

async fn run_udp(socket: UdpSocket) -> anyhow::Result<()> {
    let mut buffer = vec![0_u8; u16::MAX as usize];
    let mut limiter = UdpRateLimiter::new(Instant::now());

    loop {
        let (length, peer) = socket
            .recv_from(&mut buffer)
            .await
            .context("relay DNS UDP receive failed")?;
        if !limiter.allow(peer.ip(), Instant::now()) {
            continue;
        }
        if let Some(response) = handle_packet(&buffer[..length]) {
            let _ = socket.send_to(&response, peer).await;
        }
    }
}

struct TokenBucket {
    tokens: f64,
    capacity: f64,
    rate_per_second: f64,
    last_refill: Instant,
}

impl TokenBucket {
    fn new(capacity: f64, rate_per_second: f64, now: Instant) -> Self {
        Self {
            tokens: capacity,
            capacity,
            rate_per_second,
            last_refill: now,
        }
    }

    fn take(&mut self, now: Instant) -> bool {
        let elapsed = now
            .saturating_duration_since(self.last_refill)
            .as_secs_f64();
        self.tokens = (self.tokens + elapsed * self.rate_per_second).min(self.capacity);
        self.last_refill = now;
        if self.tokens < 1.0 {
            return false;
        }
        self.tokens -= 1.0;
        true
    }
}

struct SourceLimit {
    bucket: TokenBucket,
    last_seen: Instant,
}

struct UdpRateLimiter {
    global: TokenBucket,
    sources: HashMap<IpAddr, SourceLimit>,
    packets_since_prune: usize,
}

impl UdpRateLimiter {
    fn new(now: Instant) -> Self {
        Self {
            global: TokenBucket::new(UDP_GLOBAL_BURST, UDP_GLOBAL_RATE_PER_SECOND, now),
            sources: HashMap::new(),
            packets_since_prune: 0,
        }
    }

    fn allow(&mut self, source: IpAddr, now: Instant) -> bool {
        self.packets_since_prune = self.packets_since_prune.saturating_add(1);
        if self.packets_since_prune >= UDP_PRUNE_INTERVAL {
            self.sources.retain(|_, limit| {
                now.saturating_duration_since(limit.last_seen) < UDP_SOURCE_IDLE_TTL
            });
            self.packets_since_prune = 0;
        }

        if !self.sources.contains_key(&source) && self.sources.len() >= MAX_UDP_SOURCES {
            return false;
        }

        let limit = self.sources.entry(source).or_insert_with(|| SourceLimit {
            bucket: TokenBucket::new(UDP_SOURCE_BURST, UDP_SOURCE_RATE_PER_SECOND, now),
            last_seen: now,
        });
        limit.last_seen = now;
        limit.bucket.take(now) && self.global.take(now)
    }
}

async fn run_tcp(listener: TcpListener) -> anyhow::Result<()> {
    let permits = Arc::new(Semaphore::new(MAX_TCP_CONNECTIONS));
    loop {
        let permit = Arc::clone(&permits)
            .acquire_owned()
            .await
            .context("relay DNS TCP connection limiter closed")?;
        let (stream, _) = listener
            .accept()
            .await
            .context("relay DNS TCP accept failed")?;
        tokio::spawn(async move {
            let _permit = permit;
            let _ = serve_tcp_connection(stream).await;
        });
    }
}

async fn serve_tcp_connection(mut stream: TcpStream) -> io::Result<()> {
    loop {
        let mut length_bytes = [0_u8; 2];
        match timeout(TCP_IDLE_TIMEOUT, stream.read_exact(&mut length_bytes)).await {
            Ok(Ok(_)) => {}
            Ok(Err(error)) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(()),
            Ok(Err(error)) => return Err(error),
            Err(_) => return Ok(()),
        }

        let length = u16::from_be_bytes(length_bytes) as usize;
        if length == 0 {
            return Ok(());
        }
        let mut request = vec![0_u8; length];
        timeout(TCP_IDLE_TIMEOUT, stream.read_exact(&mut request))
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "DNS TCP read timed out"))??;

        let Some(response) = handle_packet(&request) else {
            continue;
        };
        let response_length = u16::try_from(response.len())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "DNS response too large"))?;
        timeout(TCP_IDLE_TIMEOUT, async {
            stream.write_all(&response_length.to_be_bytes()).await?;
            stream.write_all(&response).await?;
            stream.flush().await
        })
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "DNS TCP write timed out"))??;
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Name(Vec<Vec<u8>>);

impl Name {
    fn is_zone_apex(&self) -> bool {
        labels_equal(&self.0, ZONE)
    }

    fn is_in_zone(&self) -> bool {
        self.0.len() >= ZONE.len() && labels_equal(&self.0[self.0.len() - ZONE.len()..], ZONE)
    }

    fn mapped_ipv4(&self) -> Option<Ipv4Addr> {
        if self.0.len() != ZONE.len() + 1 || !labels_equal(&self.0[1..], ZONE) {
            return None;
        }
        parse_ipv4_label(&self.0[0])
    }
}

fn labels_equal(left: &[Vec<u8>], right: &[&[u8]]) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .all(|(left, right)| left.eq_ignore_ascii_case(right))
}

fn parse_ipv4_label(label: &[u8]) -> Option<Ipv4Addr> {
    let text = std::str::from_utf8(label).ok()?;
    let mut parts = text.split('-');
    if !parts.next()?.eq_ignore_ascii_case("v4") {
        return None;
    }

    let mut octets = [0_u8; 4];
    for octet in &mut octets {
        let part = parts.next()?;
        if part.is_empty() || (part.len() > 1 && part.starts_with('0')) {
            return None;
        }
        *octet = part.parse().ok()?;
    }
    if parts.next().is_some() {
        return None;
    }
    let address = Ipv4Addr::from(octets);
    is_public_ipv4(address).then_some(address)
}

fn is_public_ipv4(address: Ipv4Addr) -> bool {
    let [a, b, c, _] = address.octets();
    !matches!(
        (a, b, c),
        (0, _, _)
            | (10, _, _)
            | (100, 64..=127, _)
            | (127, _, _)
            | (169, 254, _)
            | (172, 16..=31, _)
            | (192, 0, 0)
            | (192, 0, 2)
            | (192, 88, 99)
            | (192, 168, _)
            | (198, 18..=19, _)
            | (198, 51, 100)
            | (203, 0, 113)
            | (224..=255, _, _)
    )
}

#[derive(Debug)]
struct Question {
    name: Name,
    qtype: u16,
    qclass: u16,
}

fn handle_packet(request: &[u8]) -> Option<Vec<u8>> {
    if request.len() < 2 {
        return None;
    }
    let id = read_u16(request, 0)?;
    let request_flags = read_u16(request, 2).unwrap_or(0);
    if request.len() < 12 {
        return Some(error_response(id, request_flags, RCODE_FORMERR, None));
    }
    if request_flags & 0x8000 != 0 {
        return None;
    }
    if read_u16(request, 4) != Some(1) {
        return Some(error_response(id, request_flags, RCODE_FORMERR, None));
    }

    let question = match parse_question(request) {
        Ok(question) => question,
        Err(()) => return Some(error_response(id, request_flags, RCODE_FORMERR, None)),
    };

    let opcode = (request_flags >> 11) & 0x0f;
    if opcode != 0 {
        return Some(error_response(
            id,
            request_flags,
            RCODE_NOTIMP,
            Some(&question),
        ));
    }
    if question.qclass != CLASS_IN || matches!(question.qtype, TYPE_AXFR | TYPE_ANY) {
        return Some(error_response(
            id,
            request_flags,
            RCODE_REFUSED,
            Some(&question),
        ));
    }
    if !question.name.is_in_zone() {
        return Some(error_response(
            id,
            request_flags,
            RCODE_REFUSED,
            Some(&question),
        ));
    }

    Some(authoritative_response(id, request_flags, &question))
}

fn parse_question(message: &[u8]) -> Result<Question, ()> {
    let (name, offset) = parse_name(message, 12)?;
    let qtype = read_u16(message, offset).ok_or(())?;
    let qclass = read_u16(message, offset + 2).ok_or(())?;
    Ok(Question {
        name,
        qtype,
        qclass,
    })
}

/// Parse a possibly compressed name with strict bounds on pointer traversal and
/// expanded wire length. The returned offset always follows the original name.
fn parse_name(message: &[u8], start: usize) -> Result<(Name, usize), ()> {
    let mut labels = Vec::new();
    let mut cursor = start;
    let mut next_offset = None;
    let mut pointer_hops = 0_usize;
    let mut expanded_length = 1_usize;
    let mut visited = Vec::new();

    loop {
        let length = *message.get(cursor).ok_or(())?;
        if length & 0xc0 == 0xc0 {
            let low = *message.get(cursor + 1).ok_or(())?;
            let pointer = (((length & 0x3f) as usize) << 8) | low as usize;
            if pointer >= message.len() || visited.contains(&pointer) || pointer_hops >= 32 {
                return Err(());
            }
            visited.push(pointer);
            pointer_hops += 1;
            next_offset.get_or_insert(cursor + 2);
            cursor = pointer;
            continue;
        }
        if length & 0xc0 != 0 {
            return Err(());
        }
        cursor += 1;
        if length == 0 {
            return Ok((Name(labels), next_offset.unwrap_or(cursor)));
        }

        let length = length as usize;
        if length > 63 || cursor.checked_add(length).is_none() {
            return Err(());
        }
        let end = cursor + length;
        let label = message.get(cursor..end).ok_or(())?;
        expanded_length = expanded_length.checked_add(length + 1).ok_or(())?;
        if expanded_length > 255 {
            return Err(());
        }
        labels.push(label.to_vec());
        cursor = end;
    }
}

fn authoritative_response(id: u16, request_flags: u16, question: &Question) -> Vec<u8> {
    let mut answers = Vec::new();
    let mut authority = Vec::new();
    let mut rcode = RCODE_NOERROR;

    if question.name.is_zone_apex() {
        match question.qtype {
            TYPE_NS => {
                answers.push(ResourceRecord::ns(PRIMARY_NS));
            }
            TYPE_SOA => answers.push(ResourceRecord::soa()),
            TYPE_CAA => {
                answers.push(ResourceRecord::caa_issue());
                answers.push(ResourceRecord::caa_issuewild());
            }
            TYPE_AAAA => authority.push(ResourceRecord::soa()),
            _ => authority.push(ResourceRecord::soa()),
        }
    } else if let Some(address) = question.name.mapped_ipv4() {
        match question.qtype {
            TYPE_A => answers.push(ResourceRecord::a(address)),
            TYPE_CAA => {
                answers.push(ResourceRecord::caa_issue());
                answers.push(ResourceRecord::caa_issuewild());
            }
            TYPE_AAAA => authority.push(ResourceRecord::soa()),
            _ => authority.push(ResourceRecord::soa()),
        }
    } else {
        rcode = RCODE_NXDOMAIN;
        authority.push(ResourceRecord::soa());
    }

    let flags = response_flags(request_flags, true, rcode);
    let mut response = response_header(id, flags, 1, answers.len() as u16, authority.len() as u16);
    write_question(&mut response, question);
    for record in answers {
        record.write(&mut response, &question.name);
    }
    for record in authority {
        record.write(&mut response, &question.name);
    }
    response
}

fn error_response(id: u16, request_flags: u16, rcode: u16, question: Option<&Question>) -> Vec<u8> {
    let authoritative = question.is_some_and(|question| question.name.is_in_zone());
    let mut response = response_header(
        id,
        response_flags(request_flags, authoritative, rcode),
        u16::from(question.is_some()),
        0,
        0,
    );
    if let Some(question) = question {
        write_question(&mut response, question);
    }
    response
}

fn response_flags(request_flags: u16, authoritative: bool, rcode: u16) -> u16 {
    0x8000 | (request_flags & 0x0100) | if authoritative { 0x0400 } else { 0 } | rcode
}

fn response_header(id: u16, flags: u16, questions: u16, answers: u16, authority: u16) -> Vec<u8> {
    let mut response = Vec::with_capacity(512);
    push_u16(&mut response, id);
    push_u16(&mut response, flags);
    push_u16(&mut response, questions);
    push_u16(&mut response, answers);
    push_u16(&mut response, authority);
    push_u16(&mut response, 0);
    response
}

fn write_question(output: &mut Vec<u8>, question: &Question) {
    write_name(output, &question.name.0);
    push_u16(output, question.qtype);
    push_u16(output, question.qclass);
}

enum ResourceRecord {
    A(Ipv4Addr),
    Ns(&'static [&'static [u8]]),
    Soa,
    CaaIssue,
    CaaIssueWild,
}

impl ResourceRecord {
    fn a(address: Ipv4Addr) -> Self {
        Self::A(address)
    }

    fn ns(name: &'static [&'static [u8]]) -> Self {
        Self::Ns(name)
    }

    fn soa() -> Self {
        Self::Soa
    }

    fn caa_issue() -> Self {
        Self::CaaIssue
    }

    fn caa_issuewild() -> Self {
        Self::CaaIssueWild
    }

    fn write(self, output: &mut Vec<u8>, owner: &Name) {
        if matches!(&self, Self::Soa) {
            write_name(output, ZONE);
        } else {
            write_name(output, &owner.0);
        }
        let (record_type, rdata) = match self {
            Self::A(address) => (TYPE_A, address.octets().to_vec()),
            Self::Ns(name) => {
                let mut rdata = Vec::new();
                write_name(&mut rdata, name);
                (TYPE_NS, rdata)
            }
            Self::Soa => {
                let mut rdata = Vec::new();
                write_name(&mut rdata, PRIMARY_NS);
                write_name(&mut rdata, SOA_MAILBOX);
                push_u32(&mut rdata, 2_026_071_701);
                push_u32(&mut rdata, 3_600);
                push_u32(&mut rdata, 600);
                push_u32(&mut rdata, 604_800);
                push_u32(&mut rdata, TTL);
                (TYPE_SOA, rdata)
            }
            Self::CaaIssue => {
                let mut rdata = Vec::from([0_u8, 5_u8]);
                rdata.extend_from_slice(b"issue");
                rdata.extend_from_slice(b"letsencrypt.org");
                (TYPE_CAA, rdata)
            }
            Self::CaaIssueWild => {
                let mut rdata = Vec::from([0_u8, 9_u8]);
                rdata.extend_from_slice(b"issuewild");
                rdata.push(b';');
                (TYPE_CAA, rdata)
            }
        };
        push_u16(output, record_type);
        push_u16(output, CLASS_IN);
        push_u32(output, TTL);
        push_u16(output, rdata.len() as u16);
        output.extend_from_slice(&rdata);
    }
}

fn write_name(output: &mut Vec<u8>, labels: &[impl AsRef<[u8]>]) {
    for label in labels {
        let label = label.as_ref();
        output.push(label.len() as u8);
        output.extend_from_slice(label);
    }
    output.push(0);
}

fn read_u16(input: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_be_bytes([
        *input.get(offset)?,
        *input.get(offset + 1)?,
    ]))
}

fn push_u16(output: &mut Vec<u8>, value: u16) {
    output.extend_from_slice(&value.to_be_bytes());
}

fn push_u32(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_be_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query(name: &[&str], qtype: u16) -> Vec<u8> {
        let mut request = response_header(0x1234, 0x0100, 1, 0, 0);
        for label in name {
            request.push(label.len() as u8);
            request.extend_from_slice(label.as_bytes());
        }
        request.push(0);
        push_u16(&mut request, qtype);
        push_u16(&mut request, CLASS_IN);
        request
    }

    fn counts(response: &[u8]) -> (u16, u16, u16) {
        (
            read_u16(response, 4).unwrap(),
            read_u16(response, 6).unwrap(),
            read_u16(response, 8).unwrap(),
        )
    }

    fn rcode(response: &[u8]) -> u16 {
        read_u16(response, 2).unwrap() & 0x000f
    }

    fn first_record(response: &[u8]) -> (u16, u32, Vec<u8>) {
        let (_, mut offset) = parse_name(response, 12).unwrap();
        offset += 4;
        let (_, next) = parse_name(response, offset).unwrap();
        let record_type = read_u16(response, next).unwrap();
        let ttl = u32::from_be_bytes(response[next + 4..next + 8].try_into().unwrap());
        let length = read_u16(response, next + 8).unwrap() as usize;
        (
            record_type,
            ttl,
            response[next + 10..next + 10 + length].to_vec(),
        )
    }

    #[test]
    fn resolves_encoded_ipv4_a_record_with_short_ttl() {
        let request = query(&["v4-11-22-33-44", "relay", "playarr", "app"], TYPE_A);
        let response = handle_packet(&request).unwrap();

        assert_eq!(rcode(&response), RCODE_NOERROR);
        assert_eq!(counts(&response), (1, 1, 0));
        assert_eq!(first_record(&response), (TYPE_A, TTL, vec![11, 22, 33, 44]));
        assert_ne!(read_u16(&response, 2).unwrap() & 0x0400, 0);
        assert_eq!(read_u16(&response, 2).unwrap() & 0x0080, 0);
    }

    #[test]
    fn invalid_ipv4_octet_is_nxdomain_with_soa() {
        let request = query(&["v4-11-22-33-999", "relay", "playarr", "app"], TYPE_A);
        let response = handle_packet(&request).unwrap();

        assert_eq!(rcode(&response), RCODE_NXDOMAIN);
        assert_eq!(counts(&response), (1, 0, 1));
        assert_eq!(first_record(&response).0, TYPE_SOA);
    }

    #[test]
    fn existing_ipv4_hostname_returns_aaaa_nodata() {
        let request = query(&["v4-11-22-33-44", "relay", "playarr", "app"], TYPE_AAAA);
        let response = handle_packet(&request).unwrap();

        assert_eq!(rcode(&response), RCODE_NOERROR);
        assert_eq!(counts(&response), (1, 0, 1));
        assert_eq!(first_record(&response).0, TYPE_SOA);
    }

    #[test]
    fn zone_apex_returns_delegated_authoritative_nameserver() {
        let request = query(&["relay", "playarr", "app"], TYPE_NS);
        let response = handle_packet(&request).unwrap();

        assert_eq!(rcode(&response), RCODE_NOERROR);
        assert_eq!(counts(&response), (1, 1, 0));
        assert_eq!(first_record(&response).0, TYPE_NS);
    }

    #[test]
    fn apex_and_generated_hostname_publish_letsencrypt_caa() {
        for name in [
            vec!["relay", "playarr", "app"],
            vec!["v4-11-22-33-44", "relay", "playarr", "app"],
        ] {
            let response = handle_packet(&query(&name, TYPE_CAA)).unwrap();
            let (record_type, _, rdata) = first_record(&response);
            assert_eq!(rcode(&response), RCODE_NOERROR);
            assert_eq!(counts(&response), (1, 2, 0));
            assert_eq!(record_type, TYPE_CAA);
            assert_eq!(rdata, b"\0\x05issueletsencrypt.org");
            assert!(response
                .windows(b"\0\x09issuewild;".len())
                .any(|window| window == b"\0\x09issuewild;"));
        }
    }

    #[test]
    fn malformed_compression_cycle_returns_formerr_without_question() {
        let mut request = response_header(0x1234, 0x0100, 1, 0, 0);
        request.extend_from_slice(&[0xc0, 0x0c, 0, TYPE_A as u8, 0, CLASS_IN as u8]);

        let response = handle_packet(&request).unwrap();

        assert_eq!(rcode(&response), RCODE_FORMERR);
        assert_eq!(counts(&response), (0, 0, 0));
    }

    #[test]
    fn names_outside_the_zone_are_refused_without_recursion() {
        let response = handle_packet(&query(&["example", "com"], TYPE_A)).unwrap();

        assert_eq!(rcode(&response), RCODE_REFUSED);
        assert_eq!(read_u16(&response, 2).unwrap() & 0x0080, 0);
    }

    #[test]
    fn any_query_is_refused_without_amplifying_records() {
        let response = handle_packet(&query(
            &["v4-11-22-33-44", "relay", "playarr", "app"],
            TYPE_ANY,
        ))
        .unwrap();

        assert_eq!(rcode(&response), RCODE_REFUSED);
        assert_eq!(counts(&response), (1, 0, 0));
    }

    #[test]
    fn udp_source_rate_limit_has_a_bounded_burst_and_refills() {
        let now = Instant::now();
        let source = IpAddr::V4(Ipv4Addr::new(11, 22, 33, 44));
        let mut limiter = UdpRateLimiter::new(now);

        for _ in 0..UDP_SOURCE_BURST as usize {
            assert!(limiter.allow(source, now));
        }
        assert!(!limiter.allow(source, now));

        let one_second_later = now + Duration::from_secs(1);
        for _ in 0..UDP_SOURCE_RATE_PER_SECOND as usize {
            assert!(limiter.allow(source, one_second_later));
        }
        assert!(!limiter.allow(source, one_second_later));
    }

    #[test]
    fn token_bucket_enforces_global_burst_and_refill() {
        let now = Instant::now();
        let mut bucket = TokenBucket::new(2.0, 1.0, now);

        assert!(bucket.take(now));
        assert!(bucket.take(now));
        assert!(!bucket.take(now));
        assert!(bucket.take(now + Duration::from_secs(1)));
        assert!(!bucket.take(now + Duration::from_secs(1)));
    }

    #[test]
    fn rejects_noncanonical_or_incomplete_ipv4_labels() {
        for label in [
            b"v4-11-22-33".as_slice(),
            b"v4-11-22-33-044",
            b"v4-11-22-33-44-extra",
            b"v6-11-22-33-44",
        ] {
            assert_eq!(parse_ipv4_label(label), None);
        }
    }

    #[test]
    fn rejects_private_and_reserved_ipv4_mappings() {
        for label in [
            b"v4-0-1-2-3".as_slice(),
            b"v4-10-1-2-3",
            b"v4-100-64-1-2",
            b"v4-127-0-0-1",
            b"v4-169-254-1-2",
            b"v4-172-16-1-2",
            b"v4-192-168-1-2",
            b"v4-198-18-1-2",
            b"v4-203-0-113-10",
            b"v4-224-0-0-1",
            b"v4-255-255-255-255",
        ] {
            assert_eq!(parse_ipv4_label(label), None, "{label:?}");
        }
    }

    #[test]
    fn negative_soa_is_owned_by_the_zone_apex() {
        let response = handle_packet(&query(
            &["v4-11-22-33-44", "relay", "playarr", "app"],
            TYPE_AAAA,
        ))
        .unwrap();
        let (_, question_end) = parse_name(&response, 12).unwrap();
        let (owner, _) = parse_name(&response, question_end + 4).unwrap();

        assert_eq!(
            owner,
            Name(ZONE.iter().map(|label| label.to_vec()).collect())
        );
    }
}
