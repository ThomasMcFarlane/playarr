from __future__ import annotations

import ipaddress
import os
from dataclasses import dataclass
from pathlib import Path


API_HOST = "dns.playarr.app"
PORTAL_HOST = "vidaahub.com"
PORTAL_URL = f"https://{PORTAL_HOST}/"


def _integer(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name, str(default))
    try:
        value = int(raw)
    except ValueError as error:
        raise ValueError(f"{name} must be an integer") from error
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def _boolean(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name, str(default)).strip().lower()
    if raw in {"1", "true", "yes"}:
        return True
    if raw in {"0", "false", "no"}:
        return False
    raise ValueError(f"{name} must be true or false")


def _ip_address(name: str, *, required: bool = False, default: str = "") -> str:
    raw = os.environ.get(name, default).strip()
    if required and not raw:
        raise ValueError(f"{name} is required")
    if raw:
        address = ipaddress.ip_address(raw)
        if address.version != 4:
            raise ValueError(f"{name} must be an IPv4 address")
    return raw


def _networks(name: str) -> tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return ()
    try:
        return tuple(ipaddress.ip_network(item.strip()) for item in raw.split(",") if item.strip())
    except ValueError as error:
        raise ValueError(f"{name} contains an invalid CIDR") from error


def _origins(name: str) -> frozenset[str]:
    values = frozenset(item.strip() for item in os.environ.get(name, "https://playarr.app").split(",") if item.strip())
    if not values or any(not value.startswith("https://") for value in values):
        raise ValueError(f"{name} must contain one or more HTTPS origins")
    return values


@dataclass(frozen=True)
class Settings:
    resolver_ipv4: str
    upstream_dns_ipv4: str
    dns_bind: str
    dns_port: int
    web_bind: str
    web_port: int
    health_bind: str
    health_port: int
    activation_ttl_seconds: int
    activation_rate_limit_per_hour: int
    activation_global_rate_limit_per_hour: int
    max_active_activations: int
    dns_global_rate_per_second: int
    dns_source_rate_per_second: int
    max_concurrent_dns_requests: int
    max_concurrent_web_requests: int
    allowed_origins: frozenset[str]
    trusted_proxy_networks: tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]
    api_cert_file: Path | None
    api_key_file: Path | None
    portal_cert_file: Path | None
    portal_key_file: Path | None
    allow_plaintext_web: bool
    allow_non_global_clients: bool

    def __post_init__(self) -> None:
        if self.activation_rate_limit_per_hour > self.activation_global_rate_limit_per_hour:
            raise ValueError(
                "VIDAA_ACTIVATION_RATE_LIMIT_PER_HOUR cannot exceed the global activation rate"
            )
        if self.dns_source_rate_per_second > self.dns_global_rate_per_second:
            raise ValueError("VIDAA_DNS_SOURCE_RATE_PER_SECOND cannot exceed the global DNS rate")

    @classmethod
    def from_env(cls) -> "Settings":
        plaintext = _boolean("VIDAA_ALLOW_PLAINTEXT_WEB")
        cert_values = {
            name: os.environ.get(name, "").strip()
            for name in (
                "VIDAA_API_CERT_FILE",
                "VIDAA_API_KEY_FILE",
                "VIDAA_PORTAL_CERT_FILE",
                "VIDAA_PORTAL_KEY_FILE",
            )
        }
        if not plaintext and any(not value for value in cert_values.values()):
            missing = ", ".join(name for name, value in cert_values.items() if not value)
            raise ValueError(f"TLS is required; missing {missing}")

        return cls(
            resolver_ipv4=_ip_address("VIDAA_RESOLVER_IPV4", required=True),
            upstream_dns_ipv4=_ip_address("VIDAA_UPSTREAM_DNS_IPV4", default="1.1.1.1"),
            dns_bind=os.environ.get("VIDAA_DNS_BIND", "0.0.0.0"),
            dns_port=_integer("VIDAA_DNS_PORT", 5353, 1, 65535),
            web_bind=os.environ.get("VIDAA_WEB_BIND", "0.0.0.0"),
            web_port=_integer("VIDAA_WEB_PORT", 8443, 1, 65535),
            health_bind=os.environ.get("VIDAA_HEALTH_BIND", "0.0.0.0"),
            health_port=_integer("VIDAA_HEALTH_PORT", 8080, 1, 65535),
            activation_ttl_seconds=_integer("VIDAA_ACTIVATION_TTL_SECONDS", 1200, 60, 3600),
            activation_rate_limit_per_hour=_integer("VIDAA_ACTIVATION_RATE_LIMIT_PER_HOUR", 10, 1, 60),
            activation_global_rate_limit_per_hour=_integer(
                "VIDAA_ACTIVATION_GLOBAL_RATE_LIMIT_PER_HOUR", 1000, 10, 10000
            ),
            max_active_activations=_integer("VIDAA_MAX_ACTIVE_ACTIVATIONS", 1000, 10, 10000),
            dns_global_rate_per_second=_integer("VIDAA_DNS_GLOBAL_RATE_PER_SECOND", 500, 10, 5000),
            dns_source_rate_per_second=_integer("VIDAA_DNS_SOURCE_RATE_PER_SECOND", 50, 1, 500),
            max_concurrent_dns_requests=_integer("VIDAA_MAX_CONCURRENT_DNS_REQUESTS", 64, 8, 1024),
            max_concurrent_web_requests=_integer("VIDAA_MAX_CONCURRENT_WEB_REQUESTS", 32, 4, 256),
            allowed_origins=_origins("VIDAA_ALLOWED_ORIGINS"),
            trusted_proxy_networks=_networks("VIDAA_TRUSTED_PROXY_CIDRS"),
            api_cert_file=(Path(cert_values["VIDAA_API_CERT_FILE"]) if cert_values["VIDAA_API_CERT_FILE"] else None),
            api_key_file=(Path(cert_values["VIDAA_API_KEY_FILE"]) if cert_values["VIDAA_API_KEY_FILE"] else None),
            portal_cert_file=(
                Path(cert_values["VIDAA_PORTAL_CERT_FILE"]) if cert_values["VIDAA_PORTAL_CERT_FILE"] else None
            ),
            portal_key_file=(
                Path(cert_values["VIDAA_PORTAL_KEY_FILE"]) if cert_values["VIDAA_PORTAL_KEY_FILE"] else None
            ),
            allow_plaintext_web=plaintext,
            allow_non_global_clients=_boolean("VIDAA_ALLOW_NON_GLOBAL_CLIENTS"),
        )
