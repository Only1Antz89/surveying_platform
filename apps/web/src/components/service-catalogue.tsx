"use client";
import {workspaceFetch} from "@/lib/workspace-request";
import { alterationSurcharges } from "@/lib/service-pricing-input";
import {useUnsavedChanges} from "./unsaved-changes";
import { useEffect, useState } from "react";
import { StatusDot } from "@surveynt/ui";

type Entry = { service: { id: string; name: string; active: boolean }; pricing: { version: number; currency: string; baseAmountMinor: number; vatBasisPoints: number; depositBasisPoints: number; durationMinutes: number; validityDays: number; surcharges: Record<string,{label:string;amountMinor:number}>; recommendationRules: Record<string,unknown> } | null };
export function ServiceCatalogue({ canEdit }: { canEdit: boolean }) {
  const [entries, setEntries] = useState<Entry[]>([]), [selected, setSelected] = useState<Entry | null | undefined>(undefined), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [dirty,setDirty]=useState(false);useUnsavedChanges(dirty);
  useEffect(() => { let active = true; workspaceFetch("/api/v1/service-catalogue").then(async response => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? "Catalogue could not be loaded."); if (active) setEntries(payload.data); }).catch(error => { if(active)setMessage(error.message); }); return () => { active = false; }; }, []);
  async function save(form: FormData) {
    setBusy(true); setMessage("");
    try {
      const surcharges = { ...(selected?.pricing?.surcharges ?? {}) };
      for (const {key,label} of alterationSurcharges) {
        if (form.get(`surcharge-enabled-${key}`) !== "on") { delete surcharges[key]; continue; }
        const amountMinor = Math.round(Number(form.get(`surcharge-amount-${key}`))*100);
        if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error("Enter a valid surcharge amount.");
        surcharges[key] = { label, amountMinor };
      }
      const recommendationRules={...(selected?.pricing?.recommendationRules??{})};
      if(form.get("recommendation-source")==="clifton_adviser_v1")recommendationRules.source="clifton_adviser_v1";else delete recommendationRules.source;
      const body = { ...(selected ? { expectedVersion: selected.pricing?.version ?? 0 } : {}), name: form.get("name"), baseAmountMinor: Math.round(Number(form.get("fee")) * 100), vatBasisPoints: Math.round(Number(form.get("vat")) * 100), depositBasisPoints: Math.round(Number(form.get("deposit")) * 100), durationMinutes: Number(form.get("duration")), validityDays: Number(form.get("validity")), active: form.get("active") === "on", surcharges, recommendationRules };
      const response = await workspaceFetch(`/api/v1/service-catalogue${selected ? `/${selected.service.id}` : ""}`, { method: selected ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? "Pricing could not be saved.");
      if (payload.meta?.persisted === false) throw new Error("Preview only: this pricing version was not saved.");
      const updated = await workspaceFetch("/api/v1/service-catalogue", { cache: "no-store" }); if (!updated.ok) throw new Error("Saved, but the catalogue could not be refreshed. Reload this page.");
      setEntries((await updated.json()).data); setSelected(undefined);setDirty(false); setMessage("Pricing saved as a new version. Existing accepted quotes are unchanged.");
    } catch(error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  const isSuccess = message.includes("saved");

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Services and versioned pricing</h2>
          <p>Prices exclude VAT; customer quotes preserve their accepted pricing version.</p>
        </div>
        {canEdit ? (
          <button className="button button-secondary" onClick={() => setSelected(null)}>
            Add service
          </button>
        ) : null}
      </div>
      <div className="panel-body">
        {entries.length ? (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Base fee</th>
                  <th>VAT / deposit</th>
                  <th>Duration</th>
                  <th>Availability</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={`${entry.service.id}:${entry.pricing?.version ?? 0}`}>
                    <td>
                      {entry.service.name}
                      <span className="cell-sub">Version {entry.pricing?.version ?? "Not configured"}</span>
                    </td>
                    <td>
                      {entry.pricing
                        ? new Intl.NumberFormat("en-GB", { style: "currency", currency: entry.pricing.currency }).format(
                            entry.pricing.baseAmountMinor / 100
                          )
                        : "Setup required"}
                    </td>
                    <td>
                      {entry.pricing
                        ? `${entry.pricing.vatBasisPoints / 100}% / ${entry.pricing.depositBasisPoints / 100}%`
                        : "—"}
                    </td>
                    <td>{entry.pricing?.durationMinutes ?? "—"} min</td>
                    <td>
                      <div className="table-cell-actions">
                        <StatusDot tone={entry.service.active ? "green" : "slate"}>
                          {entry.service.active ? "Available" : "Archived"}
                        </StatusDot>
                        {canEdit ? (
                          <button className="button button-quiet" onClick={() => setSelected(entry)}>
                            Edit pricing
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="cell-sub">No priced services. Configure the catalogue before creating quotes.</p>
        )}

        {selected !== undefined ? (
          <div
            style={{
              marginTop: "24px",
              padding: "20px",
              border: "1px solid var(--border)",
              borderRadius: "10px",
              background: "var(--surface-2)",
            }}
          >
            <form onChange={()=>setDirty(true)} action={save} key={selected?.service.id ?? "new"}>
              <h3 style={{ margin: "0 0 16px", fontSize: "1.05rem" }}>
                {selected ? "New pricing version" : "New service"}
              </h3>
              <div className="form-grid">
                <label className="field">
                  <span>Service name</span>
                  <input name="name" required maxLength={160} defaultValue={selected?.service.name} />
                </label>
                <label className="field">
                  <span>Base fee ({selected?.pricing?.currency ?? "GBP"} excluding VAT)</span>
                  <input
                    name="fee"
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    defaultValue={(selected?.pricing?.baseAmountMinor ?? 0) / 100}
                  />
                </label>
                <label className="field">
                  <span>VAT (%)</span>
                  <input
                    name="vat"
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    required
                    defaultValue={(selected?.pricing?.vatBasisPoints ?? 2000) / 100}
                  />
                </label>
                <label className="field">
                  <span>Deposit (%)</span>
                  <input
                    name="deposit"
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    required
                    defaultValue={(selected?.pricing?.depositBasisPoints ?? 1000) / 100}
                  />
                </label>
                <label className="field">
                  <span>Visit duration (minutes)</span>
                  <input
                    name="duration"
                    type="number"
                    min={15}
                    max={2880}
                    required
                    defaultValue={selected?.pricing?.durationMinutes ?? 180}
                  />
                </label>
                <label className="field">
                  <span>Quote validity (days)</span>
                  <input
                    name="validity"
                    type="number"
                    min={1}
                    max={365}
                    required
                    defaultValue={selected?.pricing?.validityDays ?? 7}
                  />
                </label>
              </div>

              <div style={{ margin: "16px 0" }}>
                <label className="checkbox-row">
                  <input name="active" type="checkbox" defaultChecked={selected?.service.active ?? true} />
                  <span>Available for new quotes</span>
                </label>
              </div>

              <fieldset
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  padding: "16px",
                  background: "var(--surface)",
                  margin: "16px 0",
                }}
              >
                <legend style={{ fontWeight: 600, padding: "0 6px", fontSize: "0.875rem" }}>
                  Alteration surcharges (excluding VAT)
                </legend>
                <p className="cell-sub" style={{ margin: "0 0 14px", lineHeight: 1.5 }}>
                  These charges apply when the customer declares the matching alteration. VAT and deposit are calculated on
                  the combined price.
                </p>
                <div style={{ display: "grid", gap: "10px" }}>
                  {alterationSurcharges.map(({ key, label }) => (
                    <div className="form-grid" key={key}>
                      <label className="checkbox-row" style={{ margin: "6px 0" }}>
                        <input
                          name={`surcharge-enabled-${key}`}
                          type="checkbox"
                          defaultChecked={Boolean(selected?.pricing?.surcharges[key])}
                        />
                        <span>{label}</span>
                      </label>
                      <label className="field">
                        <span>Additional fee ({selected?.pricing?.currency ?? "GBP"})</span>
                        <input
                          name={`surcharge-amount-${key}`}
                          type="number"
                          min="0"
                          max="1000000"
                          step="0.01"
                          defaultValue={(selected?.pricing?.surcharges[key]?.amountMinor ?? 0) / 100}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </fieldset>

              <label className="field full" style={{ margin: "16px 0" }}>
                <span>Automatic recommendation</span>
                <select
                  name="recommendation-source"
                  className="select"
                  defaultValue={
                    selected?.pricing?.recommendationRules.source === "clifton_adviser_v1" ? "clifton_adviser_v1" : ""
                  }
                  style={{ width: "100%" }}
                >
                  <option value="">Customer selects this service</option>
                  <option value="clifton_adviser_v1">Clifton survey adviser</option>
                </select>
              </label>
              <p className="cell-sub" style={{ margin: "0 0 16px", lineHeight: 1.5 }}>
                The adviser recommends a matching enabled service using the customer’s purpose, property age, alterations and
                defect concerns. Other services remain available for direct selection.
              </p>

              <div className="action-row">
                <button className="button button-primary" disabled={busy}>
                  {busy ? "Saving…" : "Save new version"}
                </button>
                <button type="button" className="button button-quiet" onClick={() => setSelected(undefined)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {message ? (
          <p className={isSuccess ? "form-success" : "form-error"} role="status" style={{ marginTop: "14px" }}>
            <span>{message}</span>
          </p>
        ) : null}
      </div>
    </section>
  );
}
