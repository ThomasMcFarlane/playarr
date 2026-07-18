import threading
import unittest

from vidaa_gateway.server import BoundedThreadingMixIn


class _FakeServerBase:
    def __init__(self) -> None:
        self.closed: list[object] = []

    def finish_request(self, request: object, client_address: object) -> None:
        request()

    def shutdown_request(self, request: object) -> None:
        self.closed.append(request)

    def handle_error(self, request: object, client_address: object) -> None:
        raise AssertionError("request handler unexpectedly failed")


class _Server(BoundedThreadingMixIn, _FakeServerBase):
    pass


class BoundedThreadingMixInTests(unittest.TestCase):
    def test_request_over_worker_limit_is_closed(self) -> None:
        entered = threading.Event()
        release = threading.Event()

        def first() -> None:
            entered.set()
            release.wait(timeout=2)

        def second() -> None:
            raise AssertionError("request above the worker limit must not run")

        server = _Server(max_workers=1)
        server.process_request(first, ("192.0.2.10", 1000))
        self.assertTrue(entered.wait(timeout=1))
        server.process_request(second, ("192.0.2.11", 1001))

        self.assertIn(second, server.closed)
        release.set()

    def test_shared_budget_is_enforced_across_servers(self) -> None:
        entered = threading.Event()
        release = threading.Event()
        shared_slots = threading.BoundedSemaphore(1)

        def first() -> None:
            entered.set()
            release.wait(timeout=2)

        def second() -> None:
            raise AssertionError("request above the shared worker limit must not run")

        first_server = _Server(max_workers=1, request_slots=shared_slots)
        second_server = _Server(max_workers=1, request_slots=shared_slots)
        first_server.process_request(first, ("192.0.2.10", 1000))
        self.assertTrue(entered.wait(timeout=1))

        second_server.process_request(second, ("192.0.2.11", 1001))

        self.assertIn(second, second_server.closed)
        release.set()


if __name__ == "__main__":
    unittest.main()
