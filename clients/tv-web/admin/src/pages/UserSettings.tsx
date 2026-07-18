import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  describeApiError,
  type UserResponse,
} from "@streamarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";

/**
 * Route scaffold for account-specific administration. Activity rows link
 * here now; editable user settings can land incrementally without changing
 * that stable route or sending operators back to an unlabelled user id.
 */
export function UserSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const client = useApiClient();
  const [user, setUser] = useState<UserResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useDocumentTitle(user ? `${user.display_name} settings` : "User settings");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    client
      .listUsers()
      .then((users) => {
        if (cancelled) return;
        const match = users.find((candidate) => candidate.id === id);
        if (match) {
          setUser(match);
        } else {
          setError("User not found.");
        }
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
  }, [client, id]);

  if (loading) {
    return <div className="page"><p className="muted">Loading...</p></div>;
  }

  if (error || !user) {
    return (
      <div className="page">
        <p className="error-text">{error ?? "User not found."}</p>
        <Link className="btn btn-secondary" to="/users">Back to Users</Link>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-heading-row">
        <div>
          <h1 className="page-title">{user.display_name}</h1>
          <p className="muted">@{user.username}</p>
        </div>
        <Link className="btn btn-secondary" to="/users">Back to Users</Link>
      </div>

      <section className="card" style={{ maxWidth: 640 }}>
        <h2 className="section-title" style={{ marginTop: 0 }}>User settings</h2>
        <p className="muted" style={{ marginBottom: "1rem" }}>
          Account-specific settings will be added here. Existing access and library controls remain
          available on the Users page for now.
        </p>
        <dl className="user-settings-summary">
          <div><dt>Username</dt><dd>{user.username}</dd></div>
          <div><dt>Display name</dt><dd>{user.display_name}</dd></div>
          <div><dt>Email</dt><dd>{user.email ?? "Not set"}</dd></div>
          <div><dt>Status</dt><dd>{user.disabled ? "Disabled" : "Enabled"}</dd></div>
        </dl>
      </section>
    </div>
  );
}
