"use client";

import { useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";

export function QueueActionButton({ endpoint, label }: { endpoint: string; label: string }) {
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  async function run() {
    setState("saving");
    const response = await fetch(endpoint, { method: "POST" });
    if (!response.ok) { setState("error"); return; }
    setState("done");
    window.location.reload();
  }
  return <button className="button button-quiet" onClick={run} disabled={state === "saving" || state === "done"}>{state === "done" ? <CheckCircle2 size={14} /> : <RotateCcw size={14} />}{state === "saving" ? "Queueing…" : state === "error" ? "Retry failed" : state === "done" ? "Queued" : label}</button>;
}
