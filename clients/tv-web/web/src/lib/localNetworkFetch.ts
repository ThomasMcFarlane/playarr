type TargetAddressSpace = "local" | "loopback";

type LocalNetworkRequestInit = RequestInit & {
  targetAddressSpace: TargetAddressSpace;
};

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

/** Returns the requested address space for any direct HTTP server URL. */
export function targetAddressSpaceForUrl(value: string): TargetAddressSpace | undefined {
  const url = new URL(value);
  if (url.protocol !== "http:") return undefined;

  const hostname = stripIpv6Brackets(url.hostname.toLowerCase());
  if (hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.")) {
    return "loopback";
  }
  return "local";
}

/**
 * Marks every direct HTTP request to Streamarr so supporting browsers
 * can ask the viewer for Local Network Access and relax mixed-content blocking.
 * Browsers without this API ignore the additional fetch option.
 */
export function createLocalNetworkFetch(
  nativeFetch: typeof fetch = globalThis.fetch.bind(globalThis)
): (input: Request) => Promise<Response> {
  return (input) => {
    const targetAddressSpace = targetAddressSpaceForUrl(input.url);
    return targetAddressSpace
      ? nativeFetch(input, { targetAddressSpace } as LocalNetworkRequestInit)
      : nativeFetch(input);
  };
}
