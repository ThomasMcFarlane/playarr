//! Off-node replication of completed backups to an S3-compatible bucket
//! (MinIO, a NAS, any hosted provider).
//!
//! The local destination stays authoritative and unchanged. After a run has
//! published locally, every complete local backup the bucket lacks is uploaded
//! with a multipart upload whose parts carry SHA-256 checksums (the server
//! verifies each part as it arrives), read back with `HEAD` to compare the
//! server-held composite checksum and size, and only then committed by writing
//! the plaintext sidecar last, exactly as the local publish does. Retention is
//! then applied to the bucket with the same rules as the local destination.
//!
//! Requests are signed with AWS Signature Version 4; no SDK is used so the
//! behaviour on non-AWS endpoints is explicit and testable.

use std::collections::BTreeMap;
use std::fmt;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use chrono::{DateTime, NaiveDateTime, Utc};
use hmac::{Hmac, Mac};
use reqwest::{Method, StatusCode};
use sha2::{Digest, Sha256};
use tokio::io::AsyncReadExt;

use crate::error::{BackupError, Result};
use crate::manifest::{sidecar_file_name, Sidecar, ARCHIVE_EXTENSION, ARCHIVE_PREFIX};
use crate::store::{self, RetentionItem};

pub const MIN_PART_BYTES: usize = 5 * 1024 * 1024;
pub const DEFAULT_PART_MIB: usize = 16;
const MAX_PARTS: usize = 10_000;
const ATTEMPTS: u32 = 3;
/// Orphaned uploads and archives without a sidecar older than this are
/// leftovers of an interrupted run and are cleaned up.
const STALE_AFTER_HOURS: i64 = 24;

#[derive(Clone)]
pub struct S3Config {
    /// Base URL, for example `https://s3.example.com`.
    pub endpoint: String,
    pub bucket: String,
    /// Whatever the endpoint expects (some providers accept `auto`).
    pub region: String,
    /// Key prefix (a "folder"), normalised to end in `/` unless empty. Use one
    /// prefix per server when several share a bucket.
    pub prefix: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub path_style: bool,
    pub part_size: usize,
    /// Remote retention; `None` inherits the local setting.
    pub keep_last: Option<usize>,
    pub keep_days: Option<i64>,
}

impl fmt::Debug for S3Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("S3Config")
            .field("endpoint", &self.endpoint)
            .field("bucket", &self.bucket)
            .field("region", &self.region)
            .field("prefix", &self.prefix)
            .field("access_key_id", &"<redacted>")
            .field("secret_access_key", &"<redacted>")
            .field("path_style", &self.path_style)
            .field("part_size", &self.part_size)
            .finish()
    }
}

