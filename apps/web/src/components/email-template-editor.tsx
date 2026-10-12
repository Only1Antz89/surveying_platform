"use client";
import {workspaceFetch} from "@/lib/workspace-request";
import {useUnsavedChanges} from "./unsaved-changes";
import { useState } from "react";
import { emailTemplatesSchema, fillQuoteTemplate, quoteTemplateDefaults, type EmailTemplates } from "@/lib/email-template-settings";
import { AlertCircle, CheckCircle2, Mail, RotateCcw, Save } from "lucide-react";

export function EmailTemplateEditor({ initial, canEdit }: { initial: EmailTemplates; canEdit: boolean }) {
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState(initial.customer_quote_issued ?? quoteTemplateDefaults);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const example = { customerName: "Alex Customer", organisationName: "Example Surveyors", quoteReference: "QUO-123", total: "£450.00" };

  useUnsavedChanges(JSON.stringify(value)!==JSON.stringify(saved.customer_quote_issued??quoteTemplateDefaults));
  async function save(reset = false) {
    const templates = reset ? {} : { customer_quote_issued: value };
    const valid = emailTemplatesSchema.safeParse(templates);
    if (!valid.success) {
      setMessage(valid.error.issues[0]?.message ?? "Check the template.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await workspaceFetch("/api/v1/operations/email-templates", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expected: saved, templates: valid.data, confirmed }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Template could not be saved.");
      if (payload.meta?.persisted === false) {
        setMessage("Preview only: template was not saved.");
        return;
      }
      setSaved(payload.data);
      setValue(payload.data.customer_quote_issued ?? quoteTemplateDefaults);
      setConfirmed(false);
      setMessage(reset ? "Default quote template restored." : "Quote template saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Template could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const isSuccess = message.includes("saved") || message.includes("restored");

  return (
    <section className="panel form-section" style={{ marginTop: "24px" }}>
      <div className="flex items-center gap-2" style={{ marginBottom: "6px" }}>
        <Mail size={18} className="text-blue" />
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Quote email template</h2>
      </div>
      <p className="cell-sub" style={{ margin: "0 0 16px", lineHeight: 1.55 }}>
        Customize messages sent when customer quotes are issued. Merge tags available:{" "}
        <code className="reference">{"{{customerName}}"}</code>,{" "}
        <code className="reference">{"{{organisationName}}"}</code>,{" "}
        <code className="reference">{"{{quoteReference}}"}</code>, and{" "}
        <code className="reference">{"{{total}}"}</code>.
      </p>

      <div className="form-grid">
        <label className="field full">
          <span>Subject line</span>
          <input
            maxLength={160}
            value={value.subject}
            disabled={!canEdit || busy}
            onChange={(event) => {
              setValue({ ...value, subject: event.target.value });
              setConfirmed(false);
            }}
            placeholder="Your survey quote from {{organisationName}}"
          />
        </label>
        <label className="field full">
          <span>Introduction message</span>
          <textarea
            maxLength={1500}
            rows={4}
            value={value.introduction}
            disabled={!canEdit || busy}
            onChange={(event) => {
              setValue({ ...value, introduction: event.target.value });
              setConfirmed(false);
            }}
            placeholder="Thank you for contacting us regarding your property survey..."
          />
        </label>
      </div>

      <div style={{ marginTop: "20px" }}>
        <span className="eyebrow">Customer inbox preview</span>
        <div className="email-preview-card">
          <div className="email-preview-header">
            <div>
              <span>Recipient:</span>
              <strong>{example.customerName}</strong> &lt;alex.customer@example.com&gt;
            </div>
            <div>
              <span>Subject:</span>
              <strong>{fillQuoteTemplate(value.subject, example)}</strong>
            </div>
          </div>
          <div className="email-preview-body">
            <p style={{ whiteSpace: "pre-wrap", margin: "0 0 16px" }}>
              {fillQuoteTemplate(value.introduction, example)}
            </p>
            <div
              style={{
                borderTop: "1px dashed var(--border)",
                paddingTop: "14px",
                fontSize: "0.8125rem",
                color: "var(--muted)",
              }}
            >
              <p style={{ margin: "0 0 4px" }}>
                <strong>Quote details:</strong> {example.quoteReference} · Total: {example.total}
              </p>
              <p style={{ margin: 0 }}>
                [Secure portal link, cancellation terms and expiration date are automatically attached below this message]
              </p>
            </div>
          </div>
        </div>
      </div>

      {canEdit ? (
        <div style={{ marginTop: "16px" }}>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>I reviewed this template and confirm the changes for future customer emails.</span>
          </label>
          <div className="form-actions" style={{ gap: "10px", marginTop: "14px" }}>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy || !confirmed}
              onClick={() => void save(true)}
            >
              <RotateCcw size={14} />
              <span>Restore default template</span>
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={busy || !confirmed}
              onClick={() => void save()}
            >
              <Save size={14} />
              <span>{busy ? "Saving…" : "Save template"}</span>
            </button>
          </div>
        </div>
      ) : null}

      {message ? (
        <p className={isSuccess ? "form-success" : "form-error"} role="status" style={{ marginTop: "14px" }}>
          {isSuccess ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{message}</span>
        </p>
      ) : null}
    </section>
  );
}
