/**
 * Wire DTOs for a media file's chapters and fixed container metadata.
 *
 * This file lives under `core/` and is deliberately plain TypeScript: no
 * ArkUI, no `@kit.*` / `@ohos.*` imports, no decorators. It is Linux
 * testable with `node --test` and has zero dependency on the HarmonyOS SDK.
 *
 * Field names match the JSON wire contract verbatim (snake_case) -- this
 * layer only decodes server responses, it does not remap field casing.
 * See the implementation brief section 4.11 ("Fetching bytes and auth
 * fallbacks"): `GET /api/v1/media/{media_file_id}/chapters` -> bearer-only,
 * `GET /api/v1/media/{media_file_id}/metadata` -> bearer-only.
 */

/**
 * One real chapter embedded in a media container, as reported by ffprobe
 * (brief 4.11: `MediaChapter[] = {index, title?, start_ms, end_ms?}`).
 * Untitled chapters remain untitled rather than receiving a fabricated
 * name -- render `start_ms` as the label in that case.
 */
export interface MediaChapter {
  index: number;
  title?: string | null;
  start_ms: number;
  end_ms?: number | null;
}

/**
 * `GET /api/v1/media/{media_file_id}/metadata` response (brief 4.11):
 * `{duration_ms}`.
 */
export interface MediaMetadata {
  duration_ms: number;
}
