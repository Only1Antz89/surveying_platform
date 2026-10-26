import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { AccountSettings } from "@/components/account-settings";
import { isClerkConfigured } from "@/lib/access";
export default async function Page({searchParams}:PageProps<"/account">){if(isClerkConfigured()&&!(await auth()).userId)redirect("/sign-in");return <AccountSettings twoStepRequired={(await searchParams)["two-step"]==="required"}/>;}

export const metadata = { title: "Your account" };
