"use client";

import { useState } from "react";
import { CreditCard, LoaderCircle } from "lucide-react";

export function CheckoutButton({ seats }: { seats: number }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function beginCheckout() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seats }) });
      const payload = await response.json() as { data?: { url?: string }; error?: { message?: string } };
      if (!response.ok || !payload.data?.url) throw new Error(payload.error?.message ?? "Checkout is unavailable.");
      window.location.assign(payload.data.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Checkout is unavailable.");
      setLoading(false);
    }
  }
  return <><button className="button button-primary" onClick={beginCheckout} disabled={loading}>{loading ? <LoaderCircle size={16} /> : <CreditCard size={16} />}{loading ? "Opening Stripe…" : "Continue to secure checkout"}</button>{error ? <p role="alert" style={{ color: "#b83847", fontSize: 11 }}>{error}</p> : null}</>;
}
