"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function CreditNoteForm({ invoiceId, currency, remainingMinor, remainingVatMinor, creditedMinor, onSaved }: { invoiceId: string; currency: string; remainingMinor: number; remainingVatMinor: number; creditedMinor: number; onSaved: () => void }) {
  const router=useRouter(),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const attempt=useRef<{body:string;id:string}|null>(null);
  async function issue(form:FormData){
    setBusy(true);setMessage("");
    try{
      const fields={amountMinor:Math.round(Number(form.get("amount"))*100),vatMinor:Math.round(Number(form.get("vat"))*100),expectedCreditedMinor:creditedMinor,reason:form.get("reason"),evidence:form.get("evidence"),confirmed:form.get("confirmed")==="on"};
      const body=JSON.stringify(fields);if(attempt.current?.body!==body)attempt.current={body,id:crypto.randomUUID()};
      const response=await fetch(`/api/v1/finance/invoices/${invoiceId}/credits`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...fields,requestId:attempt.current.id})});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error?.message??"Credit note could not be issued.");
      setMessage(`Credit note ${payload.data.number} issued. No funds were transferred.`);onSaved();router.refresh();
    }catch(error){setMessage(error instanceof Error?error.message:"Connection lost. Retry the same request to avoid duplication.");}finally{setBusy(false);}
  }
  return <details><summary>Issue a reviewed credit note</summary><p>Credit notes are immutable. Check the original invoice and VAT before issuing. Any resulting overpayment requires a separate refund.</p><form action={issue} className="form-grid"><label className="field"><span>Total credit ({currency}, including VAT)</span><input name="amount" type="number" min="0.01" max={remainingMinor/100} step="0.01" required/></label><label className="field"><span>VAT included ({currency})</span><input name="vat" type="number" min="0" max={remainingVatMinor/100} step="0.01" required/></label><label className="field"><span>Reason</span><textarea name="reason" required minLength={10} maxLength={2000}/></label><label className="field"><span>Supporting evidence reference</span><textarea name="evidence" required minLength={10} maxLength={2000}/></label><label><input name="confirmed" type="checkbox" required/> I checked the original invoice, credit amount and VAT.</label><button className="button button-primary" disabled={busy||remainingMinor<=0}>{busy?"Issuing…":"Issue credit note"}</button></form><p role="status">{message}</p></details>;
}
