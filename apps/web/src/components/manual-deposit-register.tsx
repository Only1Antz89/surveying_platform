"use client";
import {workspaceFetch} from "@/lib/workspace-request";
import { useState } from "react";
import { ManualPaymentForm } from "./manual-payment-form";
import { AlertCircle, AlertTriangle, Calendar, CheckCircle2, ChevronLeft, ChevronRight, Coins } from "lucide-react";
import { StatusDot } from "@surveynt/ui";

type Deposit = {
  id: string;
  version: number;
  reference: string;
  firstName: string | null;
  lastName: string | null;
  currency: string;
  depositMinor: number;
  outstandingMinor: number;
  expiresAt: string;
  pendingCheckout: boolean;
};

export function ManualDepositRegister() {
  const [rows, setRows] = useState<Deposit[] | null>(null);
  const [offset, setOffset] = useState(0);
  const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load(page = offset) {
    setBusy(true);
    setMessage("");
    try {
      const response = await workspaceFetch(`/api/v1/finance/deposits?offset=${page}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Deposit register unavailable.");
      setRows(payload.data);
      setOffset(page);
      setNext(payload.meta.nextOffset);
    } catch (error) {
      setRows(null);
      setMessage(error instanceof Error ? error.message : "Connection lost. Try loading the register again.");
    } finally {
      setBusy(false);
    }
  }

  const money = (amount: number, currency: string) =>
    new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount / 100);

  return (
    <section className="panel action-panel">
      <div className="flex items-center justify-between gap-4" style={{ marginBottom: "16px" }}>
        <div>
          <h2 className="flex items-center gap-2" style={{ margin: "0 0 4px", fontSize: "1.05rem" }}>
            <Coins size={18} className="text-blue" />
            <span>External quote deposits</span>
          </h2>
          <p className="cell-sub" style={{ margin: 0 }}>
            Review accepted quotes before recording completed deposits. Customer statements remain unverified.
          </p>
        </div>
        <button className="button button-secondary" disabled={busy} onClick={() => void load()}>
          {busy ? "Loading…" : "Review accepted quotes"}
        </button>
      </div>

      {message ? (
        <p className="form-error" role="status">
          <AlertCircle size={15} />
          <span>{message}</span>
        </p>
      ) : null}

      {rows ? (
        rows.length ? (
          <div style={{ display: "grid", gap: "12px", marginTop: "16px" }}>
            {rows.map((row) => (
              <article className="deposit-item" key={`${row.id}:${row.version}:${row.outstandingMinor}`}>
                <div className="deposit-header">
                  <div className="flex items-center gap-3">
                    <strong>{row.reference}</strong>
                    <StatusDot tone="blue">
                      {[row.firstName, row.lastName].filter(Boolean).join(" ") || "Customer"}
                    </StatusDot>
                  </div>
                  <div className="deposit-meta">
                    <span>
                      Required deposit: <strong>{money(row.depositMinor, row.currency)}</strong>
                    </span>
                    <span>
                      Remaining: <strong>{money(row.outstandingMinor, row.currency)}</strong>
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar size={13} />
                      <span>Expires {new Date(row.expiresAt).toLocaleString("en-GB")}</span>
                    </span>
                  </div>
                </div>

                {row.pendingCheckout ? (
                  <div className="support-banner">
                    <AlertTriangle size={15} />
                    <span>Online Checkout is pending. Resolve it before verifying an external receipt.</span>
                  </div>
                ) : (
                  <ManualPaymentForm
                    quote={{ id: row.id, version: row.version }}
                    maximumMinor={row.outstandingMinor}
                    currency={row.currency}
                    onSaved={() => void load()}
                  />
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state compact">
            <CheckCircle2 size={24} color="#15825e" />
            <strong>No accepted quotes awaiting verification</strong>
            <span>All accepted quote deposits on this page are clear.</span>
          </div>
        )
      ) : null}

      {rows && (offset > 0 || next !== null) ? (
        <div className="action-row" style={{ marginTop: "16px" }}>
          <button
            className="button button-quiet"
            disabled={busy || offset === 0}
            onClick={() => void load(Math.max(0, offset - 25))}
          >
            <ChevronLeft size={14} />
            <span>Previous</span>
          </button>
          <button
            className="button button-quiet"
            disabled={busy || next === null}
            onClick={() => next !== null && void load(next)}
          >
            <span>Next</span>
            <ChevronRight size={14} />
          </button>
        </div>
      ) : null}
    </section>
  );
}
