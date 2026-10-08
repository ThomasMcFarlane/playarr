// Side-effect module: replaces `fetch` before `ApiClientProvider` captures it. Always imported first by mockApi.tsx.
export type MockHandler = (url: URL, request: Request) => Response | Promise<Response> | "pending" | undefined;

let handler: MockHandler = () => undefined;
export function setMockApi(next: MockHandler): void {
  handler = next;
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const b64 = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const FIXTURE_TOKEN = `${b64({ alg: "none" })}.${b64({ sub: "00000000-0000-4000-8000-000000000001", exp: 4_102_444_800 })}.fixture`;

const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input as RequestInfo, init);
  const url = new URL(request.url, window.location.href);
  if (!url.pathname.startsWith("/api/") && !url.pathname.includes("/api/")) return nativeFetch(input, init);
  const result = handler(url, request);
  if (result === "pending") return new Promise<Response>(() => undefined);
  if (result) return result;
  if (/\/api\/v1\/auth\/(login|refresh)$/.test(url.pathname)) {
    return json({ access_token: FIXTURE_TOKEN, refresh_token: "fixture", token_type: "Bearer", expires_in: 900 });
  }
  return json({ error: "not_found" }, 404);
}) as typeof fetch;
