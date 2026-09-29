import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { AuthFrame } from "@/components/auth-frame";

export const metadata = { title: "Sign in" };
export default function SignInPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  return <AuthFrame title="Welcome back" description="Sign in securely to continue to your practice workspace.">{configured ? <SignIn /> : <div className="auth-fields"><div className="field"><label htmlFor="email">Work email</label><input id="email" className="input" type="email" defaultValue="maya@northstarsurveying.co.uk" /></div><div className="field"><label htmlFor="password">Password</label><input id="password" className="input" type="password" defaultValue="fieldnote-demo" /></div><Link className="button button-primary" href="/app/north-star-surveying/overview">Open demo workspace</Link><p className="legal">Demo authentication is local only. Configure Clerk to enable verified accounts and MFA.</p></div>}</AuthFrame>;
}
