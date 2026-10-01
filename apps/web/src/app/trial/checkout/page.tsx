import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Check, ShieldCheck } from "lucide-react";
import { AuthFrame } from "@/components/auth-frame";
import { CheckoutButton } from "@/components/checkout-button";
import { isClerkConfigured } from "@/lib/access";

export const metadata = { title: "Confirm your trial" };
export default async function TrialCheckoutPage({ searchParams }: { searchParams: Promise<{ seats?: string }> }) {
  if (isClerkConfigured() && !(await auth()).userId) redirect("/sign-in?redirect_url=/trial/checkout");
  const params = await searchParams;
  const requestedSeats = Number(params.seats ?? 5);
  const seats = Number.isInteger(requestedSeats) ? Math.min(250, Math.max(1, requestedSeats)) : 5;
  const trialEnd = new Date();
  trialEnd.setUTCDate(trialEnd.getUTCDate() + 14);
  const trialEndLabel = trialEnd.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
  return <AuthFrame title="Confirm your 14-day trial" description="Add a payment method today. You will not be charged until the trial ends."><div className="panel" style={{ boxShadow: "none", marginBottom: 18 }}><div className="form-section"><div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20 }}><div><strong>Practice plan</strong><span className="cell-sub">Base workspace + {seats} seats</span></div><strong style={{ textAlign: "right" }}>Price confirmed in Stripe</strong></div></div><div className="form-section"><div style={{ display: "grid", gap: 10, color: "#435269", fontSize: 12 }}><span><Check size={14} color="#15825e" style={{ verticalAlign: "middle", marginRight: 8 }} />Full operational workspace after webhook activation</span><span><Check size={14} color="#15825e" style={{ verticalAlign: "middle", marginRight: 8 }} />Cancel before {trialEndLabel} and pay nothing</span><span><ShieldCheck size={14} color="#3b82f6" style={{ verticalAlign: "middle", marginRight: 8 }} />Payment details handled securely by Stripe</span></div></div></div><CheckoutButton seats={seats} /><p className="legal">Workspace access activates only after a verified Stripe webhook confirms the trial.</p></AuthFrame>;
}
