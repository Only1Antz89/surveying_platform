"use client";
import { useEffect, useState } from "react";
import type { FormContext } from "@/lib/website-form-config";
import { WebsiteCustomerForm } from "./website-customer-form";
export function WebsiteFormEntry({ slug }: { slug: string }) {
  const [form, setForm] = useState<FormContext | null>(null), [error, setError] = useState("");
  useEffect(() => { let active = true; fetch(`/api/v1/public/website-form/${encodeURIComponent(slug)}`, { cache: "no-store" }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error?.message ?? "Form unavailable."); if (active) setForm(data.data); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Form unavailable."); }); return () => { active = false; }; }, [slug]);
  return form ? <WebsiteCustomerForm context={form}/> : <main className="website-form"><h1>Survey enquiry</h1><p role="status">{error || "Loading the practice’s form…"}</p>{error ? <p>Please contact the practice directly. No information has been submitted.</p> : null}</main>;
}
