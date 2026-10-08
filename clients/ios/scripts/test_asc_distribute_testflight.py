import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from asc_distribute_testflight import ApiError, compliance_body, is_already_done, parse_group_ids, whats_new_text  # noqa: E402


class ParseGroupIds(unittest.TestCase):
    def test_splits_trims_and_dedupes(self):
        self.assertEqual(parse_group_ids(" a, b ,,a\nc "), ["a", "b", "c"])

    def test_empty(self):
        self.assertEqual(parse_group_ids(None), [])
        self.assertEqual(parse_group_ids(""), [])


class WhatsNew(unittest.TestCase):
    def test_fallback(self):
        self.assertEqual(whats_new_text("", "1.2.3", "9.1"), "Playarr 1.2.3 (build 9.1).")

    def test_collapses_whitespace_and_truncates(self):
        self.assertEqual(whats_new_text("a\n b", "1", "1"), "a b")
        self.assertEqual(len(whats_new_text("x" * 5000, "1", "1")), 4000)


class AlreadyDone(unittest.TestCase):
    def test_conflict_already(self):
        self.assertTrue(is_already_done(ApiError("POST /x failed with HTTP 409: Conflict: build already submitted")))

    def test_other_errors(self):
        self.assertFalse(is_already_done(ApiError("POST /x failed with HTTP 403: Forbidden: no")))
        self.assertFalse(is_already_done(ApiError("POST /x failed with HTTP 409: Conflict: missing contact")))


class Compliance(unittest.TestCase):
    def test_exempt_means_false(self):
        self.assertFalse(compliance_body("b", True)["data"]["attributes"]["usesNonExemptEncryption"])


if __name__ == "__main__":
    unittest.main()
