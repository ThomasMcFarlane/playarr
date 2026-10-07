// Seeds the showcase server through the real admin API: the demo profile (display name, avatar, permissions)
// and the Radarr/Sonarr source instances, then waits for the first sync.
// usage: node seed.mjs <server-url> <username> <password> <radarr-port> <sonarr-port> <arr-key>
const [base, username, password, radarrPort, sonarrPort, arrKey] = process.argv.slice(2);
const api = `${base}/api/v1`;

async function call(method, path, body, token) {
  const res = await fetch(api + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const login = await call("POST", "/auth/login", {
  username, password, device_id: "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a", device_name: "Showcase setup",
  client_platform: "playarr-admin", client_version: "1.0.0",
});
const token = login.access_token;
const users = await call("GET", "/admin/users", undefined, token);
const me = users.find((u) => u.username === username) ?? users[0];
await call("PATCH", `/admin/users/${me.id}`, { can_stream: true, can_request: true, can_download: true, display_name: "Demo" }, token);
await call("PUT", "/users/me/profile-avatar", { preference: { kind: "preset", value: "cat" } }, token);

const existing = await call("GET", "/admin/source-instances", undefined, token);
const have = new Set((existing.items ?? existing).map((s) => s.name));
for (const [name, kind, port] of [["Movies", "radarr", radarrPort], ["Series", "sonarr", sonarrPort]]) {
  if (have.has(name)) continue;
  await call("POST", "/admin/source-instances", {
    name, kind, base_url: `http://127.0.0.1:${port}`, api_key: arrKey, priority: 0, best_effort: false,
  }, token);
}

const expected = 8; // seven films and one series
for (let i = 0; i < 90; i++) {
  const cat = await call("GET", "/catalog?limit=100", undefined, token).catch(() => null);
  const n = (cat?.items ?? cat ?? []).length;
  if (n >= expected) { console.log(`catalogue ready: ${n} titles`); process.exit(0); }
  await new Promise((r) => setTimeout(r, 2000));
}
throw new Error("catalogue did not reach the expected size");
