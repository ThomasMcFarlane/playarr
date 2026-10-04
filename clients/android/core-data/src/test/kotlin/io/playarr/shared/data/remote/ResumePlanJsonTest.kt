package io.playarr.shared.data.remote

import io.playarr.shared.data.model.ResumeAction
import io.playarr.shared.data.model.ResumeChoiceRequest
import io.playarr.shared.data.model.ResumeOptionKind
import io.playarr.shared.data.model.ResumePlan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Decodes literal JSON shaped like `ResumePlan` in `backend/openapi/playarr.yaml`. */
class ResumePlanJsonTest {
    private val json = PlayarrHttpClient.json

    @Test
    fun `decodes a chooser plan with every option kind`() {
        val plan = json.decodeFromString(
            ResumePlan.serializer(),
            """
            {
              "series_work_id": "7a9d3e1f-8b4c-4d2a-9b3e-5f6a7b8c9d0e",
              "action": "resume",
              "reason": "choice_required",
              "needs_choice": true,
              "ask_reasons": ["multiple_unfinished", "missed_episode"],
              "target": {"kind": "unfinished", "episode_id": "e4", "media_file_id": "m4",
                "season_number": 1, "episode_number": 4, "label": "S01E04", "title": "Four",
                "position_ms": 720000, "duration_ms": 1800000, "progress_percent": 40,
                "last_watched_at": "2026-10-01T10:00:00Z"},
              "options": [
                {"kind": "unfinished", "episode_id": "e4", "media_file_id": "m4",
                  "season_number": 1, "episode_number": 4, "label": "S01E04", "title": "Four",
                  "position_ms": 720000, "duration_ms": 1800000, "progress_percent": 40,
                  "last_watched_at": "2026-10-01T10:00:00Z"},
                {"kind": "missed_episode", "episode_id": "e1", "media_file_id": "m1",
                  "season_number": 1, "episode_number": 1, "label": "S01E01",
                  "position_ms": 0, "duration_ms": 1800000, "progress_percent": 0},
                {"kind": "continue_from_last_watched", "episode_id": "e6", "media_file_id": "m6",
                  "season_number": 1, "episode_number": 6, "episode_number_end": 7,
                  "label": "S01E06-E07", "position_ms": 0, "duration_ms": 1, "progress_percent": 0,
                  "anchor_episode_id": "e5"},
                {"kind": "next_in_series", "episode_id": "e9", "media_file_id": "m9",
                  "season_number": 2, "episode_number": 3, "label": "S02E03",
                  "position_ms": 0, "duration_ms": 1, "progress_percent": 0},
                {"kind": "start_over", "episode_id": "e1", "media_file_id": "m1",
                  "season_number": 1, "episode_number": 1, "label": "S01E01",
                  "position_ms": 0, "duration_ms": 1, "progress_percent": 0}
              ]
            }
            """.trimIndent(),
        )
        assertEquals(ResumeAction.Resume, plan.action)
        assertTrue(plan.needsChoice && plan.isStacked)
        assertEquals(
            listOf(
                ResumeOptionKind.Unfinished,
                ResumeOptionKind.MissedEpisode,
                ResumeOptionKind.ContinueFromLastWatched,
                ResumeOptionKind.NextInSeries,
                ResumeOptionKind.StartOver,
            ),
            plan.options.map { it.kind },
        )
        assertEquals(40, plan.options[0].progressPercent)
        assertEquals("2026-10-01T10:00:00Z", plan.options[0].lastWatchedAt)
        assertEquals(7, plan.options[2].episodeNumberEnd)
        assertEquals("e5", plan.options[2].anchorEpisodeId)
        assertNull(plan.options[1].lastWatchedAt)
    }

    @Test
    fun `decodes a plain start plan and ignores unknown fields`() {
        val plan = json.decodeFromString(
            ResumePlan.serializer(),
            """
            {"series_work_id": "s", "action": "start", "reason": "not_started", "needs_choice": false,
             "ask_reasons": [], "future_field": 1,
             "target": {"kind": "next_in_series", "episode_id": "e1", "media_file_id": "m1",
               "season_number": 1, "episode_number": 1, "label": "S01E01",
               "position_ms": 0, "duration_ms": 1800000, "progress_percent": 0},
             "options": []}
            """.trimIndent(),
        )
        assertEquals(ResumeAction.Start, plan.action)
        assertFalse(plan.isStacked)
        assertEquals("m1", plan.target?.mediaFileId)
    }

    @Test
    fun `a single option is never stacked even when a choice is flagged`() {
        val plan = ResumePlan(
            seriesWorkId = "s",
            action = ResumeAction.Resume,
            needsChoice = true,
            options = emptyList(),
        )
        assertFalse(plan.isStacked)
    }

    @Test
    fun `encodes the choice request with snake case names`() {
        val body = json.encodeToString(
            ResumeChoiceRequest.serializer(),
            ResumeChoiceRequest(ResumeOptionKind.NextInSeries, "e2"),
        )
        assertEquals("""{"kind":"next_in_series","episode_id":"e2"}""", body)
    }
}
