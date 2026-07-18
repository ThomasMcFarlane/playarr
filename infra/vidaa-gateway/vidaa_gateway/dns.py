from __future__ import annotations

import ipaddress
import socket
import socketserver
import struct
import threading
from dataclasses import dataclass
from typing import Callable

from .activation import ActivationRegistry, DnsQueryRateLimiter
from .server import BoundedThreadingMixIn


DNS_HEADER_SIZE = 12
DNS_PORT = 53
RCODE_FORMERR = 1
RCODE_SERVFAIL = 2
RCODE_REFUSED = 5
VIDAA_HOST = "vidaahub.com"
MAX_UDP_RESPONSE_SIZE = 1232


class DnsFormatError(ValueError):
    pass


@dataclass(frozen=True)
class Question:
    name: str
    query_type: int
    query_class: int
    end_offset: int


def parse_question(packet: bytes) -> Question:
    if len(packet) < DNS_HEADER_SIZE:
        raise DnsFormatError("DNS packet is shorter than its header")
    _, flags, question_count, _, _, _ = struct.unpack("!HHHHHH", packet[:DNS_HEADER_SIZE])
    if flags & 0x8000 or flags & 0x7800:
        raise DnsFormatError("only standard DNS queries are accepted")
    if question_count != 1:
        raise DnsFormatError("exactly one DNS question is required")

    labels: list[str] = []
    offset = DNS_HEADER_SIZE
    while True:
        if offset >= len(packet):
            raise DnsFormatError("unterminated DNS name")
        length = packet[offset]
        offset += 1
        if length == 0:
            break
        if length & 0xC0:
            raise DnsFormatError("compressed query names are not accepted")
        if length > 63 or offset + length > len(packet):
            raise DnsFormatError("invalid DNS label")
        try:
            labels.append(packet[offset : offset + length].decode("ascii"))
        except UnicodeDecodeError as error:
            raise DnsFormatError("DNS labels must be ASCII") from error
        offset += length
    if offset + 4 > len(packet):
        raise DnsFormatError("DNS question is truncated")
    query_type, query_class = struct.unpack("!HH", packet[offset : offset + 4])
    return Question(".".join(labels).lower(), query_type, query_class, offset + 4)


def error_response(packet: bytes, rcode: int, include_question: bool = True) -> bytes:
    query_id = packet[:2].ljust(2, b"\0")
    original_flags = struct.unpack("!H", packet[2:4])[0] if len(packet) >= 4 else 0
    flags = 0x8000 | (original_flags & 0x7900) | 0x0080 | rcode
    question_bytes = b""
    question_count = 0
    if include_question:
        try:
            question = parse_question(packet)
            question_bytes = packet[DNS_HEADER_SIZE : question.end_offset]
            question_count = 1
        except DnsFormatError:
            pass
    return query_id + struct.pack("!HHHHH", flags, question_count, 0, 0, 0) + question_bytes


def intercepted_response(packet: bytes, question: Question, resolver_ipv4: str, ttl: int = 60) -> bytes:
    query_id, original_flags = struct.unpack("!HH", packet[:4])
    flags = 0x8000 | (original_flags & 0x7900) | 0x0080
    answer_count = 1 if question.query_type == 1 and question.query_class == 1 else 0
    header = struct.pack("!HHHHHH", query_id, flags, 1, answer_count, 0, 0)
    question_bytes = packet[DNS_HEADER_SIZE : question.end_offset]
    if not answer_count:
        return header + question_bytes
    address = ipaddress.IPv4Address(resolver_ipv4).packed
    answer = b"\xc0\x0c" + struct.pack("!HHIH", 1, 1, ttl, len(address)) + address
    return header + question_bytes + answer


def truncated_response(packet: bytes, question: Question) -> bytes:
    query_id, original_flags = struct.unpack("!HH", packet[:4])
    flags = 0x8000 | (original_flags & 0x7900) | 0x0280
    return struct.pack("!HHHHHH", query_id, flags, 1, 0, 0, 0) + packet[DNS_HEADER_SIZE : question.end_offset]


