"use client";
import { useEffect, useState } from "react";
import { FileSignature, Send } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import { workspaceFetch } from "@/lib/workspace-request";
import { useUnsavedChanges } from "./unsaved-changes";
import type { TermsVersion } from "@/lib/engagement-terms";

const date = (value: string | null) => value ? new Date(value).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Europe/London" }) : "";
const tone = (status: TermsVersion["status"]) => status === "published" ? "green" as const : status === "draft" ? "amber" as const : "slate" as const;

/** Practice terms of engagement: one working draft, one published version, history kept. */
export function EngagementTermsSettings({ canEdit }: { canEdit: boolean }) {
  const [versions, setVersions] = useState<TermsVersion[]>([]);
  const [required, setRequired] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dirty, setDirty] = useState(false); useUnsavedChanges(dirty);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const draft = versions.find((item) => item.status === "draft");
  const published = versions.find((item) => item.status === "published");

  useEffect(() => {
    workspaceFetch("/api/v1/engagement-terms").then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw Error(payload.error?.message ?? "Terms are unavailable.");
      setVersions(payload.data.versions); setRequired(payload.data.required);
      const start = payload.data.versions.find((item: TermsVersion) => item.status === "draft") ?? payload.data.versions.find((item: TermsVersion) => item.status === "published");
      setTitle(start?.title ?? "Terms of engagement"); setBody(start?.body ?? "");
    }).catch((error: Error) => setMessage(error.message));
  }, []);

  async function send(method: "POST" | "PATCH", payload: unknown) {
    const response = await workspaceFetch("/api/v1/engagement-terms", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error?.message ?? "The change could not be saved.");
    return result as { data: TermsVersion & { required?: boolean }; meta?: { persisted?: boolean } };
  }
  async function saveDraft(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const result = await send("POST", { title, body });
      if (result.meta?.persisted === false) { setMessage("Preview only: the draft was not saved."); return; }
      setVersions((current) => [result.data, ...current.filter((item) => item.id !== result.data.id)].sort((a, b) => b.version - a.version));
      setDirty(false); setMessage(`Draft version ${result.data.version} saved. Publish it when it is ready for clients.`);
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  async function publish() {
    if (!draft) return;
    setBusy(true); setMessage("");
    try {
      const result = await send("PATCH", { action: "publish", termsId: draft.id });
      if (result.meta?.persisted === false) { setMessage("Preview only: nothing was published."); return; }
      setVersions((current) => current.map((item) => item.id === draft.id ? result.data : item.status === "published" ? { ...item, status: "retired" } : item));
      setMessage(`Version ${result.data.version} is now shown to clients. Earlier signatures stay linked to the version they signed.`);
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  async function toggleRequired(next: boolean) {
    setBusy(true); setMessage("");
    try {
      const result = await send("PATCH", { action: "require", required: next });
      if (result.meta?.persisted === false) { setMessage("Preview only: the requirement was not changed."); return; }
      setRequired(next); setMessage(next ? "Clients must now sign before booking a visit." : "Signing is optional. Clients can still sign from their case page.");
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }

  return <section className="panel">
    <div className="panel-header"><div><h2><FileSignature size={17} /> Terms of engagement</h2><p>Clients read and sign these in their case page. Each published version is frozen so signatures always match the wording signed.</p></div></div>
    <div className="panel-body stack">
      <label className="checkbox-row"><input type="checkbox" checked={required} disabled={!canEdit || busy || !published} onChange={(event) => void toggleRequired(event.target.checked)} /> Require a signature before the client books a visit</label>
      {!published ? <p className="form-help">Publish a version before requiring signatures.</p> : null}
      <form className="stack" onSubmit={saveDraft} onChange={() => setDirty(true)}>
        <div className="field"><label htmlFor="terms-title">Title</label><input id="terms-title" className="input" required minLength={3} maxLength={160} value={title} disabled={!canEdit || busy} onChange={(event) => setTitle(event.target.value)} /></div>
        <div className="field"><label htmlFor="terms-body">Wording</label><textarea id="terms-body" className="input terms-editor" required minLength={50} maxLength={40000} rows={14} value={body} disabled={!canEdit || busy} onChange={(event) => setBody(event.target.value)} /><span className="form-help">Plain text. Number your clauses; blank lines start a new paragraph. Have your terms checked by your professional adviser.</span></div>
        <div className="form-actions"><button className="button button-secondary" disabled={!canEdit || busy}>{draft ? `Save draft version ${draft.version}` : "Save as new draft"}</button>{draft ? <button type="button" className="button button-primary" disabled={!canEdit || busy || dirty} onClick={() => void publish()}><Send size={15} />Publish version {draft.version}</button> : null}</div>
        {dirty && draft ? <p className="form-help">Save the draft before publishing.</p> : null}
      </form>
      {versions.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Version</th><th>Title</th><th>State</th></tr></thead><tbody>{versions.map((item) => <tr key={item.id}><td>{item.version}</td><td>{item.title}</td><td><StatusDot tone={tone(item.status)}>{item.status === "published" ? `Published ${date(item.publishedAt)}` : item.status === "draft" ? "Draft" : "Retired"}</StatusDot></td></tr>)}</tbody></table></div> : null}
      <p role="status" className="form-help">{message}</p>
    </div>
  </section>;
}
