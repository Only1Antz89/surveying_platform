"use client";

import { type FormEvent, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import { privacyCheckLabels, privacyChecks, type SanitisedCase } from "@surveynt/learning";
import type { loadLearningConsole } from "@/lib/learning-admin";

type Console = Awaited<ReturnType<typeof loadLearningConsole>>;
type QueueItem = NonNullable<Console["privacyQueue"]>[number];

const flagLabels: Record<string, string> = {
  free_text_requires_rewrite: "Free text must be rewritten", possible_identifier: "Possible identifier", photo_manual_review_required: "Photos need manual review",
  client_statement_unverified: "Client statement (unverified)", rare_combination: "Rare combination", generalised_for_rarity: "Generalised for rarity",
};
const example: Record<string, unknown> = { definedBy: "Names and roles of the qualified reviewers who set these criteria", minimumCasesPerRelease: null, maxContributorShare: null, rareCombinationReviewBelow: null, minimumTechnicalAgreement: null, coverageDimensions: ["jurisdiction", "serviceLevel", "propertyType", "ageBand", "elementKey"], licenceScope: "Shared retrieval inside Surveynt only; no publication or export." };

export function SanitisedPreview({ value }: { value: SanitisedCase | null }) {
  if (!value) return <p className="form-help">No sanitisation result.</p>;
  const texts = [["Construction", value.text.construction ? [value.text.construction] : []], ["Surveyor observations", value.text.surveyorObservations], ["Client statements (unverified)", value.text.clientStatements], ["Records", value.text.recordContext], ["Commentary", value.text.commentary ? [value.text.commentary] : []], ["Limitations", value.text.limitations ? [value.text.limitations] : []]] as const;
  return <div className="learning-preview">
    <p className="cell-sub">{value.jurisdiction} · {value.serviceLevel.replace("_", " ")} · {value.elementLabel} · rating {value.conditionRating ?? "—"} · {[value.property.propertyType, value.property.builtForm, value.property.ageBand?.replace("_", "–"), value.property.storeys ? `${value.property.storeys} storeys` : null].filter(Boolean).join(", ") || "context withheld"}{value.photoCount ? ` · ${value.photoCount} photo(s), not copied` : ""}</p>
    {texts.filter(([, items]) => items.length).map(([label, items]) => <div key={label}><strong>{label}</strong>{items.map((item, index) => <p key={index}>{item}</p>)}</div>)}
  </div>;
}

/**
 * Platform console for shared learning. Each role sees and does only its own
 * part: compliance owns the policy, privacy reviewers the privacy queue,
 * technical reviewers the surveying review, release managers releases.
 */
export function LearningConsole({ initial, role, demo }: { initial: Console | null; role: string; demo: boolean }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const canPolicy = role === "super_admin" || role === "compliance";

  async function refresh() {
    const response = await fetch("/api/platform/learning", { cache: "no-store" });
    if (response.ok) setData((await response.json()).data);
  }

  async function send(url: string, method: string, body: unknown, done: string) {
    setBusy(true); setMessage(null);
    const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) { setMessage({ tone: "error", text: [payload?.error?.message ?? "The action failed.", ...Object.values((payload?.error?.details?.fieldErrors ?? {}) as Record<string, string[]>).flat()].join(" ") }); return false; }
    setMessage({ tone: "success", text: payload?.meta?.demo ? "Demo workspace: nothing was saved." : done });
    await refresh();
    return true;
  }

  async function draftPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    let releaseCriteria: unknown;
    try { releaseCriteria = JSON.parse(String(form.get("criteria") ?? "{}")); } catch { setMessage({ tone: "error", text: "Release criteria must be valid JSON." }); return; }
    if (await send("/api/platform/learning/policies", "POST", { version: String(form.get("version") ?? "").trim(), summary: String(form.get("summary") ?? "").trim(), policyDocumentRef: String(form.get("document") ?? "").trim(), privacyAssessmentRef: String(form.get("dpia") ?? "").trim() || null, releaseCriteria }, "Policy draft saved.")) formElement.reset();
  }

  function decide(item: QueueItem, decision: "approved" | "rejected", form: HTMLFormElement) {
    const values = new FormData(form);
    void send(`/api/platform/learning/candidates/${item.id}/privacy`, "POST", { decision, checks: values.getAll("checks").map(String), note: String(values.get("note") ?? "").trim() || null }, decision === "approved" ? "Approved for surveying review." : "Rejected; the case will not be used.");
  }

  function review(candidateId: string, decision: "approved" | "rejected", form: HTMLFormElement) {
    const values = new FormData(form);
    const text = (name: string) => String(values.get(name) ?? "").trim();
    const lines = (name: string) => text(name).split("\n").map((line) => line.trim()).filter(Boolean);
    const reviewedCase = {
      observedFeature: text("observedFeature"), possibleCauses: lines("possibleCauses"), confirmedCause: text("confirmedCause") || null, confirmationBasis: text("confirmationBasis") || null,
      surveyorJudgement: text("surveyorJudgement"), ratingExample: text("ratingExample") || null, nextSteps: lines("nextSteps"), limitations: text("limitations") || null, uncertainty: text("uncertainty"),
      evidenceStrength: text("evidenceStrength"), knowledgeReviewDue: text("knowledgeReviewDue"), ratingDisagreement: values.get("ratingDisagreement") === "on", noDefect: values.get("noDefect") === "on",
    };
    void send(`/api/platform/learning/candidates/${candidateId}/technical`, "POST", { decision, reviewed: decision === "approved" ? reviewedCase : null, note: text("note") || null }, decision === "approved" ? "Case approved for the next release." : "Case rejected.");
  }

  if (demo || !data) return <div className="ai-governance">
    <p className="address-demo-label">Demo workspace: no platform data is loaded and nothing is saved. Shared learning is off.</p>
    <section className="panel"><div className="panel-header"><div><h2>Programme</h2><p>Off until the platform flag is set, a policy with a privacy assessment and release criteria is published, and firms grant scopes individually.</p></div></div></section>
  </div>;

  return <div className="ai-governance">
    {message ? <p className={message.tone === "error" ? "form-error" : "form-success"} role="status">{message.text}</p> : null}
    {!data.programme.active ? <div className="identity-warning learning-status"><ShieldAlert size={14} aria-hidden="true" /><div><strong>Shared learning is not active.</strong><ul>{data.programme.reasons.map((reason) => <li key={reason.code}>{reason.message}</li>)}</ul></div></div> : null}
    {!data.learningConfigured ? <p className="identity-warning"><ShieldAlert size={14} aria-hidden="true" /> The learning service connection (DATABASE_LEARNING_URL) is not configured; staging and review queues are unavailable.</p> : null}

    <section className="panel">
      <div className="panel-header"><div><h2>Pipeline</h2><p>Case counts by stage across all contributors. Firms are identified only by pseudonymous keys.</p></div>{role === "release_manager" || role === "super_admin" ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => void send("/api/platform/learning/extract", "POST", {}, "Sweep complete.")}>Run sweep now</button> : null}</div>
      {data.counts && Object.keys(data.counts).length ? <div className="metric-strip">{Object.entries(data.counts).map(([status, count]) => <div key={status}><strong>{count}</strong><span>{status.replace(/_/g, " ")}</span></div>)}</div> : <p className="form-help assistant-empty">No candidates staged.</p>}
    </section>

    <section className="panel">
      <div className="panel-header"><div><h2>Contribution policy</h2><p>Publishing needs an approved privacy assessment reference and release criteria set by qualified reviewers. One version is published at a time.</p></div></div>
      {data.policies.length ? <ul className="ai-list">{data.policies.map((policy) => <li key={policy.id}>
        <div className="wording-head"><strong>Version {policy.version}</strong><StatusDot tone={policy.status === "published" ? "green" : policy.status === "draft" ? "amber" : "slate"}>{policy.status}</StatusDot><span className="cell-sub">{policy.privacyAssessmentRef ? `Privacy assessment ${policy.privacyAssessmentRef}` : "No privacy assessment"}</span></div>
        <span className="cell-sub">{policy.summary}</span>
        <details><summary className="cell-sub">Release criteria</summary><pre className="learning-json">{JSON.stringify(policy.releaseCriteria, null, 2)}</pre></details>
        {policy.status === "draft" && canPolicy ? <div className="row-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => void send(`/api/platform/learning/policies/${policy.id}/publish`, "POST", {}, "Policy published.")}>Publish</button></div> : null}
      </li>)}</ul> : <p className="form-help assistant-empty">No policy versions.</p>}
      {canPolicy ? <form className="form-section" onSubmit={(event) => void draftPolicy(event)}>
        <div className="form-grid">
          <div className="field"><label htmlFor="policy-version">Version</label><input id="policy-version" name="version" className="input" required pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,30}" /></div>
          <div className="field"><label htmlFor="policy-dpia">Privacy assessment reference</label><input id="policy-dpia" name="dpia" className="input" maxLength={200} /></div>
          <div className="field full"><label htmlFor="policy-document">Policy document</label><input id="policy-document" name="document" className="input" required minLength={5} maxLength={500} defaultValue="docs/shared-learning/policy.md" /></div>
          <div className="field full"><label htmlFor="policy-summary">Summary</label><textarea id="policy-summary" name="summary" className="textarea" rows={2} required minLength={20} maxLength={4000} /></div>
          <div className="field full"><label htmlFor="policy-criteria">Release criteria (JSON, set by qualified reviewers)</label><textarea id="policy-criteria" name="criteria" className="textarea learning-json" rows={8} defaultValue={JSON.stringify(example, null, 2)} /></div>
        </div>
        <div className="form-actions"><button className="button button-secondary" disabled={busy}>Save draft</button></div>
      </form> : null}
    </section>

    <section className="panel">
      <div className="panel-header"><div><h2>Privacy review</h2><p>Sanitised candidates only. Approve when every check holds; anything distinctive is rejected rather than trusted to redaction.</p></div></div>
      {data.privacyQueue === null ? <p className="form-help assistant-empty">The learning service is not configured.</p> : data.privacyQueue.length ? <ul className="ai-list">{data.privacyQueue.map((item) => <li key={item.id}>
        <div className="wording-head"><strong>{item.elementRef}</strong><StatusDot tone={item.status === "quarantined" ? "red" : "amber"}>{item.status === "quarantined" ? "Held" : "Awaiting review"}</StatusDot><span className="cell-sub">contributor {item.contributor} · {item.transformer}</span></div>
        {item.statusReason ? <span className="cell-sub">{item.statusReason}</span> : null}
        <div className="chip-row">{item.flags.map((flag) => <span key={flag} className="chip">{flagLabels[flag] ?? flag}</span>)}</div>
        <SanitisedPreview value={item.sanitised as SanitisedCase | null} />
        {item.residualTerms.length ? <span className="cell-sub">Capitalised words left for you to judge: {item.residualTerms.join(", ")}</span> : null}
        <span className="cell-sub">Removed or generalised: {item.findings.map((finding) => `${finding.kind.replace(/_/g, " ")} ×${finding.count}`).join(", ") || "nothing"}</span>
        {role === "privacy_reviewer" ? <form className="form-section" onSubmit={(event) => event.preventDefault()}>
          <fieldset className="field"><legend>Checks</legend>{privacyChecks.map((check) => <label key={check} className="check-field"><input type="checkbox" name="checks" value={check} />{privacyCheckLabels[check]}</label>)}</fieldset>
          <div className="field"><label htmlFor={`note-${item.id}`}>Note (required to reject)</label><input id={`note-${item.id}`} name="note" className="input" maxLength={2000} /></div>
          <div className="row-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={(event) => decide(item, "approved", event.currentTarget.form!)}>Approve</button><button type="button" className="button button-quiet danger" disabled={busy} onClick={(event) => decide(item, "rejected", event.currentTarget.form!)}>Reject</button></div>
        </form> : null}
      </li>)}</ul> : <p className="form-help assistant-empty">Nothing awaits privacy review.</p>}
    </section>

    <section className="panel">
      <div className="panel-header"><div><h2>Surveying review</h2><p>Write the generalised case that would be shared. Keep what was seen, what might explain it, the judgement and any confirmed outcome separate. A client&apos;s account of a repair is not confirmation.</p></div></div>
      {data.technicalQueue === null ? <p className="form-help assistant-empty">The learning service is not configured.</p> : data.technicalQueue.length ? <ul className="ai-list">{data.technicalQueue.map((item) => <li key={item.id}>
        <div className="wording-head"><strong>{item.elementRef}</strong><StatusDot tone="amber">Awaiting surveying review</StatusDot><span className="cell-sub">contributor {item.contributor}</span></div>
        <SanitisedPreview value={item.sanitised as SanitisedCase | null} />
        {role === "technical_reviewer" ? <form className="form-section" onSubmit={(event) => event.preventDefault()}>
          <div className="form-grid">
            <div className="field full"><label htmlFor={`feature-${item.id}`}>Observed feature (generalised)</label><textarea id={`feature-${item.id}`} name="observedFeature" className="textarea" rows={2} maxLength={2000} defaultValue={(item.sanitised as SanitisedCase | null)?.text.surveyorObservations.join(" ") ?? ""} /></div>
            <div className="field full"><label htmlFor={`causes-${item.id}`}>Possible causes (one per line, not confirmed)</label><textarea id={`causes-${item.id}`} name="possibleCauses" className="textarea" rows={2} /></div>
            <div className="field"><label htmlFor={`confirmed-${item.id}`}>Confirmed cause (only if followed up)</label><input id={`confirmed-${item.id}`} name="confirmedCause" className="input" maxLength={500} /></div>
            <div className="field"><label htmlFor={`basis-${item.id}`}>Confirmed by</label><select id={`basis-${item.id}`} name="confirmationBasis" className="select" defaultValue=""><option value="">Not confirmed</option><option value="follow_up_inspection">Follow-up inspection</option><option value="specialist_report">Specialist report</option></select></div>
            <div className="field full"><label htmlFor={`judgement-${item.id}`}>Surveyor judgement and reasoning</label><textarea id={`judgement-${item.id}`} name="surveyorJudgement" className="textarea" rows={2} maxLength={2000} /></div>
            <div className="field"><label htmlFor={`rating-${item.id}`}>Example rating</label><select id={`rating-${item.id}`} name="ratingExample" className="select" defaultValue={(item.sanitised as SanitisedCase | null)?.conditionRating ?? ""}><option value="">None</option><option>1</option><option>2</option><option>3</option><option>NI</option></select></div>
            <div className="field"><label htmlFor={`uncertainty-${item.id}`}>Uncertainty</label><select id={`uncertainty-${item.id}`} name="uncertainty" className="select" defaultValue="medium"><option>low</option><option>medium</option><option>high</option></select></div>
            <div className="field full"><label htmlFor={`steps-${item.id}`}>Next steps (one per line)</label><textarea id={`steps-${item.id}`} name="nextSteps" className="textarea" rows={2} /></div>
            <div className="field full"><label htmlFor={`limits-${item.id}`}>Limitations</label><input id={`limits-${item.id}`} name="limitations" className="input" maxLength={1000} /></div>
            <div className="field"><label htmlFor={`evidence-${item.id}`}>Evidence</label><select id={`evidence-${item.id}`} name="evidenceStrength" className="select" defaultValue="observed"><option value="observed">Observed</option><option value="observed_with_photo">Observed with photo</option><option value="reported_only">Reported only</option></select></div>
            <div className="field"><label htmlFor={`due-${item.id}`}>Review knowledge by</label><input id={`due-${item.id}`} name="knowledgeReviewDue" type="date" className="input" /></div>
            <label className="check-field"><input type="checkbox" name="ratingDisagreement" />I would rate this differently from the original surveyor</label>
            <label className="check-field"><input type="checkbox" name="noDefect" />No defect (an ordinary-condition example)</label>
            <div className="field full"><label htmlFor={`tnote-${item.id}`}>Note (required to reject)</label><input id={`tnote-${item.id}`} name="note" className="input" maxLength={2000} /></div>
          </div>
          <div className="row-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={(event) => review(item.id, "approved", event.currentTarget.form!)}>Approve case</button><button type="button" className="button button-quiet danger" disabled={busy} onClick={(event) => review(item.id, "rejected", event.currentTarget.form!)}>Reject</button></div>
        </form> : null}
      </li>)}</ul> : <p className="form-help assistant-empty">Nothing awaits surveying review.</p>}
    </section>

    <section className="panel">
      <div className="panel-header"><div><h2>Releases</h2><p>A release carries the whole reviewed corpus. It needs a privacy sign-off and a release manager&apos;s approval by different people; one release is active at a time.</p></div>{role === "release_manager" && data.releases?.some((item) => item.status === "active") ? <button type="button" className="button button-quiet danger" disabled={busy} onClick={() => { const reason = window.prompt("Why roll back the active release?"); if (reason?.trim()) void send("/api/platform/learning/releases/rollback", "POST", { reason }, "Rolled back."); }}>Roll back</button> : null}</div>
      {data.releases === null ? <p className="form-help assistant-empty">The learning service is not configured.</p> : data.releases.length ? <ul className="ai-list">{data.releases.map((release) => {
        const manifest = release.manifest as { caseCount?: number; contributorCount?: number; maxEffectiveShare?: number; unsupportedSegments?: string[]; duplicatesRemoved?: number };
        return <li key={release.id}>
          <div className="wording-head"><strong>Release {release.version}</strong><StatusDot tone={release.status === "active" ? "green" : release.status === "draft" || release.status === "approved" ? "amber" : "slate"}>{release.status.replace("_", " ")}</StatusDot><span className="cell-sub">policy {release.policyVersion}{release.privacySignedOff ? " · privacy signed off" : ""}</span></div>
          <span className="cell-sub">{manifest.caseCount ?? 0} cases from {manifest.contributorCount ?? 0} contributors · largest effective share {Math.round((manifest.maxEffectiveShare ?? 0) * 100)}% · {manifest.duplicatesRemoved ?? 0} duplicates removed</span>
          {manifest.unsupportedSegments?.length ? <span className="cell-sub">Not covered: {manifest.unsupportedSegments.join(", ")}</span> : null}
          {release.problems.length ? <ul className="learning-problems">{release.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul> : null}
          <div className="row-actions">
            {release.status === "draft" && role === "privacy_reviewer" && !release.privacySignedOff ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => { const note = window.prompt("What did you check, including linkage across earlier releases?"); if (note?.trim()) void send(`/api/platform/learning/releases/${release.id}/privacy`, "POST", { note }, "Release signed off."); }}>Privacy sign-off</button> : null}
            {release.status === "draft" && role === "release_manager" ? <button type="button" className="button button-secondary" disabled={busy || !release.privacySignedOff} onClick={() => void send(`/api/platform/learning/releases/${release.id}/approve`, "POST", {}, "Release approved.")}>Approve</button> : null}
            {(release.status === "approved" || release.status === "superseded") && role === "release_manager" ? <button type="button" className="button button-primary" disabled={busy} onClick={() => void send(`/api/platform/learning/releases/${release.id}/activate`, "POST", {}, "Release activated.")}>Activate</button> : null}
          </div>
        </li>;
      })}</ul> : <p className="form-help assistant-empty">No releases.</p>}
      {role === "release_manager" ? <form className="form-section" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; void send("/api/platform/learning/releases", "POST", { version: String(new FormData(form).get("version") ?? "").trim() }, "Draft release prepared.").then((done) => { if (done) form.reset(); }); }}>
        <div className="form-grid"><div className="field"><label htmlFor="release-version">New release version</label><input id="release-version" name="version" className="input" required pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,30}" /></div></div>
        <div className="form-actions"><button className="button button-secondary" disabled={busy}>Prepare draft</button></div>
      </form> : null}
    </section>
  </div>;
}
