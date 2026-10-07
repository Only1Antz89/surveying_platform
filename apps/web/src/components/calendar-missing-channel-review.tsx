"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Calendar, CheckCircle2 } from "lucide-react";

export type MissingCalendarChannel = { id: string; provider: string; accountId: string; reviewVersion: string };

export function CalendarMissingChannelReview({ row }: { row: MissingCalendarChannel }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();

  async function submit(form: FormData) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/platform/calendar-connections/${row.id}/provision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reviewVersion: row.reviewVersion,
          verifiedAccountId: form.get("accountId"),
          evidence: form.get("evidence"),
          confirmed: form.get("confirmed") === "on",
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Calendar provisioning review failed.");
      setMessage(payload.meta?.persisted === false ? "Demo review only. No subscription was queued." : "Reviewed registration queued. Refresh to check worker completion.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Calendar review failed.");
    } finally {
      setBusy(false);
    }
  }

  const isSuccess = message.includes("queued");

  return (
    <details className="accordion-card">
      <summary className="accordion-summary">
        <span className="flex items-center gap-2">
          <Calendar size={15} />
          <strong>{row.provider}</strong>
          <span className="cell-sub" style={{ margin: 0 }}>{row.accountId}</span>
        </span>
      </summary>
      <div style={{ paddingTop: "14px" }}>
        <p className="cell-sub" style={{ margin: "0 0 14px", lineHeight: 1.5 }}>
          A missing recorded channel does not prove provider absence. Resolve any existing attempts and verify that this exact account has no active Surveynt subscription before queuing creation.
        </p>
        <form action={submit} className="form-grid">
          <label className="field full">
            <span>Enter the exact provider account identifier</span>
            <input name="accountId" maxLength={2048} required placeholder="account_id..." />
          </label>
          <label className="field full">
            <span>Provider absence evidence reference and findings (exclude credentials)</span>
            <textarea name="evidence" minLength={15} maxLength={2000} rows={3} required placeholder="Record audit findings and absence evidence..." />
          </label>
          <div className="field full">
            <label className="checkbox-row">
              <input name="confirmed" type="checkbox" required />
              <span>I verified this account has no active Surveynt provider subscription.</span>
            </label>
          </div>
          <div className="field full action-row">
            <button className="button button-secondary" disabled={busy}>
              {busy ? "Queueing…" : "Queue reviewed registration"}
            </button>
          </div>
        </form>
        {message ? (
          <p className={isSuccess ? "form-success" : "form-error"} role="status" style={{ marginTop: "12px" }}>
            {isSuccess ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{message}</span>
          </p>
        ) : null}
      </div>
    </details>
  );
}
