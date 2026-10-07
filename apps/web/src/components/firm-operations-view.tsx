import { ManualDepositRegister } from "./manual-deposit-register";
import Link from "next/link";
import { PracticeInsightsView } from "./practice-insights";
import { CalendarDays, CirclePoundSterling, FileCheck2, FolderLock, Map, SearchCheck, TrendingUp, Users } from "lucide-react";
import { PageHeader } from "./page-header";
import type { FirmOperationsData } from "@/lib/firm-operations";
import { DocumentUploader } from "./document-uploader";
import { DocumentArchive } from "./document-archive";
import { DocumentControls } from "./document-controls";
import { OperationsCalendar } from "./operations-calendar";
import { DailyRoutes } from "./daily-routes";
import { QuoteControls,QuoteCreator } from "./quote-controls";
import { InvoiceCreator } from "./invoice-creator";
import { InvoiceActions,SettlementControl } from "./invoice-actions";

type Section = "calendar" | "customers" | "routes" | "finance" | "performance" | "report-templates" | "documents";
const money = (minor: number, currency = "GBP") => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);

const copy: Record<Section, { title: string; description: string; icon: typeof CalendarDays }> = {
  calendar: { title: "Calendar & scheduling", description: "Appointments, availability and external calendar conflicts.", icon: CalendarDays },
  customers: { title: "Customers & quotes", description: "Secure quotes, customer details, acceptance and deposit status.", icon: Users },
  routes: { title: "Fieldwork planner", description: "Plan inspections, review property evidence and preview travel between assigned visits.", icon: Map },
  finance: { title: "Finance & ledger", description: "Invoices, verified payments, refunds and firm liabilities.", icon: CirclePoundSterling },
  performance: { title: "Performance", description: "Conversion, workload and revenue indicators from audited operational records.", icon: TrendingUp },
  "report-templates": { title: "Report templates", description: "Approved wording and report assembly resources used by Surveynt reports.", icon: FileCheck2 },
  documents: { title: "Documents", description: "Retained reports, legal records, retention dates and legal holds.", icon: FolderLock },
};

