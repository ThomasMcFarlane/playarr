import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from asc_prepare_version import decide_version_action, select_build  # noqa: E402


def v(id_, string, state):
    return {"id": id_, "attributes": {"versionString": string, "appStoreState": state}}


class DecideVersionAction(unittest.TestCase):
    def test_renames_draft(self):
        self.assertEqual(decide_version_action([v("1", "1.0", "PREPARE_FOR_SUBMISSION")], "1.0.0")[:2], ("rename", "1"))

    def test_uses_matching_draft(self):
        self.assertEqual(decide_version_action([v("1", "1.0.0", "REJECTED")], "1.0.0")[:2], ("use", "1"))

    def test_creates_when_only_live_version_has_other_string(self):
        self.assertEqual(decide_version_action([v("1", "0.9", "READY_FOR_SALE")], "1.0.0")[0], "create")

    def test_skips_when_string_in_review(self):
        self.assertEqual(decide_version_action([v("1", "1.0.0", "IN_REVIEW")], "1.0.0")[0], "skip")

    def test_skips_rename_when_target_string_taken(self):
        versions = [v("1", "1.0", "PREPARE_FOR_SUBMISSION"), v("2", "1.0.0", "READY_FOR_SALE")]
        self.assertEqual(decide_version_action(versions, "1.0.0")[0], "skip")

    def test_falls_back_to_app_version_state(self):
        ver = {"id": "1", "attributes": {"versionString": "1.0", "appVersionState": "PREPARE_FOR_SUBMISSION"}}
        self.assertEqual(decide_version_action([ver], "1.0.0")[0], "rename")


class SelectBuild(unittest.TestCase):
    def test_filters_platform_and_version(self):
        resp = {
            "data": [
                {"id": "b1", "attributes": {"version": "11.1"}, "relationships": {"preReleaseVersion": {"data": {"id": "p1"}}}},
                {"id": "b2", "attributes": {"version": "11.1"}, "relationships": {"preReleaseVersion": {"data": {"id": "p2"}}}},
            ],
            "included": [
                {"type": "preReleaseVersions", "id": "p1", "attributes": {"platform": "TV_OS", "version": "1.0.0"}},
                {"type": "preReleaseVersions", "id": "p2", "attributes": {"platform": "IOS", "version": "1.0.0"}},
            ],
        }
        self.assertEqual(select_build(resp, "11.1", "IOS", "1.0.0")["id"], "b2")
        self.assertIsNone(select_build(resp, "11.1", "IOS", "0.3.0"))
        self.assertIsNone(select_build(resp, "12.1", "IOS", "1.0.0"))


if __name__ == "__main__":
    unittest.main()
