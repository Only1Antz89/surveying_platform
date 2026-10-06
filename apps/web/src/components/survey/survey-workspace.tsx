"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CloudOff, History, RefreshCw, Trash2 } from "lucide-react";
import { serviceLevelLabels, type FieldValue, type InspectionStatus, type SyncOperation, type SyncResult } from "@surveynt/assistant";
import type { SurveyPack } from "@/lib/surveys";
import { newOperationId, offlineStore, type OutboxEntry, type UploadEntry } from "@/lib/offline-store";
import { SurveyElementCard, type EarlierPhotoView, type ElementView, type ObservationView, type PhotoView } from "./survey-element-card";
import type { FieldDisplay } from "./survey-field";
import { AssistantPanel } from "./assistant-panel";
import { SurveyEvidenceProvider } from "./survey-evidence-context";
import { TemplateUpgrade } from "./template-upgrade";
import { CompletionPanel } from "./completion-panel";
import { DocumentsPanel } from "./documents-panel";
import { ReportPanel } from "./report-panel";
import { SharedCasesPanel } from "./shared-cases-panel";

const elementKey = (section: string, element: string, location = "") => `${section}.${element}.${location}`;

function describeValue(value: unknown) {
  const parsed = value as FieldValue | undefined;
  if (!parsed) return "No value";
  return parsed.state === "provided" ? String(parsed.value) : parsed.state.replace(/_/g, " ");
}

