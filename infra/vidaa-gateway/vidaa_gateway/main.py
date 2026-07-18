from __future__ import annotations

import signal
import threading

from .activation import ActivationRateLimiter, ActivationRegistry, DnsQueryRateLimiter
from .config import Settings
from .dns import DnsResolver, make_tcp_server, make_udp_server
from .http import GatewayApplication, configure_tls, make_gateway_server, make_health_server


def main() -> None:
    settings = Settings.from_env()
    registry = ActivationRegistry(settings.activation_ttl_seconds, settings.max_active_activations)
    rate_limiter = ActivationRateLimiter(
        settings.activation_rate_limit_per_hour,
        settings.activation_global_rate_limit_per_hour,
    )
    dns_rate_limiter = DnsQueryRateLimiter(
        settings.dns_global_rate_per_second,
        settings.dns_source_rate_per_second,
    )
    resolver = DnsResolver(
        registry,
        settings.resolver_ipv4,
        settings.upstream_dns_ipv4,
        query_rate_limiter=dns_rate_limiter,
    )
    application = GatewayApplication(settings, registry, rate_limiter)
    dns_request_slots = threading.BoundedSemaphore(settings.max_concurrent_dns_requests)

    servers = [
        make_udp_server(
            (settings.dns_bind, settings.dns_port),
            resolver,
            settings.max_concurrent_dns_requests,
            dns_request_slots,
        ),
        make_tcp_server(
            (settings.dns_bind, settings.dns_port),
            resolver,
            settings.max_concurrent_dns_requests,
            dns_request_slots,
        ),
        make_gateway_server(
            (settings.web_bind, settings.web_port), application, settings.max_concurrent_web_requests
        ),
        make_health_server((settings.health_bind, settings.health_port)),
    ]
    configure_tls(servers[2], settings)

    stopping = threading.Event()

    def stop(signum: int, frame: object) -> None:
        if stopping.is_set():
            return
        stopping.set()
        for server in servers:
            threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    threads = [threading.Thread(target=server.serve_forever, daemon=True) for server in servers]
    for thread in threads:
        thread.start()
    stopping.wait()
    for server in servers:
        server.server_close()
    for thread in threads:
        thread.join(timeout=5)


if __name__ == "__main__":
    main()
