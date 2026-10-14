"use client";
import { useState } from "react";
import { Mail } from "lucide-react";
import { downloadFile } from "@/lib/download";

const starters: Record<string, { subject: string; body: string }> = {
  blank: { subject: "", body: "" },
  access: { subject: "Arranging access for your survey", body: "Thank you for instructing us.\n\nTo complete the inspection we will need access to all rooms, the loft hatch, and any outbuildings. Please let us know if any areas will be locked or occupied on the day.\n\nIf the property is tenanted, please ask the occupier to expect our surveyor." },
  delay: { subject: "Update on your report", body: "We are writing to let you know that your report is taking a little longer than planned.\n\nWe expect to send it to you shortly and will contact you as soon as it is ready. Please get in touch if you have any questions in the meantime." },
  further: { subject: "Further investigations recommended", body: "Following our inspection, we recommend obtaining further advice on the matters listed in section J of your report before you commit to the purchase.\n\nPlease contact us if you would like help arranging this." },
};

/** Letters on practice letterhead, produced as a PDF for the user to send. Nothing is sent from here. */
export function LetterPanel({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function produce(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try { await downloadFile(`/api/v1/jobs/${jobId}/letters`, "letter.pdf", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject, body, recipient: "client" }) }); setMessage("Letter downloaded. Send it from your usual email or post."); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  return <section className="panel">
    <div className="panel-header"><div><h2><Mail size={17} /> Letters</h2><p>Write to the client on your practice letterhead. You download the letter and send it yourself.</p></div>{!open ? <button type="button" className="button button-secondary" onClick={() => setOpen(true)}>Write a letter</button> : null}</div>
    {open ? <form className="panel-body stack" onSubmit={produce}>
      <div className="field"><label htmlFor="letter-starter">Start from</label><select id="letter-starter" className="select" defaultValue="blank" onChange={(event) => { const starter = starters[event.target.value]; setSubject(starter.subject); setBody(starter.body); }}><option value="blank">A blank letter</option><option value="access">Arranging access</option><option value="delay">Report delay</option><option value="further">Further investigations</option></select></div>
      <div className="field"><label htmlFor="letter-subject">Subject</label><input id="letter-subject" className="input" required minLength={3} maxLength={160} value={subject} onChange={(event) => setSubject(event.target.value)} /></div>
      <div className="field"><label htmlFor="letter-body">Letter</label><textarea id="letter-body" className="input" required minLength={10} maxLength={12000} rows={9} value={body} onChange={(event) => setBody(event.target.value)} /><span className="form-help">The date, client name, property and your reference are added automatically.</span></div>
      <div className="form-actions"><button type="button" className="button button-quiet" onClick={() => setOpen(false)}>Close</button><button className="button button-primary" disabled={busy}>{busy ? "Preparing…" : "Download letter PDF"}</button></div>
      <p role="status" className="form-help">{message}</p>
    </form> : null}
  </section>;
}
