import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  describeApiError,
  type CreateUserRequest,
  type SourceInstanceResponse,
  type SourceKind,
  type UserInviteRequestResponse,
  type UserResponse,
  type WorkKind,
} from "@streamarr-tv/api-client";
import { buildInviteUrl, type PeerAddressBundleLike } from "@streamarr-tv/domain";
import { useApiBaseUrl, useApiClient, useCurrentUserId } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { Modal } from "../components/Modal";
import { QrCode } from "../components/QrCode";
import { KIND_LABELS } from "../components/PosterCard";

const EMPTY_FORM: CreateUserRequest = {
  username: "",
  display_name: "",
  email: "",
  password: "",
  is_admin: false,
  can_stream: true,
  can_download: false,
};

type TypePermission = {
  kind: WorkKind;
  sourceKinds: readonly SourceKind[];
};

type InviteSetup = {
  request: UserInviteRequestResponse | null;
};

/**
 * The source applications that can actually contribute playable works to
 * each top-level catalog Type. Bazarr/Prowlarr are intentionally absent:
 * they support subtitles/indexing but do not own a Streamarr media library,
 * so offering them as a user library permission would grant nothing.
 */
const TYPE_PERMISSIONS: readonly TypePermission[] = [
  { kind: "movie", sourceKinds: ["radarr"] },
  { kind: "series", sourceKinds: ["sonarr"] },
  { kind: "site", sourceKinds: ["whisparr"] },
  { kind: "artist", sourceKinds: ["lidarr"] },
  { kind: "author", sourceKinds: ["readarr"] },
];

function librariesForType(
  instances: readonly SourceInstanceResponse[],
  permission: TypePermission
): SourceInstanceResponse[] {
  return instances.filter((instance) => permission.sourceKinds.includes(instance.kind));
}

function selectedTypeCount(
  libraryAllow: readonly string[],
  instances: readonly SourceInstanceResponse[]
): number {
  const allowed = new Set(libraryAllow);
  return TYPE_PERMISSIONS.filter((permission) =>
    librariesForType(instances, permission).some((instance) => allowed.has(instance.id))
  ).length;
}

