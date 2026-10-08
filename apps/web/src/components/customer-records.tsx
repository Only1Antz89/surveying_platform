"use client";
import {workspaceFetch} from "@/lib/workspace-request";

import { useEffect, useState } from "react";
import { AlertCircle, FileText, Receipt } from "lucide-react";
import type { ComposedReport } from "@surveynt/assistant";

type Invoice = {
  id: string;
  number: string;
  status: string;
  currency: string;
  totalMinor: number;
  creditedMinor?: number;
};

export function CustomerRecords({
  id,
  token,
  invoices,
}: {
  id: string;
  token: string;
  invoices: Invoice[];
}) {
  const [reports, setReports] = useState<
    { id: string; version: number; approvedAt: string; content: ComposedReport }[]
  >([]);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [received, setReceived] = useState<string[]>([]);
  async function confirmReceipt(reportVersionId: string) {
    setConfirming(reportVersionId); setError("");
    try {
      const response = await workspaceFetch(`/api/v1/public/quotes/${id}/reports`, {
        method: "POST", headers: { "content-type": "application/json", "x-quote-token": token },
        body: JSON.stringify({ reportVersionId, confirmed: true }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Receipt confirmation failed.");
      setReceived(previous => [...previous, reportVersionId]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Receipt confirmation failed. Try again."); }
    finally { setConfirming(null); }
  }

  useEffect(() => {
    let active = true;
    workspaceFetch(`/api/v1/public/quotes/${id}/reports`, {
      headers: { "x-quote-token": token },
      cache: "no-store",
    })
      .then(async (r) => {
        const p = await r.json();
        if (!r.ok) throw new Error(p.error?.message ?? "Reports unavailable.");
        if (active) setReports(p.data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, token]);

  return (
    <>
      <section className="quote-form">
        <h2>Your invoices</h2>
        {invoices.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {invoices.map((i) => {
              const statusTone =
                i.status === "paid"
                  ? "status-green"
                  : i.status === "partially_paid"
                    ? "status-blue"
                    : "status-slate";
              return (
                <div className="deposit-item" key={i.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                    <Receipt size={16} style={{ color: "var(--muted)", flexShrink: 0 }} />
                    <strong>{i.number}</strong>
                    <span className={`status ${statusTone}`}>
                      {i.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                    <span style={{ fontWeight: 600 }}>
                      {new Intl.NumberFormat("en-GB", {
                        style: "currency",
                        currency: i.currency,
                      }).format((i.totalMinor - Number(i.creditedMinor ?? 0)) / 100)}
                    </span>
                    {Number(i.creditedMinor ?? 0) > 0 ? (
                      <span className="muted-text" style={{ fontSize: "0.8125rem" }}>
                        Credit notes{" "}
                        {new Intl.NumberFormat("en-GB", {
                          style: "currency",
                          currency: i.currency,
                        }).format(Number(i.creditedMinor) / 100)}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="form-help">No invoices issued yet.</p>
        )}
      </section>

      <section className="quote-form">
        <h2>Your issued reports</h2>
        {error ? (
          <div className="form-error" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        ) : null}
        {!reports.length && !error ? (
          <p className="form-help">
            Only issued, approved reports appear here. Draft inspection notes are never disclosed.
          </p>
        ) : null}
        {reports.map((r) => (
          <details className="accordion-card" key={r.id}>
            <summary className="accordion-summary">
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <FileText size={16} style={{ color: "var(--blue)" }} />
                <span>
                  Approved report · version {r.version} ·{" "}
                  {new Date(r.approvedAt).toLocaleDateString("en-GB")}
                </span>
              </div>
            </summary>
            <div className="details-panel">
              {received.includes(r.id) ? <p role="status">Report receipt confirmed.</p> : <button type="button" className="button button-secondary" disabled={confirming !== null} onClick={() => void confirmReceipt(r.id)}>{confirming === r.id ? "Confirming…" : "Confirm report received"}</button>}
              <div className="survey-workspace">
                <article className="report-preview">
                  <header>
                    <h3>{r.content.title}</h3>
                    <p>
                      {r.content.property.line1} · {r.content.jobReference}
                    </p>
                  </header>
                  {r.content.ratingSummary.map((g) => (
                    <div className="report-ratings" key={g.rating}>
                      <strong>{g.label}</strong>
                      <span>{g.elements.map((e) => e.title).join(", ")}</span>
                    </div>
                  ))}
                  {r.content.sections.map((s) => (
                    <section key={s.key}>
                      <h4>{s.title}</h4>
                      {s.blocks.map((b) => (
                        <p key={b.id}>{b.text}</p>
                      ))}
                      {s.elements.map((e) => (
                        <div key={e.key}>
                          <h5>{e.title}</h5>
                          {e.blocks.map((b) => (
                            <p key={b.id}>{b.text}</p>
                          ))}
                        </div>
                      ))}
                    </section>
                  ))}
                  {r.content.recommendations.map((b) => (
                    <p key={b.id}>{b.text}</p>
                  ))}
                </article>
              </div>
            </div>
          </details>
        ))}
      </section>
    </>
  );
}
