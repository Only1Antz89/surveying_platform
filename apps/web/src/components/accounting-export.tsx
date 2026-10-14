"use client";
import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { downloadFile } from "@/lib/download";

/** Issued invoices in an accounting package's import layout, until a direct connection is set up. */
export function AccountingExport() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run(form: FormData) {
    const query = new URLSearchParams({ format: String(form.get("format")) });
    for (const key of ["from", "to"]) { const value = String(form.get(key) || ""); if (value) query.set(key, value); }
    setBusy(true); setMessage("");
    try { await downloadFile(`/api/v1/finance/exports/accounting?${query}`, "invoices.csv"); setMessage("Export downloaded. Import it as sales invoices in your accounting package."); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  return <section className="panel">
    <div className="panel-header"><div><h2><FileSpreadsheet size={17} /> Accounting export</h2><p>Issued invoices with line items, VAT codes and due dates, laid out for import. Amounts exclude VAT; the default sales account code is 200.</p></div></div>
    <form action={run} className="panel-body cost-fields">
      <div className="field"><label htmlFor="acct-format">Package</label><select id="acct-format" name="format" className="select" defaultValue="xero"><option value="xero">Xero</option><option value="quickbooks">QuickBooks Online</option></select></div>
      <div className="field"><label htmlFor="acct-from">Issued from</label><input id="acct-from" name="from" type="date" className="input" /></div>
      <div className="field"><label htmlFor="acct-to">Issued before</label><input id="acct-to" name="to" type="date" className="input" /></div>
      <div className="form-actions"><button className="button button-secondary" disabled={busy}>{busy ? "Preparing…" : "Download CSV"}</button></div>
      <p role="status" className="form-help field grow">{message}</p>
    </form>
  </section>;
}
