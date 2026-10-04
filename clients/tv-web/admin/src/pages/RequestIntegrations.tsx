import { useCallback, useEffect, useState } from "react";
import {
  describeApiError,
  type RequestBackend,
  type RequestExternalUser,
  type RequestIntegrationInput,
  type RequestIntegrationView,
  type UserResponse,
} from "@playarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";

const BACKENDS: { value: RequestBackend; label: string; hint: string }[] = [
  { value: "direct", label: "Direct (Radarr/Sonarr)", hint: "Requests are added straight to Radarr or Sonarr." },
  { value: "ombi", label: "Ombi", hint: "Requests are created in Ombi as the mapped user; Ombi approves and adds." },
  { value: "seerr", label: "Seerr", hint: "Requests are created in Seerr as the mapped user; Seerr approves and adds." },
  {
    value: "direct_mirror",
    label: "Direct + mirror",
    hint: "Added straight to Radarr/Sonarr, and mirrored as approved requests into every enabled integration.",
  },
];

type Draft = {
  id: string | null;
  kind: "ombi" | "seerr";
  name: string;
  base_url: string;
  api_key: string;
  api_key_env: string;
  enabled: boolean;
  poll_interval_secs: number;
  mapping: "email" | "username" | "map";
  user_map: Record<string, string>;
};

const EMPTY: Draft = {
  id: null,
  kind: "ombi",
  name: "Ombi",
  base_url: "",
  api_key: "",
  api_key_env: "",
  enabled: true,
  poll_interval_secs: 300,
  mapping: "email",
  user_map: {},
};

function toDraft(i: RequestIntegrationView): Draft {
  return {
    id: i.id,
    kind: i.kind as Draft["kind"],
    name: i.name,
    base_url: i.base_url,
    api_key: "",
    api_key_env: i.api_key_env ?? "",
    enabled: i.enabled,
    poll_interval_secs: i.poll_interval_secs,
    mapping: i.mapping as Draft["mapping"],
    user_map: { ...i.user_map },
  };
}

function toInput(d: Draft): RequestIntegrationInput {
  return {
    kind: d.kind,
    name: d.name.trim(),
    base_url: d.base_url.trim(),
    api_key: d.api_key.trim() || undefined,
    api_key_env: d.api_key_env.trim() || undefined,
    enabled: d.enabled,
    poll_interval_secs: d.poll_interval_secs,
    mapping: d.mapping,
    user_map: Object.fromEntries(Object.entries(d.user_map).filter(([, v]) => v)),
  };
}

