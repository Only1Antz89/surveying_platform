"use client";

import { FormEvent, useState } from "react";
import { Building2, Plus, X } from "lucide-react";
import type { Client, Property } from "@/lib/demo-data";

type ApiProperty = { id: string; clientId: string; line1: string; city: string; postcode: string; propertyType: string | null };

export function PropertyRegister({ properties: initialProperties, clients }: { properties: Property[]; clients: Client[] }) {
  const [properties, setProperties] = useState(initialProperties);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setProperties((current) => [{ id: created.id, address: created.line1, town: created.city, postcode: created.postcode, type: created.propertyType ?? "Not recorded", client: clients.find((client) => client.id === created.clientId)?.name ?? "Client", activeJobs: 0 }, ...current]);
    setCreating(false);
  }

  return <>
    <section className="panel">
      <div className="panel-header"><div><h2>Property register</h2><p>{properties.length} properties in this workspace</p></div><div className="header-actions"><Building2 size={17} color="#2563eb" /><button className="button button-primary" onClick={() => setCreating(true)} disabled={!clients.length}><Plus size={15} />New property</button></div></div>
      {properties.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Address</th><th>Property type</th><th>Client</th><th>Active jobs</th></tr></thead><tbody>{properties.map((property) => <tr key={property.id}><td data-label="Address"><strong>{property.address}</strong><span className="cell-sub">{property.town} · {property.postcode}</span></td><td data-label="Property type">{property.type}</td><td data-label="Client">{property.client}</td><td data-label="Active jobs">{property.activeJobs}</td></tr>)}</tbody></table></div> : <div className="empty-state"><strong>No properties yet</strong><span>{clients.length ? "Add the first property linked to a client." : "Create a client before adding a property."}</span></div>}
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
  </>;
}
