"use client";
import { createContext, useEffect, useState, type ReactNode } from "react";
import type { SurveyPack } from "@/lib/surveys";
export type EvidenceSource = { key: string; name: string; status: string; coverageNotes: string; guardrail: string; categories: { category: string; status: string; coverage: string; retrievedAt: string; fresh: boolean; evidence: { label: string; url: string }[] }[] };
export type EvidenceContextProps = { surveyId: string; pack: SurveyPack; canEdit: boolean; canJudge: boolean; online: boolean; onChanged: () => Promise<void> };
export const SurveyEvidenceContext = createContext<(EvidenceContextProps & { sources: EvidenceSource[] | null; fieldContexts: Map<string, string[]>; error: string | null; preview: boolean }) | null>(null);
export const sourceStatusLabels: Record<string, string> = { available: "Evidence available", setup_required: "Setup required", unavailable: "Unavailable", not_checked: "Not checked", stale: "Stale — refresh and review", no_record_found: "No record found — absence not established" };
export function SurveyEvidenceProvider({ children, ...props }: EvidenceContextProps & { children: ReactNode }) {
  const [sources, setSources] = useState<EvidenceSource[] | null>(null); const [error, setError] = useState<string | null>(null); const [preview, setPreview] = useState(false);
  const [fieldContexts, setFieldContexts] = useState(new Map<string, string[]>());
  const { surveyId, online, pack } = props;
  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    fetch(`/api/v1/surveys/${surveyId}/evidence`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const payload = await response.json(); if (!response.ok) throw new Error(payload?.error?.message ?? "Source status could not be loaded.");
      setSources(payload.data.sources); setPreview(Boolean(payload.data.preview)); setError(null);
      setFieldContexts(new Map((payload.data.fields ?? []).map((field: { path: string; context?: string[] }) => [field.path, field.context ?? []])));
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Source status could not be loaded."); });
    return () => controller.abort();
  }, [surveyId, online, pack]);
  return <SurveyEvidenceContext value={{ ...props, sources, fieldContexts, error, preview }}>{children}</SurveyEvidenceContext>;
}
