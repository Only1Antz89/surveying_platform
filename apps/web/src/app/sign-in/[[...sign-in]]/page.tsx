import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { AuthFrame } from "@/components/auth-frame";

export const metadata = { title: "Sign in" };
export default function SignInPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  return <AuthFrame title="Welcome back" description="Sign in securely to continue to your practice workspace.">{configured ? <SignIn fallbackRedirectUrl="/" /> : <div className="auth-fields"><h2>Local design preview</h2><p>This preview uses fictional records and does not authenticate users or persist practice changes. No password is required.</p><Link className="button button-primary" href="/app/north-star-surveying/overview">Open local preview</Link><p className="legal">Connect Clerk to access the private, persistent stakeholder demo and verified accounts.</p></div>}</AuthFrame>;
}
