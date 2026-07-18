import os
import unittest
from unittest.mock import patch

from vidaa_gateway.config import Settings


class SettingsTests(unittest.TestCase):
    def test_tls_material_is_required_by_default(self) -> None:
        with patch.dict(os.environ, {"VIDAA_RESOLVER_IPV4": "192.0.2.53"}, clear=True):
            with self.assertRaisesRegex(ValueError, "TLS is required"):
                Settings.from_env()

    def test_plaintext_is_an_explicit_development_switch(self) -> None:
        environment = {
            "VIDAA_RESOLVER_IPV4": "192.0.2.53",
            "VIDAA_ALLOW_PLAINTEXT_WEB": "true",
        }
        with patch.dict(os.environ, environment, clear=True):
            value = Settings.from_env()

        self.assertTrue(value.allow_plaintext_web)
        self.assertEqual(value.allowed_origins, frozenset({"https://playarr.app"}))
        self.assertEqual(value.activation_ttl_seconds, 1200)
        self.assertEqual(value.max_concurrent_dns_requests, 64)
        self.assertEqual(value.max_concurrent_web_requests, 32)

    def test_ttl_has_a_hard_upper_bound(self) -> None:
        environment = {
            "VIDAA_RESOLVER_IPV4": "192.0.2.53",
            "VIDAA_ALLOW_PLAINTEXT_WEB": "true",
            "VIDAA_ACTIVATION_TTL_SECONDS": "3601",
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(ValueError, "between 60 and 3600"):
                Settings.from_env()

    def test_per_source_dns_rate_cannot_exceed_global_rate(self) -> None:
        environment = {
            "VIDAA_RESOLVER_IPV4": "192.0.2.53",
            "VIDAA_ALLOW_PLAINTEXT_WEB": "true",
            "VIDAA_DNS_GLOBAL_RATE_PER_SECOND": "10",
            "VIDAA_DNS_SOURCE_RATE_PER_SECOND": "11",
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(ValueError, "cannot exceed"):
                Settings.from_env()

    def test_per_source_activation_rate_cannot_exceed_global_rate(self) -> None:
        environment = {
            "VIDAA_RESOLVER_IPV4": "192.0.2.53",
            "VIDAA_ALLOW_PLAINTEXT_WEB": "true",
            "VIDAA_ACTIVATION_RATE_LIMIT_PER_HOUR": "11",
            "VIDAA_ACTIVATION_GLOBAL_RATE_LIMIT_PER_HOUR": "10",
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(ValueError, "cannot exceed"):
                Settings.from_env()


if __name__ == "__main__":
    unittest.main()
