import { useEffect, useMemo, useState } from "react";
import { describeApiError, type UserResponse } from "@playarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import {
  APPROVAL_KINDS,
  RATING_OPTIONS,
  WEEKDAYS,
  emptyHouseholdForm,
  formToSettings,
  settingsToForm,
  type ApprovalKind,
  type HouseholdForm,
} from "../lib/householdForm";
import { Modal } from "./Modal";

const APPROVAL_LABELS: Record<ApprovalKind, string> = {
  content: "Blocked titles",
  time: "Extra time",
};

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function timeZones(): string[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
      .supportedValuesOf;
    return supported ? supported("timeZone") : [];
  } catch {
    return [];
  }
}

/**
 * Per-account household controls: content rating ceiling, schedule and time
 * zone, daily watch time, guardians and approvals. Everything here is
 * enforced by the server, so a client cannot loosen it.
 */
export function HouseholdModal({
  user,
  users,
  onClose,
  onSaved,
}: {
  user: UserResponse;
  users: readonly UserResponse[];
  onClose: () => void;
  onSaved: (summaryChanged: boolean) => void;
}) {
  const client = useApiClient();
  const [form, setForm] = useState<HouseholdForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const zones = useMemo(timeZones, []);

  useEffect(() => {
    let cancelled = false;
    client
      .getUserHousehold(user.id)
      .then((settings) => {
        if (!cancelled) setForm(settingsToForm(settings));
      })
      .catch((err) => {
        if (!cancelled) {
          setError(describeApiError(err));
          setForm(emptyHouseholdForm());
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, user.id]);

  // Another admin-or-viewer account makes a sensible guardian; a profile that
  // is itself restricted is refused by the server, so it is not offered.
  const guardianCandidates = users.filter(
    (candidate) => candidate.id !== user.id && !candidate.disabled
  );

  function update(patch: Partial<HouseholdForm>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
  }

  async function save() {
    if (!form) return;
    const result = formToSettings(form);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await client.putUserHousehold(user.id, result.settings);
      onSaved(true);
      onClose();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Household controls -- ${user.username}`}
      onClose={onClose}
      footer={
        <>
          <div className="modal-footer-left" />
          <div className="modal-footer-right">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void save()}
              disabled={saving || form === null}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </>
      }
    >
      {error && (
        <p className="error-text hint" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      {form === null && <p className="muted">Loading...</p>}
      {form !== null && (
        <>
          <p className="muted hint" style={{ margin: 0 }}>
            Applied by the server on every request: search, titles, artwork, downloads and
            playback. Admin accounts are never restricted.
          </p>
          <div className="modal-field">
            <label htmlFor="household-rating">Highest content rating</label>
            <select
              id="household-rating"
              className="input"
              value={form.maxRating}
              onChange={(event) => update({ maxRating: event.target.value })}
            >
              <option value="">No limit</option>
              {RATING_OPTIONS.map((rating) => (
                <option key={rating} value={rating}>
                  {rating}
                </option>
              ))}
            </select>
          </div>
          <div className="modal-field">
            <label htmlFor="household-unrated">Titles with no rating</label>
            <select
              id="household-unrated"
              className="input"
              value={form.unrated}
              disabled={form.maxRating === ""}
              onChange={(event) => update({ unrated: event.target.value as "block" | "allow" })}
            >
              <option value="block">Hide them</option>
              <option value="allow">Show them</option>
            </select>
          </div>
          <div className="modal-field">
            <label htmlFor="household-tags">Hidden tags (comma separated)</label>
            <input
              id="household-tags"
              className="input"
              value={form.blockedTags}
              onChange={(event) => update({ blockedTags: event.target.value })}
            />
          </div>
          <div className="modal-field">
            <label htmlFor="household-budget">Daily watch time (minutes)</label>
            <input
              id="household-budget"
              className="input"
              inputMode="numeric"
              placeholder="No limit"
              value={form.budgetMinutes}
              onChange={(event) => update({ budgetMinutes: event.target.value })}
            />
          </div>
          <div className="modal-field">
            <label htmlFor="household-timezone">Time zone for schedule and daily limit</label>
            <input
              id="household-timezone"
              className="input"
              list="household-timezones"
              placeholder="UTC"
              value={form.timezone}
              onChange={(event) => update({ timezone: event.target.value })}
            />
            <datalist id="household-timezones">
              {zones.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.scheduleEnabled}
              onChange={(event) => update({ scheduleEnabled: event.target.checked })}
            />
            Only allow watching at set times (no days ticked locks the profile out)
          </label>
          {form.scheduleEnabled && (
            <div className="household-schedule">
              {WEEKDAYS.map((day) => {
                const window = form.days[day];
                return (
                  <div key={day} className="household-schedule-row">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={window.enabled}
                        onChange={(event) =>
                          update({
                            days: { ...form.days, [day]: { ...window, enabled: event.target.checked } },
                          })
                        }
                      />
                      {capitalise(day)}
                    </label>
                    <input
                      className="input"
                      type="time"
                      aria-label={`${capitalise(day)} from`}
                      value={window.start}
                      disabled={!window.enabled}
                      onChange={(event) =>
                        update({
                          days: { ...form.days, [day]: { ...window, start: event.target.value } },
                        })
                      }
                    />
                    <span aria-hidden="true">to</span>
                    <input
                      className="input"
                      type="time"
                      aria-label={`${capitalise(day)} until`}
                      value={window.end === "24:00" ? "23:59" : window.end}
                      disabled={!window.enabled}
                      onChange={(event) =>
                        update({
                          days: { ...form.days, [day]: { ...window, end: event.target.value } },
                        })
                      }
                    />
                  </div>
                );
              })}
            </div>
          )}
          <fieldset className="household-fieldset">
            <legend>Guardians</legend>
            <p className="muted hint" style={{ margin: 0 }}>
              Guardians approve requests with their own profile PIN. They need a PIN set in
              their profile settings.
            </p>
            {guardianCandidates.length === 0 && <p className="muted">No other accounts.</p>}
            {guardianCandidates.map((candidate) => (
              <label key={candidate.id} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.guardianIds.includes(candidate.id)}
                  onChange={(event) =>
                    update({
                      guardianIds: event.target.checked
                        ? [...form.guardianIds, candidate.id]
                        : form.guardianIds.filter((id) => id !== candidate.id),
                    })
                  }
                />
                {candidate.display_name || candidate.username}
              </label>
            ))}
          </fieldset>
          <fieldset className="household-fieldset">
            <legend>Needs a guardian's approval</legend>
            {APPROVAL_KINDS.map((kind) => (
              <label key={kind} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.approvalRequired.includes(kind)}
                  onChange={(event) =>
                    update({
                      approvalRequired: event.target.checked
                        ? [...form.approvalRequired, kind]
                        : form.approvalRequired.filter((item) => item !== kind),
                    })
                  }
                />
                {APPROVAL_LABELS[kind]}
              </label>
            ))}
          </fieldset>
          <div className="modal-field">
            <label htmlFor="household-offline">Offline validity (hours, 1-72)</label>
            <input
              id="household-offline"
              className="input"
              inputMode="numeric"
              placeholder="24"
              value={form.offlineTtlHours}
              onChange={(event) => update({ offlineTtlHours: event.target.value })}
            />
          </div>
        </>
      )}
    </Modal>
  );
}
