"use client";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import { workspaceFetch } from "@/lib/workspace-request";
import { PageHeader } from "./page-header";

export type ServerErrorRow = { id: string; routePath: string; routeType: string; method: string; errorName: string; message: string; digest: string | null; occurrences: number; firstSeenAt: string; lastSeenAt: string; resolvedAt: string | null };
const dateTime = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" });
const routeTypeLabels: Record<string, string> = { render: "Page", route: "API", action: "Form action", proxy: "Request check", unknown: "Server" };

export function PlatformHealth({ initial, canResolve, preview }: { initial: ServerErrorRow[]; canResolve: boolean; preview: boolean }) {
  const [rows, setRows] = useState(initial), [status, setStatus] = useState(""), [busy, setBusy] = useState<string | null>(null);
  const open = rows.filter((row) => !row.resolvedAt);
  async function resolve(id: string) {
    setBusy(id);
    try {
      const response = await workspaceFetch("/api/platform/errors", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      const payload = await response.json();
      if (!response.ok) throw Error(payload.error?.message ?? "The error could not be resolved.");
      if (payload.meta?.persisted === false) { setStatus("Preview only: nothing was saved."); return; }
      setRows((current) => current.map((row) => row.id === id ? { ...row, resolvedAt: new Date().toISOString() } : row));
      setStatus("Marked as resolved. It reopens automatically if it happens again.");
    } catch (error) { setStatus((error as Error).message); } finally { setBusy(null); }
  }
  return <main className="page">
    <PageHeader eyebrow="Support" title="Service health" description="Server errors captured by Surveynt, grouped by where they happened. Personal details, links and identifiers are removed before anything is stored." />
    <div className="stat-card-grid" aria-label="Error summary">
      <div className="stat-card"><span className="stat-card-label">Open errors</span><div className="stat-card-value">{open.length}</div></div>
      <div className="stat-card"><span className="stat-card-label">Occurrences while open</span><div className="stat-card-value">{open.reduce((sum, row) => sum + row.occurrences, 0)}</div></div>
      <div className="stat-card"><span className="stat-card-label">Resolved (recent)</span><div className="stat-card-value">{rows.length - open.length}</div></div>
    </div>
    <section className="panel">
      <header className="panel-header"><div><h2>Captured errors</h2><p>Open errors first. Resolving an error hides it until it happens again.</p></div></header>
      <div className="panel-body stack">
        {preview ? <p className="demo-banner">Local preview: errors are recorded only when a database is configured.</p> : null}
        {rows.length ? <div className="data-table-wrap"><table className="data-table">
          <thead><tr><th>Where</th><th>Error</th><th>Seen</th><th>State</th>{canResolve ? <th><span className="sr-only">Actions</span></th> : null}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}>
            <td><strong>{row.method} {row.routePath}</strong><span className="cell-sub">{routeTypeLabels[row.routeType] ?? "Server"}{row.digest ? ` · ref ${row.digest}` : ""}</span></td>
            <td><strong>{row.errorName}</strong><span className="cell-sub">{row.message}</span></td>
            <td>{row.occurrences} {row.occurrences === 1 ? "time" : "times"}<span className="cell-sub">Last {dateTime(row.lastSeenAt)}</span></td>
            <td><StatusDot tone={row.resolvedAt ? "green" : "red"}>{row.resolvedAt ? "Resolved" : "Open"}</StatusDot></td>
            {canResolve ? <td>{row.resolvedAt ? null : <button type="button" className="button button-quiet" disabled={busy === row.id} onClick={() => resolve(row.id)}><CheckCircle2 size={15} />Mark resolved</button>}</td> : null}
          </tr>)}</tbody>
        </table></div> : <p className="muted">No server errors have been captured.</p>}
        <p role="status">{status}</p>
      </div>
    </section>
  </main>;
}
