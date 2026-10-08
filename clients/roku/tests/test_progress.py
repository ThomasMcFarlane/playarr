from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAIN = (ROOT / "components" / "MainScene.brs").read_text(encoding="utf-8")
PROGRESS = (ROOT / "components" / "PlaybackProgress.brs").read_text(encoding="utf-8")
SCENE = (ROOT / "components" / "MainScene.xml").read_text(encoding="utf-8")


def resume_seconds(data):
    """Python mirror of ProgressResumeSeconds, checked against the source below."""
    if not isinstance(data, dict) or data.get("state") != "part_watched":
        return None
    position = data.get("position_ms")
    if position is None or position <= 0:
        return None
    return position / 1000


def should_write(started, position_ms, completed):
    """Python mirror of ProgressShouldWrite."""
    if not started:
        return False
    return not (position_ms <= 0 and not completed)


class ProgressRulesTests(unittest.TestCase):
    def test_resume_only_for_part_watched_with_position(self) -> None:
        self.assertEqual(resume_seconds({"state": "part_watched", "position_ms": 90500}), 90.5)
        self.assertIsNone(resume_seconds({"state": "unseen", "position_ms": 0}))
        self.assertIsNone(resume_seconds({"state": "watched", "position_ms": 5000}))
        self.assertIsNone(resume_seconds({"state": "part_watched", "position_ms": 0}))
        self.assertIsNone(resume_seconds(None))

    def test_never_writes_before_playback_started_or_at_zero(self) -> None:
        self.assertFalse(should_write(False, 5000, False))
        self.assertFalse(should_write(False, 0, True))
        self.assertFalse(should_write(True, 0, False))
        self.assertTrue(should_write(True, 1000, False))
        self.assertTrue(should_write(True, 0, True))

    def test_source_matches_the_rules(self) -> None:
        self.assertIn('data.state <> "part_watched" then return invalid', PROGRESS)
        self.assertIn("data.position_ms <= 0 then return invalid", PROGRESS)
        self.assertIn("if not started then return false", PROGRESS)
        self.assertIn("if positionMs <= 0 and not completed then return false", PROGRESS)


class ProgressWiringTests(unittest.TestCase):
    def test_uses_the_web_progress_endpoints(self) -> None:
        self.assertIn('"/progress"', PROGRESS)
        self.assertIn('method: "PUT"', PROGRESS)
        self.assertIn('method: "GET"', PROGRESS)
        self.assertIn("position_ms: positionMs, duration_ms: durationMs, completed: completed", PROGRESS)

    def test_scene_loads_the_progress_script_before_main(self) -> None:
        self.assertLess(
            SCENE.index("pkg:/components/PlaybackProgress.brs"), SCENE.index("pkg:/components/MainScene.brs")
        )

    def test_play_fetches_resume_and_applies_it(self) -> None:
        self.assertIn("startResumeFetch(mediaFileId, path)", MAIN)
        self.assertIn("ProgressApplyResume(data)", MAIN)
        self.assertIn('"&start_position_ms="', PROGRESS)
        self.assertIn("m.video.seek = seekTo", PROGRESS)
        self.assertIn("m.video.position + m.sourceOffsetSeconds", PROGRESS)

    def test_flush_on_pause_heartbeat_exit_and_end(self) -> None:
        def body(name):
            match = re.search(r"sub %s\(.*?\nend sub" % name, MAIN, re.S)
            self.assertIsNotNone(match, name)
            return match.group(0)

        self.assertIn("persistPlaybackProgress(false)", body("sendHeartbeat"))
        self.assertIn("persistPlaybackProgress(false)", body("finishPlayback"))
        self.assertIn("persistPlaybackProgress(true)", body("showEndOfPlayback"))
        self.assertIn("persistPlaybackProgress(false)", body("onVideoStateChanged"))
        self.assertIn('m.video.control = "stop"', body("finishPlayback"))

    def test_start_error_is_retried_until_the_resume_transcode_is_ready(self) -> None:
        self.assertIn('state = "error" and ProgressRetryStart()', MAIN)
        self.assertIn("if m.playbackStarted = true or m.playbackEnded then return false", PROGRESS)
        self.assertIn("m.startRetriesLeft = 15", PROGRESS)
        self.assertIn('data.mode = "hls"', PROGRESS)

    def test_exit_flush_does_not_use_the_shared_queue(self) -> None:
        body = re.search(r"sub persistPlaybackProgress.*?\nend sub", PROGRESS, re.S).group(0)
        self.assertNotIn("sendApi(", body)
        self.assertNotIn("requestBusy", body)
        self.assertIn('CreateObject("roSGNode", "ApiTask")', body)


if __name__ == "__main__":
    unittest.main()
