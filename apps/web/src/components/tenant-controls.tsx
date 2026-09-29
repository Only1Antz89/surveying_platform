"use client";

import { useState } from "react";
import { Ban, CheckCircle2, LogIn, Mail, ShieldCheck } from "lucide-react";

export function TenantControls() {
  const [suspended, setSuspended] = useState(false);
  const [support, setSupport] = useState(false);
  return <>
    {support ? <div className="support-banner" style={{ margin: "0 0 20px" }}><ShieldCheck />Read-only support session active for 59 minutes. Ticket FN-2841. Every resource view is being recorded.</div> : null}
    <div className="admin-actions" style={{ padding: 0, border: 0 }}>
      <button className="button button-primary" onClick={() => setSupport(true)}><LogIn size={15} />{support ? "Session active" : "Open support session"}</button>
      <button className="button button-secondary" onClick={() => setSuspended((value) => !value)}>{suspended ? <CheckCircle2 size={15} /> : <Ban size={15} />}{suspended ? "Reactivate tenant" : "Suspend tenant"}</button>
      <button className="button button-secondary"><Mail size={15} />Resend owner invite</button>
      <button className="button button-secondary">Change plan</button>
    </div>
    {suspended ? <div className="toast" role="status"><Ban size={15} />Tenant suspended. The action was added to the audit log.</div> : null}
  </>;
}
