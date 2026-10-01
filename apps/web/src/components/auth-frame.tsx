import { BrandMark } from "@surveynt/ui";

export function AuthFrame({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <main className="auth-page"><section className="auth-story"><BrandMark /><div><h1>Survey intelligence, from site to report.</h1><p>Connect your people, properties and projects in one clear place.</p></div><div className="auth-proof"><div><strong>14 days</strong><span>Full trial access</span></div><div><strong>UK-first</strong><span>Built for surveying firms</span></div><div><strong>MFA</strong><span>Required by default</span></div></div></section><section className="auth-form"><div className="auth-card"><div className="auth-form-brand"><BrandMark variant="primary" /></div><h2>{title}</h2><p>{description}</p>{children}</div></section></main>;
}
