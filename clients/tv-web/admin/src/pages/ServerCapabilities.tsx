import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  describeApiError,
  type CapabilitiesResponse,
  type CapabilityItem,
} from "@playarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import {
  CAPABILITY_FILTERS,
  blockingCapabilities,
  capabilityBadgeClass,
  filterCapabilities,
  parseCapabilityFilter,
  sortCapabilities,
  type CapabilityFilter,
} from "../lib/capabilities";

/** Prominent summary of required software that is absent or unusable. */
export function CapabilityAttentionBanner({ items }: { items: readonly CapabilityItem[] }) {
  const blocking = blockingCapabilities(items);
  if (blocking.length === 0) return null;
  return (
    <section className="capability-banner" role="alert" aria-label="Required software missing">
      <h2 className="section-title capability-banner-title">
        {blocking.length === 1
          ? "1 required component needs attention"
          : `${blocking.length} required components need attention`}
      </h2>
      <ul className="capability-banner-list">
        {blocking.map((item) => (
          <li key={item.id}>
            <strong>{item.name}</strong> ({item.status}): {item.impact}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CapabilityRow({ item }: { item: CapabilityItem }) {
  const showHint = item.status !== "present";
  return (
    <li className={`capability-row capability-row--${item.status}`} data-capability={item.id}>
      <div className="capability-row-head">
        <span className="capability-name">{item.name}</span>
        <span className={capabilityBadgeClass(item.status)}>{item.status}</span>
        <span className="muted capability-kind">{item.required ? "Required" : "Optional"}</span>
      </div>
      {(item.path || item.version || item.detail) && (
        <p className="muted capability-meta">
          {[item.path, item.version ? `version ${item.version}` : null, item.detail]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {showHint && (
        <dl className="capability-guidance">
          <dt>Impact</dt>
          <dd>{item.impact}</dd>
          <dt>How to fix</dt>
          <dd>{item.install_hint}</dd>
        </dl>
      )}
    </li>
  );
}

const CATEGORY_SECTIONS = [
  { category: "binary", title: "Media tools" },
  { category: "encoder", title: "Encoders" },
  { category: "hardware", title: "Hardware acceleration" },
] as const;

export function CapabilityList({
  items,
  filter,
}: {
  items: readonly CapabilityItem[];
  filter: CapabilityFilter;
}) {
  const visible = sortCapabilities(filterCapabilities(items, filter));
  if (visible.length === 0) {
    return <p className="muted">Nothing matches this filter.</p>;
  }
  return (
    <>
      {CATEGORY_SECTIONS.map(({ category, title }) => {
        const rows = visible.filter((item) => item.category === category);
        if (rows.length === 0) return null;
        return (
          <section key={category} className="capability-section">
            <h2 className="section-title">{title}</h2>
            <ul className="capability-list">
              {rows.map((item) => (
                <CapabilityRow key={item.id} item={item} />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

/**
 * Admin "Server capabilities": optional external software and hardware on
 * the node serving this admin UI, backed by
 * `GET /api/v1/admin/system/capabilities`. The filter lives in the URL
 * (`?show=attention|present`) so a filtered view can be shared or reloaded.
 */
export function ServerCapabilitiesPage() {
  useDocumentTitle("Server capabilities");
  const client = useApiClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = parseCapabilityFilter(searchParams.get("show"));
  const [report, setReport] = useState<CapabilitiesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    (refresh: boolean) => {
      setLoading(true);
      client
        .getSystemCapabilities({ refresh })
        .then((response) => {
          setReport(response);
          setError(null);
        })
        .catch((err: unknown) => setError(describeApiError(err)))
        .finally(() => setLoading(false));
    },
    [client]
  );

  useEffect(() => {
    load(false);
  }, [load]);

  function setFilter(next: CapabilityFilter) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === "all") params.delete("show");
      else params.set("show", next);
      return params;
    });
  }

  return (
    <div className="page">
      <h1 className="page-title">Server capabilities</h1>
      <p className="muted" style={{ maxWidth: 640, marginBottom: "1rem" }}>
        Optional software and hardware available on this server. Missing items are listed with the
        features they affect and how to install them. Other servers in a peer group report their
        own capabilities when you open their admin pages.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={loading}
          onClick={() => load(true)}
        >
          {loading ? "Checking..." : "Re-check now"}
        </button>
        <div role="group" aria-label="Filter capabilities" className="capability-filter">
          {CAPABILITY_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={`btn btn-secondary btn-sm${filter === value ? " is-active" : ""}`}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error-text" role="alert">{error}</p>}
      {report === null && loading && !error && <p className="muted">Checking this server...</p>}

      {report && (
        <>
          <CapabilityAttentionBanner items={report.items} />
          <CapabilityList items={report.items} filter={filter} />
          <p className="muted capability-footnote">
            Checked {new Date(report.generated_at).toLocaleString()}
            {report.cached ? " (cached for up to 30 seconds)" : ""}.
          </p>
        </>
      )}
    </div>
  );
}
