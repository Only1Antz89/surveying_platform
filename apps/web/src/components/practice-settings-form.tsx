"use client";

import { type FormEvent, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import type { OrganisationSettings } from "@/lib/data";

const regions = ["United Kingdom", "London", "South East England", "South West England", "Midlands", "North of England", "Wales", "Scotland", "Northern Ireland"];

export function PracticeSettingsForm({ initial, canEdit }: { initial: OrganisationSettings; canEdit: boolean }) {
  const [services, setServices] = useState(initial.services);
  const [accentColour, setAccentColour] = useState(initial.accentColour);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/organisation", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        region: form.get("region"),
        tradingName: form.get("tradingName"),
        supportEmail: form.get("supportEmail"),
        accentColour,
        services: services.filter((service) => service.name.trim()).map((service) => ({ id: service.id.startsWith("new-") ? undefined : service.id, name: service.name, defaultFee: service.defaultFee })),
      }),
    });
    const payload = await response.json();
    setSaving(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? "The practice settings could not be saved.");
      return;
    }
    setServices(payload.data.services.map((service: { id: string; name: string; defaultFee: string | null }) => ({ id: service.id, name: service.name, defaultFee: service.defaultFee ?? "" })));
    setMessage("Practice settings saved.");
  }

  return <section className="panel"><form onSubmit={save}>
    <div className="form-section"><h2>Practice identity</h2><p>Used throughout your workspace and future client communications.</p><div className="form-grid">
      <div className="field"><label htmlFor="practice-name">Registered workspace name</label><input id="practice-name" name="name" className="input" defaultValue={initial.name} required minLength={2} maxLength={160} disabled={!canEdit} /></div>
      <div className="field"><label htmlFor="trading-name">Trading name</label><input id="trading-name" name="tradingName" className="input" defaultValue={initial.tradingName} required minLength={2} maxLength={160} disabled={!canEdit} /></div>
      <div className="field"><label htmlFor="support-email">Support email</label><input id="support-email" name="supportEmail" className="input" type="email" defaultValue={initial.supportEmail} disabled={!canEdit} /></div>
      <div className="field"><label htmlFor="practice-region">Primary region</label><select id="practice-region" name="region" className="input" defaultValue={initial.region} disabled={!canEdit}>{regions.map((region) => <option key={region}>{region}</option>)}</select></div>
      <div className="field full"><label htmlFor="accent-colour">Brand colour</label><div className="colour-input"><input id="accent-colour" type="color" value={accentColour} onChange={(event) => setAccentColour(event.target.value)} disabled={!canEdit} /><span>{accentColour.toUpperCase()}</span></div></div>
    </div></div>
    <div className="form-section"><div className="section-heading-row"><div><h2>Default services</h2><p>Initial fee guidance can be adjusted on each job.</p></div>{canEdit ? <button type="button" className="button button-secondary" onClick={() => setServices((current) => [...current, { id: `new-${crypto.randomUUID()}`, name: "", defaultFee: "" }])} disabled={services.length >= 20}><Plus size={15} />Add service</button> : null}</div>
      {services.length ? <div className="service-list">{services.map((service) => <div className="service-row" key={service.id}><div className="field"><label htmlFor={`service-name-${service.id}`}>Service</label><input id={`service-name-${service.id}`} className="input" value={service.name} onChange={(event) => setServices((current) => current.map((item) => item.id === service.id ? { ...item, name: event.target.value } : item))} required disabled={!canEdit} /></div><div className="field"><label htmlFor={`service-fee-${service.id}`}>Default fee (£)</label><input id={`service-fee-${service.id}`} className="input" type="number" min="0" step="0.01" value={service.defaultFee} onChange={(event) => setServices((current) => current.map((item) => item.id === service.id ? { ...item, defaultFee: event.target.value } : item))} disabled={!canEdit} /></div>{canEdit ? <button type="button" className="icon-button danger" aria-label={`Remove ${service.name || "service"}`} onClick={() => setServices((current) => current.filter((item) => item.id !== service.id))}><Trash2 size={15} /></button> : null}</div>)}</div> : <div className="empty-state compact"><strong>No default services configured</strong><span>Add services to make job setup faster.</span></div>}
    </div>
    {(message || error) ? <div className="form-section">{message ? <p className="form-success" role="status">{message}</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}</div> : null}
    {canEdit ? <div className="form-section form-actions"><button className="button button-primary" disabled={saving}><Save size={15} />{saving ? "Saving…" : "Save changes"}</button></div> : null}
  </form></section>;
}
