"use client";
import { useState } from "react";
import { ManualPaymentForm } from "./manual-payment-form";
type Deposit = { id: string; version: number; reference: string; firstName: string | null; lastName: string | null; currency: string; depositMinor: number; outstandingMinor: number; expiresAt: string; pendingCheckout: boolean };

export function ManualDepositRegister() {
  const [rows,setRows] = useState<Deposit[] | null>(null), [offset,setOffset] = useState(0), [next,setNext] = useState<number | null>(null), [busy,setBusy] = useState(false), [message,setMessage] = useState("");
  async function load(page = offset) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/v1/finance/deposits?offset=${page}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Deposit register unavailable.");
      setRows(payload.data); setOffset(page); setNext(payload.meta.nextOffset);
    } catch (error) { setRows(null); setMessage(error instanceof Error ? error.message : "Connection lost. Try loading the register again."); }
    finally { setBusy(false); }
  }
  const money = (amount: number,currency: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount/100);
  return <section className="panel action-panel"><h2>External quote deposits</h2><p>Review accepted quotes before recording completed deposits. Customer statements remain unverified.</p><button className="button button-secondary" disabled={busy} onClick={() => void load()}>{busy ? "Loading…" : "Review accepted quotes"}</button>{rows ? rows.length ? rows.map(row => <div key={`${row.id}:${row.version}:${row.outstandingMinor}`}><h3>{row.reference} · {[row.firstName,row.lastName].filter(Boolean).join(" ") || "Customer"}</h3><p>Required deposit {money(row.depositMinor,row.currency)} · Remaining {money(row.outstandingMinor,row.currency)} · Expires {new Date(row.expiresAt).toLocaleString("en-GB")}</p>{row.pendingCheckout ? <p>Online Checkout is pending. Resolve it before verifying an external receipt.</p> : <ManualPaymentForm quote={{id:row.id,version:row.version}} maximumMinor={row.outstandingMinor} currency={row.currency} onSaved={() => void load()}/>}</div>) : <p>No current accepted quotes on this page.</p> : null}{rows ? <div className="action-row"><button className="button button-quiet" disabled={busy || offset === 0} onClick={() => void load(Math.max(0,offset-25))}>Previous</button><button className="button button-quiet" disabled={busy || next === null} onClick={() => next !== null && void load(next)}>Next</button></div> : null}<p role="status">{message}</p></section>;
}
