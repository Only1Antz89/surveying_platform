"use client";
import { useEffect, useMemo, useState } from "react";
import { MessageSquareText, Star } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import { workspaceFetch } from "@/lib/workspace-request";
import { fillTemplate, messageKeys, messageMeta, messageTokens, unknownTokens, type MessageKey } from "@/lib/client-messages-model";
import type { TemplateView } from "@/lib/client-messages";

type Data = { templates: TemplateView[]; reviewRequests: { enabled: boolean; reviewUrl: string | null; delayDays: number }; smsConnected: boolean };
const sample = { clientName: "Alex Morgan", practiceName: "Your practice", reference: "SVY-1048", propertyAddress: "18 Royal York Crescent, Bristol", appointmentDate: "Thursday 15 October", appointmentTime: "10:00", surveyorName: "Maya Patel", reviewLink: "https://example.com/review" };

/** Practice-written messages to clients, by email now and by text once a provider is connected. */
export function ClientMessagesSettings({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [key, setKey] = useState<MessageKey>("appointment_reminder");
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [draft, setDraft] = useState<TemplateView | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { workspaceFetch("/api/v1/client-messages").then(async (response) => { const payload = await response.json(); if (!response.ok) throw Error(payload.error?.message ?? "Client messages are unavailable."); setData(payload.data); }).catch((error: Error) => setMessage(error.message)); }, []);
  const current = data?.templates.find((item) => item.key === key && item.channel === channel) ?? null;
  const editing = draft && draft.key === key && draft.channel === channel ? draft : current;
  const warnings = useMemo(() => editing ? unknownTokens(`${editing.subject ?? ""} ${editing.body}`) : [], [editing]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true); setMessage("");
    try {
      const response = await workspaceFetch("/api/v1/client-messages", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, channel, subject: editing.subject, body: editing.body, enabled: editing.enabled }) });
      const payload = await response.json();
      if (!response.ok) throw Error(payload.error?.message ?? "The message could not be saved.");
      setData((value) => value && { ...value, templates: value.templates.map((item) => item.key === key && item.channel === channel ? payload.data : item) });
      setDraft(null); setMessage(payload.meta?.persisted === false ? "Preview only: not saved." : `${messageMeta[key].label} ${channel === "email" ? "email" : "text"} saved${payload.data.enabled ? " and switched on" : ""}.`);
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  async function saveReview(form: FormData) {
    setBusy(true); setMessage("");
    try {
      const body = { enabled: form.get("reviewEnabled") === "on", reviewUrl: String(form.get("reviewUrl") || "").trim() || null, delayDays: Number(form.get("delayDays")) };
      const response = await workspaceFetch("/api/v1/client-messages", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw Error(payload.error?.message ?? "Review settings could not be saved.");
      setData((value) => value && { ...value, reviewRequests: payload.data });
      setMessage(payload.meta?.persisted === false ? "Preview only: not saved." : "Review request settings saved.");
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  if (!data) return <section className="panel"><div className="panel-body"><p className="muted">{message || "Loading client messages…"}</p></div></section>;

  return <div className="stack">
    <section className="panel">
      <div className="panel-header"><div><h2><MessageSquareText size={17} /> Client messages</h2><p>Write each message once. Placeholders in braces are filled from the job when it is sent.</p></div></div>
      <div className="panel-body message-settings">
        <nav className="message-list" aria-label="Messages">{messageKeys.map((item) => { const email = data.templates.find((row) => row.key === item && row.channel === "email"); return <button key={item} type="button" aria-current={item === key ? "true" : undefined} className={item === key ? "active" : ""} onClick={() => { setKey(item); setDraft(null); }}><span className="message-list-text"><strong>{messageMeta[item].label}</strong><span>{messageMeta[item].automatic ? "Automatic" : "Sent from the job"}</span></span><StatusDot tone={email?.enabled ? "green" : "slate"}>{email?.enabled ? "On" : "Off"}</StatusDot></button>; })}</nav>
        {editing ? <form className="stack message-editor" onSubmit={save}>
          <p className="form-help">{messageMeta[key].when}</p>
          <div className="segmented" role="radiogroup" aria-label="Channel"><button type="button" role="radio" aria-checked={channel === "email"} className={channel === "email" ? "active" : ""} onClick={() => setChannel("email")}>Email</button><button type="button" role="radio" aria-checked={channel === "sms"} className={channel === "sms" ? "active" : ""} onClick={() => setChannel("sms")}>Text message</button></div>
          {channel === "sms" && !data.smsConnected ? <p className="notice">No text message provider is connected. You can prepare the wording now; texts are not sent until a provider is set up.</p> : null}
          {channel === "email" ? <div className="field"><label htmlFor="message-subject">Subject</label><input id="message-subject" className="input" maxLength={200} disabled={!canEdit} value={editing.subject ?? ""} onChange={(event) => setDraft({ ...editing, subject: event.target.value })} /></div> : null}
          <div className="field"><label htmlFor="message-body">Message</label><textarea id="message-body" className="input" rows={channel === "email" ? 9 : 4} maxLength={channel === "email" ? 5000 : 480} disabled={!canEdit} value={editing.body} onChange={(event) => setDraft({ ...editing, body: event.target.value })} />{channel === "sms" ? <span className="form-help">{editing.body.length} / 480 characters</span> : null}</div>
          <p className="form-help">Placeholders: {messageTokens.map((token) => `{${token}}`).join(" ")}</p>
          {warnings.length ? <p className="form-error">Not recognised: {warnings.map((token) => `{${token}}`).join(", ")}. These will be left blank.</p> : null}
          <label className="checkbox-row"><input type="checkbox" checked={editing.enabled} disabled={!canEdit || (channel === "sms" && !data.smsConnected)} onChange={(event) => setDraft({ ...editing, enabled: event.target.checked })} /> Send this {channel === "email" ? "email" : "text"}</label>
          <details><summary>Preview with example details</summary><div className="message-preview">{channel === "email" ? <strong>{fillTemplate(editing.subject ?? "", sample)}</strong> : null}<p>{fillTemplate(editing.body, sample)}</p></div></details>
          {canEdit ? <div className="form-actions"><button className="button button-primary" disabled={busy}>Save message</button></div> : null}
        </form> : null}
      </div>
    </section>
    <section className="panel">
      <div className="panel-header"><div><h2><Star size={17} /> Review requests</h2><p>Invite clients to leave a review a few days after their report is issued. Switch on the review request email above as well.</p></div></div>
      <form action={saveReview} className="panel-body form-grid" key={JSON.stringify(data.reviewRequests)}>
        <label className="checkbox-row field full"><input type="checkbox" name="reviewEnabled" defaultChecked={data.reviewRequests.enabled} disabled={!canEdit} /> Ask clients for a review after issue</label>
        <div className="field"><label htmlFor="review-url">Review link</label><input id="review-url" name="reviewUrl" type="url" className="input" placeholder="https://g.page/r/…" defaultValue={data.reviewRequests.reviewUrl ?? ""} disabled={!canEdit} /></div>
        <div className="field"><label htmlFor="review-delay">Days after issue</label><input id="review-delay" name="delayDays" type="number" min="0" max="30" className="input" defaultValue={data.reviewRequests.delayDays} disabled={!canEdit} /></div>
        {canEdit ? <div className="form-actions field full"><button className="button button-secondary" disabled={busy}>Save review settings</button></div> : null}
      </form>
    </section>
    <p role="status" className="form-help">{message}</p>
  </div>;
}
