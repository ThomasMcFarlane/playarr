#!/usr/bin/env node
// Calls the fixture server as each fixture user and asserts the household,
// language, dub and playback behaviour the fixtures exist to provide.
// Prints the evidence; exits non-zero on any failed expectation.
// Usage: verify.mjs [server-url]   (default http://127.0.0.1:18484)
import { login, deviceId, Api } from "./api.mjs";
import { FIXTURE_PASSWORD, GUARDIAN_PIN, CHILD_PIN, USERS, SERIES, MOVIES } from "./catalog.mjs";

const base = process.argv[2] ?? `http://127.0.0.1:${process.env.PLAYARR_FIXTURE_PORT ?? 18484}`;
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures++;
};
const titles = (c) => (c.items ?? []).map((w) => w.title).sort();
const section = (s) => console.log(`\n== ${s}`);

const as = {};
for (const [k, u] of Object.entries(USERS)) as[k] = await login(base, u.username, FIXTURE_PASSWORD, { platform: k === "admin" ? "playarr-admin" : "web" });

section("logins");
for (const k of ["admin", "viewer", "guardian", "child"]) check(!!as[k].api, `${USERS[k].username} can sign in`);

section("catalogue: admin vs child");
const adminCat = await as.admin.api.get("/api/v1/catalog?limit=100");
const childCat = await as.child.api.get("/api/v1/catalog?limit=100");
const viewerCat = await as.viewer.api.get("/api/v1/catalog?limit=100");
console.log("admin :", titles(adminCat).join(", "));
console.log("viewer:", titles(viewerCat).join(", "));
console.log("child :", titles(childCat).join(", "));
const all = [...SERIES, ...MOVIES].map((x) => x.title).sort();
check(JSON.stringify(titles(adminCat)) === JSON.stringify(all), "admin sees every fixture title");
check(JSON.stringify(titles(viewerCat)) === JSON.stringify(all), "unrestricted viewer sees every fixture title");
const childExpected = [...SERIES, ...MOVIES].filter((x) => ["G", "PG", "TV-Y7", "TV-G", "TV-Y"].includes(x.certification)).map((x) => x.title).sort();
check(JSON.stringify(titles(childCat)) === JSON.stringify(childExpected), `child (PG ceiling) sees only ${childExpected.join(", ")}`);

section("language facets");
const langAdmin = await as.admin.api.get("/api/v1/catalog/languages");
const langChild = await as.child.api.get("/api/v1/catalog/languages");
const fmt = (f) => Object.entries(f).map(([k, v]) => `${k}: ${v.map((x) => `${x.code}=${x.count}`).join(" ")}`).join(" | ");
console.log("admin:", fmt(langAdmin));
console.log("child:", fmt(langChild));
const count = (f, kind, code) => f[kind].find((x) => x.code === code)?.count ?? 0;
check(count(langAdmin, "audio", "ja") === 2 && count(langChild, "audio", "ja") === 0, "Japanese audio: 2 titles for admin, hidden from the child");
check(count(langAdmin, "audio", "en") === 5 && count(langChild, "audio", "en") === 3, "English audio: 5 titles for admin, 3 for the child");

section("household status");
const st = Object.fromEntries(await Promise.all(["admin", "child", "childLocked"].map(async (k) => [k, (await as[k].api?.raw("GET", "/api/v1/household/status"))?.json ?? null])));
console.log("admin :", JSON.stringify({ restricted: st.admin?.restricted, state: st.admin?.state }));
console.log("child :", JSON.stringify({ restricted: st.child?.restricted, state: st.child?.state, max_rating: st.child?.max_rating, daily_budget_minutes: st.child?.daily_budget_minutes, remaining_seconds: st.child?.remaining_seconds }));
check(st.admin?.restricted === false, "admin is unrestricted");
check(st.child?.restricted === true && st.child?.max_rating === "PG" && st.child?.daily_budget_minutes === 90, "child is restricted: PG, 90 minute budget");
if (as.childLocked.api) {
  const s = (await as.childLocked.api.raw("GET", "/api/v1/household/status")).json;
  console.log("locked:", JSON.stringify({ state: s.state }));
  check(s.state === "outside_schedule", "fx-child-locked is outside its (empty) schedule");
} else {
  console.log("locked: login refused:", as.childLocked.status, as.childLocked.text.slice(0, 120));
  check(as.childLocked.status === 403 || as.childLocked.status === 401, "fx-child-locked is refused at login");
}
const g = (await as.guardian.api.raw("GET", "/api/v1/household/status")).json;
check(g.guardian_for?.length === 2, "fx-guardian is guardian for both restricted profiles");

