"use client";
/* eslint-disable @next/next/no-img-element -- shared photos are in-memory blob URLs from authenticated requests, which next/image cannot optimise. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { CalendarDays, Check, Download, FileBadge2, FileSignature, FileText, Images, Mail, Phone, Play, Receipt, ShieldCheck, X } from "lucide-react";
import { PropertyArtwork } from "./property-artwork";
import { workspaceFetch } from "@/lib/workspace-request";
import type { PortalDocument, PortalFile, PortalView } from "@/lib/client-portal-model";

type ReportContent = { title: string; sections: { key: string; title: string; blocks: { id: string; text: string }[]; elements: { key: string; title: string; blocks: { id: string; text: string }[] }[] }[]; ratingSummary: { rating: string; label: string; elements: { key: string; title: string }[] }[]; recommendations: { id: string; text: string }[] };
const money = (minor: number, currency: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
const day = (value: string, timeZone = "Europe/London") => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone });
const dateTime = (value: string, timeZone: string) => new Date(value).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone });
const documentIcon = (kind: PortalDocument["kind"]) => kind === "report" ? FileText : kind === "contract" ? FileSignature : Receipt;
const invoiceStatus: Record<string, string> = { open: "Due", part_paid: "Part paid", paid: "Paid", overdue: "Overdue" };

/** The client's branded portal: progress, documents, photos, certificates and invoices for one survey. */
export function ClientPortal({ id }: { id: string }) {
  const [token, setToken] = useState("");
  const [via, setVia] = useState<"portal" | "quote">("portal");
  const [view, setView] = useState<PortalView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<ReportContent | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<PortalFile | null>(null);
  const created = useRef<string[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const mode = new URLSearchParams(location.search).get("via") === "quote" ? "quote" : "portal";
      const key = `surveynt:portal:${mode}:${id}`;
      const value = decodeURIComponent(location.hash.slice(1)) || (() => { try { return sessionStorage.getItem(key) ?? ""; } catch { return ""; } })();
      setVia(mode);
      if (id === "demo") { setToken("demo"); return; }
      if (!value) { setError("Open the complete link from your email. It ends with a long security code."); return; }
      try { sessionStorage.setItem(key, value); } catch { /* private browsing */ }
      history.replaceState(null, "", location.pathname + location.search);
      setToken(value);
    }, 0);
    return () => clearTimeout(timer);
  }, [id]);

  const request = useCallback((path: string) => workspaceFetch(`/api/v1/portal/${id}${path}${path.includes("?") ? "&" : "?"}via=${via}`, { headers: { "x-portal-token": token } }), [id, token, via]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    request("").then(async (response) => { const payload = await response.json(); if (!response.ok) throw Error(payload.error?.message ?? "Your portal is unavailable."); if (active) setView(payload.data); }).catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [token, request]);

  // Shared images are fetched with the portal credential and shown from memory, never from a guessable URL.
  useEffect(() => {
    if (!view || view.demo) return;
    let active = true;
    for (const file of view.files.filter((item) => item.category === "photo").slice(0, 60)) {
      request(`/files/${file.id}`).then(async (response) => { if (!response.ok || !active) return; const url = URL.createObjectURL(await response.blob()); created.current.push(url); setPreviews((value) => ({ ...value, [file.id]: url })); }).catch(() => undefined);
    }
    return () => { active = false; };
  }, [view, request]);
  useEffect(() => () => { for (const url of created.current) URL.revokeObjectURL(url); }, []);

  const photos = useMemo(() => view?.files.filter((file) => file.category === "photo" || file.category === "video") ?? [], [view]);
  const papers = useMemo(() => view?.files.filter((file) => file.category === "certificate" || file.category === "document") ?? [], [view]);
  const accent = view?.brand.accent ?? "#2f5fc4";

  async function save(path: string, fallback: string, label: string) {
    if (view?.demo) { setNotice("This is a demonstration with fictional records, so no file is produced."); return; }
    setBusy(label); setNotice("");
    try {
      const response = await request(path);
      if (!response.ok) { const payload = await response.json().catch(() => null); throw Error(payload?.error?.message ?? "This file could not be produced."); }
      const name = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? fallback;
      const href = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = href; link.download = name; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (reason) { setNotice((reason as Error).message); } finally { setBusy(null); }
  }
  async function openFile(file: PortalFile) {
    if (file.category === "photo" || file.category === "video") {
      if (!view?.demo && file.category === "video" && !previews[file.id]) { setBusy(file.id); const response = await request(`/files/${file.id}`); if (response.ok) { const url = URL.createObjectURL(await response.blob()); created.current.push(url); setPreviews((value) => ({ ...value, [file.id]: url })); } setBusy(null); }
      setOpen(file); return;
    }
    await save(`/files/${file.id}?download=1`, file.title, file.id);
  }
  async function readReport() {
    setBusy("report"); setNotice("");
    try { const response = await request("/report"); const payload = await response.json(); if (!response.ok) throw Error(payload.error?.message ?? "The report is not available yet."); setReport(payload.data.content); setTimeout(() => document.getElementById("portal-report")?.focus(), 50); }
    catch (reason) { setNotice((reason as Error).message); } finally { setBusy(null); }
  }

  if (!view) return <main className="portal" style={{ ["--portal-accent" as string]: accent }}><div className="portal-wrap portal-loading"><ShieldCheck size={28} /><h1>{error ? "Portal link unavailable" : "Opening your secure portal…"}</h1><p role={error ? "alert" : "status"}>{error || "Checking your link."}</p></div></main>;

  const current = view.progress.find((step) => step.state === "current") ?? [...view.progress].reverse().find((step) => step.state === "done");
  const reportReady = view.documents.some((doc) => doc.key === "rics_report" && doc.available);
  const hero = photos.find((file) => file.category === "photo" && (previews[file.id] || file.previewSrc));

  return <main className="portal" style={{ ["--portal-accent" as string]: accent }}>
    <header className="portal-bar"><div className="portal-wrap portal-bar-inner">
      {view.brand.logoUrl ? <Image src={view.brand.logoUrl} width={40} height={40} alt="" unoptimized className="portal-logo" /> : <span className="portal-mark" aria-hidden="true">{view.brand.name.slice(0, 1)}</span>}
      <div className="portal-brand"><strong>{view.brand.name}</strong><span>Client portal</span></div>
      <div className="portal-contact">{view.brand.phone ? <a href={`tel:${view.brand.phone.replace(/\s/g, "")}`}><Phone size={14} />{view.brand.phone}</a> : null}{view.brand.email ? <a href={`mailto:${view.brand.email}`}><Mail size={14} />{view.brand.email}</a> : null}</div>
    </div></header>

    <div className="portal-wrap portal-body">
      {view.demo ? <p className="portal-demo">Demonstration with fictional records. Photos shown are illustrations.</p> : null}
      {notice ? <p className="portal-notice" role="status">{notice}</p> : null}

      <section className="portal-hero" aria-labelledby="portal-address">
        <div className="portal-hero-art"><PropertyArtwork propertyType={view.property.propertyType} /></div>
        <div className="portal-hero-text">
          <span className="portal-eyebrow">{view.job.reference} · {view.job.service}</span>
          <h1 id="portal-address">{view.property.address}</h1>
          {current ? <p className="portal-status"><span className="portal-status-dot" aria-hidden="true" />{current.label}</p> : null}
          {view.appointment ? <p className="portal-meta"><CalendarDays size={16} />{new Date(view.appointment.startsAt) > new Date() ? "Visit on " : "Visited "}{dateTime(view.appointment.startsAt, view.timezone)}</p> : <p className="portal-meta"><CalendarDays size={16} />Visit not booked yet</p>}
          {hero ? <figure className="portal-hero-photo"><img src={previews[hero.id] ?? hero.previewSrc} alt={hero.title} /><figcaption>{view.demo ? "Illustration · " : "From your survey · "}{hero.title}</figcaption></figure> : null}
          {reportReady ? <button type="button" className="portal-button" disabled={busy === "report"} onClick={() => void readReport()}><FileText size={16} />Read your report</button> : null}
        </div>
      </section>

      <section className="portal-card" aria-labelledby="portal-progress"><h2 id="portal-progress">Progress</h2>
        <ol className="portal-steps">{view.progress.map((step) => <li key={step.stage} className={step.state} aria-current={step.state === "current" ? "step" : undefined}>
          <span className="portal-step-dot" aria-hidden="true">{step.state === "done" ? <Check size={13} /> : null}</span>
          <div><strong>{step.label}</strong><span>{step.reachedAt ? day(step.reachedAt, view.timezone) : step.state === "current" ? "In progress" : step.detail}</span></div>
        </li>)}</ol>
      </section>

      <section className="portal-card" aria-labelledby="portal-documents"><h2 id="portal-documents">Documents</h2>
        <div className="portal-docs">{view.documents.map((doc) => { const Icon = documentIcon(doc.kind); return <article key={doc.key} className={doc.available ? "" : "pending"}>
          <Icon size={20} aria-hidden="true" /><div><h3>{doc.title}</h3><p>{doc.available ? doc.description : doc.reason}</p></div>
          {doc.available ? <button type="button" className="portal-button secondary" disabled={busy === doc.key} onClick={() => void save(`/documents/${doc.key}`, `${doc.key}.pdf`, doc.key)}><Download size={15} />{busy === doc.key ? "Preparing…" : "Download"}</button> : null}
        </article>; })}</div>
        {view.reportAccessExpiresAt ? <p className="portal-small">Online access to your reports is available until {day(view.reportAccessExpiresAt, view.timezone)}. Download a copy to keep.</p> : null}
      </section>

      {report ? <section className="portal-card portal-report" id="portal-report" tabIndex={-1} aria-labelledby="portal-report-title">
        <div className="portal-report-head"><h2 id="portal-report-title">{report.title}</h2><button type="button" className="portal-icon" aria-label="Close report" onClick={() => setReport(null)}><X size={18} /></button></div>
        {report.ratingSummary.length ? <div className="portal-ratings">{report.ratingSummary.map((group) => <div key={group.rating}><strong>{group.label}</strong><span>{group.elements.map((element) => element.title).join(", ")}</span></div>)}</div> : null}
        {report.sections.map((section) => section.blocks.length || section.elements.length ? <section key={section.key}><h3>{section.title}</h3>{section.blocks.map((block) => <p key={block.id}>{block.text}</p>)}{section.elements.map((element) => <div key={element.key}><h4>{element.title}</h4>{element.blocks.map((block) => <p key={block.id}>{block.text}</p>)}</div>)}</section> : null)}
        {report.recommendations.length ? <section><h3>Recommendations</h3>{report.recommendations.map((block) => <p key={block.id}>{block.text}</p>)}</section> : null}
      </section> : null}

      <section className="portal-card" aria-labelledby="portal-media"><h2 id="portal-media"><Images size={18} />Photos and media</h2>
        {photos.length ? <div className="portal-gallery">{photos.map((file) => <button type="button" key={file.id} onClick={() => void openFile(file)} aria-label={`Open ${file.title}`}>
          {file.category === "video" ? <span className="portal-video"><Play size={26} /></span> : previews[file.id] || file.previewSrc ? <img src={previews[file.id] ?? file.previewSrc} alt="" /> : <span className="portal-thumb-loading" />}
          <span>{file.title}</span>
        </button>)}</div> : <p className="portal-empty">Your surveyor will share photos here when they are ready.</p>}
      </section>

      <div className="portal-columns">
        <section className="portal-card" aria-labelledby="portal-certificates"><h2 id="portal-certificates"><FileBadge2 size={18} />Certificates and files</h2>
          {papers.length ? <ul className="portal-list">{papers.map((file) => <li key={file.id}><div><strong>{file.title}</strong><span>{file.category === "certificate" ? "Certificate" : "Document"} · shared {day(file.sharedAt, view.timezone)}</span></div><button type="button" className="portal-button secondary" disabled={busy === file.id} onClick={() => void openFile(file)}><Download size={15} />Download</button></li>)}</ul> : <p className="portal-empty">Certificates and guarantees the practice shares appear here.</p>}
        </section>
        <section className="portal-card" aria-labelledby="portal-invoices"><h2 id="portal-invoices"><Receipt size={18} />Invoices</h2>
          {view.invoices.length ? <ul className="portal-list">{view.invoices.map((invoice) => <li key={invoice.id}><div><strong>{invoice.number} · {money(invoice.totalMinor, invoice.currency)}</strong><span className="portal-invoice-meta"><span className={`portal-pill ${invoice.status}`}>{invoiceStatus[invoice.status] ?? invoice.status}</span>{invoice.dueAt && invoice.status !== "paid" ? <span>Due {day(invoice.dueAt, view.timezone)}</span> : null}</span></div><button type="button" className="portal-button secondary" disabled={busy === invoice.id} onClick={() => void save(`/documents/invoice:${invoice.id}`, `${invoice.number}.pdf`, invoice.id)}><Download size={15} />PDF</button></li>)}</ul> : <p className="portal-empty">No invoices have been issued.</p>}
          {view.quoteLink && view.invoices.some((invoice) => invoice.status !== "paid") ? <p className="portal-small">Pay outstanding balances from <a href={`/quote/${id}`}>your quote page</a>.</p> : null}
        </section>
      </div>

      {view.information.length ? <section className="portal-card" aria-labelledby="portal-information"><h2 id="portal-information">About the property</h2>
        <dl className="portal-facts">{view.information.map((item, index) => <div key={index}><dt>{item.label}</dt><dd>{item.value}</dd><small>{item.source}{item.retrievedAt ? ` · ${day(item.retrievedAt, view.timezone)}` : ""}</small></div>)}</dl>
      </section> : null}

      {view.terms.required && !view.terms.signed ? <section className="portal-card portal-action"><FileSignature size={20} /><div><h2>Please sign your terms of engagement</h2><p>{view.quoteLink ? <>Sign them on <a href={`/quote/${id}`}>your quote page</a> before your visit.</> : "Your surveyor will send you the terms to sign."}</p></div></section> : null}

      <footer className="portal-footer"><ShieldCheck size={15} /><span>This is a private link for your survey. Do not forward it. {view.brand.address ? `${view.brand.name}, ${view.brand.address}.` : ""}</span></footer>
    </div>

    {open ? <div className="portal-lightbox" role="dialog" aria-modal="true" aria-label={open.title} onClick={() => setOpen(null)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(null); }}>
      <figure onClick={(event) => event.stopPropagation()}>
        {open.category === "video" ? (previews[open.id] ? <video src={previews[open.id]} controls autoPlay /> : <p>Loading video…</p>) : <img src={previews[open.id] ?? open.previewSrc} alt={open.title} />}
        <figcaption><span>{view.demo ? "Illustration · " : ""}{open.title}</span><span className="portal-lightbox-actions">{!view.demo ? <button type="button" className="portal-button secondary" onClick={() => void save(`/files/${open.id}?download=1`, open.title, open.id)}><Download size={15} />Save</button> : null}<button type="button" className="portal-button secondary" autoFocus onClick={() => setOpen(null)}><X size={15} />Close</button></span></figcaption>
      </figure>
    </div> : null}
  </main>;
}
