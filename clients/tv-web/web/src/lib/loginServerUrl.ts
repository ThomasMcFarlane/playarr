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

    const octets = publicIpv4Octets(url.hostname);
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
 * The hosted sign-in form always starts blank so a previously selected server
 * is never presented as a default. Self-hosted bundles still use their API URL.
 */
export function initialLoginServerUrl(
  apiBaseUrl: string,
  pageHostname: string
): string {
  return pageHostname === HOSTED_PLAYARR_HOSTNAME ? "" : apiBaseUrl;
}
