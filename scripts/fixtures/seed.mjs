#!/usr/bin/env node
// Seeds a running fixture server over its public API: sources, users,
// household policies and PINs. Idempotent. Usage: seed.mjs <server-url> <stub-url> <stub-key>
import { Api, login } from "./api.mjs";
import { FIXTURE_PASSWORD, GUARDIAN_PIN, CHILD_PIN, USERS, childWindow, SERIES, MOVIES } from "./catalog.mjs";

const [base, stub, stubKey] = process.argv.slice(2);
if (!base || !stub || !stubKey) {
  console.error("usage: seed.mjs <server-url> <stub-url> <stub-key>");
  process.exit(2);
}

const adminLogin = await login(base, USERS.admin.username, FIXTURE_PASSWORD, { platform: "playarr-admin" });
if (!adminLogin.api) throw new Error(`admin login failed: ${adminLogin.status} ${adminLogin.text}`);
const admin = adminLogin.api;

// 1. Sources (Sonarr/Radarr/Dubarr stand-ins).
const existingSources = await admin.get("/api/v1/admin/source-instances");
const sourceIds = {};
for (const [kind, prefix] of [["sonarr", "sonarr"], ["radarr", "radarr"], ["dubarr", "dubarr"]]) {
  const name = `Fixture ${kind}`;
  const have = (existingSources.items ?? existingSources).find?.((s) => s.name === name);
  const res = await admin.post("/api/v1/admin/source-instances", {
    ...(have ? { id: have.id } : {}), kind, name, base_url: `${stub}/${prefix}`, api_key: stubKey, priority: 10,
  });
  sourceIds[kind] = res.id ?? have?.id;
  console.log(`source ${kind}: ${sourceIds[kind]}`);
}
const libraries = [sourceIds.sonarr, sourceIds.radarr];

// 2. Users.
const listed = await admin.get("/api/v1/admin/users");
const byName = new Map((listed.items ?? listed).map((u) => [u.username, u]));
async function ensureUser(u, { is_admin = false } = {}) {
  const body = { display_name: u.display, password: FIXTURE_PASSWORD, is_admin, can_stream: true, can_download: true, library_allow: libraries };
  const have = byName.get(u.username);
  const res = have
    ? await admin.patch(`/api/v1/admin/users/${have.id}`, body)
    : await admin.post("/api/v1/admin/users", { username: u.username, ...body });
  const id = res.id ?? have?.id;
  console.log(`user ${u.username}: ${id}${have ? " (updated)" : " (created)"}`);
  return id;
}
const ids = {
  admin: adminLogin.userId,
  viewer: await ensureUser(USERS.viewer),
  guardian: await ensureUser(USERS.guardian),
  child: await ensureUser(USERS.child),
  childLocked: await ensureUser(USERS.childLocked),
};
// The bootstrap admin may stream too, so it can exercise playback.
await admin.patch(`/api/v1/admin/users/${ids.admin}`, { can_stream: true, can_download: true, library_allow: libraries });

// 3. Household policies for the two restricted profiles.
const win = childWindow();
const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const common = {
  max_rating: "PG", blocked_tags: [], allowed_tags: [], blocked_folders: [],
  household: {
    timezone: "UTC", unrated: "block", guardian_user_ids: [ids.guardian],
    approval_required: ["content", "time"], offline_ttl_hours: 24,
  },
};
await admin.put(`/api/v1/admin/users/${ids.child}/household`, {
  ...common,
  access_schedule: days.map((weekday) => ({ weekday, time_range: { start_minute_of_day: win.start, end_minute_of_day: win.end } })),
  household: { ...common.household, daily_budget_minutes: 90 },
});
await admin.put(`/api/v1/admin/users/${ids.childLocked}/household`, {
  ...common, access_schedule: [], household: { ...common.household, daily_budget_minutes: 30 },
});
console.log(`household: fx-child PG, daily window ${win.start}-${win.end} UTC, 90 min budget; fx-child-locked has an empty schedule`);

// 4. Profile PINs (set by each profile for itself).
for (const [who, pin] of [["guardian", GUARDIAN_PIN], ["child", CHILD_PIN]]) {
  const l = await login(base, USERS[who].username, FIXTURE_PASSWORD);
  if (!l.api) throw new Error(`${who} login failed: ${l.status} ${l.text}`);
  await l.api.patch("/api/v1/users/me/profile-pin", { pin });
  console.log(`PIN set for ${USERS[who].username}`);
}

// 5. First sync: ask each source to sync, then wait for the catalogue.
for (const kind of ["sonarr", "radarr", "dubarr"]) {
  await admin.raw("POST", `/api/v1/admin/source-instances/${sourceIds[kind]}/sync`, {});
}
const expected = SERIES.length + MOVIES.length;
let seen = 0;
for (let i = 0; i < 60; i++) {
  const cat = await admin.raw("GET", "/api/v1/catalog?limit=100");
  seen = (cat.json?.items ?? cat.json ?? []).length;
  if (seen >= expected) break;
  await new Promise((r) => setTimeout(r, 2000));
}
console.log(`catalogue: ${seen}/${expected} titles synced`);
if (seen < expected) process.exitCode = 1;
