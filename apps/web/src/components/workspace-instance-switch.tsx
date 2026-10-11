"use client";
import { workspaceFetch } from "@/lib/workspace-request";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  availableWorkspaces,
  rememberedWorkspaceHref,
  workspaceLabels,
  type WorkspaceMode,
} from "@/lib/workspace-mode";
import { usePendingWorkspaceSaves, useWorkspace } from "./workspace-provider";
import { confirmDiscardChanges } from "./unsaved-changes";
import {
  Briefcase,
  Check,
  ChevronRight,
  Loader2,
  ScanLine,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

const workspaceIcons: Record<WorkspaceMode, LucideIcon> = {
  administration: ShieldCheck,
  manager: Briefcase,
  surveyor: ScanLine,
};

const workspaceDescriptions: Record<WorkspaceMode, string> = {
  administration: "Practice configuration, team & billing",
  manager: "Fieldwork, jobs & operational oversight",
  surveyor: "Assigned surveys, evidence & routes",
};

export function WorkspaceInstanceSwitch() {
  const context = useWorkspace();
  const saving = usePendingWorkspaceSaves();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [targetMode, setTargetMode] = useState<WorkspaceMode | null>(null);
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!context) return null;
  const modes = availableWorkspaces(context.actorRole);
  if (!modes.length) return null;

  const currentMode = context.workspaceMode;
  const CurrentIcon = workspaceIcons[currentMode] ?? Briefcase;

  async function change(mode: WorkspaceMode) {
    if (!context || saving || pending || confirming) return;
    if (mode === context.workspaceMode) {
      setOpen(false);
      return;
    }
    setError("");
    setTargetMode(mode);
    setConfirming(true);
    try {
      if (!(await confirmDiscardChanges())) {
        setConfirming(false);
        setTargetMode(null);
        return;
      }
      const key = `surveynt:instance:${context.userId}:${context.organisationId}:${mode}`;
      let remembered: string | null = null;
      try {
        remembered = sessionStorage.getItem(key);
      } catch {}
      const next = rememberedWorkspaceHref(remembered, { ...context, workspaceMode: mode });
      const response = await workspaceFetch(
        `/api/v1/workspaces/${mode}/workspace-navigation?href=${encodeURIComponent(next)}`,
        { cache: "no-store", headers: { "x-demo-organisation-slug": context.slug } },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Workspace unavailable.");
      setOpen(false);
      startTransition(() => router.push(payload.data.href));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not switch workspace. Try again.");
    } finally {
      setConfirming(false);
      setTargetMode(null);
    }
  }

  const statusText = saving
    ? "Finish saving before switching."
    : pending
      ? "Switching workspace…"
      : confirming
        ? "Checking workspace access…"
        : null;

  return (
    <div ref={containerRef} className="workspace-switcher-control">
      <button
        ref={triggerRef}
        type="button"
        className="nav-link sidebar-theme workspace-switch-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Current workspace: ${workspaceLabels[currentMode]}. Switch workspace.`}
        title={`Current workspace: ${workspaceLabels[currentMode]}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <CurrentIcon aria-hidden="true" size={17} />
        <span className="workspace-switch-trigger-text">{workspaceLabels[currentMode]}</span>
        <ChevronRight
          size={15}
          aria-hidden="true"
          className={`workspace-switch-chevron ${open ? "open" : ""}`}
        />
      </button>

      {open ? (
        <div className="workspace-flyout" role="listbox" aria-label="Available workspaces">
          <div className="workspace-flyout-header">
            <span>Workspaces</span>
            <span className="workspace-flyout-badge">This tab</span>
          </div>

          <div className="workspace-options-list">
            {modes.map((mode) => {
              const Icon = workspaceIcons[mode] ?? Briefcase;
              const isSelected = mode === currentMode;
              const isTargetLoading = targetMode === mode && (pending || confirming);
              return (
                <button
                  key={mode}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={Boolean(saving) || pending || confirming}
                  className={`workspace-option-item ${isSelected ? "active" : ""}`}
                  onClick={() => void change(mode)}
                >
                  <span className="workspace-option-icon">
                    <Icon size={16} />
                  </span>
                  <span className="workspace-option-info">
                    <strong className="workspace-option-title">{workspaceLabels[mode]}</strong>
                    <small className="workspace-option-desc">{workspaceDescriptions[mode]}</small>
                  </span>
                  {isSelected ? (
                    <Check size={16} className="workspace-option-check" aria-label="Current" />
                  ) : isTargetLoading ? (
                    <Loader2 size={16} className="workspace-option-spinner" aria-label="Loading" />
                  ) : null}
                </button>
              );
            })}
          </div>

          {statusText ? (
            <div className="workspace-flyout-status" role="status">
              {statusText}
            </div>
          ) : null}

          {error ? (
            <div className="workspace-flyout-error form-error" role="alert">
              {error}
            </div>
          ) : null}

          <div className="workspace-flyout-footer">
            <small>Same account · tab-isolated switch</small>
          </div>
        </div>
      ) : null}
    </div>
  );
}
