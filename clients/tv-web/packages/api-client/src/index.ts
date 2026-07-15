/**
 * @streamarr-tv/api-client
 *
 * Hand-written placeholder for the Streamarr API client. Once the backend
 * publishes an OpenAPI schema, this package will be regenerated with
 * `openapi-typescript` (for types) + `openapi-fetch` (for the client), but
 * callers should already be able to depend on the shapes below (`ApiClient`,
 * `ApiClientConfig`, `ApiError`) without churn: the generated client is
 * expected to expose an equivalent typed-request surface.
 */

import type { VersionEnvelope } from "@streamarr-tv/domain";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiClientConfig {
  /** Origin + base path, e.g. "https://api.streamarr.tv/v1" (no trailing slash required). */
  baseUrl: string;
  /** Called before every request; return undefined to send the request unauthenticated. */
  getAccessToken?: () => string | undefined | Promise<string | undefined>;
  /** Injectable for tests / non-browser runtimes (webOS/Tizen legacy engines). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  defaultHeaders?: Record<string, string>;
}

export interface RequestOptions {
  method?: HttpMethod;
  /** Path relative to `baseUrl`, e.g. "/works" or "works/123". */
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Thrown for any non-2xx response. Carries the parsed (or raw text) body for callers to inspect. */
export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: unknown;

  constructor(status: number, statusText: string, body: unknown) {
    super(`API request failed: ${status} ${statusText}`);
    this.name = "ApiError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const relativePath = path.startsWith("/") ? path.slice(1) : path;
  return new URL(relativePath, base).toString();
}

/**
 * Minimal typed HTTP client for the Streamarr API. Deliberately small: a
 * single `request<T>` primitive plus thin verb helpers, mirroring the
 * ergonomics `openapi-fetch` will offer once the generated client replaces
 * this file.
 */
export class ApiClient {
  private readonly config: ApiClientConfig;

  constructor(config: ApiClientConfig) {
    this.config = config;
  }

  private buildUrl(path: string, query?: RequestOptions["query"]): string {
    const url = new URL(joinUrl(this.config.baseUrl, path));
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  async request<TResponse>(options: RequestOptions): Promise<TResponse> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const token = await this.config.getAccessToken?.();

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...this.config.defaultHeaders,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    };

    const response = await fetchImpl(this.buildUrl(options.path, options.query), {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });

    if (!response.ok) {
      const body = await parseBody(response);
      throw new ApiError(response.status, response.statusText, body);
    }

    if (response.status === 204) {
      return undefined as TResponse;
    }

    return (await parseBody(response)) as TResponse;
  }

  get<TResponse>(
    path: string,
    query?: RequestOptions["query"],
    init?: Omit<RequestOptions, "path" | "method" | "query">
  ): Promise<TResponse> {
    return this.request<TResponse>({ ...init, path, query, method: "GET" });
  }

  post<TResponse>(
    path: string,
    body?: unknown,
    init?: Omit<RequestOptions, "path" | "method" | "body">
  ): Promise<TResponse> {
    return this.request<TResponse>({ ...init, path, body, method: "POST" });
  }

  put<TResponse>(
    path: string,
    body?: unknown,
    init?: Omit<RequestOptions, "path" | "method" | "body">
  ): Promise<TResponse> {
    return this.request<TResponse>({ ...init, path, body, method: "PUT" });
  }

  patch<TResponse>(
    path: string,
    body?: unknown,
    init?: Omit<RequestOptions, "path" | "method" | "body">
  ): Promise<TResponse> {
    return this.request<TResponse>({ ...init, path, body, method: "PATCH" });
  }

  delete<TResponse>(
    path: string,
    init?: Omit<RequestOptions, "path" | "method">
  ): Promise<TResponse> {
    return this.request<TResponse>({ ...init, path, method: "DELETE" });
  }
}

async function parseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => undefined);
  }
  return response.text().catch(() => undefined);
}

/** Re-exported so consumers can type an endpoint's payload without a second import. */
export type { VersionEnvelope };
