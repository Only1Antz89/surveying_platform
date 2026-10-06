"use client";
import { useEffect, useState } from "react";
import { websiteFormSchema, type FormContext } from "@/lib/website-form-config";
import { WebsiteCustomerForm } from "./website-customer-form";
export function WebsiteFormPreview({ initial }: { initial: FormContext }) {
  const [config, setConfig] = useState(initial.config);
  const [mode, setMode] = useState("configured");
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent || event.data?.type !== "surveynt:preview") return;
      const parsed = websiteFormSchema.safeParse(event.data.config); if (parsed.success) setConfig(parsed.data);
      if (["configured", "quote", "enquiry", "unavailable"].includes(event.data.mode)) setMode(event.data.mode);
    };
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "surveynt:preview-ready" }, window.location.origin);
    return () => window.removeEventListener("message", receive);
  }, []);
  return <WebsiteCustomerForm context={{ ...initial, config, quotesReady: mode === "quote" || mode === "configured" && initial.quotesReady }} preview previewUnavailable={mode === "unavailable"}/>;
}
