"use client";

import { FormEvent, useState } from "react";
import { Camera, MessageSquarePlus } from "lucide-react";
import { inspectionStatusLabels, inspectionStatuses, nextActionLabels, nextActions, type ElementDefinition, type FieldValue, type FormTemplate, type InspectionStatus, type NextAction, type SectionDefinition } from "@surveynt/assistant";
import { SurveyField, type FieldDisplay } from "./survey-field";

export type ElementView = { serverId: string | null; version: number | null; inspectionStatus: InspectionStatus | null; limitationReason: string | null; pending: boolean; contentRemoved?: boolean };
export type ObservationView = { key: string; text: string; kind: string; pending: boolean; contentRemoved?: boolean; measurement?: { value: number; unit: string } | null; locationLabel?: string | null; defect?: { nextAction: string } | null; evidenceCount?: number };
export type PhotoView = { key: string; src: string | null; pending: boolean; label: string; quality?: string[] };
export type EarlierPhotoView = { mediaId: string; jobReference: string; surveyDate: string; locationLabel: string | null };

function PhotoThumb({ photo }: { photo: PhotoView }) {
  if (!photo.src) return <span className="photo-placeholder">{photo.label}</span>;
  // Private, authenticated originals and on-device object URLs cannot go through the image optimiser.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={photo.src} alt={photo.label} loading="lazy" />;
}

const needsReason: InspectionStatus[] = ["partially_inspected", "not_inspected", "inaccessible"];
const observationKindLabels: Record<string, string> = { current_observation: "Observation", measurement: "Measurement", client_claim: "Client statement (not inspected)" };

