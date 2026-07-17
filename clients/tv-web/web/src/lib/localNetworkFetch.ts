type TargetAddressSpace = "local" | "loopback";

type LocalNetworkRequestInit = RequestInit & {
  targetAddressSpace: TargetAddressSpace;
};

interface PageLocation {
  protocol: string;
  assign(url: string): void;
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function parseIpv4(hostname: string): [number, number, number, number] | undefined {
  const octets = hostname.split(".");
  if (octets.length !== 4) return undefined;
  const parsed = octets.map((octet) => Number(octet));
  return parsed.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? (parsed as [number, number, number, number])
    : undefined;
}

/** Public IP literals cannot use Local Network Access's HTTP exemption. */
export function isPublicIpLiteral(hostname: string): boolean {
  const unwrapped = stripIpv6Brackets(hostname.toLowerCase());
  const ipv4 = parseIpv4(unwrapped);
  if (ipv4) {
    const [first, second] = ipv4;
    return !(
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first >= 224
    );
  }

  if (!unwrapped.includes(":")) return false;
  return !(
    unwrapped === "::" ||
    unwrapped === "::1" ||
    unwrapped.startsWith("fc") ||
    unwrapped.startsWith("fd") ||
    /^fe[89ab]/.test(unwrapped)
  );
}

export function isPublicHttpIpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && isPublicIpLiteral(url.hostname);
  } catch {
    return false;
  }
}

/** Returns the requested address space for a private or loopback HTTP URL. */
export function targetAddressSpaceForUrl(value: string): TargetAddressSpace | undefined {
  const url = new URL(value);
  if (url.protocol !== "http:") return undefined;

  const hostname = stripIpv6Brackets(url.hostname.toLowerCase());
  if (hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.")) {
    return "loopback";
  }
  if (isPublicIpLiteral(hostname)) return undefined;
  return "local";
}

/**
 * Marks private and loopback HTTP requests to Streamarr so supporting browsers
 * can ask the viewer for Local Network Access and relax mixed-content blocking.
 * Public IPs are left unmarked because browsers correctly classify them as
 * public-network destinations. Browsers without this API ignore the option.
 */
export function createLocalNetworkFetch(
  nativeFetch: typeof fetch = globalThis.fetch.bind(globalThis),
  pageLocation: PageLocation | undefined =
    typeof window === "undefined" ? undefined : window.location
): (input: Request) => Promise<Response> {
  return (input) => {
    if (pageLocation?.protocol === "https:" && isPublicHttpIpUrl(input.url)) {
      pageLocation.assign(new URL("/playarr/login", input.url).toString());
      return Promise.reject(
        new TypeError("Opening the public HTTP server's same-origin Playarr client.")
      );
    }
    const targetAddressSpace = targetAddressSpaceForUrl(input.url);
    return targetAddressSpace
      ? nativeFetch(input, { targetAddressSpace } as LocalNetworkRequestInit)
      : nativeFetch(input);
  };
}
