import { getStoredApiBaseUrl, readKnownServers } from "@streamarr-tv/domain";

const HOSTED_PLAYARR_HOSTNAME = "playarr.app";
const PUBLIC_IPV4_RELAY_HOSTNAME = "relay.playarr.app";
const STREAMARR_PORT = "8484";

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
 * Give public IPv4 Streamarr servers a secure, deterministic DNS name.
 * DNS resolves the name straight back to the encoded address; neither
 * Playarr nor Cloudflare relays the request or its response.
 */
export function publicIpv4RelayUrl(value: string): string {
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
    return `https://${hostname}:${STREAMARR_PORT}${path}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}

/**
 * Do not present the hosted client itself as if it were a Streamarr server.
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
