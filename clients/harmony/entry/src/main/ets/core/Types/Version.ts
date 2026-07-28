/**
 * Wire DTOs for `GET /api/system/version` -- the unauthenticated
 * connectivity probe used on boot and as the failover trigger.
 *
 * This file lives under `core/` and is deliberately plain TypeScript: no
 * ArkUI, no `@kit.*` / `@ohos.*` imports, no decorators. It is Linux
 * testable with `node --test` and has zero dependency on the HarmonyOS SDK.
 *
 * Field names match the JSON wire contract verbatim (snake_case) -- unlike
 * the camelCase TOML keys the server config uses internally. See the
 * implementation brief section 4.13 ("Version / compatibility").
 */

/**
 * One platform's row in the compatibility table (brief 4.13): what the
 * latest client build is, the floor below which the server would reject
 * requests outright, and the floor below which it should nag-but-allow.
 *
 * `platform` is a `ClientPlatform` wire name (a kebab-case platform
 * identifier, one per first-party Playarr Server client surface) -- typed as a
 * plain `string` here rather than re-declaring the closed platform enum,
 * since that identity is deliberately owned by `core/AppConfig.ts` alone
 * (this module's own platform-identity literals are pinned there, not
 * duplicated across `core/`).
 *
 * `compatibility` is currently always an empty array on the wire (brief
 * 4.13 notes `backend/src/main.rs:921` returns `Vec::new()` today) -- this
 * type still decodes and renders it, but nothing may hard-gate on it.
 */
export interface CompatibilityEntry {
  platform: string;
  latest_version: string;
  min_supported_version: string;
  deprecated_below?: string | null;
  sunset?: string | null;
}

/**
 * `GET /api/system/version` response body (brief 4.13). There is NO
 * separate API-version request header -- this envelope is the only place
 * version/compatibility information travels.
 */
export interface VersionEnvelope {
  instance_name: string;
  server_version: string;
  api_version: string;
  build_sha?: string | null;
  compatibility: CompatibilityEntry[];
}
