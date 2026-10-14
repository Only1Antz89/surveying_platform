"use client";
import { useEffect, useState } from "react";
import { MessagesSquare } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import { workspaceFetch } from "@/lib/workspace-request";
import { messageMeta, type MessageKey } from "@/lib/client-messages-model";
import type { ReferralSource } from "@/lib/referrals";

type Log = { templateKey: MessageKey; channel: "email" | "sms"; status: "queued" | "skipped"; reason: string | null; createdAt: string }[];
const when = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" });

/** Job record: where the instruction came from, messages to the client and what was sent. */
export function JobClientPanel({ jobId, canSetReferral, canMessage }: { jobId: string; canSetReferral: boolean; canMessage: boolean }) {
  const [referral, setReferral] = useState<{ referralSourceId: string | null; sources: ReferralSource[] } | null>(null);
  const [messages, setMessages] = useState<{ log: Log; available: ("on_the_way" | "access_request")[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => {
    workspaceFetch(`/api/v1/jobs/${jobId}/referral`).then(async (response) => { if (response.ok) setReferral((await response.json()).data); }).catch(() => undefined);
    workspaceFetch(`/api/v1/jobs/${jobId}/messages`).then(async (response) => { if (response.ok) setMessages((await response.json()).data); }).catch(() => undefined);
  }, [jobId]);
  if (!referral && !messages) return null;

  async function changeReferral(value: string) {
    setBusy(true); setStatus("");
    try {
      const response = await workspaceFetch(`/api/v1/jobs/${jobId}/referral`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ referralSourceId: value || null }) });
      const payload = await response.json();
      if (!response.ok) throw Error(payload.error?.message ?? "The referral source could not be saved.");
      setReferral((current) => current && { ...current, referralSourceId: value || null });
      setStatus(payload.meta?.persisted === false ? "Preview only: not saved." : "Referral source saved.");
    } catch (error) { setStatus((error as Error).message); } finally { setBusy(false); }
  }
  async function send(key: "on_the_way" | "access_request") {
    setBusy(true); setStatus("");
    try {
      const response = await workspaceFetch(`/api/v1/jobs/${jobId}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key }) });
      const payload = await response.json();
      if (!response.ok) throw Error(payload.error?.message ?? "The message could not be sent.");
      const results = payload.data as { channel: "email" | "sms"; status: "queued" | "skipped"; reason: string | null }[];
      setMessages((current) => current && { ...current, log: [...results.map((item) => ({ templateKey: key, ...item, createdAt: new Date().toISOString() })), ...current.log] });
      setStatus(payload.meta?.persisted === false ? "Preview only: nothing was sent." : results.some((item) => item.status === "queued") ? `${messageMeta[key].label} queued for delivery.` : results[0]?.reason ?? "Nothing was sent.");
    } catch (error) { setStatus((error as Error).message); } finally { setBusy(false); }
  }

  return <section className="panel">
    <div className="panel-header"><div><h2><MessagesSquare size={17} /> Client contact</h2><p>Referral source and messages sent to the client for this job.</p></div></div>
    <div className="panel-body stack">
      {referral ? <div className="field"><label htmlFor="job-referral">Referral source</label>
        {canSetReferral ? <select id="job-referral" className="select" disabled={busy} value={referral.referralSourceId ?? ""} onChange={(event) => void changeReferral(event.target.value)}><option value="">Not recorded</option>{referral.sources.map((source) => <option key={source.id} value={source.id}>{source.name}{source.active ? "" : " (archived)"}</option>)}</select>
          : <span>{referral.sources.find((source) => source.id === referral.referralSourceId)?.name ?? "Not recorded"}</span>}
      </div> : null}
      {messages && canMessage ? messages.available.length ? <div className="action-row">{messages.available.map((key) => <button key={key} type="button" className="button button-secondary" disabled={busy} onClick={() => void send(key)}>Send “{messageMeta[key].label}”</button>)}</div> : <p className="form-help">Switch on messages in CRM suite → Client messages to send them from here.</p> : null}
      {messages?.log.length ? <ul className="message-log">{messages.log.map((item, index) => <li key={`${item.createdAt}-${index}`}><StatusDot tone={item.status === "queued" ? "green" : "amber"}>{item.status === "queued" ? "Sent" : "Not sent"}</StatusDot><span>{messageMeta[item.templateKey]?.label ?? item.templateKey} · {item.channel === "email" ? "email" : "text"} · {when(item.createdAt)}{item.reason ? ` · ${item.reason}` : ""}</span></li>)}</ul> : null}
      <p role="status" className="form-help">{status}</p>
    </div>
  </section>;
}