function TypePermissionSection({
  permission,
  libraries,
  selection,
  onToggleType,
  onToggleLibrary,
}: {
  permission: TypePermission;
  libraries: readonly SourceInstanceResponse[];
  selection: ReadonlySet<string>;
  onToggleType: (libraries: readonly SourceInstanceResponse[]) => void;
  onToggleLibrary: (instanceId: string) => void;
}) {
  const typeCheckboxRef = useRef<HTMLInputElement>(null);
  const selectedCount = libraries.filter((library) => selection.has(library.id)).length;
  const allSelected = libraries.length > 0 && selectedCount === libraries.length;
  const partlySelected = selectedCount > 0 && !allSelected;

  useEffect(() => {
    if (typeCheckboxRef.current) {
      typeCheckboxRef.current.indeterminate = partlySelected;
    }
  }, [partlySelected]);

  return (
    <section className="permission-type">
      <label className="checkbox-label permission-type-heading">
        <input
          ref={typeCheckboxRef}
          type="checkbox"
          checked={allSelected}
          disabled={libraries.length === 0}
          onChange={() => onToggleType(libraries)}
        />
        <span>
          <strong>{KIND_LABELS[permission.kind]}</strong>
          <span className="permission-type-count">
            {libraries.length === 0
              ? "No applicable libraries"
              : `${selectedCount} of ${libraries.length} selected`}
          </span>
        </span>
      </label>

      {libraries.length > 0 && (
        <div className="permission-library-list">
          {libraries.map((library) => (
            <label key={library.id} className="checkbox-label permission-library">
              <input
                type="checkbox"
                checked={selection.has(library.id)}
                onChange={() => onToggleLibrary(library.id)}
              />
              <span>{library.name}</span>
              <span className="muted permission-library-kind">{library.kind}</span>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

/** "Make admin"/"Revoke admin" icon for a user card's `.icon-btn` -- purely decorative. */
function ShieldIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2l8 3.5v5.5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V5.5L12 2z" />
    </svg>
  );
}

/** "Grant"/"Revoke" Playarr streaming access icon for a user card's `.icon-btn` -- purely decorative. */
function PlayIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

/** "Grant/Revoke download access" icon for a user card's `.icon-btn` -- purely decorative. */
function DownloadIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

/** "Disable"/"Enable" icon for a user card's `.icon-btn` -- purely decorative. */
function PowerIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      <line x1="12" y1="2" x2="12" y2="12" />
    </svg>
  );
}

/** "Manage permissions" icon for a user card's `.icon-btn` -- purely decorative. */
function LibraryIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  );
}

/** Remove icon for a user card's `.icon-btn.icon-btn-danger` -- purely decorative. */
function TrashIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

/**
 * The one self-lockout-risky toggle a card's action row can be mid-confirming
 * at a time. Clicking "Revoke admin"/"Disable"/"Remove" on *your own* account
 * doesn't fire the request immediately -- it arms this (showing the warning
 * text below the card), and only actually calls the API on the matching
 * second click. Anything else (switching to a different card/action, or a
 * non-self-targeting click) clears it. Purely a client-side speed bump: the
 * backend does not itself reject an admin locking themselves out (see
 * `backend/crates/streamarr-api/src/users.rs`'s `update_user_handler`/
 * `delete_user_handler`), so this is the only guard that exists today.
 * Revoking your own `can_stream` isn't included here -- unlike admin/
 * disabled/delete, it can't lock you out of *this* app (Streamarr Admin
 * doesn't require `can_stream` at all), so it doesn't need the same
 * confirm-twice friction.
 */
type SelfLockoutAction = "revoke-admin" | "disable-self" | "delete-self";

function selfLockoutKey(userId: string, action: SelfLockoutAction): string {
  return `${userId}:${action}`;
}

const SELF_LOCKOUT_WARNINGS: Record<SelfLockoutAction, string> = {
  "revoke-admin": "This is your own account -- revoking admin will lock you out of Admin. Click again to confirm.",
  "disable-self": "This is your own account -- disabling it will sign you out and lock you out. Click again to confirm.",
  "delete-self": "This is your own account -- deleting it will sign you out permanently. Click again to confirm.",
};

/**
 * Provisions/lists/removes real username+password accounts -- the web UI
 * for `POST/GET/PATCH/DELETE /api/v1/admin/users`
 * (backend/crates/streamarr-api/src/users.rs). `is_admin`/`can_stream`/
 * `disabled` are toggled inline via icon buttons (calling `updateUser`)
 * rather than a full edit form -- there's nothing else on a `User` worth a
 * dedicated edit screen for yet (display name/email/password changes
 * aren't exposed here at all).
 *
 * `can_stream` is a separate grant from `is_admin` -- see
 * `streamarr_model::Policy::can_stream`'s doc comment -- so an account can
 * be an admin with no Playarr access (the bootstrap admin defaults this
 * way) or a Playarr viewer with no admin access (the common case for a
 * household member), independently.
 */
export function UsersPage() {
  useDocumentTitle("Users");
  const client = useApiClient();
  const apiBaseUrl = useApiBaseUrl();
  const currentUserId = useCurrentUserId();
  const [users, setUsers] = useState<UserResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CreateUserRequest>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteExpiresAt, setInviteExpiresAt] = useState<string | null>(null);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteRequests, setInviteRequests] = useState<UserInviteRequestResponse[] | null>(null);
  const [reviewingRequestId, setReviewingRequestId] = useState<string | null>(null);
  const [inviteSetup, setInviteSetup] = useState<InviteSetup | null>(null);
  const [inviteCanStream, setInviteCanStream] = useState(true);
  const [inviteLibrarySelection, setInviteLibrarySelection] = useState<Set<string>>(new Set());
  const [inviteSetupError, setInviteSetupError] = useState<string | null>(null);

  // Source instances back the type-first permission picker below -- fetched
  // once on mount, same call `SourceInstancesPage`/`LibraryToolbarMenus`
  // already make. That endpoint is `AdminUser`-gated same as everything
  // else on this page, so a failure here would mean this page's own load
  // already failed; still caught silently (hides the picker rather than
  // erroring the whole page) for consistency with `LibraryToolbarMenus`.
  const [instances, setInstances] = useState<SourceInstanceResponse[] | null>(null);
  useEffect(() => {
    client
      .listSourceInstances()
      .then(setInstances)
      .catch(() => setInstances(null));
  }, [client]);

  // "Manage permissions" modal state -- which user it's open for (`null` =
  // closed), the in-progress selection, and save/error state. A `Set` for
  // the selection so toggling one checkbox doesn't need to scan/rebuild an
  // array on every click.
  const [libraryModalUser, setLibraryModalUser] = useState<UserResponse | null>(null);
  const [librarySelection, setLibrarySelection] = useState<Set<string>>(new Set());
  const [savingLibraries, setSavingLibraries] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  function refresh() {
    setError(null);
    client
      .listUsers()
      .then(setUsers)
      .catch((err: unknown) => setError(describeApiError(err)));
    client
      .listUserInviteRequests()
      .then(setInviteRequests)
      .catch((err: unknown) => setError(describeApiError(err)));
  }

  async function handleReviewInviteRequest(id: string, approved: boolean) {
    setReviewingRequestId(id);
    setError(null);
    try {
      const reviewed = await client.reviewUserInviteRequest(id, {
        approved,
        can_stream: approved,
        library_allow: [],
      });
      setInviteRequests((current) =>
        current?.map((request) => (request.id === reviewed.id ? reviewed : request)) ?? current
      );
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setReviewingRequestId(null);
    }
  }

  function openInviteSetup(request: UserInviteRequestResponse | null) {
    setInviteCanStream(true);
    setInviteLibrarySelection(new Set(request?.library_allow ?? []));
    setInviteSetupError(null);
    setInviteSetup({ request });
  }

  /**
   * `GET .../peer-groups/self/address-bundle` (`admin_peer.rs`) reports an
   * empty `addresses` list -- never an error -- for a node that has never
   * called the (not-yet-surfaced-in-this-UI) `PUT /api/v1/admin/
   * peer-nodes/self` endpoint, which is every deployment's actual state
   * today: nothing here or in a "Peers" admin page calls it yet. Without
   * this fallback, every invite link generated by such a node would encode
   * a zero-address `servers=` bundle, which `signupInvite.ts
   * ::parseSignupInvite` treats as "no invite at all" -- silently breaking
   * sign-up for the overwhelmingly common single-node case this phase's own
   * rollout invariant requires stay inert. Falling back to this admin's own
   * currently-connected address reproduces exactly the pre-this-phase
   * behavior (the client-side `apiBaseUrl` interpolation `Invite.tsx`'s
   * identical 403 fallback mirrors), still encoded via the one `servers=`
   * code path. `peer_node_id: ""` is a placeholder, not a real attribution
   * -- harmless, since every consumer downstream of `buildInviteUrl` only
   * ever reads `url` (sign-up redemption works at any node in the group by
   * design).
   */
  async function resolveAdminInviteAddressBundle(): Promise<PeerAddressBundleLike> {
    const bundle = await client.getPeerAddressBundle();
    return bundle.addresses.length > 0 ? bundle : { addresses: [{ peer_node_id: "", url: apiBaseUrl }] };
  }

  async function handleSubmitInviteAccess() {
    if (!inviteSetup) return;
    const libraryAllow = Array.from(inviteLibrarySelection);
    if (inviteSetup.request) {
      const request = inviteSetup.request;
      setReviewingRequestId(request.id);
      setInviteSetupError(null);
      try {
        const reviewed = await client.reviewUserInviteRequest(request.id, {
          approved: true,
          can_stream: inviteCanStream,
          library_allow: libraryAllow,
        });
        setInviteRequests((current) =>
          current?.map((item) => (item.id === reviewed.id ? reviewed : item)) ?? current
        );
        setInviteSetup(null);
      } catch (err) {
        setInviteSetupError(describeApiError(err));
      } finally {
        setReviewingRequestId(null);
      }
      return;
    }

    setCreatingInvite(true);
    setInviteSetupError(null);
    setInviteCopied(false);
    try {
      const [invite, addressBundle] = await Promise.all([
        client.createUserInvite({
          can_stream: inviteCanStream,
          library_allow: libraryAllow,
        }),
        resolveAdminInviteAddressBundle(),
      ]);
      setInviteLink(buildInviteUrl(addressBundle, invite.invite_token));
      setInviteExpiresAt(invite.expires_at);
      setInviteSetup(null);
    } catch (err) {
      setInviteSetupError(describeApiError(err));
    } finally {
      setCreatingInvite(false);
    }
  }

  async function handleCopyInvite() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteCopied(true);
    } catch {
      setInviteError("Could not copy the link. Select and copy it manually.");
    }
  }

  useEffect(refresh, [client]);

  function openLibraryModal(user: UserResponse) {
    setLibraryError(null);
    setLibrarySelection(new Set(user.library_allow));
    setLibraryModalUser(user);
  }

  function toggleLibrarySelection(instanceId: string) {
    setLibrarySelection((current) => {
      const next = new Set(current);
      if (next.has(instanceId)) {
        next.delete(instanceId);
      } else {
        next.add(instanceId);
      }
      return next;
    });
  }

  function toggleTypeSelection(libraries: readonly SourceInstanceResponse[]) {
    setLibrarySelection((current) => {
      const next = new Set(current);
      const everyLibrarySelected = libraries.every((library) => current.has(library.id));
      for (const library of libraries) {
        if (everyLibrarySelected) {
          next.delete(library.id);
        } else {
          next.add(library.id);
        }
      }
      return next;
    });
  }

  function toggleInviteLibrarySelection(instanceId: string) {
    setInviteLibrarySelection((current) => {
      const next = new Set(current);
      if (next.has(instanceId)) {
        next.delete(instanceId);
      } else {
        next.add(instanceId);
      }
      return next;
    });
  }

  function toggleInviteTypeSelection(libraries: readonly SourceInstanceResponse[]) {
    setInviteLibrarySelection((current) => {
      const next = new Set(current);
      const everyLibrarySelected = libraries.every((library) => current.has(library.id));
      for (const library of libraries) {
        if (everyLibrarySelected) {
          next.delete(library.id);
        } else {
          next.add(library.id);
        }
      }
      return next;
    });
  }

  async function handleSaveLibraries() {
    if (!libraryModalUser) return;
    setSavingLibraries(true);
    setLibraryError(null);
    try {
      const updated = await client.updateUser(libraryModalUser.id, {
        library_allow: Array.from(librarySelection),
      });
      setUsers((current) => current?.map((u) => (u.id === updated.id ? updated : u)) ?? current);
      setLibraryModalUser(null);
    } catch (err) {
      setLibraryError(describeApiError(err));
    } finally {
      setSavingLibraries(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const body: CreateUserRequest = {
        ...form,
        email: form.email ? form.email : undefined,
      };
      await client.createUser(body);
      setForm(EMPTY_FORM);
      refresh();
    } catch (err) {
      // Most commonly a 409 -- username already taken.
      setError(describeApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Routes every self-lockout-risky click through the arm/confirm dance
   * described on `SelfLockoutAction` above; anything else (not `self`, or
   * already armed for this exact user+action) runs `perform` straight away.
   */
  async function withSelfLockoutGuard(
    user: UserResponse,
    action: SelfLockoutAction,
    isSelfRisk: boolean,
    perform: () => Promise<void>
  ) {
    const key = selfLockoutKey(user.id, action);
    if (isSelfRisk && pendingConfirm !== key) {
      setPendingConfirm(key);
      return;
    }
    setPendingConfirm(null);
    setBusyId(user.id);
    setError(null);
    try {
      await perform();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusyId(null);
    }
  }

  function handleToggleAdmin(user: UserResponse) {
    const nextIsAdmin = !user.is_admin;
    void withSelfLockoutGuard(
      user,
      "revoke-admin",
      user.is_admin && user.id === currentUserId,
      async () => {
        const updated = await client.updateUser(user.id, { is_admin: nextIsAdmin });
        setUsers((current) => current?.map((u) => (u.id === user.id ? updated : u)) ?? current);
      }
    );
  }

  async function handleToggleStreaming(user: UserResponse) {
    setBusyId(user.id);
    setError(null);
    try {
      const updated = await client.updateUser(user.id, { can_stream: !user.can_stream });
      setUsers((current) => current?.map((u) => (u.id === user.id ? updated : u)) ?? current);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleDownload(user: UserResponse) {
    setBusyId(user.id);
    setError(null);
    try {
      const updated = await client.updateUser(user.id, { can_download: !user.can_download });
      setUsers((current) => current?.map((u) => (u.id === user.id ? updated : u)) ?? current);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusyId(null);
    }
  }

  function handleToggleDisabled(user: UserResponse) {
    const nextDisabled = !user.disabled;
    void withSelfLockoutGuard(
      user,
      "disable-self",
      !user.disabled && user.id === currentUserId,
      async () => {
        const updated = await client.updateUser(user.id, { disabled: nextDisabled });
        setUsers((current) => current?.map((u) => (u.id === user.id ? updated : u)) ?? current);
      }
    );
  }

  function handleDelete(user: UserResponse) {
    void withSelfLockoutGuard(user, "delete-self", user.id === currentUserId, async () => {
      await client.deleteUser(user.id);
      setUsers((current) => current?.filter((u) => u.id !== user.id) ?? current);
    });
  }

  return (
    <div className="page">
      <div className="page-heading-row">
        <h1 className="page-title">Users</h1>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => openInviteSetup(null)}
          disabled={creatingInvite}
        >
          {creatingInvite ? "Creating invite..." : "Invite user"}
        </button>
      </div>
      <p className="muted" style={{ maxWidth: 640, marginBottom: "1rem" }}>
        Real username/password accounts, each with a Policy controlling admin access and Playarr
        streaming access -- the two are independent grants. A new account starts with no library
        access granted -- use the "manage permissions" action on a card below to share Types and
        choose their applicable Libraries.
      </p>

      {error && <p className="error-text" style={{ marginBottom: "1rem" }}>{error}</p>}
      {inviteError && !inviteLink && (
        <p className="error-text" style={{ marginBottom: "1rem" }}>{inviteError}</p>
      )}

      {inviteRequests?.some((request) => request.status === "pending") ? (
        <section className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 className="section-title" style={{ marginBottom: "0.4rem" }}>Friend invite requests</h2>
          <p className="muted" style={{ marginBottom: "1rem" }}>
            Approving grants the requester one QR generation. Its 24-hour expiry starts only when
            they generate it in Playarr.
          </p>
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {inviteRequests
              .filter((request) => request.status === "pending")
              .map((request) => (
                <div
                  key={request.id}
                  style={{
                    display: "flex",
                    gap: "1rem",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <strong>{request.display_name}</strong>
                    <p className="muted" style={{ margin: 0 }}>
                      @{request.username} · requested {new Date(request.requested_at).toLocaleString()}
                    </p>
                    {request.message ? (
                      <p style={{ margin: "0.35rem 0 0", maxWidth: 640, whiteSpace: "pre-wrap" }}>
                        {request.message}
                      </p>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={reviewingRequestId !== null}
                      onClick={() => void handleReviewInviteRequest(request.id, false)}
                    >
                      Deny
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={reviewingRequestId !== null}
                      onClick={() => openInviteSetup(request)}
                    >
                      {reviewingRequestId === request.id ? "Reviewing..." : "Approve"}
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </section>
      ) : null}

      {users !== null && users.length > 0 && (
        <div className="provider-grid" style={{ marginBottom: "1.5rem" }}>
          {users.map((user) => {
            const isSelf = user.id === currentUserId;
            const busy = busyId === user.id;
            const warningKey = pendingConfirm?.startsWith(`${user.id}:`) ? pendingConfirm : null;
            const warningAction = warningKey
              ? (warningKey.slice(user.id.length + 1) as SelfLockoutAction)
              : null;
            const typeCount = instances ? selectedTypeCount(user.library_allow, instances) : null;
            return (
              <div key={user.id} className="provider-card">
                <div className="provider-card-name">
                  <Link className="activity-link" to={`/users/${user.id}`}>{user.username}</Link>
                </div>
                <p
                  className="muted"
                  style={{
                    fontSize: "var(--font-size-caption)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {user.display_name}
                  {user.email ? ` · ${user.email}` : ""}
                  {isSelf ? " · you" : ""}
                </p>
                <div className="provider-card-tags">
                  <span className={`badge badge-pill ${user.is_admin ? "badge-warning" : "badge-neutral"}`}>
                    {user.is_admin ? "admin" : "user"}
                  </span>
                  <span className={`badge badge-pill ${user.can_stream ? "badge-success" : "badge-neutral"}`}>
                    {user.can_stream ? "playarr access" : "no playarr access"}
                  </span>
                  <span className={`badge badge-pill ${user.can_download ? "badge-success" : "badge-neutral"}`}>
                    {user.can_download ? "can download" : "no downloads"}
                  </span>
                  <span className={`badge badge-pill ${user.disabled ? "badge-danger" : "badge-success"}`}>
                    {user.disabled ? "disabled" : "enabled"}
                  </span>
                  <span className={`badge badge-pill ${user.is_admin || user.library_allow.length > 0 ? "badge-success" : "badge-neutral"}`}>
                    {user.is_admin ? (
                      "all types (admin)"
                    ) : user.library_allow.length === 0 ? (
                      "no types"
                    ) : typeCount !== null ? (
                      `${typeCount} type${typeCount === 1 ? "" : "s"} · ${
                        user.library_allow.length
                      } librar${user.library_allow.length === 1 ? "y" : "ies"}`
                    ) : (
                      `${user.library_allow.length} librar${user.library_allow.length === 1 ? "y" : "ies"}`
                    )}
                  </span>
                </div>
                <div className="provider-card-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    title="Manage permissions"
                    aria-label="Manage permissions"
                    disabled={busy}
                    onClick={() => openLibraryModal(user)}
                    style={busy ? { opacity: 0.55, cursor: "default" } : undefined}
                  >
                    <LibraryIcon />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title={user.is_admin ? "Revoke admin" : "Make admin"}
                    aria-label={user.is_admin ? "Revoke admin" : "Make admin"}
                    disabled={busy}
                    onClick={() => handleToggleAdmin(user)}
                    style={busy ? { opacity: 0.55, cursor: "default" } : undefined}
                  >
                    <ShieldIcon />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title={user.can_stream ? "Revoke Playarr access" : "Grant Playarr access"}
                    aria-label={user.can_stream ? "Revoke Playarr access" : "Grant Playarr access"}
                    disabled={busy}
                    onClick={() => void handleToggleStreaming(user)}
                    style={busy ? { opacity: 0.55, cursor: "default" } : undefined}
                  >
                    <PlayIcon />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title={user.can_download ? "Revoke download access" : "Grant download access"}
                    aria-label={user.can_download ? "Revoke download access" : "Grant download access"}
                    disabled={busy}
                    onClick={() => void handleToggleDownload(user)}
                    style={busy ? { opacity: 0.55, cursor: "default" } : undefined}
                  >
                    <DownloadIcon />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title={user.disabled ? "Enable" : "Disable"}
                    aria-label={user.disabled ? "Enable" : "Disable"}
                    disabled={busy}
                    onClick={() => handleToggleDisabled(user)}
                    style={busy ? { opacity: 0.55, cursor: "default" } : undefined}
                  >
                    <PowerIcon />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    title="Remove"
                    aria-label="Remove"
                    disabled={busy}
                    onClick={() => handleDelete(user)}
                    style={busy ? { opacity: 0.55, cursor: "default" } : undefined}
                  >
                    <TrashIcon />
                  </button>
                </div>
                {warningAction && <p className="error-text hint">{SELF_LOCKOUT_WARNINGS[warningAction]}</p>}
              </div>
            );
          })}
        </div>
      )}
      {users !== null && users.length === 0 && (
        <p className="muted" style={{ marginBottom: "1.5rem" }}>
          No accounts provisioned yet.
        </p>
      )}

      <div className="card">
        <form
          onSubmit={(e) => void handleSubmit(e)}
          style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}
        >
          <input
            className="input"
            placeholder="Username"
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            required
          />
          <input
            className="input"
            placeholder="Display name"
            value={form.display_name}
            onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
            required
          />
          <input
            type="email"
            className="input"
            placeholder="Email (optional)"
            value={form.email ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
          <input
            type="password"
            className="input"
            placeholder="Password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            required
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.can_stream ?? false}
              onChange={(e) => setForm((f) => ({ ...f, can_stream: e.target.checked }))}
            />
            Playarr access
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.can_download ?? false}
              onChange={(e) => setForm((f) => ({ ...f, can_download: e.target.checked }))}
            />
            Download access
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.is_admin ?? false}
              onChange={(e) => setForm((f) => ({ ...f, is_admin: e.target.checked }))}
            />
            Admin
          </label>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "Creating..." : "Create account"}
          </button>
        </form>
      </div>

      {inviteSetup && (
        <Modal
          title={inviteSetup.request ? `Approve invite -- ${inviteSetup.request.username}` : "Invite a Playarr user"}
          onClose={() => setInviteSetup(null)}
          footer={
            <>
              <div className="modal-footer-left" />
              <div className="modal-footer-right">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setInviteSetup(null)}
                  disabled={creatingInvite || reviewingRequestId !== null}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void handleSubmitInviteAccess()}
                  disabled={creatingInvite || reviewingRequestId !== null}
                >
                  {creatingInvite || reviewingRequestId !== null
                    ? "Saving..."
                    : inviteSetup.request
                      ? "Approve and share"
                      : "Create invite"}
                </button>
              </div>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>
            Choose the access the new account receives as soon as this invite is redeemed.
          </p>
          {inviteSetup.request?.message ? (
            <div className="modal-field">
              <span className="muted">Request message</span>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{inviteSetup.request.message}</p>
            </div>
          ) : null}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={inviteCanStream}
              onChange={(event) => setInviteCanStream(event.target.checked)}
            />
            Playarr access
          </label>
          {inviteSetupError ? (
            <p className="error-text hint" style={{ margin: 0 }}>{inviteSetupError}</p>
          ) : null}
          {instances === null && <p className="muted">Loading source instances...</p>}
          {instances !== null && instances.length === 0 && (
            <p className="muted">No source instances registered yet -- nothing to share.</p>
          )}
          {instances !== null && instances.length > 0 && (
            <div className="permission-types">
              {TYPE_PERMISSIONS.map((permission) => (
                <TypePermissionSection
                  key={permission.kind}
                  permission={permission}
                  libraries={librariesForType(instances, permission)}
                  selection={inviteLibrarySelection}
                  onToggleType={toggleInviteTypeSelection}
                  onToggleLibrary={toggleInviteLibrarySelection}
                />
              ))}
            </div>
          )}
        </Modal>
      )}

      {libraryModalUser && (
        <Modal
          title={`Manage permissions -- ${libraryModalUser.username}`}
          onClose={() => setLibraryModalUser(null)}
          footer={
            <>
              <div className="modal-footer-left" />
              <div className="modal-footer-right">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setLibraryModalUser(null)}
                  disabled={savingLibraries}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void handleSaveLibraries()}
                  disabled={savingLibraries}
                >
                  {savingLibraries ? "Saving..." : "Save"}
                </button>
              </div>
            </>
          }
        >
          {libraryError && (
            <p className="error-text hint" style={{ margin: 0 }}>
              {libraryError}
            </p>
          )}
          {libraryModalUser.is_admin && (
            <p className="muted hint" style={{ margin: 0 }}>
              This account is an admin -- admins see every Type and Library regardless of the
              selection below. Set permissions here anyway if you plan to revoke admin later.
            </p>
          )}
          {instances === null && <p className="muted">Loading source instances...</p>}
          {instances !== null && instances.length === 0 && (
            <p className="muted">No source instances registered yet -- nothing to share.</p>
          )}
          {instances !== null && instances.length > 0 && (
            <div className="permission-types">
              {TYPE_PERMISSIONS.map((permission) => (
                <TypePermissionSection
                  key={permission.kind}
                  permission={permission}
                  libraries={librariesForType(instances, permission)}
                  selection={librarySelection}
                  onToggleType={toggleTypeSelection}
                  onToggleLibrary={toggleLibrarySelection}
                />
              ))}
            </div>
          )}
        </Modal>
      )}

      {inviteLink && (
        <Modal
          title="Invite a Playarr user"
          onClose={() => {
            setInviteLink(null);
            setInviteError(null);
          }}
          footer={
            <>
              <div className="modal-footer-left" />
              <div className="modal-footer-right">
                <button type="button" className="btn btn-secondary" onClick={() => setInviteLink(null)}>
                  Close
                </button>
                <button type="button" className="btn btn-primary" onClick={() => void handleCopyInvite()}>
                  {inviteCopied ? "Copied" : "Copy link"}
                </button>
              </div>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>
            Ask the new user to scan this code. It opens Playarr with this Streamarr server locked
            in, then lets them choose their account details.
          </p>
          <QrCode value={inviteLink} size={260} />
          <div className="modal-field">
            <label htmlFor="user-invite-link">Invite link</label>
            <input
              id="user-invite-link"
              className="input"
              value={inviteLink}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
          {inviteExpiresAt && (
            <p className="hint" style={{ margin: 0 }}>
              Expires {new Date(inviteExpiresAt).toLocaleString()}. The invite can be used once.
            </p>
          )}
          {inviteError && <p className="error-text hint" style={{ margin: 0 }}>{inviteError}</p>}
        </Modal>
      )}
    </div>
  );
}
