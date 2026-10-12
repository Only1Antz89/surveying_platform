"use client";
import {workspaceFetch} from "@/lib/workspace-request";

import { useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";

export function QueueActionButton({ endpoint, label }: { endpoint: string; label: string }) {
  const [state, setState] = useState<"idle" | "saving" | "done" | "review" | "error">("idle");
  async function run() {
    setState("saving");
    try {
      const response = await workspaceFetch(endpoint, { method: "POST" });
      if (!response.ok) { setState("error"); return; }
      const payload = await response.json().catch(() => null);
      setState(payload?.meta?.verificationRequired ? "review" : "done");
      window.location.reload();
    } catch { setState("error"); }

  }
  return <button className="button button-quiet" onClick={run} disabled={state === "saving" || state === "done" || state === "review"}>{state === "done" ? <CheckCircle2 size={14} /> : <RotateCcw size={14} />}{state === "saving" ? "Queueing…" : state === "error" ? "Retry failed" : state === "done" ? "Queued" : state === "review" ? "Review required" : label}</button>;
}
