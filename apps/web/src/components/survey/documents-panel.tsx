"use client";
import {WorkspaceAnchor} from "@/components/workspace-anchor";

import {workspaceFetch} from "@/lib/workspace-request";

import { useState } from "react";
import { ExternalLink, FileText, Upload } from "lucide-react";
import { certificateTypeLabels, type CertificateCheck, type CertificateFacts } from "@surveynt/assistant";
import type { SurveyPack } from "@/lib/surveys";

type DocumentResult = { status: string; reason?: string; asOf?: string; pageCount?: number; facts?: CertificateFacts; checks?: CertificateCheck[] };

const formatDate = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "UTC" });

/**
 * Certificates and guarantees for this survey. Facts are read from the PDF's
 * text layer with page references; they are unverified and change nothing in
 * the form. An expired certificate appears as a discrepancy to resolve.
 */
export function DocumentsPanel({ surveyId, pack, canEdit, online, demo, onChanged }: { surveyId: string; pack: SurveyPack; canEdit: boolean; online: boolean; demo: boolean; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const documents = pack.media.filter((item) => item.kind === "document");

  async function upload(file: File) {
    setBusy(true); setMessage(null);
    const form = new FormData();
    form.set("file", file);
    form.set("metadata", JSON.stringify({ clientGeneratedId: `doc_${crypto.randomUUID().replace(/-/g, "")}` }));
    const response = await workspaceFetch(`/api/v1/surveys/${surveyId}/media`, { method: "POST", body: form });
    const payload = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) return setMessage(payload?.error?.message ?? "The document could not be uploaded.");
    setMessage("Uploaded. Reading the document's text…");
    // Analysis runs after the upload response; refresh once it has had time to finish.
    window.setTimeout(() => void onChanged().then(() => setMessage(null)), 2500);
  }

  if (!documents.length && !canEdit) return null;
  return <section className="panel documents-panel" aria-labelledby="documents-heading">
    <div className="panel-header"><div><h2 id="documents-heading">Certificates and documents</h2><p>Facts are read from each PDF&apos;s text and are unverified. Check the original.</p></div>
      {canEdit ? <label className={`button button-quiet file-button ${!online || demo || busy ? "disabled" : ""}`}><Upload size={14} />{busy ? "Uploading…" : "Add PDF"}<input type="file" accept="application/pdf" className="sr-only" disabled={!online || demo || busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} /></label> : null}
    </div>
    {!online ? <p className="identity-warning intel-inline">Documents need a connection to upload.</p> : null}
    {demo ? <p className="address-demo-label intel-inline">Demo workspace: documents are not uploaded.</p> : null}
    {message ? <p className="form-success identity-message" role="status">{message}</p> : null}
    {documents.length ? <ul className="document-list">{documents.map((item) => {
      const analysis = item.analysis?.result as DocumentResult | undefined;
      const facts = analysis?.facts;
      const row = (label: string, fact: { value: string; span: { page: number } } | null | undefined, date = true) => fact ? <div><dt>{label}</dt><dd>{date ? formatDate(fact.value) : fact.value} <span className="cell-sub">(page {fact.span.page})</span></dd></div> : null;
      return <li key={item.id}>
        <div className="document-head"><FileText size={16} aria-hidden="true" /><strong>{facts?.documentType ? certificateTypeLabels[facts.documentType.value] : item.originalFilename ?? "Document"}</strong>{demo ? null : <WorkspaceAnchor href={`/api/v1/media/${item.id}`} target="_blank" rel="noopener noreferrer">Open original<ExternalLink size={12} aria-hidden="true" /></WorkspaceAnchor>}</div>
        <span className="cell-sub">{item.originalFilename ?? "Uploaded document"} · uploaded {new Date(item.createdAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}</span>
        {!item.analysis ? <span className="cell-sub">Reading the text layer…</span> : null}
        {item.analysis && item.analysis.status !== "completed" ? <span className="cell-sub">{analysis?.reason ?? "This document could not be analysed."}</span> : null}
        {facts ? <dl className="document-facts">
          {row("Reference", facts.reference, false)}
          {row("Inspection date", facts.inspectionDate)}
          {row("Issued", facts.issueDate)}
          {row("Valid until / next due", facts.dueDate)}
        </dl> : null}
        {analysis?.checks?.map((check) => <p key={check.code} className={check.code === "expired" ? "form-error" : "identity-warning"}>{check.title}. {check.detail}</p>)}
        {facts?.limitations.map((note) => <small key={note} className="cell-sub">{note}</small>)}
      </li>;
    })}</ul> : <p className="form-help assistant-empty">No documents yet. Add certificates or guarantees supplied by the client or agent.</p>}
  </section>;
}
