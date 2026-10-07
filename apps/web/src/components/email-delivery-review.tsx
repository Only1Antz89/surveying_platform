"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Mail } from "lucide-react";

export function EmailDeliveryReview({ jobId, attempts, leaseToken }: { jobId: string; attempts: number; leaseToken: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function review(form: FormData) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/platform/background-jobs/${jobId}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedAttempts: attempts,
          expectedLeaseToken: leaseToken,
          outcome: form.get("outcome"),
          providerMessageId: form.get("providerMessageId") || undefined,
          evidence: form.get("evidence"),
          confirmed: form.get("confirmed") === "on",
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Review could not be saved.");
      setMessage(payload.meta?.persisted === false ? "Preview only: review was not saved." : "Provider review recorded.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection lost. Reload before retrying the review.");
    } finally {
      setBusy(false);
    }
  }

  const isSuccess = message.includes("recorded") || message.includes("Preview only");

  return (
    <details className="accordion-card">
      <summary className="accordion-summary">
        <span className="flex items-center gap-2">
          <Mail size={15} />
          <span>Review provider evidence</span>
        </span>
      </summary>
      <div style={{ paddingTop: "14px" }}>
        <p className="cell-sub" style={{ margin: "0 0 14px", lineHeight: 1.5 }}>
          Check SMTP2GO activity for job {jobId} and attempt {leaseToken ?? "legacy worker"}. A timeout does not prove that delivery was rejected.
        </p>
        <form action={review} className="form-grid">
          <label className="field full">
            <span>Verified provider outcome</span>
            <select name="outcome" className="select" style={{ width: "100%" }}>
              <option value="accepted">Provider accepted the email</option>
              <option value="not_accepted">Provider evidence confirms no acceptance; queue a retry</option>
            </select>
          </label>
          <label className="field full">
            <span>Provider message identifier (required for acceptance)</span>
            <input name="providerMessageId" maxLength={200} placeholder="e.g. msg_01h92k..." />
          </label>
          <label className="field full">
            <span>Provider evidence reference and findings</span>
            <textarea name="evidence" minLength={15} maxLength={2000} rows={3} required placeholder="Log id, recipient server code, bounce reason..." />
          </label>
          <div className="field full">
            <label className="checkbox-row">
              <input name="confirmed" type="checkbox" required />
              <span>I verified this outcome against provider evidence.</span>
            </label>
          </div>
          <div className="field full action-row">
            <button className="button button-secondary" disabled={busy}>
              {busy ? "Recording…" : "Record reviewed outcome"}
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
