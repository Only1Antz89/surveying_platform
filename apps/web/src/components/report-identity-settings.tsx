"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

type Identity = {
  companyName?: string;
  address?: string;
  email?: string;
  phone?: string;
  reportName?: string;
};

export function ReportIdentitySettings({
  personal = false,
  canEdit = true,
}: {
  personal?: boolean;
  canEdit?: boolean;
}) {
  const [value, setValue] = useState<Identity>({});
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let current = true;
    fetch(personal ? "/api/v1/me" : "/api/v1/operations/settings", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.error?.message ?? "Identity settings could not load.");
        if (current) {
          let identity = personal
            ? { reportName: payload.data.reportName ?? "", ...payload.data.reportContact }
            : payload.data?.reportIdentity ?? {};
          if (personal && payload.data.preview) {
            try {
              identity = {
                ...identity,
                ...JSON.parse(localStorage.getItem("surveynt:preview-report-identity") ?? "{}"),
              };
            } catch {}
          }
          setValue(identity);
          setReady(true);
        }
      })
      .catch((error) => {
        if (current) setMessage(error.message);
      });
    return () => {
      current = false;
    };
  }, [personal]);

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        personal ? "/api/v1/me" : "/api/v1/operations/report-identity",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            personal
              ? {
                  reportName: value.reportName || null,
                  reportContact: { email: value.email ?? "", phone: value.phone ?? "" },
                }
              : value
          ),
        }
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "The identity could not save.");
      if (personal && payload.meta?.persisted === false)
        localStorage.setItem("surveynt:preview-report-identity", JSON.stringify(value));
      setMessage(
        payload.meta?.persisted === false
          ? personal
            ? "Saved on this device for preview — not to a practice."
            : "Preview only — not saved to a practice."
          : "Report identity saved. Existing survey entries are unchanged."
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-body">
        <h2>{personal ? "Your reusable report identity" : "Approved firm report identity"}</h2>
        <p className="form-help">
          {personal
            ? "Use your own reporting name. Qualifications, signature and declaration remain explicit professional entries."
            : "These are approved report contact details, separate from private office/routing settings."}
        </p>
        <div className="form-grid">
          {(personal
            ? [
                ["reportName", "Name used in reports"],
                ["email", "Professional contact email"],
                ["phone", "Professional contact phone"],
              ]
            : [
                ["companyName", "Company name"],
                ["address", "Report address"],
                ["email", "Report contact email"],
                ["phone", "Report contact phone"],
              ]
          ).map(([key, label]) => (
            <label className="field" key={key}>
              <span>{label}</span>
              <input
                className="input"
                value={value[key as keyof Identity] ?? ""}
                maxLength={key === "address" ? 1000 : key === "phone" ? 80 : 160}
                disabled={!ready || !canEdit || busy}
                onChange={(event) =>
                  setValue((previous) => ({ ...previous, [key]: event.target.value }))
                }
              />
            </label>
          ))}
        </div>
        {canEdit ? (
          <div className="action-row" style={{ marginTop: "1.25rem" }}>
            <button
              className="button button-secondary"
              disabled={!ready || busy}
              onClick={() => void save()}
            >
              Save report identity
            </button>
          </div>
        ) : null}
        {message ? (
          <div
            className={`form-${message.includes("could not") ? "error" : "success"}`}
            role="status"
            style={{ marginTop: "1rem" }}
          >
            {message.includes("could not") ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
            <span>{message}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
