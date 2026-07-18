import json
import unittest
from pathlib import Path

from vidaa_gateway.activation import ActivationRateLimiter, ActivationRegistry
from vidaa_gateway.config import Settings
from vidaa_gateway.http import CANONICAL_ACTIVATION_PATH, GatewayApplication, tls_certificate_role


def settings() -> Settings:
    return Settings(
        resolver_ipv4="192.0.2.53",
        upstream_dns_ipv4="1.1.1.1",
        dns_bind="127.0.0.1",
        dns_port=5353,
        web_bind="127.0.0.1",
        web_port=8443,
        health_bind="127.0.0.1",
        health_port=8080,
        activation_ttl_seconds=1200,
        activation_rate_limit_per_hour=10,
        activation_global_rate_limit_per_hour=1000,
        max_active_activations=1000,
        dns_global_rate_per_second=500,
        dns_source_rate_per_second=50,
        max_concurrent_dns_requests=64,
        max_concurrent_web_requests=32,
        allowed_origins=frozenset({"https://playarr.app"}),
        trusted_proxy_networks=(),
        api_cert_file=None,
        api_key_file=None,
        portal_cert_file=None,
        portal_key_file=None,
        allow_plaintext_web=True,
        allow_non_global_clients=True,
    )


class GatewayApplicationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.registry = ActivationRegistry(1200)
        self.application = GatewayApplication(settings(), self.registry, ActivationRateLimiter(10))
        self.headers = {"Host": "dns.playarr.app", "Origin": "https://playarr.app"}

    def test_activation_contract_and_cors(self) -> None:
        response = self.application.handle("POST", CANONICAL_ACTIVATION_PATH, self.headers, "192.0.2.10")
        payload = json.loads(response.body)

        self.assertEqual(response.status, 201)
        self.assertEqual(payload["dns_server"], "192.0.2.53")
        self.assertEqual(payload["portal_url"], "https://vidaahub.com/")
        self.assertEqual(payload["ttl_seconds"], 1200)
        self.assertIn("deactivation_token", payload)
        self.assertIn(("Access-Control-Allow-Origin", "https://playarr.app"), response.headers)
        self.assertTrue(self.registry.is_active("192.0.2.10"))

    def test_compatibility_contract_uses_resolver_ipv4(self) -> None:
        response = self.application.handle("POST", "/api/v1/activations", self.headers, "192.0.2.10")
        payload = json.loads(response.body)

        self.assertEqual(payload["resolver_ipv4"], "192.0.2.53")
        self.assertNotIn("dns_server", payload)

    def test_deactivation_requires_returned_token_and_same_source(self) -> None:
        activation = self.application.handle("POST", CANONICAL_ACTIVATION_PATH, self.headers, "192.0.2.10")
        token = json.loads(activation.body)["deactivation_token"]

        wrong_source = self.application.handle(
            "DELETE",
            CANONICAL_ACTIVATION_PATH,
            {**self.headers, "Authorization": f"Bearer {token}"},
            "192.0.2.11",
        )
        success = self.application.handle(
            "DELETE",
            CANONICAL_ACTIVATION_PATH,
            {**self.headers, "Authorization": f"Bearer {token}"},
            "192.0.2.10",
        )

        self.assertEqual(wrong_source.status, 401)
        self.assertEqual(success.status, 204)

    def test_unapproved_origin_is_rejected(self) -> None:
        response = self.application.handle(
            "POST",
            CANONICAL_ACTIVATION_PATH,
            {"Host": "dns.playarr.app", "Origin": "https://example.invalid"},
            "192.0.2.10",
        )
        self.assertEqual(response.status, 403)
        self.assertFalse(self.registry.is_active("192.0.2.10"))

    def test_distributed_activation_rate_is_globally_bounded(self) -> None:
        application = GatewayApplication(settings(), self.registry, ActivationRateLimiter(2, 2))

        first = application.handle("POST", CANONICAL_ACTIVATION_PATH, self.headers, "192.0.2.10")
        second = application.handle("POST", CANONICAL_ACTIVATION_PATH, self.headers, "192.0.2.11")
        limited = application.handle("POST", CANONICAL_ACTIVATION_PATH, self.headers, "192.0.2.12")

        self.assertEqual(first.status, 201)
        self.assertEqual(second.status, 201)
        self.assertEqual(limited.status, 429)
        self.assertEqual(self.registry.active_count, 2)

    def test_activation_registry_capacity_returns_service_unavailable(self) -> None:
        registry = ActivationRegistry(1200, max_active=1)
        application = GatewayApplication(settings(), registry, ActivationRateLimiter(10, 100))
        application.handle("POST", CANONICAL_ACTIVATION_PATH, self.headers, "192.0.2.10")

        response = application.handle("POST", CANONICAL_ACTIVATION_PATH, self.headers, "192.0.2.11")
        payload = json.loads(response.body)

        self.assertEqual(response.status, 503)
        self.assertEqual(payload["error"]["code"], "activation_capacity_reached")

    def test_forwarded_ip_is_ignored_without_trusted_proxy(self) -> None:
        response = self.application.handle(
            "POST",
            CANONICAL_ACTIVATION_PATH,
            {**self.headers, "X-Forwarded-For": "192.0.2.99"},
            "192.0.2.10",
        )
        self.assertEqual(response.status, 201)
        self.assertTrue(self.registry.is_active("192.0.2.10"))
        self.assertFalse(self.registry.is_active("192.0.2.99"))

    def test_portal_serves_only_fixed_assets(self) -> None:
        page = self.application.handle("GET", "/", {"Host": "vidaahub.com"}, "192.0.2.10")
        missing = self.application.handle("GET", "/anything", {"Host": "vidaahub.com"}, "192.0.2.10")

        self.assertEqual(page.status, 200)
        self.assertIn(b"Install Playarr", page.body)
        self.assertEqual(missing.status, 404)

    def test_installer_has_no_user_app_fields_or_dynamic_execution(self) -> None:
        script = (Path(__file__).parents[1] / "portal" / "installer.js").read_text()
        page = (Path(__file__).parents[1] / "portal" / "index.html").read_text()

        self.assertIn("https://playarr.app/?platform=tv-vidaa", script)
        self.assertIn("websdk/Appinfo.json", script)
        self.assertNotIn("eval(", script)
        self.assertNotIn("new Function", script)
        self.assertNotIn("fetch(", script)
        self.assertNotIn("localStorage", script)
        self.assertNotIn("location", script)
        self.assertNotIn("URLSearchParams", script)
        self.assertNotIn(".search", script)
        self.assertNotIn(".hash", script)
        self.assertNotIn(".value", script)
        self.assertNotIn("<input", page)

    def test_tls_defaults_no_sni_and_unknown_sni_to_portal_certificate(self) -> None:
        self.assertEqual(tls_certificate_role(None), "portal")
        self.assertEqual(tls_certificate_role("vidaahub.com"), "portal")
        self.assertEqual(tls_certificate_role("unknown.example"), "portal")
        self.assertEqual(tls_certificate_role("dns.playarr.app"), "api")
        self.assertEqual(tls_certificate_role("DNS.PLAYARR.APP."), "api")


if __name__ == "__main__":
    unittest.main()
