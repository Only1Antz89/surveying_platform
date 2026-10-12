"use client";
import {workspaceFetch} from "@/lib/workspace-request";

import { type FormEvent, useState } from "react";
import { BookOpenCheck, CheckCircle2, FilePlus2, Plus, Power, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { StatusDot } from "@surveynt/ui";
import type { PracticePackRecord } from "@/lib/data";
import { PageHeader } from "./page-header";

const summary = (definition: Record<string, unknown>) => typeof definition.summary === "string" ? definition.summary : "No summary recorded.";
const requirements = (value: FormDataEntryValue | null) => String(value || "").split("\n").map((item) => item.trim()).filter(Boolean);

export function PracticePackManager({ packs, canManage }: { packs: PracticePackRecord[]; canManage: boolean }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [versioning, setVersioning] = useState<PracticePackRecord | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function request(url: string, method: "POST" | "PATCH", body: unknown) {
    setError(null);
    const response = await workspaceFetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message ?? "The practice-pack change could not be completed.");
    router.refresh();
    return payload.data;
  }

  async function createPack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWorkingId("create");
    const formElement = event.currentTarget; const form = new FormData(formElement);
    try {
      await request("/api/platform/practice-packs", "POST", { key: form.get("key"), name: form.get("name"), discipline: form.get("discipline"), version: form.get("version"), summary: form.get("summary"), requirements: requirements(form.get("requirements")) });
      setCreating(false); formElement.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The practice pack could not be created."); }
    finally { setWorkingId(null); }
  }

  async function createVersion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!versioning) return;
    setWorkingId(versioning.id);
    const form = new FormData(event.currentTarget);
    try {
      await request(`/api/platform/practice-packs/${versioning.id}/versions`, "POST", { version: form.get("version"), summary: form.get("summary"), requirements: requirements(form.get("requirements")) });
      setVersioning(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The new version could not be created."); }
    finally { setWorkingId(null); }
  }

  async function togglePack(pack: PracticePackRecord) {
    setWorkingId(pack.id);
    try { await request(`/api/platform/practice-packs/${pack.id}`, "PATCH", { active: !pack.active }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The pack status could not be changed."); }
    finally { setWorkingId(null); }
  }

  async function publish(packId: string, versionId: string) {
    setWorkingId(versionId);
    try { await request(`/api/platform/practice-packs/${packId}/versions/${versionId}`, "PATCH", { status: "published" }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The version could not be published."); }
    finally { setWorkingId(null); }
  }

  return <main className="page"><PageHeader eyebrow="Platform operations" title="Practice packs" description="Manage the versioned surveying workflows firms can enable in their workspace." actions={canManage ? <button className="button button-primary" onClick={() => { setError(null); setCreating(true); }}><Plus size={15} />New practice pack</button> : undefined} />
    {error && !creating && !versioning ? <div className="support-banner" role="alert">{error}</div> : null}
    <div className="practice-pack-grid">{packs.length ? packs.map((pack) => { const latest = pack.versions[0]; return <section className="panel practice-pack-card" key={pack.id}><div className="panel-header"><div><span className="eyebrow">{pack.discipline}</span><h2>{pack.name}</h2><p>{pack.key}</p></div><StatusDot tone={pack.active ? "green" : "slate"}>{pack.active ? "Active" : "Inactive"}</StatusDot></div><div className="practice-pack-summary"><BookOpenCheck size={18} /><p>{latest ? summary(latest.definition) : "Create the first version to define this workflow."}</p></div>{pack.versions.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Version</th><th>Status</th><th>Created</th>{canManage ? <th>Action</th> : null}</tr></thead><tbody>{pack.versions.map((version) => <tr key={version.id}><td data-label="Version"><strong>{version.version}</strong></td><td data-label="Status"><StatusDot tone={version.status === "published" ? "green" : "amber"}>{version.status === "published" ? "Published" : "Draft"}</StatusDot></td><td data-label="Created">{new Date(version.createdAt).toLocaleDateString("en-GB")}</td>{canManage ? <td data-label="Action">{version.status === "draft" ? <button className="button button-quiet" disabled={workingId === version.id} onClick={() => publish(pack.id, version.id)}><Upload size={14} />Publish</button> : <span className="cell-sub">Immutable</span>}</td> : null}</tr>)}</tbody></table></div> : <div className="empty-state compact"><strong>No versions</strong><span>Create a draft version before enabling this practice pack.</span></div>}{canManage ? <div className="practice-pack-actions"><button className="button button-secondary" onClick={() => { setError(null); setVersioning(pack); }}><FilePlus2 size={14} />New version</button><button className="button button-quiet" disabled={workingId === pack.id} onClick={() => togglePack(pack)}><Power size={14} />{pack.active ? "Deactivate" : "Activate"}</button></div> : null}</section>; }) : <section className="panel"><div className="empty-state"><CheckCircle2 size={28} color="#3b82f6" /><strong>No practice packs configured</strong><span>Create the first controlled workflow catalogue entry.</span></div></section>}</div>

    {creating ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreating(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-pack-title"><div className="modal-header"><div><h2 id="new-pack-title">New practice pack</h2><p>Create the catalogue entry and its first controlled draft.</p></div><button className="icon-button" aria-label="Close practice-pack form" onClick={() => setCreating(false)}><X size={16} /></button></div><form onSubmit={createPack}><PackFields includeIdentity />{error ? <div className="form-section"><p className="form-error" role="alert">{error}</p></div> : null}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setCreating(false)}>Cancel</button><button className="button button-primary" disabled={workingId === "create"}>{workingId === "create" ? "Creating…" : "Create draft"}</button></div></form></section></div> : null}
    {versioning ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setVersioning(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-version-title"><div className="modal-header"><div><span className="eyebrow">{versioning.name}</span><h2 id="new-version-title">New draft version</h2><p>Published versions remain immutable for audit and retention.</p></div><button className="icon-button" aria-label="Close version form" onClick={() => setVersioning(null)}><X size={16} /></button></div><form onSubmit={createVersion}><PackFields />{error ? <div className="form-section"><p className="form-error" role="alert">{error}</p></div> : null}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setVersioning(null)}>Cancel</button><button className="button button-primary" disabled={workingId === versioning.id}>{workingId === versioning.id ? "Creating…" : "Create draft"}</button></div></form></section></div> : null}
  </main>;
}

function PackFields({ includeIdentity = false }: { includeIdentity?: boolean }) {
  return <div className="form-section"><div className="form-grid">{includeIdentity ? <><div className="field"><label htmlFor="pack-name">Name</label><input id="pack-name" name="name" className="input" required minLength={2} maxLength={160} autoFocus /></div><div className="field"><label htmlFor="pack-key">Key</label><input id="pack-key" name="key" className="input" required minLength={2} maxLength={80} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="building-survey" /></div><div className="field full"><label htmlFor="pack-discipline">Discipline</label><input id="pack-discipline" name="discipline" className="input" required minLength={2} maxLength={120} placeholder="Building surveying" /></div></> : null}<div className="field full"><label htmlFor={includeIdentity ? "pack-version" : "new-pack-version"}>Version</label><input id={includeIdentity ? "pack-version" : "new-pack-version"} name="version" className="input" required maxLength={40} placeholder="1.0" autoFocus={!includeIdentity} /></div><div className="field full"><label htmlFor={includeIdentity ? "pack-summary" : "new-pack-summary"}>Workflow summary</label><textarea id={includeIdentity ? "pack-summary" : "new-pack-summary"} name="summary" className="input" rows={4} required minLength={10} maxLength={2000} /></div><div className="field full"><label htmlFor={includeIdentity ? "pack-requirements" : "new-pack-requirements"}>Required evidence</label><textarea id={includeIdentity ? "pack-requirements" : "new-pack-requirements"} name="requirements" className="input" rows={5} placeholder={"One requirement per line\nSigned terms of engagement\nInspection photographs"} /></div></div></div>;
}