impl S3Config {
    /// Reads `PLAYARR_BACKUP_S3_*`. Off unless `PLAYARR_BACKUP_S3_BUCKET` is
    /// set; a half-configured destination is an error rather than a silent
    /// lack of off-node copies.
    pub fn from_lookup(lookup: &dyn Fn(&str) -> Option<String>) -> Result<Option<Self>> {
        let get = |key: &str| {
            lookup(key)
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        };
        let Some(bucket) = get("PLAYARR_BACKUP_S3_BUCKET") else {
            return Ok(None);
        };
        let region = get("PLAYARR_BACKUP_S3_REGION").unwrap_or_else(|| "auto".to_string());
        let endpoint = match get("PLAYARR_BACKUP_S3_ENDPOINT") {
            Some(endpoint) => endpoint,
            None if region != "auto" => format!("https://s3.{region}.amazonaws.com"),
            None => return Err(BackupError::Config(
                "PLAYARR_BACKUP_S3_ENDPOINT is required (or set PLAYARR_BACKUP_S3_REGION for AWS)"
                    .to_string(),
            )),
        };
        let url = reqwest::Url::parse(&endpoint).map_err(|_| {
            BackupError::Config("PLAYARR_BACKUP_S3_ENDPOINT is not a valid URL".into())
        })?;
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
            return Err(BackupError::Config(
                "PLAYARR_BACKUP_S3_ENDPOINT must be an http(s) URL".to_string(),
            ));
        }
        let access_key_id = get("PLAYARR_BACKUP_S3_ACCESS_KEY_ID").ok_or_else(|| {
            BackupError::Config("PLAYARR_BACKUP_S3_ACCESS_KEY_ID is required".to_string())
        })?;
        let secret_access_key = get("PLAYARR_BACKUP_S3_SECRET_ACCESS_KEY").ok_or_else(|| {
            BackupError::Config("PLAYARR_BACKUP_S3_SECRET_ACCESS_KEY is required".to_string())
        })?;
        let mut prefix = get("PLAYARR_BACKUP_S3_PREFIX").unwrap_or_default();
        prefix = prefix.trim_start_matches('/').to_string();
        if !prefix.is_empty() && !prefix.ends_with('/') {
            prefix.push('/');
        }
        let path_style = match get("PLAYARR_BACKUP_S3_PATH_STYLE").as_deref() {
            None | Some("true") | Some("1") => true,
            Some("false") | Some("0") => false,
            Some(_) => {
                return Err(BackupError::Config(
                    "PLAYARR_BACKUP_S3_PATH_STYLE must be true or false".to_string(),
                ))
            }
        };
        let number = |key: &str| -> Result<Option<u64>> {
            get(key)
                .map(|raw| {
                    raw.parse::<u64>().map_err(|_| {
                        BackupError::Config(format!("{key} must be a non-negative integer"))
                    })
                })
                .transpose()
        };
        let part_mib = number("PLAYARR_BACKUP_S3_PART_MIB")?.unwrap_or(DEFAULT_PART_MIB as u64);
        let part_size = (part_mib as usize).saturating_mul(1024 * 1024);
        if part_size < MIN_PART_BYTES {
            return Err(BackupError::Config(
                "PLAYARR_BACKUP_S3_PART_MIB must be at least 5".to_string(),
            ));
        }
        Ok(Some(Self {
            endpoint: endpoint.trim_end_matches('/').to_string(),
            bucket,
            region,
            prefix,
            access_key_id,
            secret_access_key,
            path_style,
            part_size,
            keep_last: number("PLAYARR_BACKUP_S3_KEEP_LAST")?.map(|v| (v as usize).max(1)),
            keep_days: number("PLAYARR_BACKUP_S3_KEEP_DAYS")?.map(|v| v as i64),
        }))
    }
}

// --------------------------------------------------------------------------
// Signature Version 4
// --------------------------------------------------------------------------

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

/// RFC 3986 percent-encoding as S3 requires (`/` kept when `keep_slash`).
fn uri_encode(input: &str, keep_slash: bool) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            b'/' if keep_slash => out.push('/'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn canonical_query(query: &[(&str, &str)]) -> String {
    let mut pairs: Vec<(String, String)> = query
        .iter()
        .map(|(k, v)| (uri_encode(k, false), uri_encode(v, false)))
        .collect();
    pairs.sort();
    pairs
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&")
}

/// Builds the `Authorization` header value. `headers` holds every header to
/// sign (lowercase names), including `host`, `x-amz-content-sha256` and
/// `x-amz-date`.
#[allow(clippy::too_many_arguments)]
pub(crate) fn authorization(
    access_key_id: &str,
    secret_access_key: &str,
    region: &str,
    method: &str,
    canonical_uri: &str,
    canonical_query: &str,
    headers: &BTreeMap<String, String>,
    payload_hash: &str,
    now: DateTime<Utc>,
) -> String {
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date = now.format("%Y%m%d").to_string();
    let canonical_headers: String = headers
        .iter()
        .map(|(name, value)| format!("{name}:{}\n", value.trim()))
        .collect();
    let signed_headers = headers.keys().cloned().collect::<Vec<_>>().join(";");
    let canonical_request = format!(
        "{method}\n{canonical_uri}\n{canonical_query}\n{canonical_headers}\n{signed_headers}\n{payload_hash}"
    );
    let scope = format!("{date}/{region}/s3/aws4_request");
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
        sha256_hex(canonical_request.as_bytes())
    );
    let k_date = hmac_sha256(
        format!("AWS4{secret_access_key}").as_bytes(),
        date.as_bytes(),
    );
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, b"s3");
    let k_signing = hmac_sha256(&k_service, b"aws4_request");
    let signature = hex::encode(hmac_sha256(&k_signing, string_to_sign.as_bytes()));
    format!(
        "AWS4-HMAC-SHA256 Credential={access_key_id}/{scope}, SignedHeaders={signed_headers}, Signature={signature}"
    )
}

