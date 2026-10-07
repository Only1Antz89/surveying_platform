"use client";
import { useState } from "react";
import { emailTemplatesSchema, fillQuoteTemplate, quoteTemplateDefaults, type EmailTemplates } from "@/lib/email-template-settings";

export function EmailTemplateEditor({initial,canEdit}:{initial:EmailTemplates;canEdit:boolean}) {
  const [saved,setSaved] = useState(initial);
  const [value,setValue] = useState(initial.customer_quote_issued ?? quoteTemplateDefaults);
  const [confirmed,setConfirmed] = useState(false);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const example = {customerName:"Alex Customer",organisationName:"Example Surveyors",quoteReference:"QUO-123",total:"£450.00"};
  async function save(reset=false) {
    const templates = reset ? {} : {customer_quote_issued:value};
    const valid = emailTemplatesSchema.safeParse(templates);
    if (!valid.success) {setMessage(valid.error.issues[0]?.message ?? "Check the template.");return;}
    setBusy(true);setMessage("");
    try {
      const response = await fetch("/api/v1/operations/email-templates",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({expected:saved,templates:valid.data,confirmed})});
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Template could not be saved.");
      if (payload.meta?.persisted === false) {setMessage("Preview only: template was not saved.");return;}
      setSaved(payload.data);setValue(payload.data.customer_quote_issued ?? quoteTemplateDefaults);setConfirmed(false);setMessage(reset?"Default quote template restored.":"Quote template saved.");
    } catch (error) {setMessage(error instanceof Error?error.message:"Template could not be saved.");}
    finally {setBusy(false);}
  }
  return <section className="panel form-section"><h2>Quote email template</h2><p>Use {"{{customerName}}, {{organisationName}}, {{quoteReference}} and {{total}}"}. The quote total, expiry and secure link are included below your introduction. Changes apply when queued emails are delivered.</p><label className="field"><span>Subject</span><input maxLength={160} value={value.subject} disabled={!canEdit||busy} onChange={event=>{setValue({...value,subject:event.target.value});setConfirmed(false);}}/></label><label className="field"><span>Introduction</span><textarea maxLength={1500} value={value.introduction} disabled={!canEdit||busy} onChange={event=>{setValue({...value,introduction:event.target.value});setConfirmed(false);}}/></label><h3>Example preview</h3><p>{fillQuoteTemplate(value.subject,example)}</p><p style={{whiteSpace:"pre-wrap"}}>{fillQuoteTemplate(value.introduction,example)}</p>{canEdit?<><label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/> I reviewed this template and confirm the change.</label><div className="form-actions"><button type="button" className="button button-primary" disabled={busy||!confirmed} onClick={()=>void save()}>Save template</button><button type="button" className="button" disabled={busy||!confirmed} onClick={()=>void save(true)}>Restore default template</button></div></>:null}<p role="status">{message}</p></section>;
}
