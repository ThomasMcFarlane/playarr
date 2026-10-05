import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  describeApiError,
  type PeerAddress,
  type PeerAddressBundle,
  type PeerJoinTokenResponse,
  type PeerNode,
  type PeerNodeStatus,
  type SourceInstanceResponse,
} from "@playarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { Modal } from "../components/Modal";

type SetupMode = "create" | "join";

interface AddressDraft {
  key: number;
  url: string;
  label: string;
  priority: string;
  clientReachable: boolean;
}

let nextAddressKey = 1;

function newAddressDraft(address?: PeerAddress): AddressDraft {
  return {
    key: nextAddressKey++,
    url: address?.url ?? "",
    label: address?.label ?? "",
    priority: String(address?.priority ?? 0),
    clientReachable: address?.client_reachable ?? true,
  };
}

function addressDraftsFor(addresses: PeerAddress[]): AddressDraft[] {
  return addresses.length > 0
    ? addresses.map((address) => newAddressDraft(address))
    : [newAddressDraft()];
}

function parseHttpUrl(raw: string, fieldName: string): string {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${fieldName} must be a complete http:// or https:// URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${fieldName} must use http:// or https://.`);
  }
  return value.replace(/\/$/, "");
}

function parseAddresses(drafts: AddressDraft[]): PeerAddress[] {
  const populated = drafts.filter((draft) => draft.url.trim() || draft.label.trim());
  return populated
    .map((draft, index) => {
      const label = draft.label.trim();
      if (!label) throw new Error(`Address ${index + 1} needs a label.`);
      const priority = Number(draft.priority);
      if (!Number.isInteger(priority) || priority < 0) {
        throw new Error(`Address ${index + 1} priority must be a whole number of 0 or more.`);
      }
      return {
        url: parseHttpUrl(draft.url, `Address ${index + 1}`),
        label,
        priority,
        client_reachable: draft.clientReachable,
      };
    })
    .sort((left, right) => left.priority - right.priority);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Not yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function statusClass(status: PeerNodeStatus): string {
  if (status === "active") return "badge-success";
  if (status === "unreachable") return "badge-warning";
  return "badge-neutral";
}

interface AddressEditorProps {
  addresses: AddressDraft[];
  disabled: boolean;
  idPrefix: string;
  onChange: (addresses: AddressDraft[]) => void;
}

function AddressEditor({ addresses, disabled, idPrefix, onChange }: AddressEditorProps) {
  function update(key: number, change: Partial<AddressDraft>) {
    onChange(addresses.map((address) => (address.key === key ? { ...address, ...change } : address)));
  }

  return (
    <fieldset className="peer-addresses" disabled={disabled}>
      <legend className="form-label">Reachable addresses (optional)</legend>
      <div className="peer-section-heading">
        <p className="hint">
          Add LAN and public URLs only when this node accepts inbound connections. Lower
          priorities are tried first.
        </p>
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          onClick={() => onChange([...addresses, newAddressDraft()])}
        >
          Add address
        </button>
      </div>

      <div className="peer-address-list">
        {addresses.map((address, index) => {
          const rowId = `${idPrefix}-${address.key}`;
          return (
            <div className="peer-address-row" key={address.key}>
              <div className="peer-field peer-address-url">
                <label className="form-label" htmlFor={`${rowId}-url`}>
                  URL
                </label>
                <input
                  id={`${rowId}-url`}
                  className="input"
                  type="url"
                  placeholder="https://playarr.example.com"
                  value={address.url}
                  onChange={(event) => update(address.key, { url: event.target.value })}
                />
              </div>
              <div className="peer-field">
                <label className="form-label" htmlFor={`${rowId}-label`}>
                  Label
                </label>
                <input
                  id={`${rowId}-label`}
                  className="input"
                  placeholder="Public or LAN"
                  value={address.label}
                  maxLength={80}
                  onChange={(event) => update(address.key, { label: event.target.value })}
                />
              </div>
              <div className="peer-field peer-address-priority">
                <label className="form-label" htmlFor={`${rowId}-priority`}>
                  Priority
                </label>
                <input
                  id={`${rowId}-priority`}
                  className="input"
                  type="number"
                  min="0"
                  step="1"
                  value={address.priority}
                  onChange={(event) => update(address.key, { priority: event.target.value })}
                />
              </div>
              <label className="checkbox-label peer-client-reachable">
                <input
                  type="checkbox"
                  checked={address.clientReachable}
                  onChange={(event) => update(address.key, { clientReachable: event.target.checked })}
                />
                Playarr can use this URL
              </label>
              <button
                className="btn btn-ghost btn-sm peer-address-remove"
                type="button"
                disabled={addresses.length === 1}
                aria-label={`Remove address ${index + 1}`}
                onClick={() => onChange(addresses.filter((item) => item.key !== address.key))}
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

export function PeerGroupsPage() {
  useDocumentTitle("Peer groups");
  const client = useApiClient();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [nodes, setNodes] = useState<PeerNode[]>([]);
  const [sources, setSources] = useState<SourceInstanceResponse[]>([]);
  const [folderMappings, setFolderMappings] = useState<Record<string, Record<string, string>>>({});
  const [bundle, setBundle] = useState<PeerAddressBundle | null>(null);
  const [nodeName, setNodeName] = useState("");
  const [addresses, setAddresses] = useState<AddressDraft[]>(() => [newAddressDraft()]);
  const [setupMode, setSetupMode] = useState<SetupMode>("create");
  const [groupName, setGroupName] = useState("");
  const [seedAddress, setSeedAddress] = useState("");
  const [joinTokenInput, setJoinTokenInput] = useState("");
  const [issuedToken, setIssuedToken] = useState<PeerJoinTokenResponse | null>(null);
  const [inviteSeedAddress, setInviteSeedAddress] = useState("");
  const [copiedField, setCopiedField] = useState<"seed" | "token" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [leaveConfirmationOpen, setLeaveConfirmationOpen] = useState(false);

  const selfNode = useMemo(() => nodes.find((node) => node.is_self), [nodes]);
  const grouped = Boolean(bundle?.group_id ?? selfNode?.group_id);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextNodes, nextBundle, nextSources] = await Promise.all([
        client.listPeerNodes(),
        client.getPeerAddressBundle(),
        client.listSourceInstances(),
      ]);
      setNodes(nextNodes);
      setBundle(nextBundle);
      setSources(nextSources);
      setFolderMappings(Object.fromEntries(nextSources.map((source) => [source.id, source.folder_mappings])));
      const nextSelf = nextNodes.find((node) => node.is_self);
      if (nextSelf) {
        setNodeName(nextSelf.name);
        setAddresses(addressDraftsFor(nextSelf.addresses));
        setInviteSeedAddress(
          [...nextSelf.addresses].sort((left, right) => left.priority - right.priority)[0]?.url ?? ""
        );
      }
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleSetup(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const name = nodeName.trim();
    if (!name) {
      setError("Give this Playarr Server node a name.");
      return;
    }

    try {
      const parsedAddresses = parseAddresses(addresses);
      const nameOfGroup = groupName.trim();
      const token = joinTokenInput.trim();
      const parsedSeedAddress = setupMode === "join"
        ? parseHttpUrl(seedAddress, "Seed address")
        : "";
      if (setupMode === "create" && !nameOfGroup) {
        throw new Error("Give the new peer group a name.");
      }
      if (setupMode === "join" && !token) {
        throw new Error("Paste the one-use join token from an existing node.");
      }

      setBusy(true);
      await client.updateSelfPeerNode({ name, addresses: parsedAddresses });
      if (setupMode === "create") {
        await client.foundPeerGroup({ name: nameOfGroup });
        setNotice(`Created peer group “${nameOfGroup}”.`);
      } else {
        await client.joinPeerGroup({
          seed_address: parsedSeedAddress,
          join_token: token,
        });
        setNotice("This node joined the peer group.");
        setJoinTokenInput("");
      }
      await refresh();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveNode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const name = nodeName.trim();
    if (!name) {
      setError("Give this Playarr Server node a name.");
      return;
    }
    try {
      setBusy(true);
      await client.updateSelfPeerNode({ name, addresses: parseAddresses(addresses) });
      setNotice("Node details saved.");
      await refresh();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleIssueToken() {
    setError(null);
    setNotice(null);
    setCopiedField(null);
    try {
      setBusy(true);
      setIssuedToken(await client.createPeerJoinToken());
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleLeaveGroup() {
    setError(null);
    setNotice(null);
    try {
      setBusy(true);
      const result = await client.leavePeerGroup();
      setLeaveConfirmationOpen(false);
      setIssuedToken(null);
      setCopiedField(null);
      setNotice(
        result.unreachable_peers > 0
          ? `Left the peer group. ${result.unreachable_peers} unreachable ${result.unreachable_peers === 1 ? "peer was" : "peers were"} not notified.`
          : "This node left the peer group."
      );
      await refresh();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveFolderMappings(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      setBusy(true);
      for (const source of sources) {
        const mappings: Record<string, string> = {};
        for (const [nodeId, rawPath] of Object.entries(folderMappings[source.id] ?? {})) {
          const path = rawPath.trim();
          if (path) mappings[nodeId] = path;
        }
        await client.updateSourceFolderMappings(source.id, { folder_mappings: mappings });
      }
      setNotice("Source folder mappings saved and queued for peer synchronisation.");
      await refresh();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyValue(value: string, field: "seed" | "token") {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
    } catch {
      setError("The browser could not copy that value. Select it and copy it manually.");
    }
  }

  return (
    <div className="page peer-groups-page">
      <div className="page-heading-row peer-page-heading">
        <div>
          <h1 className="page-title">Peer groups</h1>
          <p className="muted">
            Connect Playarr Server nodes so accounts, libraries, availability, and playback routing stay in sync.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          type="button"
          disabled={loading || busy}
          onClick={() => void refresh()}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <p className="error-text peer-message" role="alert">{error}</p>}
      {notice && <p className="success-text peer-message" role="status">{notice}</p>}

      {loading && bundle === null ? (
        <section className="card"><p className="muted">Loading peer-group state...</p></section>
      ) : !grouped ? (
        <form className="peer-layout" onSubmit={(event) => void handleSetup(event)}>
          <section className="card peer-card peer-card-wide">
            <div>
              <h2 className="section-title">Set up this node</h2>
              <p className="muted">
                Name this deployment. Outbound-only nodes can leave addresses blank and still
                push and pull through a reachable group member.
              </p>
            </div>

            <div className="peer-field">
              <label className="form-label" htmlFor="peer-node-name">Node name</label>
              <input
                id="peer-node-name"
                className="input"
                value={nodeName}
                maxLength={100}
                placeholder="Home, Office, Cabin..."
                disabled={busy}
                onChange={(event) => setNodeName(event.target.value)}
              />
            </div>

            <AddressEditor
              addresses={addresses}
              disabled={busy}
              idPrefix="setup-address"
              onChange={setAddresses}
            />
          </section>

          <section className="card peer-card peer-card-wide">
            <h2 className="section-title">Choose how to connect</h2>
            <div className="peer-mode-picker" role="radiogroup" aria-label="Peer-group setup mode">
              <label className={`peer-mode-option${setupMode === "create" ? " is-selected" : ""}`}>
                <input
                  type="radio"
                  name="setup-mode"
                  value="create"
                  checked={setupMode === "create"}
                  disabled={busy}
                  onChange={() => setSetupMode("create")}
                />
                <span>
                  <strong>Create a new group</strong>
                  <small>Use this on the first Playarr Server node.</small>
                </span>
              </label>
              <label className={`peer-mode-option${setupMode === "join" ? " is-selected" : ""}`}>
                <input
                  type="radio"
                  name="setup-mode"
                  value="join"
                  checked={setupMode === "join"}
                  disabled={busy}
                  onChange={() => setSetupMode("join")}
                />
                <span>
                  <strong>Join an existing group</strong>
                  <small>Use the seed address and token shown on an existing node.</small>
                </span>
              </label>
            </div>

            {setupMode === "create" ? (
              <div className="peer-field">
                <label className="form-label" htmlFor="peer-group-name">Group name</label>
                <input
                  id="peer-group-name"
                  className="input"
                  value={groupName}
                  maxLength={100}
                  placeholder="My Playarr Server group"
                  disabled={busy}
                  onChange={(event) => setGroupName(event.target.value)}
                />
              </div>
            ) : (
              <div className="peer-join-fields">
                <div className="peer-field">
                  <label className="form-label" htmlFor="peer-seed-address">Seed address</label>
                  <input
                    id="peer-seed-address"
                    className="input"
                    type="url"
                    value={seedAddress}
                    placeholder="https://existing-node.example.com"
                    disabled={busy}
                    onChange={(event) => setSeedAddress(event.target.value)}
                  />
                </div>
                <div className="peer-field">
                  <label className="form-label" htmlFor="peer-join-token">One-use join token</label>
                  <input
                    id="peer-join-token"
                    className="input peer-token-input"
                    value={joinTokenInput}
                    autoComplete="off"
                    disabled={busy}
                    onChange={(event) => setJoinTokenInput(event.target.value)}
                  />
                </div>
              </div>
            )}

            <div>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? "Connecting..." : setupMode === "create" ? "Create peer group" : "Join peer group"}
              </button>
            </div>
          </section>
        </form>
      ) : (
        <div className="peer-layout">
          <section className="card peer-card peer-group-summary">
            <div>
              <p className="peer-eyebrow">Connected peer group</p>
              <h2 className="section-title">{bundle?.group_name ?? "Peer group"}</h2>
            </div>
            <dl className="peer-summary-list">
              <div><dt>Members</dt><dd>{nodes.length}</dd></div>
              <div><dt>Group ID</dt><dd className="peer-monospace">{bundle?.group_id ?? selfNode?.group_id}</dd></div>
            </dl>
            <div className="peer-group-actions">
              <button
                className="btn btn-danger"
                type="button"
                disabled={busy}
                onClick={() => setLeaveConfirmationOpen(true)}
              >
                Leave peer group
              </button>
            </div>
          </section>

          <section className="card peer-card peer-invite-card">
            <div>
              <h2 className="section-title">Add another node</h2>
              <p className="muted">
                Generate a single-use token, then open Peer groups on the new node and choose Join.
              </p>
            </div>

            <div className="peer-field">
              <label className="form-label" htmlFor="invite-seed-address">Seed address to use</label>
              <div className="peer-copy-row">
                <select
                  id="invite-seed-address"
                  className="input"
                  value={inviteSeedAddress}
                  disabled={busy || !selfNode?.addresses.length}
                  onChange={(event) => {
                    setInviteSeedAddress(event.target.value);
                    setCopiedField(null);
                  }}
                >
                  {selfNode?.addresses.map((address) => (
                    <option key={`${address.url}-${address.label}`} value={address.url}>
                      {address.label} — {address.url}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={!inviteSeedAddress}
                  onClick={() => void copyValue(inviteSeedAddress, "seed")}
                >
                  {copiedField === "seed" ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            {issuedToken ? (
              <div className="peer-issued-token" role="status">
                <p className="hint">Shown once · expires {formatDate(issuedToken.expires_at)}</p>
                <div className="peer-copy-row">
                  <code className="peer-token-value">{issuedToken.join_token}</code>
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => void copyValue(issuedToken.join_token, "token")}
                  >
                    {copiedField === "token" ? "Copied" : "Copy token"}
                  </button>
                </div>
              </div>
            ) : (
              <p className="hint">Tokens expire after 15 minutes and can be redeemed only once.</p>
            )}

            {!inviteSeedAddress && (
              <p className="error-text">Save at least one reachable address before adding a node.</p>
            )}
            <div>
              <button
                className="btn btn-primary"
                type="button"
                disabled={busy || !inviteSeedAddress}
                onClick={() => void handleIssueToken()}
              >
                {busy ? "Generating..." : issuedToken ? "Generate another token" : "Generate join token"}
              </button>
            </div>
          </section>

          <section className="card peer-card peer-card-wide">
            <form className="peer-node-form" onSubmit={(event) => void handleSaveNode(event)}>
              <div>
                <h2 className="section-title">This node</h2>
                <p className="muted">
                  Update how this deployment appears to the rest of the group. Outbound-only nodes
                  can leave addresses blank.
                </p>
              </div>
              <div className="peer-field">
                <label className="form-label" htmlFor="grouped-node-name">Node name</label>
                <input
                  id="grouped-node-name"
                  className="input"
                  value={nodeName}
                  maxLength={100}
                  disabled={busy}
                  onChange={(event) => setNodeName(event.target.value)}
                />
              </div>
              <AddressEditor
                addresses={addresses}
                disabled={busy}
                idPrefix="grouped-address"
                onChange={setAddresses}
              />
              <div>
                <button className="btn btn-primary" type="submit" disabled={busy}>
                  {busy ? "Saving..." : "Save node details"}
                </button>
              </div>
            </form>
          </section>

          <section className="peer-card-wide peer-members-section">
            <div className="peer-section-heading">
              <div>
                <h2 className="section-title">Members</h2>
                <p className="muted">Every Playarr Server deployment currently known to this node.</p>
              </div>
              <span className="badge badge-neutral badge-pill">{nodes.length} total</span>
            </div>

            <div className="peer-member-grid">
              {nodes.map((node) => (
                <article className="card peer-member-card" key={node.id}>
                  <div className="peer-member-heading">
                    <div>
                      <h3>{node.name}</h3>
                      <p className="peer-monospace muted">{node.id}</p>
                    </div>
                    <div className="peer-member-badges">
                      {node.is_self && <span className="badge badge-queue badge-pill">This node</span>}
                      <span className={`badge badge-pill ${statusClass(node.status)}`}>{node.status}</span>
                    </div>
                  </div>

                  <ul className="peer-member-addresses">
                    {node.addresses.map((address) => (
                      <li key={`${address.url}-${address.label}`}>
                        <div>
                          <strong>{address.label}</strong>
                          <a href={address.url} target="_blank" rel="noreferrer">{address.url}</a>
                        </div>
                        <span className="hint">
                          Priority {address.priority}{address.client_reachable ? " · Playarr" : ""}
                        </span>
                      </li>
                    ))}
                    {node.addresses.length === 0 && <li className="muted">No addresses configured.</li>}
                  </ul>

                  <dl className="peer-member-meta">
                    <div><dt>Joined</dt><dd>{formatDate(node.joined_at)}</dd></div>
                    <div><dt>Last seen</dt><dd>{formatDate(node.last_seen_at)}</dd></div>
                  </dl>
                  {node.last_sync_error && <p className="error-text">{node.last_sync_error}</p>}
                </article>
              ))}
            </div>
          </section>

          <section className="card peer-card peer-card-wide">
            <div>
              <h2 className="section-title">Source folder mappings</h2>
              <p className="muted">
                Map each Source instance&apos;s reported root to the equivalent physical folder on every node.
                These mappings sync as part of the normal Source instance and power the Library source matrix.
              </p>
            </div>
            {sources.length === 0 ? (
              <p className="muted">No Source instances are configured.</p>
            ) : (
              <form className="peer-folder-mappings" onSubmit={(event) => void handleSaveFolderMappings(event)}>
                {sources.map((source) => (
                  <fieldset className="peer-source-mapping" key={source.id} disabled={busy}>
                    <legend><strong>{source.name}</strong> <span className="muted">({source.kind})</span></legend>
                    <p className="hint">Reported root: <code>{source.default_root_folder_id ?? "Not reported"}</code></p>
                    <div className="peer-source-mapping-grid">
                      {nodes.map((node) => (
                        <label key={node.id}>
                          <span>{node.name}{node.is_self ? " (this node)" : ""}</span>
                          <input
                            className="input peer-monospace"
                            value={folderMappings[source.id]?.[node.id] ?? ""}
                            placeholder={source.default_root_folder_id ?? "/path/on/this/node"}
                            onChange={(event) => setFolderMappings((current) => ({
                              ...current,
                              [source.id]: { ...current[source.id], [node.id]: event.target.value },
                            }))}
                          />
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
                <div><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving..." : "Save folder mappings"}</button></div>
              </form>
            )}
          </section>
        </div>
      )}

      {leaveConfirmationOpen && (
        <Modal
          title="Leave peer group?"
          onClose={() => {
            if (!busy) setLeaveConfirmationOpen(false);
          }}
          footer={
            <div className="modal-footer-right">
              <button
                className="btn btn-secondary"
                type="button"
                disabled={busy}
                onClick={() => setLeaveConfirmationOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                type="button"
                disabled={busy}
                onClick={() => void handleLeaveGroup()}
              >
                {busy ? "Leaving..." : "Leave peer group"}
              </button>
            </div>
          }
        >
          <p className="muted" style={{ margin: 0 }}>
            This node will stop syncing accounts, libraries, availability, and playback routing
            with the group. Local users, source instances, and media stay on this node.
          </p>
        </Modal>
      )}
    </div>
  );
}
