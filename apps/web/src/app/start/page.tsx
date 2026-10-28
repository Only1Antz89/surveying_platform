import { CustomerSetupVisit } from "@/components/customer-setup-visit";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/auth-frame";
import { StartPracticeForm } from "@/components/start-practice-form";
import { isClerkConfigured } from "@/lib/access";

export const metadata = { title: "Set up your practice" };
export default async function StartPage() {
  if (isClerkConfigured() && !(await auth()).userId) redirect("/sign-in?redirect_url=/start");
  return <AuthFrame title="Tell us about your practice" description="We will use this to prepare your workspace and initial service defaults."><CustomerSetupVisit /><StartPracticeForm configured={isClerkConfigured()} /></AuthFrame>;
}
