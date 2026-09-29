import { CreditCard, ExternalLink } from "lucide-react";
import { StatusDot } from "@fieldnote/ui";
import { ActionButton } from "@/components/action-feedback";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Billing" };
export default function BillingPage() { return <main className="page"><PageHeader title="Billing" description="Your FIELDNOTE subscription, payment method and invoice history." /><div className="dashboard-grid"><section className="panel"><div className="form-section"><h2>Practice plan</h2><p>Base workspace plus five active seats.</p><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}><div><div className="metric-value">£149<span style={{ fontSize: 12, color: "#627086", fontWeight: 500 }}> / month</span></div><StatusDot tone="blue">14-day trial · 11 days remaining</StatusDot></div><ActionButton className="button button-primary" message="Stripe billing portal would open in production"><ExternalLink size={15} />Manage in Stripe</ActionButton></div></div></section><aside className="panel"><div className="panel-header"><h2>Payment method</h2><CreditCard size={17} color="#2563eb" /></div><div className="panel-body"><strong>Visa ending 4242</strong><span className="cell-sub">Expires 10/29 · Default</span></div></aside></div></main>; }
