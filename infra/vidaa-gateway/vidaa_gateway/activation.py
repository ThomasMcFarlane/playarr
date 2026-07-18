from __future__ import annotations

import hashlib
import ipaddress
import secrets
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass(frozen=True)
class Activation:
    expires_at_epoch: float
    token: str

    @property
    def expires_at(self) -> str:
        value = datetime.fromtimestamp(self.expires_at_epoch, timezone.utc).isoformat(timespec="seconds")
        return value.replace("+00:00", "Z")


@dataclass(frozen=True)
class _StoredActivation:
    expires_at_epoch: float
    token_digest: bytes


class ActivationCapacityError(RuntimeError):
    pass


class ActivationRegistry:
    """An in-memory, expiring DNS allow-list keyed by the observed source IP."""

    def __init__(self, ttl_seconds: int, max_active: int = 1000) -> None:
        self.ttl_seconds = ttl_seconds
        self.max_active = max_active
        self._items: dict[str, _StoredActivation] = {}
        self._lock = threading.Lock()

    def activate(self, source_ip: str, now: float | None = None) -> Activation:
        now = time.time() if now is None else now
        address = str(ipaddress.ip_address(source_ip))
        token = secrets.token_urlsafe(32)
        expires_at = now + self.ttl_seconds
        stored = _StoredActivation(expires_at, self._digest(token))
        with self._lock:
            self._purge_locked(now)
            if address not in self._items and len(self._items) >= self.max_active:
                raise ActivationCapacityError("active household capacity reached")
            self._items[address] = stored
        return Activation(expires_at, token)

    def is_active(self, source_ip: str, now: float | None = None) -> bool:
        now = time.time() if now is None else now
        address = str(ipaddress.ip_address(source_ip))
        with self._lock:
            item = self._items.get(address)
            if item is None:
                return False
            if item.expires_at_epoch <= now:
                del self._items[address]
                return False
            return True

    def deactivate(self, source_ip: str, token: str, now: float | None = None) -> bool:
        now = time.time() if now is None else now
        address = str(ipaddress.ip_address(source_ip))
        digest = self._digest(token)
        with self._lock:
            item = self._items.get(address)
            if item is None or item.expires_at_epoch <= now:
                self._items.pop(address, None)
                return False
            if not secrets.compare_digest(item.token_digest, digest):
                return False
            del self._items[address]
            return True

    def _purge_locked(self, now: float) -> None:
        expired = [address for address, item in self._items.items() if item.expires_at_epoch <= now]
        for address in expired:
            del self._items[address]

    @property
    def active_count(self) -> int:
        with self._lock:
            return len(self._items)

    @staticmethod
    def _digest(token: str) -> bytes:
        return hashlib.sha256(token.encode("utf-8")).digest()


class ActivationRateLimiter:
    def __init__(self, limit_per_hour: int, global_limit_per_hour: int = 1000) -> None:
        if limit_per_hour > global_limit_per_hour:
            raise ValueError("source activation limit cannot exceed global activation limit")
        self.limit_per_hour = limit_per_hour
        self.global_limit_per_hour = global_limit_per_hour
        self._global_attempts: deque[float] = deque()
        self._attempts: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def permit(self, source_ip: str, now: float | None = None) -> bool:
        now = time.time() if now is None else now
        cutoff = now - 3600
        with self._lock:
            while self._global_attempts and self._global_attempts[0] <= cutoff:
                self._global_attempts.popleft()
            expired_sources: list[str] = []
            for address, recorded in self._attempts.items():
                while recorded and recorded[0] <= cutoff:
                    recorded.popleft()
                if not recorded:
                    expired_sources.append(address)
            for address in expired_sources:
                del self._attempts[address]

            if len(self._global_attempts) >= self.global_limit_per_hour:
                return False
            attempts = self._attempts.get(source_ip)
            if attempts is None:
                attempts = deque()
                self._attempts[source_ip] = attempts
            if len(attempts) >= self.limit_per_hour:
                return False
            self._global_attempts.append(now)
            attempts.append(now)
            return True

    @property
    def tracked_source_count(self) -> int:
        with self._lock:
            return len(self._attempts)


class DnsQueryRateLimiter:
    """A one-second global and per-source sliding-window DNS limiter."""

    def __init__(self, global_limit: int, source_limit: int) -> None:
        if source_limit > global_limit:
            raise ValueError("source DNS limit cannot exceed global DNS limit")
        self.global_limit = global_limit
        self.source_limit = source_limit
        self._global_attempts: deque[float] = deque()
        self._source_attempts: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def permit(self, source_ip: str, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        cutoff = now - 1
        with self._lock:
            while self._global_attempts and self._global_attempts[0] <= cutoff:
                self._global_attempts.popleft()
            expired_sources: list[str] = []
            for address, attempts in self._source_attempts.items():
                while attempts and attempts[0] <= cutoff:
                    attempts.popleft()
                if not attempts:
                    expired_sources.append(address)
            for address in expired_sources:
                del self._source_attempts[address]

            if len(self._global_attempts) >= self.global_limit:
                return False
            attempts = self._source_attempts[source_ip]
            if len(attempts) >= self.source_limit:
                return False
            self._global_attempts.append(now)
            attempts.append(now)
            return True

    @property
    def tracked_source_count(self) -> int:
        with self._lock:
            return len(self._source_attempts)


def resolve_source_ip(
    peer_ip: str,
    forwarded_for: str | None,
    trusted_proxy_networks: tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...],
) -> str:
    """Resolve a client address, trusting forwarded data only from configured proxies.

    The chain is walked from the closest hop to the furthest. This ignores any
    attacker-supplied addresses to the left of the first untrusted hop.
    """

    peer = ipaddress.ip_address(peer_ip)
    if not any(peer in network for network in trusted_proxy_networks):
        return str(peer)
    if not forwarded_for:
        return str(peer)

    try:
        chain = [ipaddress.ip_address(item.strip()) for item in forwarded_for.split(",") if item.strip()]
    except ValueError:
        return str(peer)

    for candidate in reversed(chain):
        if not any(candidate in network for network in trusted_proxy_networks):
            return str(candidate)
    return str(chain[0]) if chain else str(peer)
