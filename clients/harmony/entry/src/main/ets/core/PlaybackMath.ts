/**
 * Pure arithmetic for reconciling playback position/duration between the
 * server's negotiation response and the on-device AVPlayer.
 *
 * This file lives under `core/` and is deliberately plain TypeScript: no
 * ArkUI, no `@kit.*` / `@ohos.*` imports, no decorators. It is Linux
 * testable with `node --test` and has zero dependency on the HarmonyOS SDK.
 *
 * See the implementation brief section 4.10 ("Playback negotiation") and
 * section 4.12 ("Playback session reporting").
 */

/**
 * Every reported `position_ms` sent to the session-events endpoint is the
 * player's own position PLUS `source_offset_ms` -- the absolute source
 * timestamp represented by t=0 in the negotiated playback URL. Brief 4.10:
 * "the client must ADD it to every reported position". Brief 4.12: "Every
 * reported `position_ms` = `player_position + source_offset_ms`."
 */
export function reportedPositionMs(playerPositionMs: number, sourceOffsetMs: number): number {
  return playerPositionMs + sourceOffsetMs;
}

/**
 * `PlaybackInfoResponse.duration_ms === 0` means server-side duration
 * probing failed -- it is NOT an error and must never be surfaced as a zero
 * duration. Fall back to the player's own reported duration instead (brief
 * 4.10: "0 means probing failed -- fall back to the player's own duration,
 * it is not an error").
 */
export function resolveDurationMs(serverDurationMs: number, playerReportedDurationMs: number): number {
  if (serverDurationMs === 0) {
    return playerReportedDurationMs;
  }
  return serverDurationMs;
}

/**
 * Clamp a seek target to the playable range `[0, durationMs]`.
 */
export function clampSeekTargetMs(targetMs: number, durationMs: number): number {
  if (targetMs < 0) {
    return 0;
  }
  if (targetMs > durationMs) {
    return durationMs;
  }
  return targetMs;
}

/**
 * The "completed" threshold applied before `PUT
 * /api/v1/playback/{media_file_id}/progress` (brief 4.12: "Mark `completed`
 * when `position >= duration - 5000`"). Treated as complete once within 5
 * seconds of the end, since players rarely land on the exact final sample.
 */
const COMPLETED_THRESHOLD_MS = 5000;

export function isPlaybackComplete(positionMs: number, durationMs: number): boolean {
  return positionMs >= durationMs - COMPLETED_THRESHOLD_MS;
}

/**
 * Resume point from the server's saved progress: only a `part_watched` item
 * with a positive position resumes (the web client's rule). Returns 0 for
 * "start from the top".
 */
export function resumeStartMs(state: string, positionMs: number): number {
  return state === "part_watched" && positionMs > 0 ? positionMs : 0;
}

/**
 * Whether a watch-progress write is allowed. Nothing is written until
 * playback has really started, and never at position 0, so a stalled or
 * cancelled start cannot overwrite the saved resume point.
 */
export function shouldCheckpointProgress(playbackStarted: boolean, reportedPositionMs: number): boolean {
  return playbackStarted && reportedPositionMs > 0;
}
