import { getStoredApiBaseUrl, readKnownServers } from "@playarr-tv/domain";

const HOSTED_PLAYARR_HOSTNAME = "playarr.app";
const PUBLIC_IPV4_RELAY_HOSTNAME = "relay.playarr.app";
const LEGACY_RELAY_PORT = "8484";
const RELAY_PORT_MEMORY_KEY = "playarr:relayPort.v1";
const RELAY_PROBE_TIMEOUT_MS = 3000;

type RelayPortMemory = Record<string, "443" | "8484">;

function readRelayPortMemory(): RelayPortMemory {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(RELAY_PORT_MEMORY_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as RelayPortMemory) : {};
  } catch {
    return {};
  }
}

/** Remember which port answered for a port-less relay name, so later launches go straight there. */
function rememberRelayPort(hostname: string, port: "443" | "8484"): void {
  try {
    globalThis.localStorage?.setItem(
      RELAY_PORT_MEMORY_KEY,
      JSON.stringify({ ...readRelayPortMemory(), [hostname.toLowerCase()]: port })
    );
  } catch {
    // Storage may be unavailable; the next launch simply probes again.
  }
}

/** The port the user typed, read from the raw text because `URL` hides the default one (443). */
function typedPort(candidate: string): string | undefined {
  return candidate.match(/^[a-z][a-z\d+.-]*:\/\/(?:[^/?#@]*@)?[^/?#:]*:(\d+)(?:[/?#]|$)/i)?.[1];
}

function publicIpv4Octets(hostname: string): [number, number, number, number] | undefined {
  const rawOctets = hostname.split(".");
  if (rawOctets.length !== 4) return undefined;

  const octets = rawOctets.map((octet) => Number(octet));
  if (
    !octets.every(
      (octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255
    )
  ) {
    return undefined;
  }

  const parsed = octets as [number, number, number, number];
  const [first, second] = parsed;
  if (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && (parsed[2] === 0 || parsed[2] === 2)) ||
    (first === 192 && second === 88 && parsed[2] === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && second >= 18 && second <= 19) ||
    (first === 198 && second === 51 && parsed[2] === 100) ||
    (first === 203 && second === 0 && parsed[2] === 113) ||
    first >= 224
  ) {
    return undefined;
  }

  return parsed;
}

function encodedPublicIpv4Octets(
  hostname: string
): [number, number, number, number] | undefined {
  const match = hostname.match(
    /^v4-(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})\.relay\.playarr\.app$/i
  );
  return match ? publicIpv4Octets(match.slice(1).join(".")) : undefined;
}

/**
 * Give public IPv4 Playarr Server instances a secure, deterministic DNS name.
 * DNS resolves the name straight back to the encoded address; neither
 * Playarr nor Cloudflare relays the request or its response.
 */
export function publicIpv4RelayUrl(
  value: string,
  pageProtocol: string | undefined = typeof window === "undefined" ? undefined : window.location.protocol
): string {
  // A page served over plain http (the web client a Playarr Server serves itself at /tv/) has no
  // mixed content to avoid, and the server may not be registered with the relay: use the address as
  // entered rather than a secure name that might not exist. Playarr never blocks an http:// server.
  if (pageProtocol === "http:") return value;
  const input = value.trim();
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(input)
    ? input
    : input.startsWith("//")
      ? `http:${input}`
      : `http://${input}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return value;

    const encodedOctets = encodedPublicIpv4Octets(url.hostname);
    const octets = encodedOctets ?? publicIpv4Octets(url.hostname);
    if (!octets) return value;

    const hostname = `v4-${octets.join("-")}.${PUBLIC_IPV4_RELAY_HOSTNAME}`;
    const path = url.pathname === "/" ? "" : url.pathname;
    // An explicit port is respected exactly. Without one the name is a candidate for the 443 then 8484
    // fallback (`resolveRelayAddress`); if a previous launch found that only 8484 answers, use it.
    const explicitPort = url.port || typedPort(candidate);
    const rememberedPort = explicitPort ? undefined : readRelayPortMemory()[hostname];
    const port = explicitPort
      ? `:${explicitPort}`
      : rememberedPort === "8484"
        ? `:${LEGACY_RELAY_PORT}`
        : "";
    return `https://${hostname}${port}${path}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}

/** True for a normalised relay URL with no port, which means 443 and may fall back to 8484. */
function isPortlessRelayUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.port === "" && encodedPublicIpv4Octets(url.hostname) !== undefined
      && !typedPort(value);
  } catch {
    return false;
  }
}

/** A real `GET /api/system/version`, short timeout; true only for an OK answer. */
export async function probeRelayCandidate(
  baseUrl: string,
  fetchImpl: (input: Request) => Promise<Response> = (input) => fetch(input),
  timeoutMs: number = RELAY_PROBE_TIMEOUT_MS
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(
      new Request(`${baseUrl.replace(/\/+$/, "")}/api/system/version`, { signal: controller.signal })
    );
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `publicIpv4RelayUrl` plus the connection fallback. A bare public address (no port typed) has two
 * candidates: the relay name on 443, then on 8484 (the default `PLAYARR_HTTP_BIND_ADDR`) when 443 does
 * not connect, fails TLS or times out. The port that worked is remembered. An explicit port, a
 * remembered port, a private address and a plain-http page are returned without any probe.
 */
export async function resolveRelayAddress(
  value: string,
  options: {
    probe?: (baseUrl: string) => Promise<boolean>;
    pageProtocol?: string;
  } = {}
): Promise<string> {
  const primary = publicIpv4RelayUrl(value, options.pageProtocol);
  if (!isPortlessRelayUrl(primary)) return primary;
  const hostname = new URL(primary).hostname;
  if (readRelayPortMemory()[hostname.toLowerCase()] === "443") return primary;

  const probe = options.probe ?? ((url: string) => probeRelayCandidate(url));
  const split = primary.match(/^(https:\/\/[^/?#]+)(.*)$/);
  if (!split) return primary;
  const [, origin, rest] = split;
  if (await probe(primary)) {
    rememberRelayPort(hostname, "443");
    return primary;
  }
  const fallback = `${origin}:${LEGACY_RELAY_PORT}${rest}`;
  if (await probe(fallback)) {
    rememberRelayPort(hostname, "8484");
    return fallback;
  }
  return primary;
}

/**
 * Do not present the hosted client itself as if it were a Playarr Server.
 * The hosted sign-in form starts blank so a previously selected server is
 * never presented as a default -- *unless* there is something real to
 * prefill it with: a legacy operator-entered `apiBaseUrl`
 * (`getStoredApiBaseUrl`), or a remembered peer-group address book
 * (`readKnownServers`, `docs/architecture/peer-groups.md` §7.1/§7.3).
 * Blank only when neither exists at all -- the genuinely first-ever visit
 * case. Self-hosted bundles (any other hostname) still always use their own
 * API URL, unchanged. `apiBaseUrl` itself is a display value only here (the
 * already-resolved current origin) -- the *presence* checks below read the
 * persisted values directly rather than trusting that `apiBaseUrl` came
 * from one of them, since on the hosted build it may just be this page's
 * own origin (`window.location.origin`), which is never a real server.
 */
export function initialLoginServerUrl(
  apiBaseUrl: string,
  pageHostname: string
): string {
  if (pageHostname !== HOSTED_PLAYARR_HOSTNAME) return apiBaseUrl;

  const hasRememberedServer = Boolean(getStoredApiBaseUrl()) || readKnownServers() !== undefined;
  return hasRememberedServer ? apiBaseUrl : "";
}
