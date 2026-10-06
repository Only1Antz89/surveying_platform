"use client";
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { applyAppearance, defaultAppearance, type Appearance } from "@/lib/appearance";
const Context = createContext<{value:Appearance;update:(value:Partial<Appearance>)=>void}>({ value: defaultAppearance, update: () => {} });
export const useAppearance = () => useContext(Context);
const subscribeSystemTheme = (notify: () => void) => { const media = matchMedia("(prefers-color-scheme: dark)"); media.addEventListener("change", notify); return () => media.removeEventListener("change", notify); };
export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [value, setValue] = useState(defaultAppearance);
  const systemDark = useSyncExternalStore(subscribeSystemTheme, () => matchMedia("(prefers-color-scheme: dark)").matches, () => false);
  const dark = value.theme === "dark" || (value.theme === "system" && systemDark);
  const update = useCallback((next: Partial<Appearance>) => setValue((current) => { const result = { ...current, ...next }; applyAppearance(result); localStorage.setItem("surveynt:appearance", JSON.stringify(result)); return result; }), []);
  useEffect(() => {
    Promise.resolve().then(()=>{try { update(JSON.parse(localStorage.getItem("surveynt:appearance") ?? "{}")); } catch { applyAppearance(defaultAppearance); }});
    const media = matchMedia("(prefers-color-scheme: dark)"); const changed = () => setValue((current) => { applyAppearance(current); return current; }); media.addEventListener("change", changed);
    fetch("/api/v1/me", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((p) => { if (p?.data?.appearance && !p.data.preview) update(p.data.appearance); }).catch(() => undefined);
    return () => media.removeEventListener("change", changed);
  }, [update]);
  const content = <Context.Provider value={{ value, update }}>{children}</Context.Provider>;
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <ClerkProvider appearance={{ variables: { colorPrimary: "#2563eb", colorForeground: dark ? "#f1f5f9" : "#0f172a", colorBackground: dark ? "#111e30" : "#ffffff", colorMutedForeground: dark ? "#cbd5e1" : "#64748b", colorBorder: "#64748b", borderRadius: "8px", fontFamily: "var(--font-geist-sans)" } }}>{content}</ClerkProvider> : content;
}
