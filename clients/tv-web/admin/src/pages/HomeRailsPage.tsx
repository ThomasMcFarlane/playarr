import { useCallback, useEffect, useState } from "react";
import {
  describeApiError,
  type HomeRailConfig,
  type HomeRailDefinition,
  type LibraryViewResponse,
  type SeasonalRule,
} from "@playarr-tv/api-client";
import { Modal } from "../components/Modal";
import { useApiClient } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import {
  KIND_LABELS,
  LIBRARY_LABELS,
  groupByLibrary,
  isEasterRule,
  joinList,
  moveWithinGroup,
  newSeasonalRule,
  parseOptionalInt,
  setRuleWindow,
  splitList,
} from "../lib/homeRails";

type Library = "movie" | "series" | "artist" | "";

interface EditState {
  rail: HomeRailDefinition;
  name: string;
  limit: string;
  staleDays: string;
  minCollection: string;
  hemisphere: "north" | "south";
  /** `null` = built-in seasonal rules. */
  rules: SeasonalRule[] | null;
  viewId: string;
}

function toEditState(rail: HomeRailDefinition): EditState {
  return {
    rail,
    name: rail.name ?? "",
    limit: rail.config.limit?.toString() ?? "",
    staleDays: rail.config.stale_days?.toString() ?? "",
    minCollection: rail.config.min_collection_size?.toString() ?? "",
    hemisphere: rail.config.hemisphere === "south" ? "south" : "north",
    rules: rail.config.seasonal_rules ?? null,
    viewId: rail.view_id ?? "",
  };
}

function railTitle(rail: HomeRailDefinition): string {
  return rail.name || rail.default_title;
}

/**
 * Admin "Home rails" page: enable/disable and reorder the default rails per
 * library, tune thresholds and seasonal rules, and build custom rails from
 * saved views (`/api/v1/admin/home-rails`).
 */
