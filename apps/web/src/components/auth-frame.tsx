import { BrandMark } from "@fieldnote/ui";

export function AuthFrame({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <main className="auth-page"><section className="auth-story"><BrandMark /><div><h1>Run your surveying practice from one clear place.</h1><p>FIELDNOTE connects clients, properties, jobs, your team and professional controls without losing the detail that matters.</p></div><div className="auth-proof"><div><strong>14 days</strong><span>Full trial access</span></div><div><strong>UK-first</strong><span>Built for surveying firms</span></div><div><strong>MFA</strong><span>Required by default</span></div></div></section><section className="auth-form"><div className="auth-card"><h2>{title}</h2><p>{description}</p>{children}</div></section></main>;
}
