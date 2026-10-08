import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { AccountSettings } from "@/components/account-settings";
import { isClerkConfigured } from "@/lib/access";
export default async function Page(){if(isClerkConfigured()&&!(await auth()).userId)redirect("/sign-in");return <AccountSettings/>;}