// --------------------------------------------------------------------------
// Minimal XML helpers (the S3 responses used here are flat and simple)
// --------------------------------------------------------------------------

fn xml_unescape(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn xml_tag(source: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = source.find(&open)? + open.len();
    let end = source[start..].find(&close)? + start;
    Some(xml_unescape(&source[start..end]))
}

fn xml_blocks<'a>(source: &'a str, tag: &str) -> Vec<&'a str> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let mut blocks = Vec::new();
    let mut rest = source;
    while let Some(start) = rest.find(&open) {
        let body = &rest[start + open.len()..];
        let Some(end) = body.find(&close) else { break };
        blocks.push(&body[..end]);
        rest = &body[end + close.len()..];
    }
    blocks
}

// --------------------------------------------------------------------------
// Client
// --------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteObject {
    pub key: String,
    pub size: u64,
}

#[derive(Debug, Clone, Default)]
struct ObjectHead {
    size: u64,
    checksum_sha256: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteBackup {
    pub id: String,
    pub created_at: DateTime<Utc>,
    pub archive_name: String,
    pub archive_size: Option<u64>,
    pub has_sidecar: bool,
}

impl RemoteBackup {
    pub fn complete(&self) -> bool {
        self.archive_size.is_some() && self.has_sidecar
    }
}

/// How the bytes held by the bucket were confirmed to match the local archive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verified {
    /// The server-held composite SHA-256 and the size matched.
    ServerChecksum,
    /// The server did not report a usable checksum, so the object was read
    /// back in full and hashed.
    FullReadBack,
}

#[derive(Debug, Default, Clone)]
pub struct SyncReport {
    pub uploaded: Vec<String>,
    pub removed: Vec<String>,
}

#[derive(Clone)]
pub struct S3Store {
    config: Arc<S3Config>,
    http: reqwest::Client,
}

