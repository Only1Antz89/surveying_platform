"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import { aiUseLabels, aiUses, type AiGateResult, type AiUse } from "@surveynt/assistant";

type Consent = { id: string; status: "granted" | "withdrawn"; uses: string[]; method: string; disclosureVersion: number; note: string | null; createdAt: string };
type AiStatus = { consents: Consent[]; gates: AiGateResult[] };

const methodLabels = { written: "Written", electronic: "Electronic", verbal_recorded: "Verbal (recorded)", terms_of_engagement: "Terms of engagement" } as const;
const formatDate = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

/**
 * The client's AI consent for one job and, per use, whether AI may run and why
 * not. Consent alone never switches anything on: the firm, the platform model
 * register and an approved risk assessment must also allow the use.
 */
export function JobAiConsent({ jobId, canEdit }: { jobId: string; canEdit: boolean }) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [demo, setDemo] = useState(false);
  const [uses, setUses] = useState<AiUse[]>([]);
  const [method, setMethod] = useState<keyof typeof methodLabels>("written");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const fetchStatus = useCallback(async () => {
    const response = await fetch(`/api/v1/jobs/${jobId}/ai-consent`, { cache: "no-store" });
    if (!response.ok) throw new Error("unavailable");
    return response.json() as Promise<{ data: AiStatus; meta?: { demo?: boolean } }>;
  }, [jobId]);

  useEffect(() => {
    let cancelled = false;
    fetchStatus().then((payload) => { if (!cancelled) { setStatus(payload.data); setDemo(Boolean(payload.meta?.demo)); } }, () => { if (!cancelled) setMessage({ tone: "error", text: "AI status could not be loaded." }); });
    return () => { cancelled = true; };
  }, [fetchStatus]);

  async function record(kind: "granted" | "withdrawn") {
    setBusy(true); setMessage(null);
    const response = await fetch(`/api/v1/jobs/${jobId}/ai-consent`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: kind, uses: kind === "granted" ? uses : [], method }) });
    const payload = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) { setMessage({ tone: "error", text: payload?.error?.message ?? "The consent could not be recorded." }); return; }
    setMessage({ tone: "success", text: kind === "granted" ? "Consent recorded." : "Withdrawal recorded." });
    setUses([]);
    const refreshed = await fetchStatus().catch(() => null);
    if (refreshed) setStatus(refreshed.data);
  }

  const latest = status?.consents[0] ?? null;
  return <section className="job-ai-consent" aria-labelledby={`ai-consent-${jobId}`}>
    <div className="job-history-heading"><ShieldCheck size={16} /><div><h3 id={`ai-consent-${jobId}`}>AI use on this job</h3><p>{latest ? `${latest.status === "granted" ? "Consent recorded" : "Consent withdrawn"} ${formatDate(latest.createdAt)}` : "No client consent recorded"}</p></div></div>
    {message ? <p className={message.tone === "error" ? "form-error" : "form-success"} role="status">{message.text}</p> : null}
    {status ? <ul className="ai-gates">{status.gates.map((gate) => <li key={gate.use}>
      <StatusDot tone={gate.allowed ? "green" : "slate"}>{aiUseLabels[gate.use]}</StatusDot>
      <span className="cell-sub">{gate.allowed ? `Allowed · ${gate.model?.providerKey} ${gate.model?.modelId}` : gate.reasons[0]?.message}{gate.reasons.length > 1 ? ` (+${gate.reasons.length - 1} more)` : ""}</span>
    </li>)}</ul> : !message ? <p className="form-help">Loading AI status…</p> : null}
    {status && canEdit && !demo ? <div className="ai-consent-form">
      <fieldset className="field"><legend>Uses the client agreed to</legend><div className="check-row">{aiUses.map((use) => <label key={use} className="check-field"><input type="checkbox" checked={uses.includes(use)} onChange={(event) => setUses((current) => event.target.checked ? [...current, use] : current.filter((item) => item !== use))} />{aiUseLabels[use]}</label>)}</div></fieldset>
      <div className="field"><label htmlFor={`ai-consent-method-${jobId}`}>How it was given</label><select id={`ai-consent-method-${jobId}`} className="select" value={method} onChange={(event) => setMethod(event.target.value as keyof typeof methodLabels)}>{Object.entries(methodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div className="row-actions">
        <button type="button" className="button button-secondary" disabled={busy || uses.length === 0} onClick={() => void record("granted")}>Record consent</button>
        {latest?.status === "granted" ? <button type="button" className="button button-quiet" disabled={busy} onClick={() => void record("withdrawn")}>Record withdrawal</button> : null}
      </div>
    </div> : null}
    {demo ? <p className="form-help">Demo workspace: AI features are off and consent cannot be recorded.</p> : null}
    {status?.consents.length ? <details className="ai-consent-history"><summary>Consent history ({status.consents.length})</summary><ol>{status.consents.map((item) => <li key={item.id}><strong>{item.status === "granted" ? "Granted" : "Withdrawn"}</strong> · {formatDate(item.createdAt)} · {methodLabels[item.method as keyof typeof methodLabels] ?? item.method} · disclosure v{item.disclosureVersion}{item.uses.length ? <span className="cell-sub">{item.uses.map((use) => aiUseLabels[use as AiUse] ?? use).join(", ")}</span> : null}</li>)}</ol></details> : null}
  </section>;
}