section("restricted playback");
const find = (cat, t) => cat.items.find((w) => w.title === t);
const detail = async (api, id) => (await api.raw("GET", `/api/v1/catalog/${id}`));
const movieB = find(adminCat, "Test Movie B");
const movieA = find(adminCat, "Test Movie A");
const detB = (await detail(as.admin.api, movieB.id)).json;
const detChildB = await detail(as.child.api, movieB.id);
console.log(`child GET catalog/<Test Movie B> -> ${detChildB.status} ${detChildB.text.slice(0, 120)}`);
check(detChildB.status === 403 || detChildB.status === 404, "child cannot open the R-rated film");
const pbChildB = await as.child.api.raw("GET", `/api/v1/playback/${detB.media_file_id}`);
console.log(`child GET playback/<Test Movie B file> -> ${pbChildB.status} ${pbChildB.text.slice(0, 120)}`);
check(pbChildB.status === 403 || pbChildB.status === 404, "child cannot start playback of the R-rated film by file id");

section("stream manifest and audio tracks (Test Movie A, H.264, 3 audio + dub)");
const detA = (await detail(as.admin.api, movieA.id)).json;
const pb = await as.admin.api.get(`/api/v1/playback/${detA.media_file_id}`);
console.log("mode:", pb.mode, "url:", pb.url);
console.log("audio:", pb.audio_tracks.map((a) => `${a.language}${a.id.startsWith("dubarr") ? "(dub)" : ""}`).join(", "));
console.log("subtitles:", pb.subtitle_tracks.map((s) => s.language).join(", "));
check(pb.audio_tracks.some((a) => a.id.startsWith("dubarr-") && a.language === "deu"), "the Dubarr stub dub is offered as an alternate audio track");
const manifest = await as.admin.api.raw("GET", pb.url);
console.log("manifest ->", manifest.status);
console.log(manifest.text.split("\n").slice(0, 12).join("\n"));
check(manifest.status === 200 && manifest.text.startsWith("#EXTM3U"), "HLS manifest is served");
const childA = await as.child.api.get(`/api/v1/playback/${detA.media_file_id}`);
check(!!childA.url, "child can play the PG film");

section("TV fixture (multiple seasons)");
const s1 = (await detail(as.admin.api, find(adminCat, "Sample Series 1").id)).json.children.Series;
console.log("Sample Series 1:", s1.map((s) => `S${s.season.season_number}=${s.episodes.length}ep`).join(" "));
check(s1.length === 3, "Sample Series 1 has three seasons");

section("PIN switching");
const pinLogin = async (who, pin) => {
  const l = await login(base, USERS[who].username, FIXTURE_PASSWORD, { platform: "android-mobile" });
  const lock = await l.api.raw("POST", "/api/v1/auth/lock", {});
  const unlock = await new Api(base).raw("POST", "/api/v1/auth/unlock", { device_id: deviceId(`${USERS[who].username}/android-mobile`), refresh_token: l.refreshToken, pin });
  return { lock: lock.status, unlock: unlock.status };
};
const wrong = await pinLogin("guardian", "0000");
const right = await pinLogin("guardian", GUARDIAN_PIN);
console.log(`guardian lock/unlock: wrong PIN -> ${wrong.unlock}, right PIN -> ${right.unlock}`);
check(wrong.unlock >= 400 && right.unlock === 200, "guardian PIN rejects a wrong PIN and accepts the right one");
void CHILD_PIN;

console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
