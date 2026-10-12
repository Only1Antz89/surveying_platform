"use client";
import {workspaceFetch} from "@/lib/workspace-request";

import { useState } from "react";
import { ExternalLink, LoaderCircle } from "lucide-react";

export function BillingPortalButton({ disabled }: { disabled: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPortal() {
    setLoading(true);
    setError(null);
    const response = await workspaceFetch("/api/billing/portal", { method: "POST" });
    const payload = await response.json();
    setLoading(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? "The billing portal could not be opened.");
      return;
    }
    window.location.assign(payload.data.url);
  }

  return <div className="billing-action"><button className="button button-primary" onClick={openPortal} disabled={disabled || loading}>{loading ? <LoaderCircle size={15} /> : <ExternalLink size={15} />}{loading ? "Opening…" : "Manage in Stripe"}</button>{error ? <p className="form-error" role="alert">{error}</p> : null}</div>;
}
