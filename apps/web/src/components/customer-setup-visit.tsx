"use client";
import { useEffect } from "react";
/** No form contents, page paths or user identifiers are sent from the browser. */
export function CustomerSetupVisit({
  workspace = false,
}: {
  workspace?: boolean;
}) {
  useEffect(() => {
    void fetch(
      workspace ? "/api/onboarding/workspace-visit" : "/api/onboarding/visit",
      { method: "POST" },
    ).catch(() => undefined);
  }, [workspace]);
  return null;
}