impl S3Store {
    pub fn new(config: S3Config) -> Self {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(900))
            .build()
            .unwrap_or_default();
        Self {
            config: Arc::new(config),
            http,
        }
    }

    pub fn config(&self) -> &S3Config {
        &self.config
    }

    fn object_key(&self, name: &str) -> String {
        format!("{}{name}", self.config.prefix)
    }

    /// Returns `(url, host header, canonical uri)` for a key (empty = bucket).
    fn locate(&self, key: &str, canonical_query: &str) -> Result<(String, String, String)> {
        let base = reqwest::Url::parse(&self.config.endpoint)
            .map_err(|_| BackupError::Config("invalid S3 endpoint".to_string()))?;
        let mut host = base
            .host_str()
            .ok_or_else(|| BackupError::Config("S3 endpoint has no host".to_string()))?
            .to_string();
        if !self.config.path_style {
            host = format!("{}.{host}", self.config.bucket);
        }
        let authority = match base.port() {
            Some(port) => format!("{host}:{port}"),
            None => host,
        };
        let encoded_key = uri_encode(key, true);
        let uri = if self.config.path_style {
            format!("/{}/{encoded_key}", uri_encode(&self.config.bucket, false))
        } else {
            format!("/{encoded_key}")
        };
        let mut url = format!("{}://{authority}{uri}", base.scheme());
        if !canonical_query.is_empty() {
            url.push('?');
            url.push_str(canonical_query);
        }
        Ok((url, authority, uri))
    }

    /// Sends one signed request, retrying transport errors, 429 and 5xx.
    /// Any other status is returned to the caller.
    async fn send_raw(
        &self,
        method: Method,
        key: &str,
        query: &[(&str, &str)],
        extra: &[(&str, String)],
        body: &[u8],
    ) -> Result<reqwest::Response> {
        let canonical_query = canonical_query(query);
        let payload_hash = sha256_hex(body);
        let mut last = String::new();
        for attempt in 0..ATTEMPTS {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
            }
            let (url, authority, uri) = self.locate(key, &canonical_query)?;
            let now = Utc::now();
            let mut headers: BTreeMap<String, String> = BTreeMap::new();
            headers.insert("host".into(), authority);
            headers.insert("x-amz-content-sha256".into(), payload_hash.clone());
            headers.insert(
                "x-amz-date".into(),
                now.format("%Y%m%dT%H%M%SZ").to_string(),
            );
            for (name, value) in extra {
                headers.insert(name.to_ascii_lowercase(), value.clone());
            }
            let auth = authorization(
                &self.config.access_key_id,
                &self.config.secret_access_key,
                &self.config.region,
                method.as_str(),
                &uri,
                &canonical_query,
                &headers,
                &payload_hash,
                now,
            );
            let mut request = self.http.request(method.clone(), &url);
            for (name, value) in &headers {
                if name != "host" {
                    request = request.header(name.as_str(), value.as_str());
                }
            }
            request = request.header("authorization", auth);
            if !body.is_empty() || method == Method::PUT || method == Method::POST {
                request = request.body(body.to_vec());
            }
            match request.send().await {
                Ok(response)
                    if response.status().is_server_error()
                        || response.status() == StatusCode::TOO_MANY_REQUESTS =>
                {
                    last = format!("HTTP {}", response.status());
                }
                Ok(response) => return Ok(response),
                Err(error) => last = format!("transport error: {}", error.without_url()),
            }
        }
        Err(BackupError::Remote(format!(
            "{method} {key}: {last} after {ATTEMPTS} attempts"
        )))
    }

    async fn send(
        &self,
        method: Method,
        key: &str,
        query: &[(&str, &str)],
        extra: &[(&str, String)],
        body: &[u8],
    ) -> Result<reqwest::Response> {
        let response = self
            .send_raw(method.clone(), key, query, extra, body)
            .await?;
        if response.status().is_success() {
            return Ok(response);
        }
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        let code = xml_tag(&text, "Code").unwrap_or_default();
        let message = xml_tag(&text, "Message").unwrap_or_default();
        Err(BackupError::Remote(format!(
            "{method} {key}: HTTP {status} {code} {message}"
        )))
    }

    async fn head(&self, key: &str) -> Result<Option<ObjectHead>> {
        let response = self
            .send_raw(
                Method::HEAD,
                key,
                &[],
                &[("x-amz-checksum-mode", "ENABLED".to_string())],
                &[],
            )
            .await?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(BackupError::Remote(format!(
                "HEAD {key}: HTTP {}",
                response.status()
            )));
        }
        let header = |name: &str| {
            response
                .headers()
                .get(name)
                .and_then(|v| v.to_str().ok())
                .map(str::to_string)
        };
        Ok(Some(ObjectHead {
            size: header("content-length")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
            checksum_sha256: header("x-amz-checksum-sha256"),
        }))
    }

    pub(crate) async fn delete(&self, key: &str) -> Result<()> {
        let response = self.send_raw(Method::DELETE, key, &[], &[], &[]).await?;
        if response.status().is_success() || response.status() == StatusCode::NOT_FOUND {
            Ok(())
        } else {
            Err(BackupError::Remote(format!(
                "DELETE {key}: HTTP {}",
                response.status()
            )))
        }
    }

    /// Reads an object back in full and returns its SHA-256 (hex) and size.
    pub(crate) async fn download_sha256(&self, key: &str) -> Result<(String, u64)> {
        let mut response = self.send(Method::GET, key, &[], &[], &[]).await?;
        let mut hasher = Sha256::new();
        let mut size = 0u64;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| BackupError::Remote(format!("GET {key}: {}", error.without_url())))?
        {
            size += chunk.len() as u64;
            hasher.update(&chunk);
        }
        Ok((hex::encode(hasher.finalize()), size))
    }

    /// Lists objects under the configured prefix (all pages).
    pub async fn list_objects(&self) -> Result<Vec<RemoteObject>> {
        let mut objects = Vec::new();
        let mut token: Option<String> = None;
        loop {
            let mut query = vec![("list-type", "2"), ("prefix", self.config.prefix.as_str())];
            if let Some(token) = token.as_deref() {
                query.push(("continuation-token", token));
            }
            let text = self
                .send(Method::GET, "", &query, &[], &[])
                .await?
                .text()
                .await
                .map_err(|error| BackupError::Remote(error.without_url().to_string()))?;
            for block in xml_blocks(&text, "Contents") {
                if let Some(key) = xml_tag(block, "Key") {
                    objects.push(RemoteObject {
                        key,
                        size: xml_tag(block, "Size")
                            .and_then(|v| v.parse().ok())
                            .unwrap_or(0),
                    });
                }
            }
            if xml_tag(&text, "IsTruncated").as_deref() == Some("true") {
                token = xml_tag(&text, "NextContinuationToken");
                if token.is_none() {
                    break;
                }
            } else {
                break;
            }
        }
        Ok(objects)
    }

    /// Backups held by the bucket, newest first.
    pub async fn list_backups(&self) -> Result<Vec<RemoteBackup>> {
        let objects = self.list_objects().await?;
        Ok(group_backups(&self.config.prefix, &objects))
    }

    // ----- upload ---------------------------------------------------------

    async fn upload_archive(
        &self,
        key: &str,
        path: &Path,
        sha256: &str,
        size: u64,
    ) -> Result<Verified> {
        let created = self
            .send(
                Method::POST,
                key,
                &[("uploads", "")],
                &[
                    ("x-amz-checksum-algorithm", "SHA256".to_string()),
                    ("x-amz-meta-archive-sha256", sha256.to_string()),
                    ("content-type", "application/octet-stream".to_string()),
                ],
                &[],
            )
            .await?
            .text()
            .await
            .map_err(|error| BackupError::Remote(error.without_url().to_string()))?;
        let upload_id = xml_tag(&created, "UploadId")
            .ok_or_else(|| BackupError::Remote("no UploadId in the response".to_string()))?;
        match self.upload_parts(key, &upload_id, path, sha256, size).await {
            Ok(verified) => Ok(verified),
            Err(error) => {
                let _ = self
                    .send_raw(Method::DELETE, key, &[("uploadId", &upload_id)], &[], &[])
                    .await;
                Err(error)
            }
        }
    }

    async fn upload_parts(
        &self,
        key: &str,
        upload_id: &str,
        path: &Path,
        sha256: &str,
        size: u64,
    ) -> Result<Verified> {
        let part_size = self.config.part_size;
        if (size as usize).div_ceil(part_size) > MAX_PARTS {
            return Err(BackupError::Remote(format!(
                "archive of {size} bytes needs more than {MAX_PARTS} parts; raise PLAYARR_BACKUP_S3_PART_MIB"
            )));
        }
        let mut file = tokio::fs::File::open(path).await?;
        let mut whole = Sha256::new();
        let mut composite = Sha256::new();
        let mut parts: Vec<(usize, String, String)> = Vec::new();
        let mut buffer = vec![0u8; part_size];
        loop {
            let mut filled = 0;
            while filled < part_size {
                let read = file.read(&mut buffer[filled..]).await?;
                if read == 0 {
                    break;
                }
                filled += read;
            }
            if filled == 0 && !parts.is_empty() {
                break;
            }
            let chunk = &buffer[..filled];
            whole.update(chunk);
            let digest = Sha256::digest(chunk);
            composite.update(digest);
            let checksum = B64.encode(digest);
            let number = parts.len() + 1;
            let response = self
                .send(
                    Method::PUT,
                    key,
                    &[("partNumber", &number.to_string()), ("uploadId", upload_id)],
                    &[("x-amz-checksum-sha256", checksum.clone())],
                    chunk,
                )
                .await?;
            let etag = response
                .headers()
                .get("etag")
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| BackupError::Remote(format!("part {number} returned no ETag")))?
                .to_string();
            parts.push((number, etag, checksum));
            if filled < part_size {
                break;
            }
        }
        if hex::encode(whole.finalize()) != sha256 {
            return Err(BackupError::Corrupt(
                "the local archive changed while it was being uploaded".to_string(),
            ));
        }
        let mut xml = String::from("<CompleteMultipartUpload>");
        for (number, etag, checksum) in &parts {
            xml.push_str(&format!(
                "<Part><PartNumber>{number}</PartNumber><ETag>{}</ETag><ChecksumSHA256>{checksum}</ChecksumSHA256></Part>",
                xml_escape(etag)
            ));
        }
        xml.push_str("</CompleteMultipartUpload>");
        let text = self
            .send(
                Method::POST,
                key,
                &[("uploadId", upload_id)],
                &[("content-type", "application/xml".to_string())],
                xml.as_bytes(),
            )
            .await?
            .text()
            .await
            .map_err(|error| BackupError::Remote(error.without_url().to_string()))?;
        // CompleteMultipartUpload can answer 200 with an error document.
        if text.contains("<Error>") {
            return Err(BackupError::Remote(format!(
                "completing {key}: {} {}",
                xml_tag(&text, "Code").unwrap_or_default(),
                xml_tag(&text, "Message").unwrap_or_default()
            )));
        }

        let expected = format!("{}-{}", B64.encode(composite.finalize()), parts.len());
        match self.verify_archive(key, sha256, size, &expected).await {
            Ok(verified) => Ok(verified),
            Err(error) => {
                let _ = self.delete(key).await;
                Err(error)
            }
        }
    }

    /// Read-back verification: size, then the server-held composite checksum;
    /// when the server does not report one, a full read-back and hash.
    async fn verify_archive(
        &self,
        key: &str,
        sha256: &str,
        size: u64,
        expected_composite: &str,
    ) -> Result<Verified> {
        let head = self.head(key).await?.ok_or_else(|| {
            BackupError::Corrupt("the uploaded archive is not visible in the bucket".to_string())
        })?;
        if head.size != size {
            return Err(BackupError::Corrupt(format!(
                "the bucket holds {} bytes for an archive of {size} bytes",
                head.size
            )));
        }
        match head.checksum_sha256.as_deref() {
            Some(reported) if reported == expected_composite => Ok(Verified::ServerChecksum),
            _ => {
                let (actual, actual_size) = self.download_sha256(key).await?;
                if actual == sha256 && actual_size == size {
                    Ok(Verified::FullReadBack)
                } else {
                    Err(BackupError::Corrupt(
                        "the archive read back from the bucket does not match the local archive"
                            .to_string(),
                    ))
                }
            }
        }
    }

    async fn put_sidecar(&self, key: &str, sidecar: &Sidecar) -> Result<()> {
        let body = serde_json::to_vec_pretty(sidecar)?;
        let checksum = B64.encode(Sha256::digest(&body));
        self.send(
            Method::PUT,
            key,
            &[],
            &[
                ("x-amz-checksum-sha256", checksum.clone()),
                ("content-type", "application/json".to_string()),
            ],
            &body,
        )
        .await?;
        let head = self.head(key).await?.ok_or_else(|| {
            BackupError::Corrupt("the sidecar is not visible in the bucket".into())
        })?;
        let matches = head.size == body.len() as u64
            && head
                .checksum_sha256
                .as_deref()
                .map(|reported| reported == checksum)
                .unwrap_or(true);
        if !matches {
            let _ = self.delete(key).await;
            return Err(BackupError::Corrupt(
                "the sidecar read back from the bucket does not match".to_string(),
            ));
        }
        Ok(())
    }

    /// Uploads one local backup: archive first, verified, then the sidecar as
    /// the commit marker.
    pub async fn upload_backup(&self, dir: &Path, sidecar: &Sidecar) -> Result<Verified> {
        let archive_key = self.object_key(&sidecar.archive_name);
        let sidecar_key = self.object_key(&sidecar_file_name(&sidecar.archive_name));
        let verified = self
            .upload_archive(
                &archive_key,
                &dir.join(&sidecar.archive_name),
                &sidecar.archive_sha256,
                sidecar.archive_size,
            )
            .await?;
        if let Err(error) = self.put_sidecar(&sidecar_key, sidecar).await {
            let _ = self.delete(&archive_key).await;
            return Err(error);
        }
        Ok(verified)
    }

    // ----- retention and housekeeping --------------------------------------

    /// Applies the local retention rules to the bucket. Returns the ids removed.
    pub async fn apply_retention(
        &self,
        keep_last: usize,
        keep_days: i64,
        now: DateTime<Utc>,
    ) -> Result<Vec<String>> {
        let backups = self.list_backups().await?;
        let stale = now - chrono::Duration::hours(STALE_AFTER_HOURS);
        let mut removed = Vec::new();
        // Recent archives without a sidecar may be an upload in flight.
        let (candidates, _in_flight): (Vec<_>, Vec<_>) = backups
            .iter()
            .partition(|b| b.has_sidecar || b.created_at < stale);
        let items: Vec<RetentionItem> = candidates
            .iter()
            .map(|b| RetentionItem {
                id: b.id.clone(),
                created_at: b.created_at,
                complete: b.complete(),
            })
            .collect();
        for index in store::plan_retention(&items, keep_last, keep_days, now) {
            let backup = candidates[index];
            // Sidecar first: without it the archive is no longer advertised.
            self.delete(&self.object_key(&sidecar_file_name(&backup.archive_name)))
                .await?;
            self.delete(&self.object_key(&backup.archive_name)).await?;
            removed.push(backup.id.clone());
        }
        self.abort_stale_uploads(now).await;
        Ok(removed)
    }

    async fn abort_stale_uploads(&self, now: DateTime<Utc>) {
        let query = [("uploads", ""), ("prefix", self.config.prefix.as_str())];
        let Ok(response) = self.send(Method::GET, "", &query, &[], &[]).await else {
            return;
        };
        let Ok(text) = response.text().await else {
            return;
        };
        for block in xml_blocks(&text, "Upload") {
            let (Some(key), Some(id)) = (xml_tag(block, "Key"), xml_tag(block, "UploadId")) else {
                continue;
            };
            let old = xml_tag(block, "Initiated")
                .and_then(|v| DateTime::parse_from_rfc3339(&v).ok())
                .map(|at| at.with_timezone(&Utc) < now - chrono::Duration::hours(STALE_AFTER_HOURS))
                .unwrap_or(false);
            if old {
                let _ = self
                    .send_raw(Method::DELETE, &key, &[("uploadId", &id)], &[], &[])
                    .await;
            }
        }
    }

    /// Uploads every complete local backup the bucket lacks (newest first),
    /// then applies retention to the bucket.
    pub async fn sync(
        &self,
        dir: &Path,
        keep_last: usize,
        keep_days: i64,
        now: DateTime<Utc>,
    ) -> Result<SyncReport> {
        let mut report = SyncReport::default();
        let remote = self.list_backups().await?;
        for record in store::list_backups(dir)? {
            if !record.complete {
                continue;
            }
            let id = &record.sidecar.manifest.backup_id;
            if remote.iter().any(|b| &b.id == id && b.complete()) {
                continue;
            }
            let verified = self.upload_backup(dir, &record.sidecar).await?;
            tracing::info!(
                backup_id = %id,
                bytes = record.sidecar.archive_size,
                verified = ?verified,
                "backup replicated off-node"
            );
            report.uploaded.push(id.clone());
        }
        report.removed = self
            .apply_retention(
                self.config.keep_last.unwrap_or(keep_last),
                self.config.keep_days.unwrap_or(keep_days),
                now,
            )
            .await?;
        Ok(report)
    }
}