export function FirmOperationsView({ section, slug, data, canEdit=false,canManage=false }: { section: Section; slug: string; data: FirmOperationsData; canEdit?:boolean;canManage?:boolean }) {
  const heading = copy[section];
  return <main className="page"><PageHeader eyebrow="Firm operations" title={heading.title} description={heading.description} />
    {section==="customers"&&canEdit?<QuoteCreator/>:null}
    {section === "customers" ? <section className="panel"><div className="panel-header"><div><h2>Quote register</h2><p>Customer statements remain unverified until reviewed by a surveyor.</p></div></div>{data.quotes.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Reference</th><th>Customer</th><th>Total</th><th>Status</th><th>Expires & actions</th></tr></thead><tbody>{data.quotes.map((quote) => <tr key={quote.id}><td><strong>{quote.reference}</strong></td><td>{[quote.firstName, quote.lastName].filter(Boolean).join(" ") || quote.email || "Details pending"}</td><td>{money(quote.totalMinor, quote.currency)}</td><td><span className="status-dot blue">{quote.status.replaceAll("_", " ")}</span></td><td>{quote.expiresAt.toLocaleDateString("en-GB")}{canEdit?<QuoteControls quote={quote} slug={slug}/>:null}</td></tr>)}</tbody></table></div> : <Empty icon={SearchCheck} title="No customer quotes" text="Create a staff quote or activate the secure public adviser." />}</section> : null}
    {section === "calendar" ? <OperationsCalendar appointments={data.appointments} slug={slug} canEdit={canEdit} canManage={canManage} /> : null}
    {section === "finance" ? <>{canManage?<><InvoiceCreator/><ManualDepositRegister/></>:null}<section className="metric-grid">{data.totals.currencies.flatMap(row=>[<Metric key={`${row.currency}-receipts`} label={`${row.currency} net verified receipts`} value={money(row.receipts,row.currency)} />,<Metric key={`${row.currency}-outstanding`} label={`${row.currency} outstanding`} value={money(row.outstanding,row.currency)} />,<Metric key={`${row.currency}-invoices`} label={`${row.currency} invoices`} value={String(row.invoices)} />])}</section><section className="panel"><div className="panel-header"><div><h2>Invoice ledger</h2><p>Verified receipts less refunds; each invoice appears once.</p></div>{canManage?<div className="action-row"><a className="button button-secondary" href="/api/v1/finance/exports?dataset=invoices">Export invoices</a><a className="button button-secondary" href="/api/v1/finance/exports?dataset=payments">Export payments</a><a className="button button-secondary" href="/api/v1/finance/exports?dataset=credits">Export credit notes</a><a className="button button-secondary" href="/api/v1/finance/exports?dataset=reconciliation">Export reconciliation</a></div>:null}</div>{data.finance.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Invoice</th><th>Total</th><th>Received</th><th>Outstanding</th><th>Status & actions</th></tr></thead><tbody>{data.finance.map(({ invoice, creditedMinor, payments,paidMinor,outstandingMinor }) => <tr key={invoice.id}><td><strong>{invoice.number}</strong></td><td>{money(invoice.totalMinor, invoice.currency)}{creditedMinor>0?<span className="cell-sub">Credit notes: {money(creditedMinor,invoice.currency)}</span>:null}</td><td>{money(paidMinor,invoice.currency)}</td><td>{money(outstandingMinor,invoice.currency)}</td><td>{invoice.status}<InvoiceActions id={invoice.id} status={invoice.status} currency={invoice.currency} payments={payments} canManage={canManage}/></td></tr>)}</tbody></table></div> : <Empty icon={CirclePoundSterling} title="No financial records" text="Invoices and verified client payments will appear here." />}</section>{canManage?<SettlementControl/>:null}</> : null}
    {section === "performance" ? <PracticeInsightsView/> : null}
    {section === "routes" ? <DailyRoutes slug={slug}/> : null}
    {section === "report-templates" ? <section className="panel"><Empty icon={FileCheck2} title="Templates use the existing report engine" text="Manage approved clauses in the wording library; assembled report versions retain their approvals and evidence." /><div className="panel-body"><Link className="button button-primary" href={`/app/${slug}/wording`}>Open wording library</Link></div></section> : null}
    {section === "documents" ? <section className="panel"><div className="panel-header"><div><h2>Protected document register</h2><p>Checksummed private originals with retention and legal-hold controls.</p></div></div>{canManage ? <><DocumentUploader /><DocumentArchive /></> : null}{data.documents.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Name</th><th>Category</th><th>Size</th><th>Protection</th></tr></thead><tbody>{data.documents.map((document) => <tr key={document.id}><td><a href={`/api/v1/documents/${document.id}`}><strong>{document.name}</strong></a><span className="cell-sub">SHA-256 {document.checksum.slice(0, 12)}…</span></td><td>{document.category.replaceAll("_", " ")}</td><td>{Math.ceil(document.sizeBytes / 1024)} KB</td><td>{document.legalHold ? "Legal hold" : document.retentionUntil ? `Retain to ${document.retentionUntil.toLocaleDateString("en-GB")}` : "Practice policy"}{canManage ? <DocumentControls id={document.id} checksum={document.checksum} category={document.category} accessClass={document.accessClass} retentionUntil={document.retentionUntil?.toISOString() ?? null} legalHold={document.legalHold} /> : null}</td></tr>)}</tbody></table></div> : <Empty icon={FolderLock} title="No retained documents" text="Survey evidence remains in its existing media store." />}</section> : null}
  </main>;
}

function Empty({ icon: Icon, title, text }: { icon: typeof CalendarDays; title: string; text: string }) { return <div className="empty-state"><Icon size={28} color="#3b82f6" /><strong>{title}</strong><span>{text}</span></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><div className="metric-head"><span>{label}</span></div><div className="metric-value">{value}</div></div>; }
