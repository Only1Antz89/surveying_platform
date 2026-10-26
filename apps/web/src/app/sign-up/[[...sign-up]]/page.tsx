import { shareMetadata } from "@/lib/share-metadata";
import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
import { AuthFrame } from "@/components/auth-frame";

const description = "Start a Surveynt trial for your surveying practice: quotes, bookings, fieldwork and reports in one place.";
export const metadata = { title: "Start a trial", description, ...shareMetadata("/sign-up", "Start a trial · Surveynt", description) };
export default function SignUpPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  return <AuthFrame title="Start your Surveynt trial" description="Create your account, then set up your practice and payment method.">{configured ? <SignUp /> : <div className="auth-fields"><div className="field"><label htmlFor="name">Your name</label><input id="name" className="input" defaultValue="Maya Patel" /></div><div className="field"><label htmlFor="email">Work email</label><input id="email" className="input" type="email" placeholder="you@practice.co.uk" /></div><Link className="button button-primary" href="/start">Continue</Link><p className="legal">By continuing you agree to the Surveynt terms and privacy policy.</p></div>}</AuthFrame>;
}