export function RequestIntegrationsPage() {
  useDocumentTitle("Request integrations");
  const client = useApiClient();
  const [integrations, setIntegrations] = useState<RequestIntegrationView[]>([]);
  const [backend, setBackend] = useState<RequestBackend>("direct");
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [externals, setExternals] = useState<RequestExternalUser[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, settings, localUsers] = await Promise.all([
        client.listRequestIntegrations(),
        client.getRequestSettings(),
        client.listUsers(),
      ]);
      setIntegrations(list);
      setBackend(settings.backend);
      setUsers(localUsers);
    } catch (err) {
      setError(describeApiError(err));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<string | void>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await action();
      if (result) setMessage(result);
      await load();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function loadExternals(id: string) {
    try {
      setExternals(await client.requestIntegrationUsers(id));
    } catch (err) {
      setError(describeApiError(err));
    }
  }

  const current = draft;
  return (
    <div className="page">
      <h1 className="page-title">Request integrations</h1>
      <p className="muted">
        Connect Ombi or Seerr so requests made in Playarr, Ombi and Seerr stay in sync. Playarr
        keeps its own direct Radarr/Sonarr requests.
      </p>
      {error && <p className="error-text" role="alert">{error}</p>}
      {message && <p className="success-text" role="status">{message}</p>}

      <section className="card" style={{ maxWidth: 720 }}>
        <h2 className="section-title" style={{ marginTop: 0 }}>Where requests go</h2>
        <label className="form-label" htmlFor="request-backend">Request backend</label>
        <select
          id="request-backend"
          className="input"
          value={backend}
          disabled={busy}
          onChange={(event) => {
            const next = event.target.value as RequestBackend;
            void run(async () => {
              await client.putRequestSettings({ backend: next });
              return "Request backend saved.";
            });
          }}
        >
          {BACKENDS.map((b) => (
            <option key={b.value} value={b.value}>{b.label}</option>
          ))}
        </select>
        <p className="hint">{BACKENDS.find((b) => b.value === backend)?.hint}</p>
      </section>

      <section className="card" style={{ maxWidth: 720, marginTop: "1rem" }}>
        <h2 className="section-title" style={{ marginTop: 0 }}>Integrations</h2>
        {integrations.length === 0 && <p className="muted">None configured.</p>}
        {integrations.map((i) => (
          <div key={i.id} style={{ borderTop: "1px solid var(--border, #333)", padding: "0.75rem 0" }}>
            <strong>{i.name}</strong> <span className="muted">({i.kind}{i.enabled ? "" : ", disabled"})</span>
            <div className="muted">{i.base_url}</div>
            <div className="muted">
              {i.last_sync_at ? `Last sync ${new Date(i.last_sync_at).toLocaleString()}` : "Never synced"}
              {i.last_error ? ` - error: ${i.last_error}` : ""}
            </div>
            <div className="muted">
              Webhook: <code>{i.webhook_path}</code> with header{" "}
              <code>Authorization: Bearer {i.webhook_secret}</code>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => { setDraft(toDraft(i)); void loadExternals(i.id); }}>Edit</button>
              <button
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={() => void run(async () => {
                  const r = await client.testRequestIntegration(i.id);
                  return r.ok ? `Connected (${r.version ?? "ok"}), ${r.external_users} users.` : `Connection failed: ${r.error}`;
                })}
              >Test</button>
              <button
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={() => void run(async () => {
                  const r = await client.syncRequestIntegration(i.id);
                  return `Synced: ${r.fetched} fetched, ${r.created} new, ${r.updated} updated, ${r.linked} linked, ${r.removed} removed, ${r.unmapped} unmapped.`;
                })}
              >Sync now</button>
              <button
                className="btn btn-danger btn-sm"
                disabled={busy}
                onClick={() => { if (window.confirm(`Delete ${i.name}? Imported requests are kept.`)) void run(async () => { await client.deleteRequestIntegration(i.id); return "Deleted."; }); }}
              >Delete</button>
            </div>
          </div>
        ))}
        {!current && (
          <button className="btn btn-primary" style={{ marginTop: "0.75rem" }} onClick={() => { setDraft({ ...EMPTY }); setExternals([]); }}>
            Add integration
          </button>
        )}
      </section>

      {current && (
        <section className="card" style={{ maxWidth: 720, marginTop: "1rem" }}>
          <h2 className="section-title" style={{ marginTop: 0 }}>{current.id ? "Edit integration" : "New integration"}</h2>
          <form
            style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                if (current.id) await client.updateRequestIntegration(current.id, toInput(current));
                else await client.createRequestIntegration(toInput(current));
                setDraft(null);
                return "Saved.";
              });
            }}
          >
            <label className="form-label">Type
              <select className="input" value={current.kind} disabled={!!current.id}
                onChange={(e) => setDraft({ ...current, kind: e.target.value as Draft["kind"], name: e.target.value === "ombi" ? "Ombi" : "Seerr" })}>
                <option value="ombi">Ombi</option>
                <option value="seerr">Seerr (Jellyseerr/Overseerr compatible)</option>
              </select>
            </label>
            <label className="form-label">Name
              <input className="input" value={current.name} required onChange={(e) => setDraft({ ...current, name: e.target.value })} />
            </label>
            <label className="form-label">Base URL
              <input className="input" value={current.base_url} required placeholder="http://ombi.media.svc:3579" onChange={(e) => setDraft({ ...current, base_url: e.target.value })} />
            </label>
            <label className="form-label">API key {current.id ? "(leave blank to keep)" : ""}
              <input className="input" type="password" autoComplete="off" value={current.api_key} onChange={(e) => setDraft({ ...current, api_key: e.target.value })} />
            </label>
            <label className="form-label">API key environment variable (from a Kubernetes Secret; wins over the stored key)
              <input className="input" value={current.api_key_env} placeholder="OMBI_API_KEY" onChange={(e) => setDraft({ ...current, api_key_env: e.target.value })} />
            </label>
            <label className="form-label">Poll interval (seconds, minimum 30)
              <input className="input" type="number" min={30} value={current.poll_interval_secs} onChange={(e) => setDraft({ ...current, poll_interval_secs: Number(e.target.value) })} />
            </label>
            <label className="form-label">
              <input type="checkbox" checked={current.enabled} onChange={(e) => setDraft({ ...current, enabled: e.target.checked })} /> Enabled
            </label>
            <label className="form-label">User mapping
              <select className="input" value={current.mapping} onChange={(e) => setDraft({ ...current, mapping: e.target.value as Draft["mapping"] })}>
                <option value="email">By email address</option>
                <option value="username">By username</option>
                <option value="map">Explicit map only</option>
              </select>
            </label>
            {current.id && (
              <div>
                <div className="form-label">Explicit map (overrides the strategy)</div>
                {externals.length === 0 && <p className="hint">Save, then Edit to load the external user list.</p>}
                {users.map((u) => (
                  <div key={u.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.25rem" }}>
                    <span style={{ minWidth: 160 }}>{u.display_name || u.username}</span>
                    <select className="input" value={current.user_map[u.id] ?? ""}
                      onChange={(e) => setDraft({ ...current, user_map: { ...current.user_map, [u.id]: e.target.value } })}>
                      <option value="">Use the strategy</option>
                      {externals.map((x) => (
                        <option key={x.id} value={x.id}>{x.username ?? x.display_name ?? x.id}{x.email ? ` (${x.email})` : ""}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn btn-primary" type="submit" disabled={busy}>Save</button>
              <button className="btn btn-secondary" type="button" onClick={() => setDraft(null)}>Cancel</button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
