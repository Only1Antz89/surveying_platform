"use client";
import {workspaceFetch} from "@/lib/workspace-request";

import { type FormEvent, useState } from "react";
import { useOrganizationList } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";

function PracticeFields({ disabled = false }: { disabled?: boolean }) {
  return <>
    <div className="field"><label htmlFor="firm-name">Practice name</label><input id="firm-name" name="firmName" className="input" required minLength={2} maxLength={160} autoFocus disabled={disabled} /></div>
    <div className="field"><label htmlFor="practice-type">Primary practice area</label><select id="practice-type" name="practiceType" className="input" defaultValue="residential-building-surveying" disabled={disabled}><option value="residential-building-surveying">Residential building surveying</option><option value="commercial-building-surveying">Commercial building surveying</option><option value="valuation">Valuation</option><option value="multi-disciplinary">Multi-disciplinary</option></select></div>
    <div className="form-grid"><div className="field"><label htmlFor="team-size">Team size</label><select id="team-size" name="teamSize" className="input" defaultValue="1-5" disabled={disabled}><option value="1-5">1–5 people</option><option value="6-15">6–15 people</option><option value="16-50">16–50 people</option><option value="51+">51+ people</option></select></div><div className="field"><label htmlFor="practice-region">Region</label><select id="practice-region" name="region" className="input" defaultValue="South West England" disabled={disabled}><option>South West England</option><option>London</option><option>South East England</option><option>Midlands</option><option>North of England</option><option>Wales</option><option>Scotland</option><option>Northern Ireland</option></select></div></div>
  </>;
}

function ClerkStartPracticeForm() {
  const { isLoaded, setActive } = useOrganizationList();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isLoaded || !setActive) return;
    setSaving(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await workspaceFetch("/api/onboarding/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firmName: form.get("firmName"), practiceType: form.get("practiceType"), teamSize: form.get("teamSize"), region: form.get("region") }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? "The workspace could not be prepared.");
      await setActive({ organization: payload.data.clerkOrganisationId });
      router.push(`/trial/checkout?seats=${payload.data.seats}`);
    } catch (reason) {
      setSaving(false);
      setError(reason instanceof Error ? reason.message : "The workspace could not be prepared.");
    }
  }

  return <form className="auth-fields" onSubmit={submit}>
    <PracticeFields />
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <button className="button button-primary" disabled={saving || !isLoaded}>{saving ? <LoaderCircle size={16} /> : <ArrowRight size={16} />}{saving ? "Preparing workspace…" : "Continue to billing"}</button>
    <p className="legal">Your workspace remains provisional until Stripe confirms the trial.</p>
  </form>;
}

export function StartPracticeForm({ configured }: { configured: boolean }) {
  if (!configured) return <form className="auth-fields"><PracticeFields disabled /><button className="button button-primary" disabled><ArrowRight size={16} />Connect authentication to continue</button><p className="legal">Workspace provisioning becomes available after Clerk and the production database are configured.</p></form>;
  return <ClerkStartPracticeForm />;
}
