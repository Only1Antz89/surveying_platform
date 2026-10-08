"use client";
import {workspaceFetch} from "@/lib/workspace-request";
import { useState } from "react";
import { AlertCircle, Clock, History, RotateCw } from "lucide-react";

type Entry = { id: string; action: string; occurredAt: string; changedFields: string[] };

const labels: Record<string, string> = {
  "account.created": "Account synchronised",
  "account.profile_synchronised": "Profile synchronised",
  "account.profile_event_ignored": "Older or equal profile event ignored",
  "account.settings_updated": "Personal settings changed",
};

const fields: Record<string, string> = {
  photo: "profile photo",
  email: "email",
  firstName: "first name",
  lastName: "last name",
  professionalDetails: "professional details",
  ricsNumber: "RICS number",
  appearance: "appearance",
  notifications: "notifications",
  work: "availability",
  reportName: "report name",
  reportContact: "report contact",
};

export function AccountHistory() {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    setBusy(true);
    setMessage("");
    try {
      const response = await workspaceFetch("/api/v1/me/history", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "History could not be loaded.");
      setRows(payload.data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "History could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details
      className="settings-section accordion-card"
      onToggle={(event) => {
        if (event.currentTarget.open && rows === null && !busy) void load();
      }}
    >
      <summary className="accordion-summary">
        <span className="flex items-center gap-2">
          <History size={16} />
          <span>Your account history</span>
        </span>
      </summary>
      <div style={{ paddingTop: "14px" }}>
        <div className="flex items-center justify-between gap-4" style={{ marginBottom: "14px" }}>
          <p className="cell-sub" style={{ margin: 0, lineHeight: 1.5 }}>
            The latest 50 recorded profile and personal settings events. Profile updates are recorded after provider synchronisation.
          </p>
          <button type="button" className="button button-secondary" disabled={busy} onClick={() => void load()}>
            <RotateCw size={14} className={busy ? "animate-spin" : ""} />
            <span>{busy ? "Loading…" : "Refresh history"}</span>
          </button>
        </div>

        {message ? (
          <p className="form-error" role="status">
            <AlertCircle size={15} />
            <span>{message}</span>
          </p>
        ) : null}

        {rows?.length ? (
          <ul className="activity-list" style={{ marginTop: "16px" }}>
            {rows.map((row) => (
              <li className="activity-item" key={row.id}>
                <strong>{labels[row.action] ?? "Account event"}</strong>
                <time>{new Date(row.occurredAt).toLocaleString("en-GB")}</time>
                {row.changedFields.length ? (
                  <div className="flex flex-wrap gap-1.5" style={{ marginTop: "6px" }}>
                    {row.changedFields.map((field) => (
                      <span key={field} className="status status-blue" style={{ fontSize: "0.75rem", padding: "2px 7px" }}>
                        {fields[field] ?? field}
                      </span>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : rows ? (
          <div className="empty-state compact">
            <Clock size={20} color="#627086" />
            <strong>No account events recorded</strong>
            <span>Recorded changes and provider sync events will appear here.</span>
          </div>
        ) : null}
      </div>
    </details>
  );
}
