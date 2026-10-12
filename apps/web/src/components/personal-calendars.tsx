"use client";
import {WorkspaceAnchor} from "@/components/workspace-anchor";

import {workspaceFetch} from "@/lib/workspace-request";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Info, RefreshCw } from "lucide-react";
import type { Capability } from "@/lib/capabilities";

type Connection = {
  id: string;
  provider: string;
  status: string;
  lastSyncedAt: string | null;
};

export function PersonalCalendars() {
  const [rows, setRows] = useState<Connection[]>([]);
  const [providers, setProviders] = useState<Capability[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState(false);

  async function load() {
    const [cr, pr] = await Promise.all([
      workspaceFetch("/api/v1/me/calendar-connections", { cache: "no-store" }),
      workspaceFetch("/api/v1/capabilities", { cache: "no-store" }),
    ]);
    const [connections, capabilities] = await Promise.all([cr.json(), pr.json()]);
    if (!cr.ok || !pr.ok) throw new Error("Calendar settings could not load.");
    let rows = connections.data;
    if (connections.meta?.demo) {
      try {
        rows = JSON.parse(localStorage.getItem("surveynt:preview-calendars") ?? "[]");
      } catch {
        rows = [];
      }
    }
    setRows(rows);
    setPreview(Boolean(connections.meta?.demo));
    setProviders(
      capabilities.data.filter((row: Capability) =>
        ["google", "microsoft"].includes(row.key)
      )
    );
    setReady(true);
  }

  useEffect(() => {
    let active = true;
    Promise.resolve().then(async () => {
      if (active)
        try {
          await load();
          const result = new URLSearchParams(location.search).get("calendar");
          if (result)
            setMessage(
              result === "connected"
                ? "Your calendar is connected. First sync is queued."
                : result === "review_required"
                  ? "Your calendar credentials were updated. Platform support must resolve the earlier registration before another subscription can be created. Calendar reconciliation remains available."
                  : "Calendar authorisation did not complete. Please reconnect."
            );
        } catch (error) {
          setMessage((error as Error).message);
        }
    });
    return () => {
      active = false;
    };
  }, []);

  function simulate(provider: string) {
    const connection = {
      id: `demo-${provider}`,
      provider,
      status: "demo",
      lastSyncedAt: null,
    };
    const next = [...rows.filter((row) => row.provider !== provider), connection];
    localStorage.setItem("surveynt:preview-calendars", JSON.stringify(next));
    setRows(next);
    setMessage(
      "Demo calendar linked on this device. No external calendar or OAuth account was changed."
    );
  }

  async function action(id: string, action: "sync" | "disconnect") {
    if (preview) {
      const next = rows.map((row) =>
        row.id === id
          ? {
              ...row,
              status: action === "disconnect" ? "revoked" : "demo",
              lastSyncedAt: action === "sync" ? new Date().toISOString() : row.lastSyncedAt,
            }
          : row
      );
      localStorage.setItem("surveynt:preview-calendars", JSON.stringify(next));
      setRows(next);
      setMessage(
        action === "sync"
          ? "Demo sync completed. No external events imported or changed."
          : "Demo calendar disconnected on this device."
      );
      return;
    }
    setBusy(true);
    try {
      const response = await workspaceFetch("/api/v1/me/calendar-connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error?.message ?? "Calendar action failed.");
      await load();
      setMessage(
        action === "sync"
          ? "Sync queued. Refresh to see its completion."
          : "Surveynt syncing stopped and local credentials removed. Existing external events and cached busy periods are retained; you can revoke provider consent in Google/Microsoft."
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-section">
      <h2>Your calendar connections</h2>
      <p className="form-help">
        Only your own connections appear here. OAuth keys and token-encryption secrets are managed by Surveynt administrators.
      </p>
      {!ready && !message ? <p role="status">Loading calendar providers…</p> : null}
      <div className="capability-grid">
        {providers.map((provider) => (
          <article className="capability" key={provider.key}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
              <h3>{provider.label}</h3>
              <span className="status status-blue">{provider.state}</span>
            </div>
            {provider.connectHref ? (
              <WorkspaceAnchor className="button button-primary" href={provider.connectHref}>
                {provider.action}
              </WorkspaceAnchor>
            ) : (
              <p className="form-help">
                {preview
                  ? "Live calendar linking is unavailable in this isolated demo. Test the simulated flow below."
                  : "Surveynt must configure this provider before you can grant access."}
              </p>
            )}
            {preview ? (
              <button
                className="button button-secondary"
                onClick={() => simulate(provider.key)}
              >
                Connect demo calendar
              </button>
            ) : null}
            {rows
              .filter((row) => row.provider === provider.key)
              .map((row) => {
                const statusTone =
                  row.status === "active"
                    ? "status-green"
                    : row.status === "demo"
                      ? "status-amber"
                      : "status-slate";
                return (
                  <div
                    key={row.id}
                    className="deposit-item"
                    style={{
                      flexDirection: "column",
                      alignItems: "stretch",
                      gap: "0.5rem",
                      marginTop: "0.75rem",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "0.5rem",
                      }}
                    >
                      <span className={`status ${statusTone}`}>{row.status}</span>
                      <span className="muted-text" style={{ fontSize: "0.8125rem" }}>
                        {row.lastSyncedAt
                          ? `Last sync ${new Date(row.lastSyncedAt).toLocaleString("en-GB")}`
                          : "Not yet synced"}
                      </span>
                    </div>
                    <div className="action-row" style={{ marginTop: "0.25rem" }}>
                      <button
                        className="button button-secondary"
                        disabled={busy || !["active", "demo"].includes(row.status)}
                        onClick={() => void action(row.id, "sync")}
                      >
                        Sync now
                      </button>
                      <button
                        className="button button-quiet"
                        disabled={busy || row.status === "revoked"}
                        onClick={() => {
                          if (
                            confirm(
                              "Stop Surveynt syncing this calendar? External events will not be deleted."
                            )
                          )
                            void action(row.id, "disconnect");
                        }}
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                );
              })}
          </article>
        ))}
      </div>
      <div className="action-row" style={{ marginTop: "1.25rem" }}>
        <button
          className="button button-secondary"
          disabled={busy}
          onClick={() => void load().catch((error) => setMessage(error.message))}
        >
          <RefreshCw size={14} />
          Refresh connection status
        </button>
      </div>
      {message ? (
        <div
          className={`form-${
            message.includes("did not") || message.includes("failed") || message.includes("could not")
              ? "error"
              : message.includes("linked") ||
                  message.includes("connected") ||
                  message.includes("completed") ||
                  message.includes("stopped") ||
                  message.includes("queued")
                ? "success"
                : "info"
          }`}
          role="status"
          style={{ marginTop: "1rem" }}
        >
          {message.includes("did not") || message.includes("failed") || message.includes("could not") ? (
            <AlertCircle size={16} />
          ) : message.includes("linked") ||
            message.includes("connected") ||
            message.includes("completed") ||
            message.includes("stopped") ||
            message.includes("queued") ? (
            <CheckCircle2 size={16} />
          ) : (
            <Info size={16} />
          )}
          <span>{message}</span>
        </div>
      ) : null}
    </div>
  );
}
