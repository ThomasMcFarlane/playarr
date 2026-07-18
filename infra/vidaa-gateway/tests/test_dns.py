import ipaddress
import struct
import unittest

from vidaa_gateway.activation import ActivationRegistry, DnsQueryRateLimiter
from vidaa_gateway.dns import DnsResolver, parse_question


def query(name: str, query_type: int = 1, query_id: int = 0x1234) -> bytes:
    encoded_name = b"".join(bytes([len(label)]) + label.encode("ascii") for label in name.split(".")) + b"\0"
    return struct.pack("!HHHHHH", query_id, 0x0100, 1, 0, 0, 0) + encoded_name + struct.pack("!HH", query_type, 1)


def empty_response(packet: bytes) -> bytes:
    question = parse_question(packet)
    return packet[:2] + struct.pack("!HHHHH", 0x8180, 1, 0, 0, 0) + packet[12 : question.end_offset]


class DnsResolverTests(unittest.TestCase):
    def setUp(self) -> None:
        self.registry = ActivationRegistry(1200)
        self.udp_queries: list[bytes] = []
        self.tcp_queries: list[bytes] = []

        def udp_forward(packet: bytes) -> bytes:
            self.udp_queries.append(packet)
            return empty_response(packet)

        def tcp_forward(packet: bytes) -> bytes:
            self.tcp_queries.append(packet)
            return empty_response(packet)

        self.resolver = DnsResolver(
            self.registry,
            "192.0.2.53",
            "1.1.1.1",
            udp_forwarder=udp_forward,
            tcp_forwarder=tcp_forward,
        )

    def test_inactive_udp_client_is_silently_dropped_without_forwarding(self) -> None:
        response = self.resolver.resolve(query("example.com"), "192.0.2.10", "udp")

        self.assertEqual(response, b"")
        self.assertEqual(self.udp_queries, [])

    def test_inactive_tcp_client_is_refused_without_forwarding(self) -> None:
        response = self.resolver.resolve(query("example.com"), "192.0.2.10", "tcp")

        flags = struct.unpack("!H", response[2:4])[0]
        self.assertEqual(flags & 0xF, 5)
        self.assertEqual(self.udp_queries, [])

    def test_active_client_receives_intercepted_vidaa_a_record(self) -> None:
        self.registry.activate("192.0.2.10")
        response = self.resolver.resolve(query("vidaahub.com"), "192.0.2.10", "udp")

        answer_count = struct.unpack("!H", response[6:8])[0]
        self.assertEqual(answer_count, 1)
        self.assertTrue(response.endswith(ipaddress.ip_address("192.0.2.53").packed))
        self.assertEqual(self.udp_queries, [])

    def test_vidaa_aaaa_is_intercepted_with_no_data(self) -> None:
        self.registry.activate("192.0.2.10")
        response = self.resolver.resolve(query("vidaahub.com", query_type=28), "192.0.2.10", "udp")

        self.assertEqual(struct.unpack("!H", response[6:8])[0], 0)
        self.assertEqual(self.udp_queries, [])

    def test_only_exact_vidaa_hostname_is_intercepted(self) -> None:
        packet = query("sub.vidaahub.com")
        self.registry.activate("192.0.2.10")
        response = self.resolver.resolve(packet, "192.0.2.10", "udp")

        self.assertEqual(response, empty_response(packet))
        self.assertEqual(self.udp_queries, [packet])

    def test_active_ordinary_query_uses_requested_transport(self) -> None:
        packet = query("example.com")
        self.registry.activate("192.0.2.10")

        self.resolver.resolve(packet, "192.0.2.10", "tcp")

        self.assertEqual(self.tcp_queries, [packet])
        self.assertEqual(self.udp_queries, [])

    def test_malformed_udp_query_is_dropped_without_reflection(self) -> None:
        response = self.resolver.resolve(b"\x12\x34", "192.0.2.10", "udp")

        self.assertEqual(response, b"")

    def test_malformed_tcp_query_returns_format_error(self) -> None:
        response = self.resolver.resolve(b"\x12\x34", "192.0.2.10", "tcp")
        flags = struct.unpack("!H", response[2:4])[0]
        self.assertEqual(flags & 0xF, 1)

    def test_udp_query_rate_limit_drops_without_forwarding(self) -> None:
        packet = query("example.com")
        self.registry.activate("192.0.2.10")
        resolver = DnsResolver(
            self.registry,
            "192.0.2.53",
            "1.1.1.1",
            udp_forwarder=lambda value: empty_response(value),
            query_rate_limiter=DnsQueryRateLimiter(global_limit=1, source_limit=1),
        )
        resolver.resolve(packet, "192.0.2.10", "udp")

        response = resolver.resolve(packet, "192.0.2.10", "udp")

        self.assertEqual(response, b"")

    def test_tcp_query_rate_limit_refuses_without_forwarding(self) -> None:
        packet = query("example.com")
        self.registry.activate("192.0.2.10")
        resolver = DnsResolver(
            self.registry,
            "192.0.2.53",
            "1.1.1.1",
            tcp_forwarder=lambda value: empty_response(value),
            query_rate_limiter=DnsQueryRateLimiter(global_limit=1, source_limit=1),
        )
        resolver.resolve(packet, "192.0.2.10", "tcp")

        response = resolver.resolve(packet, "192.0.2.10", "tcp")

        self.assertEqual(struct.unpack("!H", response[2:4])[0] & 0xF, 5)

    def test_inactive_queries_do_not_consume_active_dns_allowance(self) -> None:
        packet = query("vidaahub.com")
        self.registry.activate("192.0.2.10")
        resolver = DnsResolver(
            self.registry,
            "192.0.2.53",
            "1.1.1.1",
            query_rate_limiter=DnsQueryRateLimiter(global_limit=1, source_limit=1),
        )

        for position in range(100):
            response = resolver.resolve(packet, f"192.0.2.{position + 100}", "udp")
            self.assertEqual(response, b"")

        active_response = resolver.resolve(packet, "192.0.2.10", "udp")

        self.assertEqual(struct.unpack("!H", active_response[6:8])[0], 1)

    def test_large_udp_upstream_response_is_truncated_safely(self) -> None:
        packet = query("example.com")
        self.registry.activate("192.0.2.10")

        def oversized(value: bytes) -> bytes:
            response = empty_response(value)
            return response + (b"x" * 2000)

        resolver = DnsResolver(
            self.registry,
            "192.0.2.53",
            "1.1.1.1",
            udp_forwarder=oversized,
        )
        response = resolver.resolve(packet, "192.0.2.10", "udp")

        flags = struct.unpack("!H", response[2:4])[0]
        self.assertTrue(flags & 0x0200)
        self.assertLess(len(response), 512)


if __name__ == "__main__":
    unittest.main()
