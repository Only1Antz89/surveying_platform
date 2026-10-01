"use client";

import { FormEvent, useState } from "react";
import { Archive, Building2, Clock3, Eye, Pencil, Plus, X } from "lucide-react";
import { jobStageLabels, type JobStage } from "@surveynt/domain";
import { StatusDot } from "@surveynt/ui";
import type { Client, Property } from "@/lib/demo-data";

type ApiProperty = { id: string; clientId: string; line1: string; city: string; postcode: string; propertyType: string | null; version: number };
type PropertyDetail = { property: { id: string; line1: string; line2: string | null; city: string; postcode: string; propertyType: string | null; version: number }; clientName: string; jobs: { id: string; reference: string; serviceName: string; stage: JobStage; targetDate: string | null }[] };

export function PropertyRegister({ properties: initialProperties, clients, canEdit = true }: { properties: Property[]; clients: Client[]; canEdit?: boolean }) {
  const [properties, setProperties] = useState(initialProperties);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Property | null>(null);
  const [detail, setDetail] = useState<PropertyDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openProperty(property: Property) {
    setError(null); setDetail(null); setDetailLoading(true);
    const response = await fetch(`/api/v1/properties/${property.id}`);
    const payload = await response.json(); setDetailLoading(false);
    if (!response.ok) return setError(payload?.error?.message ?? "The property record could not be opened.");
    setDetail(payload.data as PropertyDetail);
  }

  async function createProperty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/properties", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId: form.get("clientId"), line1: form.get("line1"),
        line2: String(form.get("line2") || "") || undefined,
        city: form.get("city"), postcode: form.get("postcode"),
        propertyType: String(form.get("propertyType") || "") || undefined,
      }),
    });
    const payload = await response.json();
    setSaving(false);
    if (!response.ok) { setError(payload?.error?.message ?? "The property could not be created."); return; }
    const created = payload.data as ApiProperty;
    setProperties((current) => [{ id: created.id, address: created.line1, town: created.city, postcode: created.postcode, type: created.propertyType ?? "Not recorded", client: clients.find((client) => client.id === created.clientId)?.name ?? "Client", activeJobs: 0, version: created.version }, ...current]);
    setCreating(false);
  }

  async function updateProperty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return;
    setSaving(true); setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/v1/properties/${editing.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ line1: form.get("line1"), city: form.get("city"), postcode: form.get("postcode"), propertyType: String(form.get("propertyType") || "") || null, version: editing.version ?? 1 }) });
    const payload = await response.json(); setSaving(false);
    if (!response.ok) return setError(payload?.error?.message ?? "The property could not be updated.");
    setProperties((current) => current.map((property) => property.id === editing.id ? { ...property, address: payload.data.line1, town: payload.data.city, postcode: payload.data.postcode, type: payload.data.propertyType ?? "Not recorded", version: payload.data.version } : property));
    setEditing(null);
  }

  async function archiveProperty(property: Property) {
    if (!window.confirm(`Archive ${property.address}? Existing jobs will retain their property reference.`)) return;
    setError(null);
    const response = await fetch(`/api/v1/properties/${property.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived: true, version: property.version ?? 1 }) });
    const payload = await response.json();
    if (!response.ok) return setError(payload?.error?.message ?? "The property could not be archived.");
    setProperties((current) => current.filter((item) => item.id !== property.id));
  }

  return <>
    <section className="panel">
      <div className="panel-header"><div><h2>Property register</h2><p>{properties.length} properties in this workspace</p></div><div className="header-actions"><Building2 size={17} color="#3b82f6" /><button className="button button-primary" onClick={() => setCreating(true)} disabled={!clients.length || !canEdit}><Plus size={15} />New property</button></div></div>
      {error && !creating && !editing && !detail && !detailLoading ? <div className="form-section"><p className="form-error" role="alert">{error}</p></div> : null}
      {properties.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Address</th><th>Property type</th><th>Client</th><th>Active jobs</th><th>Record</th>{canEdit ? <th>Actions</th> : null}</tr></thead><tbody>{properties.map((property) => <tr key={property.id}><td data-label="Address"><button className="table-link-button" onClick={() => openProperty(property)}><strong>{property.address}</strong><span className="cell-sub">{property.town} · {property.postcode}</span></button></td><td data-label="Property type">{property.type}</td><td data-label="Client">{property.client}</td><td data-label="Active jobs">{property.activeJobs}</td><td data-label="Record"><button className="button button-quiet" onClick={() => openProperty(property)}><Eye size={14} />Open</button></td>{canEdit ? <td data-label="Actions"><div className="row-actions"><button className="button button-quiet" onClick={() => { setError(null); setEditing(property); }}><Pencil size={14} />Edit</button><button className="button button-quiet danger" onClick={() => archiveProperty(property)}><Archive size={14} />Archive</button></div></td> : null}</tr>)}</tbody></table></div> : <div className="empty-state"><strong>No properties yet</strong><span>{clients.length ? "Add the first property linked to a client." : "Create a client before adding a property."}</span></div>}
    </section>
    {creating ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreating(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-property-title">
      <div className="modal-header"><div><h2 id="new-property-title">New property</h2><p>Record the address once and link it to the responsible client.</p></div><button className="icon-button" aria-label="Close new property form" onClick={() => setCreating(false)}><X size={16} /></button></div>
      <form onSubmit={createProperty}><div className="form-section"><div className="form-grid">
        <div className="field full"><label htmlFor="property-client">Client</label><select id="property-client" name="clientId" className="input" required>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></div>
        <div className="field full"><label htmlFor="property-line1">Address line 1</label><input id="property-line1" name="line1" className="input" required minLength={2} maxLength={180} autoFocus /></div>
        <div className="field full"><label htmlFor="property-line2">Address line 2</label><input id="property-line2" name="line2" className="input" maxLength={180} /></div>
        <div className="field"><label htmlFor="property-city">Town or city</label><input id="property-city" name="city" className="input" required minLength={2} maxLength={100} /></div>
        <div className="field"><label htmlFor="property-postcode">Postcode</label><input id="property-postcode" name="postcode" className="input" required minLength={5} maxLength={10} /></div>
        <div className="field full"><label htmlFor="property-type">Property type</label><input id="property-type" name="propertyType" className="input" maxLength={100} placeholder="For example, Victorian terrace" /></div>
      </div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setCreating(false)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Creating…" : "Create property"}</button></div></form>
    </section></div> : null}
    {detailLoading ? <div className="modal-backdrop"><section className="modal property-record-modal" role="dialog" aria-modal="true" aria-label="Loading property record"><div className="job-loading"><Clock3 size={18} />Loading property record…</div></section></div> : null}
    {detail ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetail(null); }}><section className="modal property-record-modal" role="dialog" aria-modal="true" aria-labelledby="property-record-title"><div className="modal-header"><div><span className="eyebrow">{detail.clientName}</span><h2 id="property-record-title">{detail.property.line1}</h2><p>{detail.property.city} · {detail.property.postcode}</p></div><button className="icon-button" aria-label="Close property record" onClick={() => setDetail(null)}><X size={16} /></button></div><div className="form-section"><dl className="detail-grid property-record-details"><div className="detail"><dt>Address line 1</dt><dd>{detail.property.line1}</dd></div><div className="detail"><dt>Address line 2</dt><dd>{detail.property.line2 || "—"}</dd></div><div className="detail"><dt>Town or city</dt><dd>{detail.property.city}</dd></div><div className="detail"><dt>Postcode</dt><dd>{detail.property.postcode}</dd></div><div className="detail"><dt>Property type</dt><dd>{detail.property.propertyType || "Not recorded"}</dd></div><div className="detail"><dt>Responsible client</dt><dd>{detail.clientName}</dd></div></dl></div><section className="property-jobs"><div className="panel-header"><div><h3>Linked jobs</h3><p>{detail.jobs.length} recorded {detail.jobs.length === 1 ? "instruction" : "instructions"}</p></div></div>{detail.jobs.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Reference</th><th>Service</th><th>Stage</th><th>Target</th></tr></thead><tbody>{detail.jobs.map((job) => <tr key={job.id}><td data-label="Reference"><strong>{job.reference}</strong></td><td data-label="Service">{job.serviceName}</td><td data-label="Stage"><StatusDot tone={job.stage === "paid" || job.stage === "issued" ? "green" : job.stage === "archived" ? "slate" : "blue"}>{jobStageLabels[job.stage]}</StatusDot></td><td data-label="Target">{job.targetDate ? new Date(`${job.targetDate}T12:00:00.000Z`).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Europe/London" }) : "Not scheduled"}</td></tr>)}</tbody></table></div> : <div className="empty-state compact"><strong>No linked jobs</strong><span>New instructions for this property will appear here.</span></div>}</section><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setDetail(null)}>Close</button>{canEdit ? <button type="button" className="button button-primary" onClick={() => { const record = properties.find((item) => item.id === detail.property.id); setDetail(null); if (record) setEditing(record); }}><Pencil size={14} />Edit property</button> : null}</div></section></div> : null}
    {editing ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-property-title"><div className="modal-header"><div><h2 id="edit-property-title">Edit property</h2><p>Update the property record without changing its job history.</p></div><button className="icon-button" aria-label="Close edit property form" onClick={() => setEditing(null)}><X size={16} /></button></div><form onSubmit={updateProperty}><div className="form-section"><div className="form-grid"><div className="field full"><label htmlFor="edit-property-line1">Address line 1</label><input id="edit-property-line1" name="line1" className="input" defaultValue={editing.address} required minLength={2} maxLength={180} autoFocus /></div><div className="field"><label htmlFor="edit-property-city">Town or city</label><input id="edit-property-city" name="city" className="input" defaultValue={editing.town} required minLength={2} maxLength={100} /></div><div className="field"><label htmlFor="edit-property-postcode">Postcode</label><input id="edit-property-postcode" name="postcode" className="input" defaultValue={editing.postcode} required minLength={5} maxLength={10} /></div><div className="field full"><label htmlFor="edit-property-type">Property type</label><input id="edit-property-type" name="propertyType" className="input" defaultValue={editing.type === "Not recorded" ? "" : editing.type} maxLength={100} /></div></div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></div></form></section></div> : null}
  </>;
}