export function SurveyWorkspace({ surveyId, canEdit: initialCanEdit, canJudge: initialCanJudge, canApprove }: { surveyId: string; canEdit: boolean; canJudge: boolean; canApprove: boolean }) {
  const [recordingRevoked, setRecordingRevoked] = useState(false);
  const canEdit = initialCanEdit && !recordingRevoked;
  const canJudge = initialCanJudge && !recordingRevoked;
  const [pack, setPack] = useState<SurveyPack | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<OutboxEntry[]>([]);
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [demo, setDemo] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [section, setSection] = useState<string | null>(null);
  const syncingRef = useRef(false);

  const refreshLocal = useCallback(async () => {
    setOutbox(await offlineStore.outbox(surveyId));
    setUploads(await offlineStore.uploads(surveyId));
  }, [surveyId]);

  const fetchPack = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/surveys/${surveyId}`, { cache: "no-store" });
      const payload = await response.json();
      if ([401, 403, 404].includes(response.status)) {
        await offlineStore.clearSurvey(surveyId);
        setPack(null); setRecordingRevoked(true);
        setLoadError(payload?.error?.message ?? "Access changed. The device copy has been removed.");
        return;
      }
      if (!response.ok) { setLoadError(payload?.error?.message ?? "The survey could not be loaded."); return; }
      setPack(payload.data as SurveyPack);
      setDemo(Boolean(payload.meta?.demo));
      setLoadError(null);
      await offlineStore.savePack(surveyId, payload.data);
      setSavedAt(new Date().toISOString());
    } catch {
      // Offline: keep working from the device copy.
    }
  }, [surveyId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = await offlineStore.loadPack<SurveyPack>(surveyId);
      if (!cancelled && local) { setPack(local.pack); setSavedAt(local.savedAt); }
      await refreshLocal();
      await fetchPack();
    })();
    return () => { cancelled = true; };
  }, [surveyId, fetchPack, refreshLocal]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  const sync = useCallback(async () => {
    if (syncingRef.current || !navigator.onLine || recordingRevoked) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      for (const upload of await offlineStore.uploads(surveyId)) {
        if (upload.status === "failed") continue;
        const body = new FormData();
        body.append("file", new File([upload.blob], upload.name, { type: upload.type }));
        body.append("metadata", JSON.stringify({ clientGeneratedId: upload.clientId, capturedAt: upload.capturedAt, captureContext: upload.context }));
        try {
          const response = await fetch(`/api/v1/surveys/${surveyId}/media`, { method: "POST", body });
          if (response.ok) await offlineStore.removeUpload(upload.clientId);
          else {
            const payload = await response.json().catch(() => null);
            if (response.status === 422) await offlineStore.queueUpload({ ...upload, status: "failed", message: payload?.error?.message ?? "Upload rejected." });
            else setNotice(payload?.error?.message ?? "Photos are kept on this device until uploads are available.");
          }
        } catch {
          break;
        }
      }
      const waitingMedia = new Set((await offlineStore.uploads(surveyId)).map((upload) => upload.clientId));
      const ready = (await offlineStore.outbox(surveyId)).filter((entry) => entry.status === "pending" && !(entry.operation.type === "link_evidence" && entry.operation.evidence.type === "media" && waitingMedia.has(entry.operation.evidence.id)));
      for (let index = 0; index < ready.length; index += 50) {
        const batch = ready.slice(index, index + 50);
        const response = await fetch(`/api/v1/surveys/${surveyId}/sync`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operations: batch.map((entry) => entry.operation) }) });
        if (!response.ok) { const payload = await response.json().catch(() => null); if (response.status === 403) setRecordingRevoked(true); setNotice(payload?.error?.message ?? "Changes could not be synced yet. They are safe on this device."); break; }
        const payload = await response.json();
        if (payload.meta?.demo) setNotice("Demo workspace: changes are not saved to a server.");
        for (const result of payload.data.results as SyncResult[]) {
          const entry = batch.find((item) => item.operationId === result.operationId);
          if (!entry) continue;
          if (result.status === "applied" || result.status === "duplicate") await offlineStore.removeOperation(entry.operationId);
          else if (result.status === "conflict") await offlineStore.enqueue({ ...entry, status: "conflict", message: result.message, current: result.current });
          else if (result.status === "rejected") await offlineStore.enqueue({ ...entry, status: "rejected", message: result.message });
        }
      }
      await fetchPack();
    } catch {
      // Network dropped mid-sync; the outbox is intact and retries later.
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      await refreshLocal();
    }
  }, [surveyId, fetchPack, refreshLocal, recordingRevoked]);

  const pendingCount = outbox.filter((entry) => entry.status === "pending").length + uploads.filter((upload) => upload.status === "pending").length;
  useEffect(() => {
    if (!online || !pendingCount) return;
    const timer = window.setTimeout(() => void sync(), 800);
    return () => window.clearTimeout(timer);
  }, [online, pendingCount, sync]);
  useEffect(() => {
    const interval = window.setInterval(() => void sync(), 30_000);
    return () => window.clearInterval(interval);
  }, [sync]);

  /** Saves locally first. A newer unsent edit to the same field or element replaces the older one, keeping the original base. */
  const queue = useCallback(async (operation: SyncOperation) => {
    const existing = await offlineStore.outbox(surveyId);
    for (const entry of existing) {
      if (entry.status !== "pending") continue;
      const sameField = operation.type === "set_field" && entry.operation.type === "set_field" && entry.operation.fieldPath === operation.fieldPath;
      const sameElement = operation.type === "set_element" && entry.operation.type === "set_element" && elementKey(entry.operation.element.sectionKey, entry.operation.element.elementKey, entry.operation.element.locationLabel) === elementKey(operation.element.sectionKey, operation.element.elementKey, operation.element.locationLabel);
      if (sameField && operation.type === "set_field" && entry.operation.type === "set_field") { operation.baseValueId = entry.operation.baseValueId; await offlineStore.removeOperation(entry.operationId); }
      if (sameElement && operation.type === "set_element" && entry.operation.type === "set_element") { operation.baseVersion = entry.operation.baseVersion; await offlineStore.removeOperation(entry.operationId); }
    }
    await offlineStore.enqueue({ operationId: operation.operationId, surveyId, operation, createdAt: new Date().toISOString(), status: "pending" });
    await refreshLocal();
  }, [surveyId, refreshLocal]);

  const values = useMemo(() => new Map((pack?.values ?? []).map((value) => [value.fieldPath, value])), [pack]);
  const elementRows = useMemo(() => new Map((pack?.elements ?? []).map((element) => [elementKey(element.sectionKey, element.elementKey, element.locationLabel), element])), [pack]);

  const fieldDisplay = useCallback((path: string): FieldDisplay => {
    const pending = [...outbox].reverse().find((entry) => entry.status === "pending" && entry.operation.type === "set_field" && entry.operation.fieldPath === path);
    if (pending && pending.operation.type === "set_field") return { value: pending.operation.value, pending: true, origin: "surveyor_entry" };
    const stored = values.get(path);
    return { value: (stored?.value as FieldValue | undefined) ?? null, pending: false, origin: stored?.origin ?? null };
  }, [outbox, values]);

  const elementView = useCallback((sectionKey: string, key: string): ElementView => {
    const row = elementRows.get(elementKey(sectionKey, key));
    const pending = [...outbox].reverse().find((entry) => entry.status === "pending" && entry.operation.type === "set_element" && entry.operation.element.sectionKey === sectionKey && entry.operation.element.elementKey === key && entry.operation.element.locationLabel === "");
    if (pending && pending.operation.type === "set_element") return { serverId: row?.id ?? null, version: row?.version ?? null, inspectionStatus: pending.operation.inspectionStatus, limitationReason: pending.operation.limitationReason, pending: true };
    return { serverId: row?.id ?? null, version: row?.version ?? null, inspectionStatus: (row?.inspectionStatus as InspectionStatus | null) ?? null, limitationReason: row?.limitationReason ?? null, pending: false };
  }, [elementRows, outbox]);

  const photoUrls = useMemo(() => new Map(uploads.map((upload) => [upload.clientId, URL.createObjectURL(upload.blob)])), [uploads]);
  useEffect(() => () => { for (const url of photoUrls.values()) URL.revokeObjectURL(url); }, [photoUrls]);

  if (!pack) return <section className="panel"><div className="empty-state">{loadError ? <><AlertTriangle size={22} /><strong>{loadError}</strong></> : <><RefreshCw size={22} /><strong>Loading survey…</strong><span>If you are offline, open a survey you have already opened on this device.</span></>}</div></section>;

  const attention = outbox.filter((entry) => entry.status !== "pending");
  const openTasks = pack.tasks.filter((task) => task.status === "open" && task.kind === "reinspect");
  const activeSection = pack.template.sections.find((item) => item.key === section) ?? pack.template.sections[0];

  async function resolveConflict(entry: OutboxEntry, keepMine: boolean) {
    await offlineStore.removeOperation(entry.operationId);
    if (keepMine && entry.operation.type === "set_field") await queue({ ...entry.operation, operationId: newOperationId(), baseValueId: (entry.current?.id as string | undefined) ?? null });
    if (keepMine && entry.operation.type === "set_element") await queue({ ...entry.operation, operationId: newOperationId(), baseVersion: (entry.current?.version as number | undefined) ?? null });
    await refreshLocal();
    if (!keepMine) await fetchPack();
  }

  async function removeOfflineCopy() {
    const unsynced = outbox.length + uploads.length;
    if (unsynced && !window.confirm(`${unsynced} change${unsynced === 1 ? "" : "s"} have not synced and will be lost. Remove the offline copy anyway?`)) return;
    await offlineStore.clearSurvey(surveyId);
    navigator.serviceWorker?.controller?.postMessage("clear-offline-shell");
    setNotice("The offline copy was removed from this device.");
    await refreshLocal();
  }

  const syncLabel = !online ? `Offline. ${pendingCount} change${pendingCount === 1 ? "" : "s"} saved on this device.` : syncing ? "Syncing…" : pendingCount ? `${pendingCount} change${pendingCount === 1 ? "" : "s"} waiting to sync` : attention.length ? `${attention.length} change${attention.length === 1 ? "" : "s"} need attention` : "All changes synced";

  return <div className="survey-workspace">
    <header className="page-header"><div><span className="eyebrow">{pack.job.reference} · {serviceLevelLabels[pack.survey.serviceLevel]}</span><h1>{pack.property.line1}</h1><p>{[pack.property.city, pack.property.postcode].filter(Boolean).join(" · ")} · Template {pack.survey.templateKey} {pack.survey.templateVersion}</p></div></header>
    {demo ? <p className="address-demo-label">Demo workspace: representative form, nothing is saved to a server.</p> : null}
    <div className={`sync-bar ${!online ? "offline" : attention.length ? "attention" : ""}`} role="status" aria-live="polite">
      {!online ? <CloudOff size={15} aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" className={syncing ? "spin" : ""} />}
      <span>{syncLabel}</span>
      {savedAt ? <small>Device copy saved {new Date(savedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</small> : null}
      <div className="row-actions"><button type="button" className="button button-quiet" onClick={() => void sync()} disabled={!online || syncing}>Sync now</button><button type="button" className="button button-quiet danger" onClick={() => void removeOfflineCopy()}><Trash2 size={14} />Remove offline copy</button></div>
    </div>
    {notice ? <p className="form-success" role="status">{notice}</p> : null}
    {canEdit && !demo && pack.survey.status === "in_progress" ? <TemplateUpgrade pack={pack} disabled={!online || syncing || outbox.length > 0 || uploads.length > 0} onChanged={fetchPack}/> : null}
    {attention.length ? <section className="panel attention-panel" aria-labelledby="attention-heading"><div className="panel-header"><div><h2 id="attention-heading">Changes needing attention</h2><p>Nothing is overwritten silently. Choose which value to keep.</p></div></div><ul>{attention.map((entry) => <li key={entry.operationId}><strong>{entry.operation.type === "set_field" ? entry.operation.fieldPath : entry.operation.type.replace(/_/g, " ")}</strong><span>{entry.message}</span>{entry.status === "conflict" && entry.operation.type === "set_field" ? <span className="cell-sub">Yours: {describeValue(entry.operation.value)} · Current: {describeValue(entry.current?.value)}</span> : null}<div className="row-actions">{entry.status === "conflict" ? <><button type="button" className="button button-secondary" onClick={() => void resolveConflict(entry, true)}>Keep mine</button><button type="button" className="button button-quiet" onClick={() => void resolveConflict(entry, false)}>Use current</button></> : <button type="button" className="button button-quiet danger" onClick={() => void resolveConflict(entry, false)}>Discard</button>}</div></li>)}</ul></section> : null}
    {openTasks.length ? <section className="panel tasks-panel" aria-labelledby="tasks-heading"><div className="panel-header"><div><h2 id="tasks-heading">Reminders from earlier surveys</h2><p>Historical context only. These are not current findings.</p></div><History size={17} color="#3b82f6" aria-hidden="true" /></div><ul>{openTasks.map((task) => <li key={task.id}><strong>{task.title}</strong><span>{task.detail}</span></li>)}</ul></section> : null}
    <SurveyEvidenceProvider surveyId={surveyId} pack={pack} canEdit={canEdit && pack.survey.status === "in_progress"} canJudge={canJudge} online={online && outbox.length === 0 && uploads.length === 0} onChanged={fetchPack}><div className="survey-layout">

    <div className="survey-main">
    <nav className="workspace-tabs survey-sections" role="tablist" aria-label="Survey sections">
      {pack.template.sections.map((item, index) => <button key={item.key} id={`survey-tab-${item.key}`} type="button" role="tab" tabIndex={item.key === activeSection.key ? 0 : -1} aria-controls="survey-section-panel" aria-selected={item.key === activeSection.key} className={`workspace-tab ${item.key === activeSection.key ? "active" : ""}`} onClick={() => setSection(item.key)} onKeyDown={event => {
        const count = pack.template.sections.length;
        const next = event.key === "ArrowRight" ? (index + 1) % count : event.key === "ArrowLeft" ? (index + count - 1) % count : event.key === "Home" ? 0 : event.key === "End" ? count - 1 : null;
        if (next === null) return;
        event.preventDefault(); setSection(pack.template.sections[next].key);
        document.getElementById(`survey-tab-${pack.template.sections[next].key}`)?.focus();
      }}>{item.label}</button>)}
    </nav>
    <div id="survey-section-panel" role="tabpanel" aria-labelledby={`survey-tab-${activeSection.key}`} tabIndex={0} className="survey-section">
      {activeSection.elements.map((element) => {
        const view = elementView(activeSection.key, element.key);
        // Observations may sit on located rows of the same element (for example "rear elevation").
        const elementRowIds = new Set(pack.elements.filter((row) => row.sectionKey === activeSection.key && row.elementKey === element.key).map((row) => row.id));
        const pendingLinks = (target: { observationId?: string; observationOperationId?: string }) => outbox.filter((entry) => entry.status === "pending" && entry.operation.type === "link_evidence" && entry.operation.target.type === "observation" && ((target.observationId && entry.operation.target.observationId === target.observationId) || (target.observationOperationId && entry.operation.target.observationOperationId === target.observationOperationId))).length;
        const serverObservations: ObservationView[] = pack.observations.filter((observation) => observation.elementId && elementRowIds.has(observation.elementId)).map((observation) => {
          const structured = observation.structured as { measurement?: { value: number; unit: string }; defect?: { nextAction: string } };
          return { key: observation.id, text: observation.text, kind: observation.kind, pending: false, measurement: structured.measurement ?? null, locationLabel: observation.locationLabel, defect: structured.defect ?? null, evidenceCount: pack.evidence.filter((link) => link.targetType === "observation" && link.targetId === observation.id).length + pendingLinks({ observationId: observation.id }) };
        });
        const pendingObservations: ObservationView[] = outbox.flatMap((entry) => entry.status === "pending" && entry.operation.type === "add_observation" && entry.operation.element?.sectionKey === activeSection.key && entry.operation.element.elementKey === element.key ? [{ key: entry.operationId, text: entry.operation.text, kind: entry.operation.kind, pending: true, measurement: entry.operation.measurement ?? null, locationLabel: entry.operation.element.locationLabel || null, defect: entry.operation.defect ?? null, evidenceCount: pendingLinks({ observationOperationId: entry.operationId }) }] : []);
        const linkedMedia = new Set(pack.evidence.filter((link) => link.evidenceType === "media" && link.targetType === "element" && link.targetId === view.serverId).map((link) => link.evidenceId));
        const photos: PhotoView[] = [
          ...pack.media.filter((media) => media.kind === "photo" && linkedMedia.has(media.id)).map((media) => ({ key: media.id, src: demo ? null : `/api/v1/media/${media.id}`, pending: false, label: `Photo of ${element.label}`, quality: media.analysis?.status === "completed" ? ((media.analysis.result as { messages?: string[] }).messages ?? []) : [] })),
          ...uploads.filter((upload) => upload.context.sectionKey === activeSection.key && upload.context.elementKey === element.key).map((upload) => ({ key: upload.clientId, src: photoUrls.get(upload.clientId) ?? null, pending: upload.status === "pending", label: upload.status === "failed" ? `Upload failed: ${upload.message ?? ""}` : `Photo of ${element.label}` })),
        ];
        return <SurveyElementCard
          key={element.key}
          section={activeSection}
          element={element}
          template={pack.template}
          view={view}
          fieldDisplay={fieldDisplay}
          observations={[...serverObservations, ...pendingObservations]}
          photos={photos}
          canEdit={canEdit && pack.survey.status === "in_progress"}
          canJudge={canJudge}
          onElement={(status, reason) => void queue({ type: "set_element", operationId: newOperationId(), element: { sectionKey: activeSection.key, elementKey: element.key, locationLabel: "" }, inspectionStatus: status, limitationReason: reason, baseVersion: view.version })}
          onField={(path, value) => void queue({ type: "set_field", operationId: newOperationId(), fieldPath: path, value, baseValueId: values.get(path)?.id ?? null })}
          onObservation={(input) => void queue({ type: "add_observation", operationId: newOperationId(), element: { sectionKey: activeSection.key, elementKey: element.key, locationLabel: input.locationLabel ?? "" }, kind: input.kind, text: input.text, measurement: input.measurement, defect: input.defect, observedAt: new Date().toISOString() })}
          onLoadEarlier={demo ? undefined : async () => {
            if (!navigator.onLine) return null;
            const response = await fetch(`/api/v1/surveys/${surveyId}/photo-history?section=${activeSection.key}&element=${element.key}`, { cache: "no-store" });
            return response.ok ? ((await response.json()).data as EarlierPhotoView[]) : null;
          }}
          onLinkPhoto={(observationKey, pending, photoKey) => void queue({ type: "link_evidence", operationId: newOperationId(), target: pending ? { type: "observation", observationOperationId: observationKey } : { type: "observation", observationId: observationKey }, evidence: { type: "media", id: photoKey } })}
          onPhoto={(file) => void (async () => {
            const clientId = `media_${crypto.randomUUID().replace(/-/g, "")}`;
            await offlineStore.queueUpload({ clientId, surveyId, blob: file, name: file.name || "photo.jpg", type: file.type || "image/jpeg", capturedAt: new Date().toISOString(), context: { sectionKey: activeSection.key, elementKey: element.key }, status: "pending", createdAt: new Date().toISOString() });
            await queue({ type: "link_evidence", operationId: newOperationId(), target: { type: "element", element: { sectionKey: activeSection.key, elementKey: element.key, locationLabel: "" } }, evidence: { type: "media", id: clientId } });
          })()}
        />;
      })}
    </div>
    </div>
    <aside className="survey-side" aria-label="Checks, suggestions, documents and report">
      <CompletionPanel pack={pack} pendingCount={pendingCount} onGoTo={(sectionKey, elementKey) => { setSection(sectionKey); window.setTimeout(() => document.getElementById(`element-${sectionKey}-${elementKey}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }} />
      <DocumentsPanel surveyId={surveyId} pack={pack} canEdit={canEdit && pack.survey.status === "in_progress"} online={online} demo={demo} onChanged={fetchPack} />
      <AssistantPanel surveyId={surveyId} pack={pack} hideSuggestions sectionKey={activeSection.key} canEdit={canEdit && pack.survey.status === "in_progress"} canJudge={canJudge} online={online && outbox.length === 0 && uploads.length === 0} onChanged={fetchPack} />
      <ReportPanel surveyId={surveyId} canEdit={canEdit} canJudge={canApprove} online={online} demo={demo} onChanged={fetchPack} />
      <SharedCasesPanel pack={pack} sectionKey={activeSection.key} online={online} />
    </aside>
    </div></SurveyEvidenceProvider>
  </div>;
}
