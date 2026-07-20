import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiError, describeApiError, type UserResponse } from "@streamarr-tv/api-client";
import { useApiClient } from "./ApiClientProvider";

/**
 * One active "view as" session -- minted by `POST
 * /api/v1/admin/users/{user_id}/impersonate` and held only in memory
 * (nothing here is persisted; a page reload drops it and the explorer falls
 * back to the signed-in admin's own token, same as any other in-memory
 * state here).
 */
interface ImpersonationState {
  accessToken: string;
  username: string;
  /** `Date.now()` at mint time plus the response's `expires_in` (seconds), in epoch ms. */
  expiresAt: number;
}

interface ApiTag {
  name: string;
  description?: string;
}

interface ApiExplorerContextValue {
  spec: Record<string, unknown> | null;
  specLoading: boolean;
  specError: string | null;
  /** `spec.tags`, in document order -- what both Scalar's own sidebar and the app's nav group its operations by. */
  tags: ApiTag[];
  users: UserResponse[] | null;
  usersError: string | null;
  selectedUserId: string;
  setSelectedUserId: (id: string) => void;
  impersonating: ImpersonationState | null;
  impersonateBusy: boolean;
  impersonateError: string | null;
  handleImpersonate: () => Promise<void>;
  stopImpersonating: () => void;
  /** Best-known bearer token right now -- the impersonated user's if active, else the signed-in admin's own. Recomputed only when `impersonating` changes; see `handleRequestBuilt` for the always-current enforcement path. */
  currentToken: string;
  /**
   * Fired by Scalar right before an outbound "Test Request" call goes out.
   * Reads only refs, never React state, so it's correct regardless of when
   * Scalar captured this particular function reference -- see the
   * `impersonatingRef`/`adminTokenRef` comments below for why that matters.
   */
  handleRequestBuilt: (input: { request: Request }) => void;
}

const ApiExplorerContext = createContext<ApiExplorerContextValue | null>(null);

/**
 * Owns every piece of state the API Explorer needs, shared between the
 * sidebar's "API Explorer" nav section (tag links, the impersonation
 * picker -- both in `App.tsx`) and the routed `ApiExplorerPage` (the Scalar
 * panel itself). Those two consumers are siblings, not parent/child, so
 * this lives in a context rather than component state -- provided once,
 * high up in `App.tsx`, alongside the sidebar itself.
 */
