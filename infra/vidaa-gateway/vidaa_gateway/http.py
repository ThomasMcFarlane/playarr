from __future__ import annotations

import ipaddress
import json
import mimetypes
import ssl
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Mapping
from urllib.parse import urlsplit

from .activation import (
    ActivationCapacityError,
    ActivationRateLimiter,
    ActivationRegistry,
    resolve_source_ip,
)
from .config import API_HOST, PORTAL_HOST, PORTAL_URL, Settings
from .server import BoundedThreadingMixIn


CANONICAL_ACTIVATION_PATH = "/v1/activations/self"
COMPAT_ACTIVATION_PATH = "/api/v1/activations"
COMPAT_DEACTIVATION_PATH = "/api/v1/activations/current"
MAX_REQUEST_BODY = 16
PORTAL_ROOT = Path(__file__).resolve().parent.parent / "portal"


@dataclass(frozen=True)
class Response:
    status: int
    body: bytes = b""
    headers: tuple[tuple[str, str], ...] = ()


class GatewayApplication:
    def __init__(self, settings: Settings, registry: ActivationRegistry, rate_limiter: ActivationRateLimiter) -> None:
        self.settings = settings
        self.registry = registry
        self.rate_limiter = rate_limiter

    def handle(
        self,
        method: str,
        target: str,
        headers: Mapping[str, str],
        peer_ip: str,
        body: bytes = b"",
    ) -> Response:
        host = headers.get("Host", "").partition(":")[0].lower()
        path = urlsplit(target).path
        if host == PORTAL_HOST:
            return self._portal(method, path)
        if host != API_HOST and not self.settings.allow_plaintext_web:
            return self._error(HTTPStatus.MISDIRECTED_REQUEST, "invalid_host", "This host is not served here.")
        return self._api(method, path, headers, peer_ip, body)

    def _api(
        self,
        method: str,
        path: str,
        headers: Mapping[str, str],
        peer_ip: str,
        body: bytes,
    ) -> Response:
        known_paths = {CANONICAL_ACTIVATION_PATH, COMPAT_ACTIVATION_PATH, COMPAT_DEACTIVATION_PATH}
        if path not in known_paths:
            return self._error(HTTPStatus.NOT_FOUND, "not_found", "The requested endpoint does not exist.")

        origin = headers.get("Origin")
        cors_headers: tuple[tuple[str, str], ...] = ()
        if origin:
            if origin not in self.settings.allowed_origins:
                return self._error(HTTPStatus.FORBIDDEN, "origin_not_allowed", "This origin is not allowed.")
            cors_headers = (
                ("Access-Control-Allow-Origin", origin),
                ("Vary", "Origin"),
            )

        if method == "OPTIONS":
            return Response(
                HTTPStatus.NO_CONTENT,
                headers=cors_headers
                + (
                    ("Access-Control-Allow-Methods", "POST, DELETE, OPTIONS"),
                    ("Access-Control-Allow-Headers", "Authorization, Content-Type"),
                    ("Access-Control-Max-Age", "600"),
                ),
            )

        source_ip = resolve_source_ip(
            peer_ip,
            headers.get("X-Forwarded-For"),
            self.settings.trusted_proxy_networks,
        )
        address = ipaddress.ip_address(source_ip)
        if not self.settings.allow_non_global_clients and not address.is_global:
            return self._error(
                HTTPStatus.FORBIDDEN,
                "non_public_source",
                "Activation must come from the household's public IP address.",
                cors_headers,
            )

        if method == "POST" and path in {CANONICAL_ACTIVATION_PATH, COMPAT_ACTIVATION_PATH}:
            if body not in {b"", b"{}"}:
                return self._error(
                    HTTPStatus.BAD_REQUEST,
                    "body_not_allowed",
                    "Send this request without a body.",
                    cors_headers,
                )
            if not self.rate_limiter.permit(source_ip):
                return self._error(
                    HTTPStatus.TOO_MANY_REQUESTS,
                    "rate_limited",
                    "Too many activations. Try again later.",
                    cors_headers + (("Retry-After", "3600"),),
                )
            try:
                activation = self.registry.activate(source_ip)
            except ActivationCapacityError:
                return self._error(
                    HTTPStatus.SERVICE_UNAVAILABLE,
                    "activation_capacity_reached",
                    "The installer is at activation capacity. Try again later.",
                    cors_headers + (("Retry-After", str(self.settings.activation_ttl_seconds)),),
                )
            payload = {
                "expires_at": activation.expires_at,
                "portal_url": PORTAL_URL,
                "ttl_seconds": self.settings.activation_ttl_seconds,
                "deactivation_token": activation.token,
            }
            if path == CANONICAL_ACTIVATION_PATH:
                payload["dns_server"] = self.settings.resolver_ipv4
            else:
                payload["resolver_ipv4"] = self.settings.resolver_ipv4
            return self._json(HTTPStatus.CREATED, payload, cors_headers + (("Cache-Control", "no-store"),))

        if method == "DELETE" and path in {CANONICAL_ACTIVATION_PATH, COMPAT_DEACTIVATION_PATH}:
            authorization = headers.get("Authorization", "")
            if not authorization.startswith("Bearer ") or not self.registry.deactivate(source_ip, authorization[7:]):
                return self._error(
                    HTTPStatus.UNAUTHORIZED,
                    "invalid_deactivation_token",
                    "The deactivation token is invalid or expired.",
                    cors_headers + (("WWW-Authenticate", "Bearer"),),
                )
            return Response(HTTPStatus.NO_CONTENT, headers=cors_headers + (("Cache-Control", "no-store"),))

        return self._error(
            HTTPStatus.METHOD_NOT_ALLOWED,
            "method_not_allowed",
            "This method is not allowed.",
            cors_headers,
        )

    def _portal(self, method: str, path: str) -> Response:
        if method not in {"GET", "HEAD"}:
            return self._error(
                HTTPStatus.METHOD_NOT_ALLOWED,
                "method_not_allowed",
                "This method is not allowed.",
            )
        files = {
            "/": "index.html",
            "/index.html": "index.html",
            "/installer.js": "installer.js",
            "/styles.css": "styles.css",
        }
        filename = files.get(path)
        if filename is None:
            return self._error(HTTPStatus.NOT_FOUND, "not_found", "The requested asset does not exist.")
        content = (PORTAL_ROOT / filename).read_bytes()
        media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        headers = (
            ("Content-Type", f"{media_type}; charset=utf-8"),
            ("Cache-Control", "no-store" if filename == "index.html" else "public, max-age=3600"),
            (
                "Content-Security-Policy",
                "default-src 'none'; script-src 'self'; style-src 'self'; "
                "img-src https://playarr.app; base-uri 'none'; form-action 'none'; "
                "frame-ancestors 'none'",
            ),
        )
        return Response(HTTPStatus.OK, b"" if method == "HEAD" else content, headers)

    @staticmethod
    def _json(
        status: int,
        payload: object,
        headers: tuple[tuple[str, str], ...] = (),
    ) -> Response:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        return Response(status, body, (("Content-Type", "application/json; charset=utf-8"),) + headers)

    @classmethod
    def _error(
        cls,
        status: int,
        code: str,
        message: str,
        headers: tuple[tuple[str, str], ...] = (),
    ) -> Response:
        return cls._json(status, {"error": {"code": code, "message": message}}, headers)


