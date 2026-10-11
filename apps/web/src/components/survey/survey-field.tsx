"use client";

import { useId, useState } from "react";
import { validateFieldValue, valueStateLabels, valueStates, type FieldDefinition, type FieldValue, type FormTemplate, type ValueState } from "@surveynt/assistant";
import { FieldEvidence } from "./field-evidence";

export type FieldDisplay = { value: FieldValue | null; pending: boolean; deviceOnly?: boolean; contentRemoved?: boolean; origin: string | null };

function initialText(value: FieldValue | null) {
  if (!value || value.state !== "provided") return "";
  return Array.isArray(value.value) ? value.value.join(", ") : String(value.value);
}

/**
 * One form field. Recorded values and explicit states (unknown, not inspected,
 * inaccessible, not applicable) are separate choices, so a blank is never
 * mistaken for "No".
 */
export function SurveyField({ field, path, template, display, disabled, lockedReason, onSave }: {
  field: FieldDefinition;
  path: string;
  template: FormTemplate;
  display: FieldDisplay;
  disabled: boolean;
  lockedReason: string | null;
  onSave: (value: FieldValue) => void;
}) {
  const id = useId();
  const current = display.value;
  const signature = JSON.stringify(current);
  const [seen, setSeen] = useState(signature);
  const [state, setState] = useState<ValueState>(current?.state ?? "provided");
  const [text, setText] = useState(initialText(current));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reset local edits when the stored value changes (sync, conflict resolution).
  if (seen !== signature) {
    setSeen(signature);
    setDirty(false);
    setState(current?.state ?? "provided");
    setText(initialText(current));
  }

  if (display.contentRemoved) return <div className="survey-field" data-path={path}>
    <div className="survey-field-label"><span>{field.label}</span></div>
    <p className="form-help" role="status">Answer content removed after retention review. Identity and provenance history remain.</p>
  </div>;

  const locked = disabled || Boolean(lockedReason);
  const save = (value: FieldValue) => {
    const checked = validateFieldValue(field, value);
    if (!checked.ok) { setError(checked.message); return; }
    setError(null); onSave(checked.value);
  };
  const commit = (raw: string | boolean) => {
    if (state !== "provided") return;
    setDirty(true);
    if (typeof raw === "string" && !raw.trim()) { setState("unknown"); save({ state: "unknown" }); return; }
    save({ state: "provided", value: field.type === "integer" || field.type === "decimal" ? Number(raw) : raw });
  };
  const changeState = (next: ValueState) => {
    setState(next); setDirty(true);
    if (next !== "provided") save({ state: next });
  };

  const control = () => {
    const common = { id, disabled: locked || state !== "provided", "aria-describedby": `${id}-meta` };
    switch (field.type) {
      case "long_text":
        return <textarea {...common} className="textarea" maxLength={field.maxLength} value={text} onChange={(event) => { setText(event.target.value); setDirty(true); }} onBlur={() => text !== initialText(current) && commit(text)} rows={3} />;
      case "enum":
      case "condition_rating": {
        const options = field.type === "condition_rating" ? Object.entries(template.conditionRatingLabels).map(([value, label]) => ({ value, label })) : field.options ?? [];
        return <><select {...common} className="select" value={text} onChange={(event) => { setText(event.target.value); setDirty(true); commit(event.target.value); }}><option value="">Select…</option>{options.map((option) => <option key={option.value} value={option.value}>{field.type === "condition_rating" ? `${option.value} — ` : ""}{option.label}</option>)}</select>{field.type === "condition_rating" && template.key.startsWith("surveynt-home-survey") && text ? <span className={`home-rating home-rating-${text}`} aria-label={`Condition rating ${text}`}>{text}</span> : null}</>;
      }
      case "multi_enum": {
        const selected = text ? text.split(", ") : [];
        return <fieldset disabled={common.disabled} aria-describedby={common["aria-describedby"]}><legend className="form-help">Select all that apply</legend>{(field.options ?? []).map(option => <label className="check-field" key={option.value}><input type="checkbox" checked={selected.includes(option.value)} onChange={event => {
          const next = event.target.checked ? [...selected, option.value] : selected.filter(value => value !== option.value);
          setText(next.join(", ")); setDirty(true);
          if (next.length) save({state:"provided",value:next}); else {setState("unknown");save({state:"unknown"});}
        }}/>{option.label}</label>)}</fieldset>;
      }
      case "boolean":
        return <select {...common} className="select" value={text} onChange={(event) => {setText(event.target.value);if(event.target.value)commit(event.target.value === "true");else{setDirty(true);setState("unknown");save({state:"unknown"});}}}><option value="">Select…</option><option value="true">Yes</option><option value="false">No</option></select>;
      case "integer":
      case "decimal":
        return <input {...common} className="input" type="number" inputMode={field.type === "integer" ? "numeric" : "decimal"} min={field.min} max={field.max} step={field.type === "integer" ? 1 : "any"} value={text} onChange={(event) => { setText(event.target.value); setDirty(true); }} onBlur={() => text !== initialText(current) && commit(text)} />;
      case "date":
        return <input {...common} className="input" type="date" value={text} onChange={(event) => { setText(event.target.value); setDirty(true); commit(event.target.value); }} />;
      default:
        return <input {...common} className="input" maxLength={field.maxLength} value={text} onChange={(event) => { setText(event.target.value); setDirty(true); }} onBlur={() => text !== initialText(current) && commit(text)} />;
    }
  };

  return <div className={`survey-field ${!dirty && display.origin && !["surveyor_entry","edited_proposal"].includes(display.origin) ? "prefilled" : "human-entered"} ${field.fieldClass === "professional_assessment" ? "professional" : ""}`} data-path={path}>
    <div className="survey-field-label">
      <label htmlFor={id}>{field.label}{field.requirement !== "optional" ? <span className="required-mark" aria-hidden="true"> *</span> : null}</label>
      <select className="select state-select" aria-label={`${field.label}: recording state`} value={state} disabled={locked} onChange={(event) => changeState(event.target.value as ValueState)}>
        {valueStates.map((item) => <option key={item} value={item}>{valueStateLabels[item]}</option>)}
      </select>
    </div>
    {control()}
    <p className="form-help" id={`${id}-meta`}>
      {lockedReason ?? (display.pending ? display.deviceOnly ? "Preview answer saved on this device." : "Saved on this device. It will sync when online." : display.origin && display.origin !== "surveyor_entry" ? `Origin: ${display.origin.replace(/_/g, " ")}` : "")}
      {field.guidance ? <span className="field-guidance">{field.guidance}</span> : null}
    </p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <FieldEvidence path={path} />
  </div>;
}