class DnsResolver:
    def __init__(
        self,
        registry: ActivationRegistry,
        resolver_ipv4: str,
        upstream_ipv4: str,
        udp_forwarder: Callable[[bytes], bytes] | None = None,
        tcp_forwarder: Callable[[bytes], bytes] | None = None,
        query_rate_limiter: DnsQueryRateLimiter | None = None,
    ) -> None:
        self.registry = registry
        self.resolver_ipv4 = resolver_ipv4
        self.upstream_ipv4 = upstream_ipv4
        self._udp_forwarder = udp_forwarder or self._forward_udp
        self._tcp_forwarder = tcp_forwarder or self._forward_tcp
        self._query_rate_limiter = query_rate_limiter

    def resolve(self, packet: bytes, source_ip: str, transport: str) -> bytes:
        try:
            question = parse_question(packet)
        except DnsFormatError:
            if transport == "udp":
                return b""
            return error_response(packet, RCODE_FORMERR, include_question=False)
        if not self.registry.is_active(source_ip):
            if transport == "udp":
                return b""
            return error_response(packet, RCODE_REFUSED)
        if self._query_rate_limiter and not self._query_rate_limiter.permit(source_ip):
            if transport == "udp":
                return b""
            return error_response(packet, RCODE_REFUSED, include_question=False)
        if question.name == VIDAA_HOST:
            return intercepted_response(packet, question, self.resolver_ipv4)

        try:
            response = self._tcp_forwarder(packet) if transport == "tcp" else self._udp_forwarder(packet)
            if len(response) < DNS_HEADER_SIZE or response[:2] != packet[:2]:
                raise OSError("invalid upstream DNS response")
            if transport == "udp" and len(response) > MAX_UDP_RESPONSE_SIZE:
                return truncated_response(packet, question)
            return response
        except (OSError, TimeoutError):
            return error_response(packet, RCODE_SERVFAIL)

    def _forward_udp(self, packet: bytes) -> bytes:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as upstream:
            upstream.settimeout(3)
            upstream.connect((self.upstream_ipv4, DNS_PORT))
            upstream.send(packet)
            return upstream.recv(4096)

    def _forward_tcp(self, packet: bytes) -> bytes:
        with socket.create_connection((self.upstream_ipv4, DNS_PORT), timeout=3) as upstream:
            upstream.sendall(struct.pack("!H", len(packet)) + packet)
            size = struct.unpack("!H", _read_exact(upstream, 2))[0]
            return _read_exact(upstream, size)


def _read_exact(connection: socket.socket, size: int) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    while remaining:
        chunk = connection.recv(remaining)
        if not chunk:
            raise OSError("connection closed before DNS message completed")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


class _ThreadingUdpServer(BoundedThreadingMixIn, socketserver.UDPServer):
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request: object, client_address: object) -> None:
        # Avoid putting household IP addresses in exception logs.
        return


class _ThreadingTcpServer(BoundedThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request: object, client_address: object) -> None:
        # Avoid putting household IP addresses in exception logs.
        return


def make_udp_server(
    address: tuple[str, int],
    resolver: DnsResolver,
    max_workers: int = 64,
    request_slots: threading.BoundedSemaphore | None = None,
) -> socketserver.UDPServer:
    class Handler(socketserver.BaseRequestHandler):
        def handle(self) -> None:
            packet, connection = self.request
            response = resolver.resolve(packet, self.client_address[0], "udp")
            if response:
                connection.sendto(response, self.client_address)

    return _ThreadingUdpServer(
        address,
        Handler,
        max_workers=max_workers,
        request_slots=request_slots,
    )


def make_tcp_server(
    address: tuple[str, int],
    resolver: DnsResolver,
    max_workers: int = 64,
    request_slots: threading.BoundedSemaphore | None = None,
) -> socketserver.TCPServer:
    class Handler(socketserver.BaseRequestHandler):
        def handle(self) -> None:
            self.request.settimeout(5)
            size_bytes = _read_exact(self.request, 2)
            size = struct.unpack("!H", size_bytes)[0]
            packet = _read_exact(self.request, size)
            response = resolver.resolve(packet, self.client_address[0], "tcp")
            self.request.sendall(struct.pack("!H", len(response)) + response)

    return _ThreadingTcpServer(
        address,
        Handler,
        max_workers=max_workers,
        request_slots=request_slots,
    )
