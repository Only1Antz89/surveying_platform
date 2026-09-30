import { ShieldCheck, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Platform settings" };

export default function Page() {
  return <main className="page"><PageHeader eyebrow="Platform operations" title="Platform settings" description="Review the operational security policy currently enforced by the application." /><section className="panel"><div className="panel-header"><div><h2>Trial and access policy</h2><p>Policy changes are deployed through reviewed configuration rather than edited in the production browser.</p></div><SlidersHorizontal size={17} color="#2563eb" /></div><dl className="detail-grid"><div className="detail"><dt>Trial length</dt><dd>14 calendar days</dd></div><div className="detail"><dt>Payment grace period</dt><dd>7 calendar days</dd></div><div className="detail"><dt>Support session maximum</dt><dd>60 minutes</dd></div><div className="detail"><dt>Break-glass maximum</dt><dd>15 minutes</dd></div><div className="detail"><dt>Payment method</dt><dd>Required before trial access</dd></div><div className="detail"><dt>Professional issue</dt><dd>Named human approval required</dd></div></dl><div className="form-section"><div className="support-banner"><ShieldCheck />These values are read-only in production. Changes require code review, automated checks and a new deployment.</div></div></section></main>;
}