export function SurveyElementCard({ section, element, template, view, fieldDisplay, observations, photos, canEdit, canJudge, onElement, onField, onObservation, onPhoto, onLinkPhoto, onLoadEarlier }: {
  section: SectionDefinition;
  element: ElementDefinition;
  template: FormTemplate;
  view: ElementView;
  fieldDisplay: (path: string) => FieldDisplay;
  observations: ObservationView[];
  photos: PhotoView[];
  canEdit: boolean;
  canJudge: boolean;
  onElement: (status: InspectionStatus | null, reason: string | null) => void;
  onField: (path: string, value: FieldValue) => void;
  onObservation: (input: { kind: "current_observation" | "measurement" | "client_claim"; text: string; measurement?: { value: number; unit: string }; locationLabel?: string; defect?: { nextAction: NextAction } }) => void;
  onPhoto: (file: File) => void;
  /** Links an existing photo of this element to an observation as its evidence. */
  onLinkPhoto?: (observationKey: string, pending: boolean, photoKey: string) => void;
  /** Loads this firm's earlier photos of the element, for comparison on site. */
  onLoadEarlier?: () => Promise<EarlierPhotoView[] | null>;
}) {
  const [reason, setReason] = useState(view.limitationReason ?? "");
  const [seenReason, setSeenReason] = useState(view.limitationReason);
  const [adding, setAdding] = useState(false);
  const [earlier, setEarlier] = useState<EarlierPhotoView[] | "loading" | "unavailable" | null>(null);
  if (seenReason !== view.limitationReason) {
    setSeenReason(view.limitationReason);
    setReason(view.limitationReason ?? "");
  }
  const editable = canEdit && !view.contentRemoved;
  const status = view.inspectionStatus;
  const headingId = `element-${section.key}-${element.key}`;

  function addObservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const kind = String(form.get("kind")) as "current_observation" | "measurement" | "client_claim";
    const text = String(form.get("text") ?? "").trim();
    if (!text) return;
    const value = Number(form.get("measurementValue"));
    const unit = String(form.get("measurementUnit") ?? "").trim();
    const nextAction = String(form.get("nextAction") ?? "") as NextAction | "";
    const locationLabel = String(form.get("locationLabel") ?? "").trim();
    onObservation({ kind, text, measurement: kind === "measurement" && Number.isFinite(value) && unit ? { value, unit } : undefined, locationLabel: locationLabel || undefined, defect: nextAction && kind === "current_observation" ? { nextAction } : undefined });
    event.currentTarget.reset();
    setAdding(false);
  }

  return <section className="survey-element" aria-labelledby={headingId}>
    <header className="survey-element-header">
      <div><h3 id={headingId}>{element.label}</h3>{element.description ? <p>{element.description}</p> : null}</div>
      {element.inspectable ? <label className="inspection-status">
        <span>Inspection</span>
        <select className="select" value={status ?? ""} disabled={!editable} onChange={(event) => onElement((event.target.value || null) as InspectionStatus | null, needsReason.includes(event.target.value as InspectionStatus) ? reason || null : null)}>
          <option value="">Not yet recorded</option>
          {inspectionStatuses.map((item) => <option key={item} value={item}>{inspectionStatusLabels[item]}</option>)}
        </select>
      </label> : null}
    </header>
    {view.pending ? <p className="pending-note">Saved on this device. It will sync when online.</p> : null}
    {view.contentRemoved ? <p>Inspection notes removed after retention review.</p> : element.inspectable && status && needsReason.includes(status) ? <div className="field"><label htmlFor={`${headingId}-reason`}>Why was it not fully inspected?</label><input id={`${headingId}-reason`} className="input" value={reason} maxLength={2000} disabled={!editable} onChange={(event) => setReason(event.target.value)} onBlur={() => reason !== (view.limitationReason ?? "") && onElement(status, reason || null)} placeholder="For example, no safe access to the roof space hatch" /></div> : null}
    <div className="survey-fields">
      {element.fields.map((field) => {
        const path = `${section.key}.${element.key}.${field.key}`;
        const locked = field.fieldClass === "professional_assessment" && !canJudge ? "Professional assessment: recorded by a surveyor." : null;
        return <SurveyField key={path} field={field} path={path} template={template} display={fieldDisplay(path)} disabled={!editable} lockedReason={locked} onSave={(value) => onField(path, value)} />;
      })}
    </div>
    {element.inspectable ? <div className="survey-evidence">
      <div className="survey-evidence-header">
        <h4>Observations and photos</h4>
        {editable ? <div className="row-actions">
          <button type="button" className="button button-quiet" onClick={() => setAdding((value) => !value)}><MessageSquarePlus size={14} />Add observation</button>
          <label className="button button-quiet file-button"><Camera size={14} />Add photo<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) onPhoto(file); event.target.value = ""; }} /></label>
        </div> : null}
      </div>
      {adding ? <form className="observation-form" onSubmit={addObservation}>
        <div className="form-grid">
          <div className="field"><label htmlFor={`${headingId}-kind`}>Type</label><select id={`${headingId}-kind`} name="kind" className="select" defaultValue="current_observation">{Object.entries(observationKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <div className="field"><label htmlFor={`${headingId}-value`}>Measurement (optional)</label><div className="measurement-row"><input id={`${headingId}-value`} name="measurementValue" className="input" type="number" step="any" placeholder="Value" /><input name="measurementUnit" className="input" maxLength={20} placeholder="Unit" aria-label="Unit" /></div></div>
          <div className="field"><label htmlFor={`${headingId}-location`}>Where (optional)</label><input id={`${headingId}-location`} name="locationLabel" className="input" maxLength={120} placeholder="For example, rear elevation" /></div>
          {canJudge ? <div className="field"><label htmlFor={`${headingId}-defect`}>Defect and next action</label><select id={`${headingId}-defect`} name="nextAction" className="select" defaultValue=""><option value="">Not classified as a defect</option>{nextActions.map((action) => <option key={action} value={action}>Defect: {nextActionLabels[action]}</option>)}</select></div> : null}
          <div className="field full"><label htmlFor={`${headingId}-text`}>What did you see?</label><textarea id={`${headingId}-text`} name="text" className="textarea" required maxLength={8000} rows={3} placeholder="Record the visible facts. Keep possible causes for your commentary." /></div>
        </div>
        <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setAdding(false)}>Cancel</button><button className="button button-primary">Save observation</button></div>
      </form> : null}
      {observations.length ? <ul className="observation-list">{observations.map((observation) => observation.contentRemoved ? <li key={observation.key}><p role="status">Observation content removed after retention review. Identity and provenance history remain.</p></li> : <li key={observation.key}>
        <span className={`status ${observation.defect ? "status-amber" : "status-slate"}`}>{observation.defect ? `Defect: ${nextActionLabels[observation.defect.nextAction as NextAction] ?? "next action not recorded"}` : observationKindLabels[observation.kind] ?? observation.kind}</span>
        <p>{observation.locationLabel ? <b>{observation.locationLabel}: </b> : null}{observation.text}{observation.measurement ? ` (${observation.measurement.value} ${observation.measurement.unit})` : ""}</p>
        {observation.pending ? <small>Saved on this device</small> : null}
        {observation.defect ? <small>{observation.evidenceCount ? `${observation.evidenceCount} item${observation.evidenceCount === 1 ? "" : "s"} of evidence` : "No evidence linked yet"}</small> : null}
        {observation.defect && editable && onLinkPhoto && photos.length ? <select className="select observation-link" aria-label="Link a photo as evidence" value="" onChange={(event) => { if (event.target.value) onLinkPhoto(observation.key, observation.pending, event.target.value); }}><option value="">Link a photo as evidence…</option>{photos.map((photo, index) => <option key={photo.key} value={photo.key}>Photo {index + 1}{photo.pending ? " (waiting to upload)" : ""}</option>)}</select> : null}
      </li>)}</ul> : null}
      {photos.length ? <ul className="photo-strip">{photos.map((photo) => <li key={photo.key}><PhotoThumb photo={photo} />{photo.pending ? <small>Waiting to upload</small> : null}{photo.quality?.map((message) => <small key={message} className="photo-quality">{message}</small>)}</li>)}</ul> : null}
      {onLoadEarlier ? <div className="earlier-photos">
        {earlier === null ? <button type="button" className="button button-quiet" onClick={() => { setEarlier("loading"); void onLoadEarlier().then((items) => setEarlier(items ?? "unavailable"), () => setEarlier("unavailable")); }}>Show earlier photos of this element</button> : null}
        {earlier === "loading" ? <p className="form-help">Loading earlier photos…</p> : null}
        {earlier === "unavailable" ? <p className="form-help">Earlier photos are unavailable offline.</p> : null}
        {Array.isArray(earlier) ? earlier.length ? <>
          <p className="form-help">From this firm&apos;s earlier surveys of the same property. Compare on site: any difference is a possible change, not a finding.</p>
          <ul className="photo-strip">{earlier.map((photo) => <li key={photo.mediaId}><PhotoThumb photo={{ key: photo.mediaId, src: `/api/v1/media/${photo.mediaId}`, pending: false, label: `Earlier photo of ${element.label}` }} /><small>{photo.jobReference} · {photo.surveyDate}{photo.locationLabel ? ` · ${photo.locationLabel}` : ""}</small></li>)}</ul>
        </> : <p className="form-help">No earlier photos of this element in this firm&apos;s surveys.</p> : null}
      </div> : null}
      {!observations.length && !photos.length ? <p className="form-help">No observations or photos recorded for this element.</p> : null}
    </div> : null}
  </section>;
}
