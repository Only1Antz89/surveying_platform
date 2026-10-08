"use client";
import {workspaceFetch} from "@/lib/workspace-request";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, FileText } from "lucide-react";

export function CreditNoteForm({ invoiceId, currency, remainingMinor, remainingVatMinor, creditedMinor, onSaved }: { invoiceId: string; currency: string; remainingMinor: number; remainingVatMinor: number; creditedMinor: number; onSaved: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const attempt = useRef<{ body: string; id: string } | null>(null);

  async function issue(form: FormData) {
    setBusy(true);
    setMessage("");
    try {
      const fields = {
        amountMinor: Math.round(Number(form.get("amount")) * 100),
        vatMinor: Math.round(Number(form.get("vat")) * 100),
        expectedCreditedMinor: creditedMinor,
        reason: form.get("reason"),
        evidence: form.get("evidence"),
        confirmed: form.get("confirmed") === "on",
      };
      const body = JSON.stringify(fields);
      if (attempt.current?.body !== body) attempt.current = { body, id: crypto.randomUUID() };
      const response = await workspaceFetch(`/api/v1/finance/invoices/${invoiceId}/credits`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...fields, requestId: attempt.current.id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Credit note could not be issued.");
      setMessage(`Credit note ${payload.data.number} issued. No funds were transferred.`);
      onSaved();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection lost. Retry the same request to avoid duplication.");
    } finally {
      setBusy(false);
    }
  }

  const isSuccess = message.includes("issued");

  return (
    <details className="accordion-card">
      <summary className="accordion-summary">
        <span className="flex items-center gap-2">
          <FileText size={15} />
          <span>Issue a reviewed credit note</span>
        </span>
      </summary>
      <div style={{ paddingTop: "14px" }}>
        <p className="cell-sub" style={{ margin: "0 0 14px", lineHeight: 1.5 }}>
          Credit notes are immutable. Check the original invoice and VAT before issuing. Any resulting overpayment requires a separate refund.
        </p>
        <form action={issue} className="form-grid">
          <label className="field">
            <span>Total credit ({currency}, including VAT)</span>
            <input name="amount" type="number" min="0.01" max={remainingMinor / 100} step="0.01" required placeholder="0.00" />
          </label>
          <label className="field">
            <span>VAT included ({currency})</span>
            <input name="vat" type="number" min="0" max={remainingVatMinor / 100} step="0.01" required placeholder="0.00" />
          </label>
          <label className="field full">
            <span>Reason</span>
            <textarea name="reason" required minLength={10} maxLength={2000} rows={3} placeholder="Provide audit reason for issuing this credit note..." />
          </label>
          <label className="field full">
            <span>Supporting evidence reference</span>
            <textarea name="evidence" required minLength={10} maxLength={2000} rows={2} placeholder="Reference document, customer correspondence or ticket..." />
          </label>
          <div className="field full">
            <label className="checkbox-row">
              <input name="confirmed" type="checkbox" required />
              <span>I checked the original invoice, credit amount and VAT.</span>
            </label>
          </div>
          <div className="field full action-row">
            <button className="button button-primary" disabled={busy || remainingMinor <= 0}>
              {busy ? "Issuing…" : "Issue credit note"}
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
