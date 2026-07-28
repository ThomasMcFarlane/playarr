/**
 * Wire DTOs for playback negotiation, session-event reporting and durable
 * watch progress.
 *
 * This file lives under `core/` and is deliberately plain TypeScript: no
 * ArkUI, no `@kit.*` / `@ohos.*` imports, no decorators. It is Linux
 * testable with `node --test` and has zero dependency on the HarmonyOS SDK.
 *
 * Field names match the JSON wire contract verbatim (snake_case) -- this
 * layer only decodes server responses, it does not remap field casing.
 * See the implementation brief section 4.10 ("Playback negotiation") and
 * section 4.12 ("Playback session reporting").
 */

/** `PlaybackInfoResponse.audio_tracks[]` entry (brief 4.10). */
export interface AudioTrack {
  id: string;
  stream_index: number;
  label: string;
  language?: string | null;
  codec?: string | null;
  channels?: number | null;
  is_default: boolean;
}

/** `PlaybackInfoResponse.subtitle_tracks[]` entry (brief 4.10). Unlike
 * `AudioTrack`, `codec` is REQUIRED here -- only `language` is optional. */
export interface SubtitleTrack {
  id: string;
  stream_index: number;
  label: string;
  language?: string | null;
  codec: string;
  is_default: boolean;
  forced: boolean;
  url: string;
}

/**
 * `PlaybackInfoResponse.quality_options[]` entry; `"original"` is always
 * first (brief 4.10). The brief's own `{id, label, profile, height,
 * video_bitrate_bps}` shorthand carries no nullability mark, but the
 * backend (`playarr-api::playback::PlaybackQualityOption`) declares
 * `profile`/`height`/`video_bitrate_bps` as `Option<T>`, and the always-
 * present "original" entry is constructed with `profile: None, height:
 * None` -- i.e. the very first array element is guaranteed to carry a
 * `null` `profile`/`height` on every real response. Modelling these as
 * non-null here would be a verified, guaranteed-to-trigger bug, not a
 * theoretical one.
 */
export interface QualityOption {
  id: string;
  label: string;
  profile: string | null;
  height: number | null;
  video_bitrate_bps: number | null;
}

/**
 * `GET /api/v1/playback/{media_file_id}` response (brief 4.10).
 *
 * `mode` is one of exactly `"direct"` | `"hls"` -- there is no DASH and no
 * remux/DirectStream path. `duration_ms === 0` means server-side duration
 * probing failed, not an error (see `core/PlaybackMath.ts`).
 * `source_offset_ms` is the absolute source timestamp represented by t=0 in
 * `url`; it must be ADDED to every reported player position. `url` is
 * server-relative and must be joined onto the active base URL via
 * `core/Url.ts` -- never treated as absolute.
 */
export interface PlaybackInfoResponse {
  mode: "direct" | "hls";
  url: string;
  mime_type: string;
  duration_ms: number;
  source_offset_ms: number;
  audio_tracks: AudioTrack[];
  selected_audio_track_id: string | null;
  subtitle_tracks: SubtitleTrack[];
  selected_subtitle_track_id: string | null;
  quality_options: QualityOption[];
  selected_quality_id: string;
  session_id: string;
}

/**
 * `StopReason` values reported on a `"stop"` playback event (brief 4.12).
 * The fallback `{"other": "..."}` form is an object, not a scalar, exactly
 * like `ExternalProvider::Other` in `core/Types/Work.ts`.
 */
export interface StopReasonOther {
  other: string;
}

export type StopReason =
  | "completed"
  | "user_stopped"
  | "error"
  | "device_disconnected"
  | "session_revoked"
  | "concurrent_limit_exceeded"
  | "idle_timeout"
  | StopReasonOther;

/**
 * The `PlaybackEventKind` union, internally tagged on `"kind"`, snake_case,
 * tag and fields flattened into one JSON object (brief 4.12). This is the
 * exact request body for `POST /api/v1/playback/sessions/{session_id}/events`.
 */
export interface PlaybackEventStart {
  kind: "start";
}

export interface PlaybackEventPause {
  kind: "pause";
  position_ms: number;
}

export interface PlaybackEventResume {
  kind: "resume";
  position_ms: number;
}

export interface PlaybackEventSeek {
  kind: "seek";
  from_ms: number;
  to_ms: number;
}

export interface PlaybackEventBufferStart {
  kind: "buffer_start";
  position_ms: number;
}

export interface PlaybackEventBufferEnd {
  kind: "buffer_end";
  duration_ms: number;
}

export interface PlaybackEventBitrateChange {
  kind: "bitrate_change";
  from_bps: number | null;
  to_bps: number;
}

export interface PlaybackEventHeartbeat {
  kind: "heartbeat";
  position_ms: number;
  bytes_streamed_total: number | null;
}

export interface PlaybackEventStop {
  kind: "stop";
  reason: StopReason;
  position_ms: number;
}

export interface PlaybackEventError {
  kind: "error";
  message: string;
}

export type PlaybackEventKind =
  | PlaybackEventStart
  | PlaybackEventPause
  | PlaybackEventResume
  | PlaybackEventSeek
  | PlaybackEventBufferStart
  | PlaybackEventBufferEnd
  | PlaybackEventBitrateChange
  | PlaybackEventHeartbeat
  | PlaybackEventStop
  | PlaybackEventError;

export type WatchProgressState = "unseen" | "part_watched" | "watched";

/**
 * The durable resume channel (brief 4.12), separate from session-event
 * reporting: `GET /api/v1/playback/progress` (list), `GET
 * /api/v1/playback/{media_file_id}/progress` (one -- synthesises
 * `state: "unseen"`, `updated_at: null` when no row exists yet), `PUT
 * /api/v1/playback/{media_file_id}/progress` (write). The server clamps
 * `position_ms` to `duration_ms` and derives `state` itself (>=90% watched).
 */
export interface WatchProgress {
  media_file_id: string;
  work_id: string;
  position_ms: number;
  duration_ms: number;
  state: WatchProgressState;
  updated_at: string | null;
}
