"use client";
import {workspaceFetch} from "@/lib/workspace-request";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, CreditCard } from "lucide-react";

export function ManualPaymentForm({ invoiceId, paymentId, quote, maximumMinor, currency, onSaved }: { invoiceId?: string; paymentId?: string; quote?: { id: string; version: number }; maximumMinor: number; currency: string; onSaved?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const attempt = useRef<{ body: string; id: string } | null>(null);

  async function verify(form: FormData) {
    setBusy(true);
    setMessage("");
    try {
      const amountMinor = Math.round(Number(form.get("amount")) * 100);
      if (!Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor > maximumMinor) {
        throw new Error("Choose an amount within the remaining balance.");
      }
      const fields = {
        ...(quote ? { version: quote.version } : {}),
        amountMinor,
        ...(paymentId ? {} : { expectedOutstandingMinor: maximumMinor }),
        method: form.get("method"),
        reference: form.get("reference"),
        evidence: form.get("evidence"),
        occurredAt: new Date(String(form.get("occurredAt"))).toISOString(),
        confirmed: form.get("confirmed") === "on",
      };
      const body = JSON.stringify(fields);
      if (attempt.current?.body !== body) attempt.current = { body, id: crypto.randomUUID() };
      const url = quote ? `/api/v1/quotes/${quote.id}/manual-deposit` : paymentId ? `/api/v1/finance/payments/${paymentId}/manual-refund` : `/api/v1/finance/invoices/${invoiceId}/manual-payments`;
      const response = await workspaceFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...fields, requestId: attempt.current.id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Verification failed.");
      setMessage(payload.meta?.jobId ? "Deposit verified and job instructed. No funds were transferred by Surveynt." : "External transaction verified and audited. No funds were transferred by Surveynt.");
      onSaved?.();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection lost. Retry the same verification to avoid duplication.");
    } finally {
      setBusy(false);
    }
  }

  const title = quote ? "Verify an external deposit" : paymentId ? "Verify an externally completed refund" : "Verify a manual payment";
  const isSuccess = message.includes("verified");

  return (
    <details className="accordion-card">
      <summary className="accordion-summary">
        <span className="flex items-center gap-2">
          <CreditCard size={15} />
          <span>{title}</span>
        </span>
      </summary>
      <div style={{ paddingTop: "14px" }}>
        <p className="cell-sub" style={{ margin: "0 0 8px", lineHeight: 1.5 }}>
          Check the bank statement or receipt before confirming. This records evidence of a completed transaction.
        </p>
        {quote ? (
          <p className="cell-sub" style={{ margin: "0 0 14px", lineHeight: 1.5 }}>
            Partial receipts reduce the required deposit. The job is instructed when verified receipts cover it in full.
          </p>
        ) : null}
        <form action={verify} className="form-grid">
          <label className="field">
            <span>Amount ({currency})</span>
            <input name="amount" type="number" min="0.01" max={maximumMinor / 100} step="0.01" required placeholder="0.00" />
          </label>
          <label className="field">
            <span>Method</span>
            <select name="method" className="select" style={{ width: "100%" }}>
              <option value="bank_transfer">Bank transfer</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cleared cheque</option>
              <option value="external_card">External card processor</option>
            </select>
          </label>
          <label className="field">
            <span>Completed at (device timezone)</span>
            <input name="occurredAt" type="datetime-local" required />
          </label>
          <label className="field">
            <span>External transaction reference</span>
            <input name="reference" required minLength={3} maxLength={120} placeholder="e.g. BACS-88421" />
          </label>
          <label className="field full">
            <span>Verification evidence reference and note</span>
            <textarea name="evidence" required minLength={10} maxLength={2000} rows={3} placeholder="Statement date, line reference or audit note..." />
          </label>
          <div className="field full">
            <label className="checkbox-row">
              <input name="confirmed" type="checkbox" required />
              <span>I checked evidence that this transaction has completed.</span>
            </label>
          </div>
          <div className="field full action-row">
            <button className="button button-primary" disabled={busy || maximumMinor <= 0}>
              {busy ? "Verifying…" : "Record verified transaction"}
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