export function ApiExplorerProvider({ children }: { children: ReactNode }) {
  const client = useApiClient();

  const [spec, setSpec] = useState<Record<string, unknown> | null>(null);
  const [specLoading, setSpecLoading] = useState(true);
  const [specError, setSpecError] = useState<string | null>(null);

  const [users, setUsers] = useState<UserResponse[] | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");

  const [impersonating, setImpersonating] = useState<ImpersonationState | null>(null);
  const [impersonateBusy, setImpersonateBusy] = useState(false);
  const [impersonateError, setImpersonateError] = useState<string | null>(null);

  /**
   * The signed-in admin's own current access token. `handleRequestBuilt`
   * below must stay synchronous (Scalar calls it inline for every outgoing
   * request), but `client.getAccessToken()` is async -- so this ref is kept
   * fresh by the effect further down instead, and the hook reads it
   * directly.
   */
  const adminTokenRef = useRef<string | undefined>(undefined);

  /**
   * Mirrors `impersonating` state via a ref, not a closure over the state
   * value directly. Learned the hard way from an earlier (swagger-ui-react)
   * version of this page: that library only read its request-interceptor
   * prop once, at initial mount, and never re-applied it on later
   * re-renders -- a closure over `impersonating` would have forever seen
   * whatever it was at mount time (`null`). Keeping a ref in sync and
   * reading `.current` inside a referentially-stable callback sidesteps
   * that question entirely, regardless of which library ends up consuming
   * `handleRequestBuilt`.
   */
  const impersonatingRef = useRef<ImpersonationState | null>(null);
  impersonatingRef.current = impersonating;

  // Fetch the live spec once, on mount.
  useEffect(() => {
    let cancelled = false;
    setSpecLoading(true);
    setSpecError(null);
    client.raw
      .GET("/api/v1/openapi.json")
      .then((result) => {
        if (cancelled) return;
        if (!result.response.ok) {
          setSpecError(describeApiError(new ApiError(result.response.status, result.response.statusText, result.error)));
          return;
        }
        // The generated schema has no body type for this operation (an
        // OpenAPI document describing its own server, generated at
        // request time), so the real JSON object openapi-fetch already
        // parsed comes through typed as `undefined` here -- cast through
        // `unknown` to what it actually is at runtime.
        setSpec((result.data as unknown as Record<string, unknown> | undefined) ?? {});
      })
      .catch((err: unknown) => {
        if (!cancelled) setSpecError(describeApiError(err));
      })
      .finally(() => {
        if (!cancelled) setSpecLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // Fetch the user list for the impersonation picker.
  useEffect(() => {
    let cancelled = false;
    client
      .listUsers()
      .then((list) => {
        if (!cancelled) setUsers(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setUsersError(describeApiError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // Keeps `adminTokenRef` current -- on mount, and again whenever
  // impersonation is cleared, so requests fall back to a valid (not stale)
  // admin token the moment "Stop impersonating" is clicked.
  useEffect(() => {
    if (impersonating) return;
    let cancelled = false;
    client
      .getAccessToken()
      .then((token) => {
        if (!cancelled) adminTokenRef.current = token;
      })
      .catch(() => {
        if (!cancelled) adminTokenRef.current = undefined;
      });
    return () => {
      cancelled = true;
    };
  }, [client, impersonating]);

  const handleImpersonate = useCallback(async () => {
    if (!selectedUserId) return;
    setImpersonateBusy(true);
    setImpersonateError(null);
    try {
      const result = await client.raw.POST("/api/v1/admin/users/{user_id}/impersonate", {
        params: { path: { user_id: selectedUserId } },
      });
      if (!result.response.ok || !result.data) {
        throw new ApiError(result.response.status, result.response.statusText, result.error);
      }
      const impersonatedUser = users?.find((user) => user.id === result.data.user_id);
      setImpersonating({
        accessToken: result.data.access_token,
        username: impersonatedUser?.username ?? result.data.user_id,
        expiresAt: Date.now() + result.data.expires_in * 1000,
      });
    } catch (err) {
      setImpersonateError(describeApiError(err));
    } finally {
      setImpersonateBusy(false);
    }
  }, [client, selectedUserId, users]);

  const stopImpersonating = useCallback(() => {
    setImpersonating(null);
    setImpersonateError(null);
  }, []);

  const handleRequestBuilt = useCallback(({ request }: { request: Request }) => {
    const active = impersonatingRef.current;
    const token = active ? active.accessToken : adminTokenRef.current;
    if (token) {
      request.headers.set("Authorization", `Bearer ${token}`);
    }
  }, []);

  const tags = useMemo<ApiTag[]>(() => {
    const raw = spec?.tags;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (tag): tag is ApiTag => typeof tag === "object" && tag !== null && typeof tag.name === "string"
    );
  }, [spec]);

  const currentToken = useMemo(
    () => (impersonating ? impersonating.accessToken : adminTokenRef.current) ?? "",
    [impersonating]
  );

  const value: ApiExplorerContextValue = {
    spec,
    specLoading,
    specError,
    tags,
    users,
    usersError,
    selectedUserId,
    setSelectedUserId,
    impersonating,
    impersonateBusy,
    impersonateError,
    handleImpersonate,
    stopImpersonating,
    currentToken,
    handleRequestBuilt,
  };

  return <ApiExplorerContext.Provider value={value}>{children}</ApiExplorerContext.Provider>;
}

export function useApiExplorer(): ApiExplorerContextValue {
  const value = useContext(ApiExplorerContext);
  if (!value) {
    throw new Error("useApiExplorer() must be called within an <ApiExplorerProvider>.");
  }
  return value;
}