export function HomeRailsPage() {
  useDocumentTitle("Home rails");
  const client = useApiClient();
  const [rails, setRails] = useState<HomeRailDefinition[] | null>(null);
  const [views, setViews] = useState<LibraryViewResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [create, setCreate] = useState<{ name: string; library: Library; viewId: string } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [defs, allViews] = await Promise.all([client.listAdminHomeRails(), client.listAdminViews()]);
      setRails(defs);
      setViews(allViews);
      setError(null);
    } catch (err) {
      setError(describeApiError(err));
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function toggle(rail: HomeRailDefinition) {
    setError(null);
    try {
      await client.updateHomeRail(rail.id, { enabled: !rail.enabled });
      await reload();
    } catch (err) {
      setError(describeApiError(err));
    }
  }

  async function move(rail: HomeRailDefinition, direction: -1 | 1) {
    if (!rails) return;
    const ids = moveWithinGroup(rails, rail.id, direction);
    if (!ids) return;
    setError(null);
    try {
      setRails(await client.reorderHomeRails(ids));
    } catch (err) {
      setError(describeApiError(err));
    }
  }

  async function saveEdit() {
    if (!edit) return;
    const { rail } = edit;
    const config: HomeRailConfig = {
      limit: parseOptionalInt(edit.limit),
      stale_days: rail.kind === "rediscover" ? parseOptionalInt(edit.staleDays) : null,
      min_collection_size:
        rail.kind === "rediscover" && rail.library === "movie"
          ? parseOptionalInt(edit.minCollection)
          : null,
      hemisphere: rail.kind === "seasonal" ? edit.hemisphere : null,
      seasonal_rules: rail.kind === "seasonal" ? edit.rules : null,
    };
    setBusy(true);
    setModalError(null);
    try {
      await client.updateHomeRail(rail.id, {
        name: edit.name,
        config,
        view_id: rail.kind === "custom" ? edit.viewId : undefined,
      });
      setEdit(null);
      await reload();
    } catch (err) {
      setModalError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeRail() {
    if (!edit) return;
    setBusy(true);
    setModalError(null);
    try {
      await client.deleteHomeRail(edit.rail.id);
      setEdit(null);
      await reload();
    } catch (err) {
      setModalError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveCreate() {
    if (!create) return;
    setBusy(true);
    setModalError(null);
    try {
      await client.createHomeRail({
        name: create.name,
        view_id: create.viewId,
        library: create.library || undefined,
      });
      setCreate(null);
      await reload();
    } catch (err) {
      setModalError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  function updateRule(index: number, patch: Partial<SeasonalRule>) {
    setEdit((e) =>
      e && e.rules
        ? { ...e, rules: e.rules.map((r, i) => (i === index ? { ...r, ...patch } : r)) }
        : e
    );
  }

  const groups = rails ? groupByLibrary(rails) : [];

  return (
    <div className="page">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          Home rails
        </h1>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setModalError(null);
            setCreate({ name: "", library: "", viewId: views[0]?.id ?? "" });
          }}
        >
          + New custom rail
        </button>
      </div>
      <p className="muted" style={{ maxWidth: 680, marginBottom: "1rem" }}>
        The shelves on Home, per library. The server computes them for each viewer (their library
        access and household controls apply) and hides any that are empty. Viewers can also hide or
        reorder rails for themselves. Custom rails are built from a saved view, so any filter,
        including the language filters, can become a rail.
      </p>

      {error && <p className="error-text" style={{ marginBottom: "1rem" }}>{error}</p>}
      {rails === null && !error && <p className="muted">Loading...</p>}

      {groups.map((group) => (
        <section key={group.library} style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>
            {LIBRARY_LABELS[group.library] ?? group.library}
          </h2>
          <table className="table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Rail</th>
                <th style={{ textAlign: "left" }}>Type</th>
                <th style={{ textAlign: "left" }}>Shown</th>
                <th style={{ textAlign: "left" }}>Order</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {group.rails.map((rail, index) => (
                <tr key={rail.id} style={rail.enabled ? undefined : { opacity: 0.6 }}>
                  <td>{railTitle(rail)}</td>
                  <td className="muted">
                    {KIND_LABELS[rail.kind] ?? rail.kind}
                    {!rail.is_default && (
                      <span className="badge badge-pill badge-success" style={{ marginLeft: "0.5rem" }}>
                        Custom
                      </span>
                    )}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Show ${railTitle(rail)}`}
                      checked={rail.enabled}
                      onChange={() => void toggle(rail)}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      aria-label={`Move ${railTitle(rail)} up`}
                      disabled={index === 0}
                      onClick={() => void move(rail, -1)}
                    >
                      ↑
                    </button>{" "}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      aria-label={`Move ${railTitle(rail)} down`}
                      disabled={index === group.rails.length - 1}
                      onClick={() => void move(rail, 1)}
                    >
                      ↓
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setModalError(null);
                        setEdit(toEditState(rail));
                      }}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {create && (
        <Modal
          title="New custom rail"
          onClose={() => setCreate(null)}
          footer={
            <>
              <div className="modal-footer-left" />
              <div className="modal-footer-right">
                <button type="button" className="btn btn-secondary" onClick={() => setCreate(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !create.name.trim() || !create.viewId}
                  onClick={() => void saveCreate()}
                >
                  {busy ? "Creating..." : "Create"}
                </button>
              </div>
            </>
          }
        >
          {modalError && <p className="error-text">{modalError}</p>}
          <div className="modal-field">
            <label className="form-label" htmlFor="rail-new-name">Title</label>
            <input
              id="rail-new-name"
              className="input"
              style={{ width: "100%" }}
              value={create.name}
              onChange={(e) => setCreate({ ...create, name: e.target.value })}
            />
          </div>
          <div className="modal-field">
            <label className="form-label" htmlFor="rail-new-library">Library</label>
            <select
              id="rail-new-library"
              className="input"
              style={{ width: "100%" }}
              value={create.library}
              onChange={(e) => setCreate({ ...create, library: e.target.value as Library })}
            >
              <option value="">All libraries</option>
              <option value="movie">Movies</option>
              <option value="series">Series</option>
              <option value="artist">Music</option>
            </select>
          </div>
          <div className="modal-field">
            <label className="form-label" htmlFor="rail-new-view">Saved view</label>
            <select
              id="rail-new-view"
              className="input"
              style={{ width: "100%" }}
              value={create.viewId}
              onChange={(e) => setCreate({ ...create, viewId: e.target.value })}
            >
              {views.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
            <p className="muted hint">Build the filter under Library, Views (it can include language filters).</p>
          </div>
        </Modal>
      )}

      {edit && (
        <Modal
          title={`Edit ${railTitle(edit.rail)}`}
          onClose={() => setEdit(null)}
          footer={
            <>
              <div className="modal-footer-left">
                {edit.rail.is_default ? (
                  <span className="muted hint">Default rails can't be deleted; hide them instead.</span>
                ) : (
                  <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void removeRail()}>
                    Delete
                  </button>
                )}
              </div>
              <div className="modal-footer-right">
                <button type="button" className="btn btn-secondary" onClick={() => setEdit(null)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveEdit()}>
                  {busy ? "Saving..." : "Save"}
                </button>
              </div>
            </>
          }
        >
          {modalError && <p className="error-text">{modalError}</p>}
          <div className="modal-field">
            <label className="form-label" htmlFor="rail-name">Title override</label>
            <input
              id="rail-name"
              className="input"
              style={{ width: "100%" }}
              placeholder={edit.rail.default_title}
              value={edit.name}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            />
            <p className="muted hint">
              Leave blank for the built-in title, which is shown in the viewer's language.
            </p>
          </div>
          {edit.rail.kind === "custom" && (
            <div className="modal-field">
              <label className="form-label" htmlFor="rail-view">Saved view</label>
              <select
                id="rail-view"
                className="input"
                style={{ width: "100%" }}
                value={edit.viewId}
                onChange={(e) => setEdit({ ...edit, viewId: e.target.value })}
              >
                {views.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="modal-field">
            <label className="form-label" htmlFor="rail-limit">Maximum items (1-100, default 24)</label>
            <input
              id="rail-limit"
              type="number"
              min={1}
              max={100}
              className="input"
              style={{ width: "100%" }}
              value={edit.limit}
              onChange={(e) => setEdit({ ...edit, limit: e.target.value })}
            />
          </div>
          {edit.rail.kind === "rediscover" && (
            <div className="modal-field">
              <label className="form-label" htmlFor="rail-stale">
                Idle for at least this many days (default 60)
              </label>
              <input
                id="rail-stale"
                type="number"
                min={1}
                className="input"
                style={{ width: "100%" }}
                value={edit.staleDays}
                onChange={(e) => setEdit({ ...edit, staleDays: e.target.value })}
              />
              <p className="muted hint">
                Series started but not finished, and movies left part-watched, qualify after this long.
              </p>
            </div>
          )}
          {edit.rail.kind === "rediscover" && edit.rail.library === "movie" && (
            <div className="modal-field">
              <label className="form-label" htmlFor="rail-collection">
                Titles needed for a franchise (default 2)
              </label>
              <input
                id="rail-collection"
                type="number"
                min={1}
                className="input"
                style={{ width: "100%" }}
                value={edit.minCollection}
                onChange={(e) => setEdit({ ...edit, minCollection: e.target.value })}
              />
              <p className="muted hint">
                Collections with at least this many titles in the library count as franchises.
              </p>
            </div>
          )}
          {edit.rail.kind === "seasonal" && (
            <>
              <div className="modal-field">
                <label className="form-label" htmlFor="rail-hemisphere">Hemisphere</label>
                <select
                  id="rail-hemisphere"
                  className="input"
                  style={{ width: "100%" }}
                  value={edit.hemisphere}
                  onChange={(e) => setEdit({ ...edit, hemisphere: e.target.value as "north" | "south" })}
                >
                  <option value="north">Northern (summer June to August)</option>
                  <option value="south">Southern (summer December to February)</option>
                </select>
              </div>
              <div className="modal-field">
                <span className="form-label">Seasonal rules</span>
                {edit.rules === null ? (
                  <>
                    <p className="muted hint">
                      Using the built-in rules:{" "}
                      {(edit.rail.effective_seasonal_rules ?? []).map((r) => r.key).join(", ")}.
                    </p>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() =>
                        setEdit({ ...edit, rules: structuredClone(edit.rail.effective_seasonal_rules ?? []) })
                      }
                    >
                      Customise rules
                    </button>
                  </>
                ) : (
                  <>
                    <p className="muted hint">
                      The first active rule wins. Dates are MM-DD (a window may wrap the new year).
                      Keywords match whole words in the title and overview; genres and tags match exactly.
                    </p>
                    {edit.rules.map((rule, index) => (
                      <div key={index} className="card" style={{ padding: "0.75rem", marginBottom: "0.5rem" }}>
                        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                          <input
                            className="input"
                            aria-label="Rule key"
                            placeholder="key (e.g. christmas)"
                            value={rule.key}
                            onChange={(e) => updateRule(index, { key: e.target.value })}
                          />
                          <input
                            className="input"
                            aria-label="Rule display name"
                            placeholder="display name (optional)"
                            value={rule.name ?? ""}
                            onChange={(e) => updateRule(index, { name: e.target.value || null })}
                          />
                        </div>
                        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
                          <select
                            className="input"
                            aria-label="Window type"
                            value={isEasterRule(rule) ? "easter" : "fixed"}
                            onChange={(e) =>
                              updateRule(index, setRuleWindow(rule, e.target.value as "fixed" | "easter"))
                            }
                          >
                            <option value="fixed">Fixed dates</option>
                            <option value="easter">Around Easter</option>
                          </select>
                          {isEasterRule(rule) ? (
                            <>
                              <input
                                className="input"
                                type="number"
                                min={0}
                                aria-label="Days before Easter"
                                title="Days before Easter"
                                style={{ width: 90 }}
                                value={rule.easter_before_days ?? 0}
                                onChange={(e) => updateRule(index, { easter_before_days: Number(e.target.value) })}
                              />
                              <input
                                className="input"
                                type="number"
                                min={0}
                                aria-label="Days after Easter"
                                title="Days after Easter"
                                style={{ width: 90 }}
                                value={rule.easter_after_days ?? 0}
                                onChange={(e) => updateRule(index, { easter_after_days: Number(e.target.value) })}
                              />
                            </>
                          ) : (
                            <>
                              <input
                                className="input"
                                aria-label="Start (MM-DD)"
                                placeholder="MM-DD"
                                style={{ width: 90 }}
                                value={rule.start ?? ""}
                                onChange={(e) => updateRule(index, { start: e.target.value })}
                              />
                              <input
                                className="input"
                                aria-label="End (MM-DD)"
                                placeholder="MM-DD"
                                style={{ width: 90 }}
                                value={rule.end ?? ""}
                                onChange={(e) => updateRule(index, { end: e.target.value })}
                              />
                            </>
                          )}
                          <select
                            className="input"
                            aria-label="Hemisphere"
                            value={rule.hemisphere ?? ""}
                            onChange={(e) =>
                              updateRule(index, { hemisphere: (e.target.value || null) as "north" | "south" | null })
                            }
                          >
                            <option value="">Both hemispheres</option>
                            <option value="north">Northern only</option>
                            <option value="south">Southern only</option>
                          </select>
                        </div>
                        <input
                          className="input"
                          style={{ width: "100%", marginBottom: "0.5rem" }}
                          aria-label="Keywords"
                          placeholder="keywords, comma separated"
                          defaultValue={joinList(rule.keywords)}
                          onBlur={(e) => updateRule(index, { keywords: splitList(e.target.value) })}
                        />
                        <input
                          className="input"
                          style={{ width: "100%", marginBottom: "0.5rem" }}
                          aria-label="Genres"
                          placeholder="genres, comma separated"
                          defaultValue={joinList(rule.genres)}
                          onBlur={(e) => updateRule(index, { genres: splitList(e.target.value) })}
                        />
                        <input
                          className="input"
                          style={{ width: "100%", marginBottom: "0.5rem" }}
                          aria-label="Tags"
                          placeholder="tags, comma separated"
                          defaultValue={joinList(rule.tags)}
                          onBlur={(e) => updateRule(index, { tags: splitList(e.target.value) })}
                        />
                        <button
                          type="button"
                          className="btn btn-danger"
                          onClick={() =>
                            setEdit({ ...edit, rules: (edit.rules ?? []).filter((_, i) => i !== index) })
                          }
                        >
                          Remove rule
                        </button>
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setEdit({ ...edit, rules: [...(edit.rules ?? []), newSeasonalRule()] })}
                      >
                        + Add rule
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={() => setEdit({ ...edit, rules: null })}>
                        Reset to built-in rules
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
