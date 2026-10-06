// Tiny API helper shared by seed.mjs and verify.mjs (Node 20+, no dependencies).
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

// Stable per-user device id so repeated logins reuse one device.
export const deviceId = (name) => {
  const h = createHash("sha1").update(`playarr-fixture-device/${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export class Api {
  constructor(base, token = null) {
    this.base = base;
    this.token = token;
  }
  async raw(method, path, body, headers = {}) {
    const res = await fetch(this.base + path, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON (manifests) */
    }
    return { status: res.status, ok: res.ok, json, text };
  }
  async must(method, path, body) {
    const r = await this.raw(method, path, body);
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${r.text.slice(0, 300)}`);
    return r.json;
  }
  get = (p) => this.must("GET", p);
  post = (p, b) => this.must("POST", p, b ?? {});
  put = (p, b) => this.must("PUT", p, b);
  patch = (p, b) => this.must("PATCH", p, b);
}

export async function login(base, username, password, { platform = "web", pin } = {}) {
  const api = new Api(base);
  const r = await api.raw("POST", "/api/v1/auth/login", {
    username, password, ...(pin ? { pin } : {}),
    device_id: deviceId(`${username}/${platform}`), device_name: `fixture-${username}`,
    client_platform: platform, client_version: "fixture",
  });
  if (!r.ok) return { ...r, api: null };
  return { ...r, api: new Api(base, r.json.access_token), userId: r.json.user_id, refreshToken: r.json.refresh_token };
}
