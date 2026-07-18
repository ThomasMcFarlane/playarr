from __future__ import annotations

import socketserver
import threading


class BoundedThreadingMixIn(socketserver.ThreadingMixIn):
    """Thread-per-request handling with a hard, non-blocking worker limit."""

    daemon_threads = True

    def __init__(
        self,
        *args: object,
        max_workers: int,
        request_slots: threading.BoundedSemaphore | None = None,
        **kwargs: object,
    ) -> None:
        self._request_slots = request_slots or threading.BoundedSemaphore(max_workers)
        super().__init__(*args, **kwargs)

    def process_request(self, request: object, client_address: object) -> None:
        if not self._request_slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self._request_slots.release()
            raise

    def process_request_thread(self, request: object, client_address: object) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._request_slots.release()
