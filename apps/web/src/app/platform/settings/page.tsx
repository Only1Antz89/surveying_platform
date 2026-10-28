import Link from "next/link";
import { ShieldCheck, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/page-header";
export const metadata = { title: "Platform settings" };
export default function Page() {
  return (
    <main className="page">
      <PageHeader
        title="Platform settings"
        description="Platform policy and operational administration."
      />
      <div className="toolbar">
        <Link className="button button-secondary" href="/platform/users">
          Manage platform users
        </Link>
        <Link className="button button-secondary" href="/platform/integrations">
          Manage integrations
        </Link>
      </div>
      <div className="stack">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Trial and access policy</h2>
              <p>
                Policy changes are deployed through reviewed configuration
                rather than edited in the production browser.
              </p>
            </div>
            <SlidersHorizontal size={17} color="#3b82f6" />
          </div>
          <dl className="detail-grid">
            <div className="detail">
              <dt>Trial length</dt>
              <dd>14 calendar days</dd>
            </div>
            <div className="detail">
              <dt>Payment grace period</dt>
              <dd>7 calendar days</dd>
            </div>
            <div className="detail">
              <dt>Support session maximum</dt>
              <dd>60 minutes</dd>
            </div>
            <div className="detail">
              <dt>Break-glass maximum</dt>
              <dd>15 minutes</dd>
            </div>
            <div className="detail">
              <dt>Payment method</dt>
              <dd>Required before trial access</dd>
            </div>
            <div className="detail">
              <dt>Professional issue</dt>
              <dd>Named human approval required</dd>
            </div>
          </dl>
          <div className="form-section">
            <div className="support-banner">
              <ShieldCheck />
              These values are read-only in production. Changes require code
              review, automated checks and a new deployment.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