/// Parses `playarr-backup-<timestamp>-<id>.parbak[.json]` object keys into
/// per-backup records, newest first.
pub(crate) fn group_backups(prefix: &str, objects: &[RemoteObject]) -> Vec<RemoteBackup> {
    let mut by_id: BTreeMap<String, RemoteBackup> = BTreeMap::new();
    for object in objects {
        let Some(name) = object.key.strip_prefix(prefix) else {
            continue;
        };
        let (archive_name, is_sidecar) = match name.strip_suffix(".json") {
            Some(archive) => (archive, true),
            None => (name, false),
        };
        let Some(stem) = archive_name
            .strip_prefix(ARCHIVE_PREFIX)
            .and_then(|rest| rest.strip_suffix(&format!(".{ARCHIVE_EXTENSION}")))
        else {
            continue;
        };
        let Some((stamp, id)) = stem.split_once('-').filter(|(stamp, _)| stamp.len() == 16) else {
            continue;
        };
        let Ok(created) = NaiveDateTime::parse_from_str(stamp, "%Y%m%dT%H%M%SZ") else {
            continue;
        };
        let entry = by_id.entry(id.to_string()).or_insert_with(|| RemoteBackup {
            id: id.to_string(),
            created_at: created.and_utc(),
            archive_name: archive_name.to_string(),
            archive_size: None,
            has_sidecar: false,
        });
        if is_sidecar {
            entry.has_sidecar = true;
        } else {
            entry.archive_size = Some(object.size);
        }
    }
    let mut backups: Vec<RemoteBackup> = by_id.into_values().collect();
    backups.sort_by_key(|b| std::cmp::Reverse(b.created_at));
    backups
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn signature_matches_the_aws_documentation_example() {
        // "GET Object" example from the S3 Signature Version 4 documentation.
        let now = DateTime::parse_from_rfc3339("2013-05-24T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut headers = BTreeMap::new();
        headers.insert(
            "host".to_string(),
            "examplebucket.s3.amazonaws.com".to_string(),
        );
        headers.insert("range".to_string(), "bytes=0-9".to_string());
        headers.insert(
            "x-amz-content-sha256".to_string(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string(),
        );
        headers.insert("x-amz-date".to_string(), "20130524T000000Z".to_string());
        let auth = authorization(
            "AKIAIOSFODNN7EXAMPLE",
            "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            "us-east-1",
            "GET",
            "/test.txt",
            "",
            &headers,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            now,
        );
        assert!(auth.ends_with(
            "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
        ));
        assert!(auth.contains("SignedHeaders=host;range;x-amz-content-sha256;x-amz-date"));
    }

    #[test]
    fn uri_encoding_and_query_ordering() {
        assert_eq!(uri_encode("a b/c+d~", true), "a%20b/c%2Bd~");
        assert_eq!(uri_encode("a/b", false), "a%2Fb");
        assert_eq!(
            canonical_query(&[("prefix", "x/y"), ("list-type", "2"), ("uploads", "")]),
            "list-type=2&prefix=x%2Fy&uploads="
        );
    }

    #[test]
    fn keys_group_into_backups() {
        let obj = |key: &str, size| RemoteObject {
            key: key.to_string(),
            size,
        };
        let objects = vec![
            obj("p/playarr-backup-20260101T000000Z-aaa.parbak", 10),
            obj("p/playarr-backup-20260101T000000Z-aaa.parbak.json", 2),
            obj("p/playarr-backup-20260102T000000Z-bbb.parbak", 10),
            obj("p/other.txt", 1),
            obj("q/playarr-backup-20260103T000000Z-ccc.parbak", 10),
        ];
        let backups = group_backups("p/", &objects);
        assert_eq!(backups.len(), 2);
        assert_eq!(backups[0].id, "bbb");
        assert!(!backups[0].complete());
        assert_eq!(backups[1].id, "aaa");
        assert!(backups[1].complete());
    }

    #[test]
    fn config_requires_credentials_and_hides_them_from_debug() {
        let map = |pairs: &'static [(&'static str, &'static str)]| {
            move |key: &str| {
                pairs
                    .iter()
                    .find(|(k, _)| *k == key)
                    .map(|(_, v)| v.to_string())
            }
        };
        assert!(S3Config::from_lookup(&map(&[])).unwrap().is_none());
        assert!(S3Config::from_lookup(&map(&[("PLAYARR_BACKUP_S3_BUCKET", "b")])).is_err());
        let config = S3Config::from_lookup(&map(&[
            ("PLAYARR_BACKUP_S3_BUCKET", "b"),
            ("PLAYARR_BACKUP_S3_ENDPOINT", "https://s3.example.com/"),
            ("PLAYARR_BACKUP_S3_ACCESS_KEY_ID", "AKID-VISIBLE?"),
            ("PLAYARR_BACKUP_S3_SECRET_ACCESS_KEY", "SECRET-VALUE"),
            ("PLAYARR_BACKUP_S3_PREFIX", "/site-a"),
        ]))
        .unwrap()
        .unwrap();
        assert_eq!(config.prefix, "site-a/");
        assert_eq!(config.endpoint, "https://s3.example.com");
        assert_eq!(config.region, "auto");
        assert!(config.path_style);
        let debug = format!("{config:?}");
        assert!(!debug.contains("SECRET-VALUE") && !debug.contains("AKID-VISIBLE"));
        assert!(S3Config::from_lookup(&map(&[
            ("PLAYARR_BACKUP_S3_BUCKET", "b"),
            ("PLAYARR_BACKUP_S3_ENDPOINT", "https://x"),
            ("PLAYARR_BACKUP_S3_ACCESS_KEY_ID", "a"),
            ("PLAYARR_BACKUP_S3_SECRET_ACCESS_KEY", "s"),
            ("PLAYARR_BACKUP_S3_PART_MIB", "1"),
        ]))
        .is_err());
    }
}
