/**
 * Storybook stand-in for `src/lib/ApiClientProvider` (swapped in by `.storybook/main.ts`). Components keep calling
 * `useApiClient()` and friends, but get a fixture client: every method resolves from the handlers a story registers with
 * `setMockApi`, and anything unregistered rejects. Nothing here reaches a network.
 */
import type { ReactNode } from "react";
import { QueryCache, type ApiClient } from "@playarr-tv/api-client";

// The real module for the pure helpers; the plugin in main.ts lets this one import through.
export * from "../../src/lib/ApiClientProvider";
import type { useAuth as RealUseAuth } from "../../src/lib/ApiClientProvider";

type Handler = (...args: unknown[]) => unknown;
let handlers: Record<string, Handler | unknown> = {};

/** Register the fixture responses for the current story. A function is called with the request arguments; any other value is returned as is. */
export function setMockApi(next: Record<string, Handler | unknown>): void {
  handlers = next;
}

/** The query cache is off (no scope), as when signed out: nothing is stored, prefetched or fetched through it. */
const queries = new QueryCache();

const client = new Proxy({} as ApiClient, {
  get(_target, method: string) {
    if (method === "then") return undefined;
    if (method === "queries") return queries;
    return (...args: unknown[]) => {
      const handler = handlers[method];
      if (handler === undefined) return Promise.reject(new Error(`No fixture for ApiClient.${method}`));
      return Promise.resolve(typeof handler === "function" ? (handler as Handler)(...args) : handler);
    };
  },
});

export function ApiClientProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
export const useApiClient = () => client;
export const usePrimaryApiClient = () => client;
export const useServerClient = () => client;
export const useServerAccessToken = () => async () => "fixture-token";
export const useApiBaseUrl = (): [string, (value: string) => void] => ["https://server.example.com", () => undefined];
export const useCurrentUserId = () => "00000000-0000-4000-8000-0000000000u1";
export const useAuth = (): ReturnType<typeof RealUseAuth> => ({
  authFailed: false,
  currentUserId: "00000000-0000-4000-8000-0000000000u1",
  currentUserName: "Sample User",
  savedProfiles: [{ userId: "00000000-0000-4000-8000-0000000000u1", name: "Sample User" }],
  connectedServers: [{ url: "https://server.example.com", label: "Sample server", username: "sample", primary: true }],
  login: async () => undefined,
  connectServer: async () => undefined,
  logout: () => undefined,
  switchProfile: async () => undefined,
  disconnectServer: () => undefined,
  logoutProfile: () => undefined,
} as unknown as ReturnType<typeof RealUseAuth>);
