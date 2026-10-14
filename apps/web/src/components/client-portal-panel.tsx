"use client";
import { useEffect, useState } from "react";
import { Copy, ExternalLink, Link2, Mail, Share2 } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import { workspaceFetch } from "@/lib/workspace-request";

type Media = { id: string; kind: string; name: string | null; contentType: string; capturedAt: string; element: string | null };
type Shared = { id: string; mediaAssetId: string; category: string; title: string; sharedAt: string };
type Admin = { clientEmail: string | null; clientName: string; hasQuote: boolean; canManage: boolean; access: { id: string; email: string | null; source: string; lastSentAt: string | null; lastViewedAt: string | null; expiresAt: string; createdAt: string } | null; shared: Shared[]; media: Media[] };
const when = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" });
const sources: Record<string, string> = { quote_accepted: "automatically when the quote was accepted", practice_sent: "by the practice", practice_link: "to share by another route" };
const categoryFor = (media: Media) => media.contentType.startsWith("image/") ? "photo" : media.contentType.startsWith("video/") ? "video" : "certificate";
const labelFor = (media: Media) => media.element ? media.element.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase()) : media.name?.replace(/\.[a-z0-9]+$/i, "") ?? "Survey file";

/** Job record: the client's portal link and what is shared in it. */
export function ClientPortalPanel({ jobId, canEdit }: { jobId: string; canEdit: boolean }) {
  const [data, setData] = useState<Admin | null>(null);
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [picking, setPicking] = useState(false);
  const [titles, setTitles] = useState<Record<string, string>>({});
  useEffect(() => { workspaceFetch(`/api/v1/jobs/${jobId}/portal`).then(async (response) => { const payload = await response.json(); if (response.ok) { setData(payload.data); setEmail(payload.data.clientEmail ?? ""); } }).catch(() => undefined); }, [jobId]);
  if (!data) return null;
  const editable = canEdit && data.canManage;

  async function call(method: string, path: string, body?: unknown) {
    const response = await workspaceFetch(`/api/v1/jobs/${jobId}/portal${path}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const payload = await response.json();
    if (!response.ok) throw Error(payload.error?.message ?? "The change could not be made.");
    return payload as { data: Record<string, unknown>; meta?: { persisted?: boolean } };
  }
  async function send() {
    setBusy(true); setMessage(""); setLink(null);
    try {
      const result = await call("POST", "", { action: "send", email: email.trim() || null });
      setData({ ...data!, access: { id: String(result.data.accessId ?? "demo"), email: String(result.data.sentTo), source: "practice_sent", lastSentAt: new Date().toISOString(), lastViewedAt: null, expiresAt: new Date(Date.now() + 548 * 86_400_000).toISOString(), createdAt: new Date().toISOString() } });
      setMessage(result.meta?.persisted === false ? `Preview only: nothing was sent to ${result.data.sentTo}.` : `Portal link sent to ${result.data.sentTo}. Any earlier link no longer works.`);
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  async function makeLink() {
    setBusy(true); setMessage("");
    try {
      const result = await call("POST", "", { action: "link" });
      setLink(String(result.data.url));
      if (result.meta?.persisted !== false) setData({ ...data!, access: { id: String(result.data.accessId), email: null, source: "practice_link", lastSentAt: null, lastViewedAt: null, expiresAt: new Date(Date.now() + 548 * 86_400_000).toISOString(), createdAt: new Date().toISOString() } });
      setMessage("Copy this link now. It is shown once, and any earlier link no longer works.");
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  async function revoke() {
    setBusy(true); setMessage(""); setLink(null);
    try { const result = await call("DELETE", ""); setData({ ...data!, access: null }); setMessage(result.meta?.persisted === false ? "Preview only." : "Portal link turned off. The client can no longer open it."); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  async function share(media: Media) {
    setBusy(true); setMessage("");
    try {
      const result = await call("POST", "/files", { mediaAssetId: media.id, category: categoryFor(media), title: (titles[media.id] ?? labelFor(media)).trim() || labelFor(media) });
      setData({ ...data!, shared: [...data!.shared, { ...(result.data as unknown as Shared), mediaAssetId: media.id }] });
      setMessage(result.meta?.persisted === false ? "Preview only: not shared." : "Shared with the client.");
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  async function unshare(item: Shared) {
    setBusy(true); setMessage("");
    try { await call("DELETE", "/files", { fileId: item.id }); setData({ ...data!, shared: data!.shared.filter((entry) => entry.id !== item.id) }); setMessage("No longer shared."); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  async function copy() { if (!link) return; try { await navigator.clipboard.writeText(link); setMessage("Link copied."); } catch { setMessage("Select the link and copy it."); } }

  const unshared = data.media.filter((media) => !data.shared.some((item) => item.mediaAssetId === media.id));
  return <section className="panel">
    <div className="panel-header"><div><h2><Share2 size={17} /> Client portal</h2><p>A branded page where {data.clientName} follows progress and downloads reports, photos, certificates and invoices.</p></div><StatusDot tone={data.access ? "green" : "slate"}>{data.access ? "Link active" : "No link yet"}</StatusDot></div>
    <div className="panel-body stack">
      {data.access ? <p>{data.access.email ? `Link emailed to ${data.access.email}` : "Link created"} on {when(data.access.lastSentAt ?? data.access.createdAt)}, {sources[data.access.source] ?? "by the practice"}. {data.access.lastViewedAt ? `Last opened ${when(data.access.lastViewedAt)}.` : "Not opened yet."}</p>
        : <p>{data.hasQuote ? "Clients who accept a quote get their link automatically once their deposit is confirmed." : "This customer was added by the practice. Send them their portal link when you are ready."}</p>}
      {editable ? <div className="portal-admin-actions">
        <div className="field"><label htmlFor="portal-email">Client email</label><input id="portal-email" type="email" className="input" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="client@example.com" /></div>
        <button type="button" className="button button-primary" disabled={busy} onClick={() => void send()}><Mail size={15} />{data.access ? "Send a new link" : "Email portal link"}</button>
        <button type="button" className="button button-secondary" disabled={busy} onClick={() => void makeLink()}><Link2 size={15} />Create link to copy</button>
        {data.access ? <button type="button" className="button button-quiet" disabled={busy} onClick={() => void revoke()}>Turn off link</button> : null}
      </div> : null}
      {link ? <div className="portal-link-box"><input readOnly className="input" value={link} aria-label="Portal link" onFocus={(event) => event.currentTarget.select()} /><button type="button" className="button button-secondary" onClick={() => void copy()}><Copy size={15} />Copy</button><a className="button button-quiet" href={link} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />Open</a></div> : null}
      <div>
        <h3 className="portal-admin-heading">Shared with the client</h3>
        {data.shared.length ? <ul className="portal-admin-list">{data.shared.map((item) => <li key={item.id}><span><strong>{item.title}</strong><span className="cell-sub">{item.category} · shared {when(item.sharedAt)}</span></span>{editable ? <button type="button" className="button button-quiet" disabled={busy} onClick={() => void unshare(item)}>Stop sharing</button> : null}</li>)}</ul> : <p className="muted">Nothing shared yet. Issued reports, signed terms, the quote and invoices appear automatically.</p>}
        {editable && unshared.length ? picking ? <ul className="portal-admin-list">{unshared.map((media) => <li key={media.id}><span><input className="input" aria-label={`Title for ${media.name ?? "file"}`} value={titles[media.id] ?? labelFor(media)} onChange={(event) => setTitles({ ...titles, [media.id]: event.target.value })} maxLength={160} /><span className="cell-sub">{categoryFor(media)} · {media.name ?? "survey file"} · {when(media.capturedAt)}</span></span><button type="button" className="button button-secondary" disabled={busy} onClick={() => void share(media)}>Share</button></li>)}</ul>
          : <button type="button" className="button button-quiet" onClick={() => setPicking(true)}>Choose photos and certificates to share ({unshared.length})</button> : null}
      </div>
      <p role="status" className="form-help">{message}</p>
    </div>
  </section>;
}
