"use client";
import {workspaceFetch} from "@/lib/workspace-request";

import { FormEvent, useState } from "react";
import { AlertTriangle, Fingerprint, LocateFixed, X } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import { ukCountries, ukCountryLabels, type UkCountry } from "@surveynt/domain";
import { locationConfidenceLabels, uprnEvidenceLabels, uprnEvidenceTypes, type LocationConfidence, type UprnEvidenceType } from "@surveynt/property-data";
import type { PropertyIdentityView } from "@/lib/property-workspace";
import type { UprnResolution } from "@/lib/property-identity";
import { AddressSearch, type AddressSelection } from "./address-search";

const confidenceTone: Record<LocationConfidence, "slate" | "amber" | "blue" | "green"> = { unresolved: "slate", postcode_centroid: "amber", geocoded_address: "blue", surveyor_confirmed: "green" };

const actionLabels: Record<string, string> = {
  set_location: "Location set from search",
  confirm_uprn: "UPRN confirmed",
  clear_uprn: "UPRN cleared",
  clear_location: "Location cleared",
  set_country: "Country updated",
};

type Event = { id: string; action: string; createdAt: string; actor: string; evidence: Record<string, unknown> };

export function PropertyIdentityPanel({ propertyId, address, initialIdentity, initialVersion, initialEvents, canEdit, canConfirm, demo }: {
  propertyId: string;
  address: { line1: string; city: string; postcode: string };
  initialIdentity: PropertyIdentityView;
  initialVersion: number;
  initialEvents: Event[];
  canEdit: boolean;
  canConfirm: boolean;
  demo: boolean;
}) {
  const [identity, setIdentity] = useState(initialIdentity);
  const [version, setVersion] = useState(initialVersion);
  const [events, setEvents] = useState(initialEvents);
  const [locating, setLocating] = useState(false);
  const [selection, setSelection] = useState<AddressSelection | null>(null);
  const [resolution, setResolution] = useState<UprnResolution | null>(null);
  const [selectedUprn, setSelectedUprn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function send(body: Record<string, unknown>) {
    setBusy(true); setError(null); setNotice(null);
    const response = await workspaceFetch(`/api/v1/properties/${propertyId}/identity`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, version }) });
    const payload = await response.json(); setBusy(false);
    if (!response.ok) { setError(payload?.error?.message ?? "The identity change could not be saved."); return false; }
    if (payload.meta?.demo) { setNotice("Demo workspace: the change was not saved."); return true; }
    setIdentity(payload.data.identity); setVersion(payload.data.version);
    setEvents((current) => [{ id: crypto.randomUUID(), action: String(body.action), createdAt: new Date().toISOString(), actor: "You", evidence: { warnings: payload.data.warnings } }, ...current]);
    if (payload.data.warnings?.length) setNotice(payload.data.warnings.join(" "));
    return true;
  }

  async function choose(next: AddressSelection) {
    setSelection(next); setResolution(null); setSelectedUprn(""); setError(null);
    const response = await workspaceFetch("/api/v1/address/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lookupId: next.lookupId, index: next.candidate.index }) });
    const payload = await response.json();
    if (!response.ok) return setError(payload?.error?.message ?? "That result could not be resolved.");
    setResolution(payload.data.uprn as UprnResolution);
  }

  async function applyLocation() {
    if (!selection) return;
    if (await send({ action: "set_location", lookupId: selection.lookupId, index: selection.candidate.index, replaceConfirmed: identity.locationConfidence === "surveyor_confirmed" })) setLocating(false);
  }

  async function confirmUprn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const uprn = String(form.get("uprn") ?? "").trim();
    const fromCandidates = Boolean(resolution?.candidates.some((candidate) => candidate.uprn === uprn));
    if (await send({ action: "confirm_uprn", uprn, evidenceType: form.get("evidenceType") as UprnEvidenceType, note: String(form.get("note") ?? "") || null, fromCandidates })) {
      setLocating(false); setSelection(null); setResolution(null);
    }
  }

  async function clear(action: "clear_uprn" | "clear_location") {
    const reason = window.prompt(action === "clear_uprn" ? "Why is the UPRN being cleared?" : "Why is the location being cleared?");
    if (!reason || reason.trim().length < 3) return;
    await send({ action, reason });
  }

  const point = identity.latitude !== null && identity.longitude !== null ? `${identity.latitude.toFixed(5)}, ${identity.longitude.toFixed(5)}` : "Not recorded";

  return <section className="panel identity-panel" aria-labelledby="identity-heading">
    <div className="panel-header"><div><h2 id="identity-heading">Location and identity</h2><p>External matches stay approximate until a surveyor confirms them with evidence.</p></div><Fingerprint size={17} color="#3b82f6" aria-hidden="true" /></div>
    <dl className="detail-grid">
      <div className="detail"><dt>Country</dt><dd>{canEdit ? <select className="select compact-select" aria-label="Country" value={identity.country ?? ""} disabled={busy} onChange={(event) => void send({ action: "set_country", country: (event.target.value || null) as UkCountry | null })}><option value="">Not set</option>{ukCountries.map((country) => <option key={country} value={country}>{ukCountryLabels[country]}</option>)}</select> : identity.country ? ukCountryLabels[identity.country] : "Not set"}</dd></div>
      <div className="detail"><dt>Location</dt><dd><StatusDot tone={confidenceTone[identity.locationConfidence]}>{locationConfidenceLabels[identity.locationConfidence]}</StatusDot><span className="cell-sub">{point}</span></dd></div>
      <div className="detail"><dt>UPRN</dt><dd>{identity.uprn ? <><strong>{identity.uprn}</strong><span className="cell-sub">Confirmed{identity.uprnEvidenceType ? ` · ${uprnEvidenceLabels[identity.uprnEvidenceType as UprnEvidenceType] ?? identity.uprnEvidenceType}` : ""}{identity.uprnConfirmedAt ? ` · ${new Date(identity.uprnConfirmedAt).toLocaleDateString("en-GB")}` : ""}</span></> : "Not confirmed"}</dd></div>
      <div className="detail"><dt>Resolved</dt><dd>{identity.resolvedAt ? new Date(identity.resolvedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—"}</dd></div>
    </dl>
    {identity.addressChangedSinceResolution ? <p className="identity-warning" role="status"><AlertTriangle size={14} aria-hidden="true" />The address has changed since this location was resolved. Check the location and UPRN again.</p> : null}
    {notice ? <p className="form-success identity-message" role="status">{notice}</p> : null}
    {error ? <p className="form-error identity-message" role="alert">{error}</p> : null}
    {canEdit ? <div className="identity-actions">
      <button type="button" className="button button-secondary" onClick={() => { setLocating((value) => !value); setSelection(null); setResolution(null); }} disabled={busy}><LocateFixed size={14} />{locating ? "Close search" : identity.locationConfidence === "unresolved" ? "Find location" : "Re-check location"}</button>
      {identity.uprn && canConfirm ? <button type="button" className="button button-quiet danger" onClick={() => void clear("clear_uprn")} disabled={busy}><X size={14} />Clear UPRN</button> : null}
      {identity.locationConfidence !== "unresolved" ? <button type="button" className="button button-quiet danger" onClick={() => void clear("clear_location")} disabled={busy}><X size={14} />Clear location</button> : null}
    </div> : null}
    {locating ? <div className="identity-workflow">
      <AddressSearch initialQuery={`${address.line1}, ${address.city} ${address.postcode}`} onSelect={(next) => void choose(next)} disabled={busy} />
      {selection ? <div className="identity-selection">
        <h3>Selected result</h3>
        <p><strong>{selection.candidate.label}</strong><span className="cell-sub">{selection.candidate.precision === "postcode" ? "Postcode centre. This is approximate and may be far from the building." : "Address search match. This is approximate."}</span></p>
        <button type="button" className="button button-primary" onClick={() => void applyLocation()} disabled={busy}>Use as approximate location</button>
      </div> : null}
      {resolution ? <form className="identity-selection" onSubmit={confirmUprn}>
        <h3>UPRN candidates{resolution.datasetVersion ? <span className="cell-sub">OS Open UPRN {resolution.datasetVersion} · within {resolution.searchRadiusMetres} m</span> : null}</h3>
        {resolution.warnings.map((warning) => <p key={warning.code} className="identity-warning"><AlertTriangle size={14} aria-hidden="true" />{warning.message}</p>)}
        {resolution.candidates.length ? <fieldset className="candidate-list"><legend className="sr-only">Nearby UPRNs</legend>{resolution.candidates.map((candidate) => <label key={candidate.uprn} className="candidate-option"><input type="radio" name="candidate" value={candidate.uprn} checked={selectedUprn === candidate.uprn} onChange={() => setSelectedUprn(candidate.uprn)} /><span><strong>{candidate.uprn}</strong><span className="cell-sub">{candidate.distanceMetres.toFixed(0)} m away{candidate.colocated > 1 ? ` · shares a point with ${candidate.colocated - 1} other${candidate.colocated > 2 ? "s" : ""}` : ""}</span></span></label>)}</fieldset> : null}
        {canConfirm ? <div className="form-grid">
          <div className="field"><label htmlFor="identity-uprn">UPRN to confirm</label><input id="identity-uprn" name="uprn" className="input" inputMode="numeric" pattern="[0-9]{1,12}" maxLength={12} required value={selectedUprn} onChange={(event) => setSelectedUprn(event.target.value.replace(/\D/g, ""))} /></div>
          <div className="field"><label htmlFor="identity-evidence">Evidence</label><select id="identity-evidence" name="evidenceType" className="select" required defaultValue="">{[<option key="" value="" disabled>Select evidence</option>, ...uprnEvidenceTypes.map((type) => <option key={type} value={type}>{uprnEvidenceLabels[type]}</option>)]}</select></div>
          <div className="field full"><label htmlFor="identity-note">Evidence note</label><textarea id="identity-note" name="note" className="textarea" maxLength={500} placeholder="For example, the UPRN on the energy certificate matches flat 2" /></div>
          <label className="check-field full"><input type="checkbox" required /> I confirm this UPRN identifies this property, based on the evidence selected. A nearby point alone is not enough.</label>
          <div className="form-actions full"><button className="button button-primary" disabled={busy || !selectedUprn}>Confirm UPRN</button></div>
        </div> : <p className="form-help">Only owners, administrators and surveyors can confirm a UPRN.</p>}
      </form> : null}
      {demo ? <p className="address-demo-label">Demo workspace: identity changes are not saved.</p> : null}
    </div> : null}
    {events.length ? <div className="identity-history"><h3>Identity history</h3><ul>{events.map((event) => <li key={event.id}><strong>{actionLabels[event.action] ?? event.action}</strong><span className="cell-sub">{event.actor} · {new Date(event.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}{typeof event.evidence.evidenceType === "string" ? ` · ${uprnEvidenceLabels[event.evidence.evidenceType as UprnEvidenceType] ?? event.evidence.evidenceType}` : ""}</span></li>)}</ul></div> : null}
  </section>;
}
