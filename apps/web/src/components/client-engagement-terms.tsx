"use client";
import { useCallback, useEffect, useState } from "react";
import { FileSignature, ShieldCheck } from "lucide-react";
import { workspaceFetch } from "@/lib/workspace-request";
import { downloadFile } from "@/lib/download";

type Terms = { id: string; version: number; title: string; body: string };
type Signature = { version: number; signerName: string; signedAt: string; method: string };
type State = { required: boolean; terms: Terms | null; acceptance: Signature | null };
const when = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/London" });

/** Client case step: read the practice's terms and sign by typing a full name. */
export function ClientEngagementTerms({ quoteId, token, onSigned }: { quoteId: string; token: string; onSigned: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useCallback(async (init?: RequestInit) => {
    const response = await workspaceFetch(`/api/v1/public/quotes/${quoteId}/terms`, { ...init, headers: { "content-type": "application/json", "x-quote-token": token } });
    const payload = await response.json();
    if (!response.ok) throw Error(payload.error?.message ?? "Terms are unavailable.");
    return payload.data;
  }, [quoteId, token]);
  useEffect(() => { if (!token) return; request().then(setState).catch(() => setState(null)); }, [token, request]);
  if (!state?.terms) return null;
  const current = state.acceptance && state.acceptance.version === state.terms.version;

  async function sign(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const acceptance = await request({ method: "POST", body: JSON.stringify({ termsId: state!.terms!.id, signerName: name, signerEmail: email.trim() || null, agree }) });
      setState({ ...state!, acceptance }); onSigned();
    } catch (reason) { setError((reason as Error).message); if ((reason as Error).message.includes("updated its terms")) request().then(setState).catch(() => undefined); }
    finally { setBusy(false); }
  }

  return <section className="quote-form client-terms" aria-labelledby="client-terms-heading">
    <h2 id="client-terms-heading"><FileSignature />Terms of engagement</h2>
    {current && error ? <p className="form-error" role="alert">{error}</p> : null}
    {current ? <p role="status" className="client-terms-signed"><ShieldCheck aria-hidden="true" />Signed by {state.acceptance!.signerName} on {when(state.acceptance!.signedAt)} · version {state.terms.version}{state.acceptance!.method === "recorded_by_practice" ? " · recorded by your practice" : ""} <button type="button" className="button button-quiet" onClick={() => downloadFile(`/api/v1/public/quotes/${quoteId}/terms/pdf`, "signed-terms.pdf", { headers: { "x-quote-token": token } }).catch((reason: Error) => setError(reason.message))}>Download signed copy</button></p> : <>
      <p>{state.required ? "Please read and sign these terms before you choose a visit." : "Please read and sign these terms. They explain what the survey covers."}</p>
      <div className="client-terms-text" tabIndex={0} aria-label={`${state.terms.title}, version ${state.terms.version}`}>
        <h3>{state.terms.title}</h3>
        {state.terms.body.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        <p className="cell-sub">Version {state.terms.version}</p>
      </div>
      <form className="stack" onSubmit={sign}>
        <label>Your full name<input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={120} autoComplete="name" /></label>
        <label>Email for your records (optional)<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} autoComplete="email" /></label>
        <label className="client-terms-agree"><input type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} required /> I have read these terms and agree to them. Typing my name acts as my signature.</label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="button button-primary" disabled={busy || !agree || name.trim().length < 2}>{busy ? "Signing…" : "Sign terms"}</button>
      </form>
    </>}
  </section>;
}
