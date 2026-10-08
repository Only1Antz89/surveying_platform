"use client";

import { useId, useState } from "react";
import { valueStateLabels, valueStates, type FieldDefinition, type FieldValue, type FormTemplate, type ValueState } from "@surveynt/assistant";
import { FieldEvidence } from "./field-evidence";

export type FieldDisplay = { value: FieldValue | null; pending: boolean; contentRemoved?: boolean; origin: string | null };

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
  // Reset local edits when the stored value changes (sync, conflict resolution).
  if (seen !== signature) {
    setSeen(signature);
    setState(current?.state ?? "provided");
    setText(initialText(current));
  }

  if (display.contentRemoved) return <div className="survey-field" data-path={path}>
    <div className="survey-field-label"><span>{field.label}</span></div>
    <p className="form-help" role="status">Answer content removed after retention review. Identity and provenance history remain.</p>
  </div>;

  const locked = disabled || Boolean(lockedReason);
  const commit = (raw: string | boolean) => {
    if (state !== "provided") return;
    if (typeof raw === "string" && !raw.trim()) return;
    let value: string | number | boolean;
    if (field.type === "integer" || field.type === "decimal") value = Number(raw);
    else value = raw;
    onSave({ state: "provided", value });
  };
  const changeState = (next: ValueState) => {
    setState(next);
    if (next !== "provided") onSave({ state: next });
  };

  const control = () => {
    const common = { id, disabled: locked || state !== "provided", "aria-describedby": `${id}-meta` };
    switch (field.type) {
      case "long_text":
        return <textarea {...common} className="textarea" maxLength={field.maxLength} value={text} onChange={(event) => setText(event.target.value)} onBlur={() => text !== initialText(current) && commit(text)} rows={3} />;
      case "enum":
      case "condition_rating": {
        const options = field.type === "condition_rating" ? Object.entries(template.conditionRatingLabels).map(([value, label]) => ({ value, label })) : field.options ?? [];
        return <><select {...common} className="select" value={text} onChange={(event) => { setText(event.target.value); commit(event.target.value); }}><option value="">Select…</option>{options.map((option) => <option key={option.value} value={option.value}>{field.type === "condition_rating" ? `${option.value} — ` : ""}{option.label}</option>)}</select>{field.type === "condition_rating" && template.key.startsWith("surveynt-home-survey") && text ? <span className={`home-rating home-rating-${text}`} aria-label={`Condition rating ${text}`}>{text}</span> : null}</>;
      }
      case "boolean":
        return <select {...common} className="select" value={current?.state === "provided" ? String(current.value) : ""} onChange={(event) => event.target.value && commit(event.target.value === "true")}><option value="">Select…</option><option value="true">Yes</option><option value="false">No</option></select>;
      case "integer":
      case "decimal":
        return <input {...common} className="input" type="number" inputMode={field.type === "integer" ? "numeric" : "decimal"} min={field.min} max={field.max} step={field.type === "integer" ? 1 : "any"} value={text} onChange={(event) => setText(event.target.value)} onBlur={() => text !== initialText(current) && commit(text)} />;
      case "date":
        return <input {...common} className="input" type="date" value={text} onChange={(event) => { setText(event.target.value); commit(event.target.value); }} />;
      default:
        return <input {...common} className="input" maxLength={field.maxLength} value={text} onChange={(event) => setText(event.target.value)} onBlur={() => text !== initialText(current) && commit(text)} />;
    }
  };

  return <div className={`survey-field ${field.fieldClass === "professional_assessment" ? "professional" : ""}`} data-path={path}>
    <div className="survey-field-label">
      <label htmlFor={id}>{field.label}{field.requirement !== "optional" ? <span className="required-mark" aria-hidden="true"> *</span> : null}</label>
      <select className="select state-select" aria-label={`${field.label}: recording state`} value={state} disabled={locked} onChange={(event) => changeState(event.target.value as ValueState)}>
        {valueStates.map((item) => <option key={item} value={item}>{valueStateLabels[item]}</option>)}
      </select>
    </div>
    {control()}
    <p className="form-help" id={`${id}-meta`}>
      {lockedReason ?? (display.pending ? "Saved on this device. It will sync when online." : display.origin && display.origin !== "surveyor_entry" ? `Origin: ${display.origin.replace(/_/g, " ")}` : "")}
      {field.guidance ? <span className="field-guidance">{field.guidance}</span> : null}
    </p>
    <FieldEvidence path={path} />
  </div>;
}
