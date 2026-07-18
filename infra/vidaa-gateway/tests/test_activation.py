import ipaddress
import unittest

from vidaa_gateway.activation import (
    ActivationRateLimiter,
    ActivationRegistry,
    DnsQueryRateLimiter,
    resolve_source_ip,
)


class ActivationRegistryTests(unittest.TestCase):
    def test_activation_expires_and_token_deactivates_same_source(self) -> None:
        registry = ActivationRegistry(120)
        activation = registry.activate("192.0.2.10", now=1000)

        self.assertTrue(registry.is_active("192.0.2.10", now=1119))
        self.assertFalse(registry.deactivate("192.0.2.11", activation.token, now=1119))
        self.assertFalse(registry.deactivate("192.0.2.10", "wrong", now=1119))
        self.assertTrue(registry.deactivate("192.0.2.10", activation.token, now=1119))
        self.assertFalse(registry.is_active("192.0.2.10", now=1119))

    def test_expired_activation_is_refused(self) -> None:
        registry = ActivationRegistry(60)
        registry.activate("192.0.2.10", now=1000)

        self.assertFalse(registry.is_active("192.0.2.10", now=1060))

    def test_registry_capacity_is_bounded_and_reactivation_is_allowed(self) -> None:
        registry = ActivationRegistry(60, max_active=2)
        registry.activate("192.0.2.10", now=1000)
        registry.activate("192.0.2.11", now=1000)

        with self.assertRaisesRegex(RuntimeError, "capacity"):
            registry.activate("192.0.2.12", now=1001)

        registry.activate("192.0.2.10", now=1001)
        self.assertEqual(registry.active_count, 2)

    def test_expiry_releases_registry_capacity(self) -> None:
        registry = ActivationRegistry(60, max_active=1)
        registry.activate("192.0.2.10", now=1000)

        registry.activate("192.0.2.11", now=1060)

        self.assertFalse(registry.is_active("192.0.2.10", now=1060))
        self.assertTrue(registry.is_active("192.0.2.11", now=1060))

    def test_rate_limit_uses_rolling_hour(self) -> None:
        limiter = ActivationRateLimiter(2)

        self.assertTrue(limiter.permit("192.0.2.10", now=1000))
        self.assertTrue(limiter.permit("192.0.2.10", now=1001))
        self.assertFalse(limiter.permit("192.0.2.10", now=1002))
        self.assertTrue(limiter.permit("192.0.2.10", now=4601))

    def test_rate_limit_prunes_expired_source_keys_globally(self) -> None:
        limiter = ActivationRateLimiter(2)
        limiter.permit("192.0.2.10", now=1000)
        limiter.permit("192.0.2.11", now=1001)
        self.assertEqual(limiter.tracked_source_count, 2)

        limiter.permit("192.0.2.12", now=4602)

        self.assertEqual(limiter.tracked_source_count, 1)

    def test_global_limit_bounds_distributed_source_memory(self) -> None:
        limiter = ActivationRateLimiter(limit_per_hour=2, global_limit_per_hour=3)

        self.assertTrue(limiter.permit("192.0.2.10", now=1000))
        self.assertTrue(limiter.permit("192.0.2.11", now=1001))
        self.assertTrue(limiter.permit("192.0.2.12", now=1002))
        self.assertFalse(limiter.permit("192.0.2.13", now=1003))

        self.assertEqual(limiter.tracked_source_count, 3)

    def test_global_limit_prunes_after_rolling_hour(self) -> None:
        limiter = ActivationRateLimiter(limit_per_hour=2, global_limit_per_hour=2)
        limiter.permit("192.0.2.10", now=1000)
        limiter.permit("192.0.2.11", now=1001)

        self.assertTrue(limiter.permit("192.0.2.12", now=4602))

        self.assertEqual(limiter.tracked_source_count, 1)


class DnsQueryRateLimiterTests(unittest.TestCase):
    def test_enforces_per_source_and_global_limits(self) -> None:
        limiter = DnsQueryRateLimiter(global_limit=3, source_limit=2)

        self.assertTrue(limiter.permit("192.0.2.10", now=10))
        self.assertTrue(limiter.permit("192.0.2.10", now=10.1))
        self.assertFalse(limiter.permit("192.0.2.10", now=10.2))
        self.assertTrue(limiter.permit("192.0.2.11", now=10.3))
        self.assertFalse(limiter.permit("192.0.2.12", now=10.4))

    def test_prunes_expired_source_keys(self) -> None:
        limiter = DnsQueryRateLimiter(global_limit=3, source_limit=2)
        limiter.permit("192.0.2.10", now=10)
        limiter.permit("192.0.2.11", now=10.1)
        self.assertEqual(limiter.tracked_source_count, 2)

        self.assertTrue(limiter.permit("192.0.2.12", now=11.2))

        self.assertEqual(limiter.tracked_source_count, 1)


class SourceIpTests(unittest.TestCase):
    def test_forwarded_header_is_ignored_for_untrusted_peer(self) -> None:
        result = resolve_source_ip("192.0.2.10", "198.51.100.20", ())
        self.assertEqual(result, "192.0.2.10")

    def test_first_untrusted_hop_from_right_is_used(self) -> None:
        trusted = (ipaddress.ip_network("10.0.0.0/8"),)
        result = resolve_source_ip("10.0.0.4", "192.0.2.99, 198.51.100.20, 10.0.0.5", trusted)
        self.assertEqual(result, "198.51.100.20")

    def test_invalid_forwarded_header_falls_back_to_peer(self) -> None:
        trusted = (ipaddress.ip_network("10.0.0.0/8"),)
        result = resolve_source_ip("10.0.0.4", "not-an-ip", trusted)
        self.assertEqual(result, "10.0.0.4")


if __name__ == "__main__":
    unittest.main()