class _GatewayHttpServer(BoundedThreadingMixIn, HTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request: object, client_address: object) -> None:
        return


def make_gateway_server(
    address: tuple[str, int], application: GatewayApplication, max_workers: int = 64
) -> HTTPServer:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def setup(self) -> None:
            super().setup()
            self.connection.settimeout(10)

        def do_GET(self) -> None:
            self._serve()

        def do_HEAD(self) -> None:
            self._serve()

        def do_POST(self) -> None:
            self._serve()

        def do_DELETE(self) -> None:
            self._serve()

        def do_OPTIONS(self) -> None:
            self._serve()

        def _serve(self) -> None:
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self.send_error(HTTPStatus.BAD_REQUEST)
                return
            if content_length < 0 or content_length > MAX_REQUEST_BODY:
                self.send_error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
                return
            body = self.rfile.read(content_length) if content_length else b""
            response = application.handle(self.command, self.path, self.headers, self.client_address[0], body)
            self.send_response(response.status)
            for name, value in response.headers:
                self.send_header(name, value)
            self.send_header("Content-Length", str(len(response.body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
            self.end_headers()
            if self.command != "HEAD" and response.body:
                self.wfile.write(response.body)

        def log_message(self, format: str, *args: object) -> None:
            # Do not log household IP addresses or deactivation tokens.
            return

    return _GatewayHttpServer(address, Handler, max_workers=max_workers)


def make_health_server(address: tuple[str, int]) -> HTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path != "/healthz":
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            body = b'{"status":"ok"}'
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: object) -> None:
            return

    return _GatewayHttpServer(address, Handler, max_workers=8)


def configure_tls(server: HTTPServer, settings: Settings) -> None:
    if settings.allow_plaintext_web:
        return
    assert settings.api_cert_file and settings.api_key_file
    assert settings.portal_cert_file and settings.portal_key_file

    portal_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    portal_context.minimum_version = ssl.TLSVersion.TLSv1_2
    portal_context.load_cert_chain(settings.portal_cert_file, settings.portal_key_file)

    api_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    api_context.minimum_version = ssl.TLSVersion.TLSv1_2
    api_context.load_cert_chain(settings.api_cert_file, settings.api_key_file)

    def select_certificate(connection: ssl.SSLSocket, server_name: str | None, initial: ssl.SSLContext) -> None:
        if tls_certificate_role(server_name) == "api":
            connection.context = api_context

    portal_context.set_servername_callback(select_certificate)
    server.socket = portal_context.wrap_socket(server.socket, server_side=True)


def tls_certificate_role(server_name: str | None) -> str:
    """Choose the trusted API certificate only for explicit API SNI.

    Older VIDAA clients may omit SNI, so every other case uses the portal
    certificate intended for their manually accepted connection.
    """

    if server_name and server_name.rstrip(".").lower() == API_HOST:
        return "api"
    return "portal"
