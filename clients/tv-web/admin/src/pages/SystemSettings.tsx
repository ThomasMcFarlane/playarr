import { useEffect, useState } from "react";
import { describeApiError } from "@streamarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";

export function SystemSettingsPage() {
  useDocumentTitle("System settings");
  const client = useApiClient();
  const [instanceName, setInstanceName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    client
      .getSystemSettings()
      .then((settings) => {
        if (!cancelled) setInstanceName(settings.instance_name);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeApiError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedName = instanceName.trim();
    if (!trimmedName) {
      setError("Instance name must not be empty.");
      return;
    }

    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const settings = await client.updateSystemSettings({ instance_name: trimmedName });
      setInstanceName(settings.instance_name);
      setSaved(true);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">Settings</h1>

      <section className="card" style={{ maxWidth: 640 }}>
        <h2 className="section-title" style={{ marginTop: 0 }}>
          Instance identity
        </h2>
        <p className="muted" style={{ marginTop: 0 }}>
          This name identifies the server in Playarr&apos;s connected-server settings and on
          invitation sign-up links.
        </p>

        {loading ? (
          <p className="muted">Loading...</p>
        ) : (
          <form
            onSubmit={(event) => void handleSubmit(event)}
            style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            <div>
              <label className="form-label" htmlFor="instance-name">
                Instance name
              </label>
              <input
                id="instance-name"
                className="input"
                style={{ width: "100%" }}
                value={instanceName}
                onChange={(event) => {
                  setInstanceName(event.target.value);
                  setSaved(false);
                }}
                maxLength={100}
                required
                autoComplete="off"
              />
              <p className="hint" style={{ marginBottom: 0 }}>
                1–100 characters. Changes appear in Playarr immediately.
              </p>
            </div>

            {error && <p className="error-text" role="alert">{error}</p>}
            {saved && <p className="success-text" role="status">Settings saved.</p>}

            <div>
              <button className="btn btn-primary" type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save changes"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
