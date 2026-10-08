"use client";
import {workspaceFetch} from "@/lib/workspace-request";

import { FormEvent, useState } from "react";
import Link from "@/components/workspace-link";
import { Archive, Building2, Eye, Pencil, Plus, X } from "lucide-react";
import { ukCountries, ukCountryLabels } from "@surveynt/domain";
import type { Client, Property } from "@/lib/demo-data";
import { AddressSearch, type AddressSelection } from "./address-search";
import { PropertyTypeField } from "./property-type-field";

type ApiProperty = { id: string; clientId: string; line1: string; city: string; postcode: string; propertyType: string | null; version: number };
type AddressFields = { line1: string; line2: string; city: string; postcode: string; country: string };
const emptyAddress: AddressFields = { line1: "", line2: "", city: "", postcode: "", country: "" };

export function PropertyRegister({ slug, properties: initialProperties, clients, canEdit = true }: { slug: string; properties: Property[]; clients: Client[]; canEdit?: boolean }) {
  const [properties, setProperties] = useState(initialProperties);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Property | null>(null);
  const [address, setAddress] = useState<AddressFields>(emptyAddress);
  const [selection, setSelection] = useState<AddressSelection | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function startCreate() {
    setError(null); setNotice(null); setAddress(emptyAddress); setSelection(null); setCreating(true);
  }

  function applySelection(next: AddressSelection) {
    setSelection(next);
    setAddress((current) => ({
      line1: next.candidate.line1 ?? current.line1,
      line2: current.line2,
      city: next.candidate.city ?? current.city,
      postcode: next.candidate.postcode ?? current.postcode,
      country: next.candidate.country ?? current.country,
    }));
  }

  async function createProperty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await workspaceFetch("/api/v1/properties", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId: form.get("clientId"), line1: address.line1,
        line2: address.line2 || undefined,
        city: address.city, postcode: address.postcode,
        propertyType: String(form.get("propertyType") || "") || undefined,
        country: address.country || undefined,
        addressSource: selection && selection.candidate.source !== "demo" ? selection.candidate.source : "manual",
      }),
    });
    const payload = await response.json();
    if (!response.ok) { setSaving(false); setError(payload?.error?.message ?? "The property could not be created."); return; }
    const created = payload.data as ApiProperty;
    // The search result becomes an approximate location only after the record exists; failure here never loses the property.
    if (selection && selection.candidate.source !== "demo" && !payload.meta?.demo) {
      const located = await workspaceFetch(`/api/v1/properties/${created.id}/identity`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "set_location", lookupId: selection.lookupId, index: selection.candidate.index, version: created.version }) });
      if (!located.ok) setNotice("The property was created, but its approximate location could not be saved. Open the record to try again.");
      else created.version += 1;
    }
    setSaving(false);
    setProperties((current) => [{ id: created.id, address: created.line1, town: created.city, postcode: created.postcode, type: created.propertyType ?? "Not recorded", client: clients.find((client) => client.id === created.clientId)?.name ?? "Client", activeJobs: 0, version: created.version }, ...current]);
    setCreating(false);
  }

  async function updateProperty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return;
    setSaving(true); setError(null);
    const form = new FormData(event.currentTarget);
    const response = await workspaceFetch(`/api/v1/properties/${editing.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ line1: form.get("line1"), city: form.get("city"), postcode: form.get("postcode"), propertyType: String(form.get("propertyType") || "") || null, version: editing.version ?? 1 }) });
    const payload = await response.json(); setSaving(false);
    if (!response.ok) return setError(payload?.error?.message ?? "The property could not be updated.");
    setProperties((current) => current.map((property) => property.id === editing.id ? { ...property, address: payload.data.line1, town: payload.data.city, postcode: payload.data.postcode, type: payload.data.propertyType ?? "Not recorded", version: payload.data.version } : property));
    setEditing(null);
  }

  async function archiveProperty(property: Property) {
    if (!window.confirm(`Archive ${property.address}? Existing jobs will retain their property reference.`)) return;
    setError(null);
    const response = await workspaceFetch(`/api/v1/properties/${property.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived: true, version: property.version ?? 1 }) });
    const payload = await response.json();
    if (!response.ok) return setError(payload?.error?.message ?? "The property could not be archived.");
    setProperties((current) => current.filter((item) => item.id !== property.id));
  }

  const recordHref = (property: Property) => `/app/${slug}/properties/${property.id}`;

  return <>
    <section className="panel">
      <div className="panel-header"><div><h2>Property register</h2><p>{properties.length} properties in this workspace</p></div><div className="header-actions"><Building2 size={17} color="#3b82f6" /><button className="button button-primary" onClick={startCreate} disabled={!clients.length || !canEdit}><Plus size={15} />New property</button></div></div>
      {error && !creating && !editing ? <div className="form-section"><p className="form-error" role="alert">{error}</p></div> : null}
      {notice ? <div className="form-section"><p className="form-success" role="status">{notice}</p></div> : null}
      {properties.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Address</th><th>Property type</th><th>Client</th><th>Active jobs</th><th>Record</th>{canEdit ? <th>Actions</th> : null}</tr></thead><tbody>{properties.map((property) => <tr key={property.id}><td data-label="Address"><Link className="table-link-button" href={recordHref(property)}><strong>{property.address}</strong><span className="cell-sub">{property.town} · {property.postcode}</span></Link></td><td data-label="Property type">{property.type}</td><td data-label="Client">{property.client}</td><td data-label="Active jobs">{property.activeJobs}</td><td data-label="Record"><Link className="button button-quiet" href={recordHref(property)}><Eye size={14} />Open</Link></td>{canEdit ? <td data-label="Actions"><div className="row-actions"><button className="button button-quiet" onClick={() => { setError(null); setEditing(property); }}><Pencil size={14} />Edit</button><button className="button button-quiet danger" onClick={() => archiveProperty(property)}><Archive size={14} />Archive</button></div></td> : null}</tr>)}</tbody></table></div> : <div className="empty-state"><strong>No properties yet</strong><span>{clients.length ? "Add the first property linked to a client." : "Create a client before adding a property."}</span></div>}
    </section>
    {creating ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreating(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-property-title">
      <div className="modal-header"><div><h2 id="new-property-title">New property</h2><p>Record the address once and link it to the responsible client.</p></div><button className="icon-button" aria-label="Close new property form" onClick={() => setCreating(false)}><X size={16} /></button></div>
      <form onSubmit={createProperty}><div className="form-section">
        <AddressSearch onSelect={applySelection} disabled={saving} label="Find address (optional)" />
        {selection ? <p className="form-help">Fields were filled from the selected result. Check and correct them before saving. The location stays approximate until confirmed.</p> : null}
        <div className="form-grid">
          <div className="field full"><label htmlFor="property-client">Client</label><select id="property-client" name="clientId" className="input" required>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></div>
          <div className="field full"><label htmlFor="property-line1">Address line 1</label><input id="property-line1" className="input" required minLength={2} maxLength={180} value={address.line1} onChange={(event) => setAddress({ ...address, line1: event.target.value })} /></div>
          <div className="field full"><label htmlFor="property-line2">Address line 2</label><input id="property-line2" className="input" maxLength={180} value={address.line2} onChange={(event) => setAddress({ ...address, line2: event.target.value })} /></div>
          <div className="field"><label htmlFor="property-city">Town or city</label><input id="property-city" className="input" required minLength={2} maxLength={100} value={address.city} onChange={(event) => setAddress({ ...address, city: event.target.value })} /></div>
          <div className="field"><label htmlFor="property-postcode">Postcode</label><input id="property-postcode" className="input" required minLength={5} maxLength={10} value={address.postcode} onChange={(event) => setAddress({ ...address, postcode: event.target.value })} /></div>
          <div className="field"><label htmlFor="property-country">Country</label><select id="property-country" className="select" value={address.country} onChange={(event) => setAddress({ ...address, country: event.target.value })}><option value="">Not set</option>{ukCountries.map((country) => <option key={country} value={country}>{ukCountryLabels[country]}</option>)}</select></div>
          <PropertyTypeField id="property-type" />
        </div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setCreating(false)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Creating…" : "Create property"}</button></div></form>
    </section></div> : null}
    {editing ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-property-title"><div className="modal-header"><div><h2 id="edit-property-title">Edit property</h2><p>Update the property record without changing its job history.</p></div><button className="icon-button" aria-label="Close edit property form" onClick={() => setEditing(null)}><X size={16} /></button></div><form onSubmit={updateProperty}><div className="form-section"><div className="form-grid"><div className="field full"><label htmlFor="edit-property-line1">Address line 1</label><input id="edit-property-line1" name="line1" className="input" defaultValue={editing.address} required minLength={2} maxLength={180} autoFocus /></div><div className="field"><label htmlFor="edit-property-city">Town or city</label><input id="edit-property-city" name="city" className="input" defaultValue={editing.town} required minLength={2} maxLength={100} /></div><div className="field"><label htmlFor="edit-property-postcode">Postcode</label><input id="edit-property-postcode" name="postcode" className="input" defaultValue={editing.postcode} required minLength={5} maxLength={10} /></div><PropertyTypeField id="edit-property-type" defaultValue={editing.type === "Not recorded" ? "" : editing.type} /></div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></div></form></section></div> : null}
  </>;
}
