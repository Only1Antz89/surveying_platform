"use client";
import {workspaceFetch} from "@/lib/workspace-request";
import { useRef, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useAppearance } from "./appearance-provider";
import { nextTheme } from "@/lib/appearance";
const modes = {
  system: { label: "System", icon: Monitor },
  light: { label: "Light", icon: Sun },
  dark: { label: "Dark", icon: Moon },
};
export function ThemeCycleButton() {
  const { value, update } = useAppearance();
  const [status, setStatus] = useState("");
  const saves = useRef<Promise<void>>(Promise.resolve());
  const current = modes[value.theme], next = modes[nextTheme(value.theme)];
  const Icon = current.icon;
  function cycle() {
    const theme = nextTheme(value.theme), appearance = { ...value, theme };
    update({ theme });
    setStatus(`${modes[theme].label} theme selected.`);
    // Keep rapid clicks in order without delaying the visible theme change.
    saves.current = saves.current.then(async () => {
      try {
        const response = await workspaceFetch("/api/v1/me", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ appearance }) });
        if (!response.ok) throw new Error("Preference save failed");
      } catch {
        setStatus("Theme saved on this device. Account synchronisation is currently unavailable.");
      }
    });
  }
  return <><button type="button" className="nav-link sidebar-theme" aria-label={`Theme: ${current.label}. Switch to ${next.label}.`} title={`Switch to ${next.label} theme`} onClick={cycle}><Icon aria-hidden="true"/><span>{current.label} theme</span></button><span className="sr-only" role="status">{status}</span></>;
}
