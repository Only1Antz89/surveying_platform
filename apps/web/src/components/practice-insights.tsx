"use client";
import {workspaceFetch} from "@/lib/workspace-request";

import { useEffect, useState } from "react";
import { AlertCircle, Download } from "lucide-react";
import { jobStageLabels, type JobStage } from "@surveynt/domain";
import type { PracticeInsights } from "@/lib/insights";

export function PracticeInsightsView() {
  const [range, setRange] = useState(() => ({
    from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  }));
  const [data, setData] = useState<PracticeInsights | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    workspaceFetch(`/api/v1/insights?${new URLSearchParams(range)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "Insights unavailable.");
        setData(payload.data);
        setError("");
        setLoading(false);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(error.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [range]);

  const money = (minor: number, currency: string) =>
    new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);

  return (
    <>
      <form
        className="panel action-panel form-grid"
        action={(form) => {
          setLoading(true);
          setRange({ from: String(form.get("from")), to: String(form.get("to")) });
        }}
      >
        <label className="field">
          <span>From</span>
          <input type="date" name="from" defaultValue={range.from} required />
        </label>
        <label className="field">
          <span>Through</span>
          <input type="date" name="to" defaultValue={range.to} required />
        </label>
        <div className="form-grid-full action-row" style={{ marginTop: "0.25rem" }}>
          <button className="button button-primary" disabled={loading}>
            Apply dates
          </button>
          {data && !loading ? (
            <a
              className="button button-secondary"
              href={`/api/v1/insights?${new URLSearchParams({ ...range, format: "csv" })}`}
            >
              <Download size={14} />
              Export these indicators
            </a>
          ) : null}
        </div>
      </form>

      {loading ? (
        <p role="status" className="form-help">
          Loading practice indicators…
        </p>
      ) : null}

      {error ? (
        <div className="form-error" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      {data && !loading && !error ? (
        <>
          <section className="metric-grid">
            <Metric label="Quotes created in period" value={String(data.quotes)} />
            <Metric label="Quote cohort converted" value={String(data.converted)} />
            <Metric
              label="Quote conversion"
              value={data.conversionPercent === null ? "—" : `${data.conversionPercent}%`}
            />
            <Metric
              label="Average creation to issue"
              value={
                data.completion.days === null
                  ? "Not recorded"
                  : `${data.completion.days.toFixed(1)} days`
              }
            />
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Financial indicators</h2>
                <p>
                  Period receipts, refunds, credit notes and billed invoices; outstanding balances
                  are current. Currencies are never combined.
                </p>
              </div>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Currency</th>
                    <th>Received</th>
                    <th>Refunded</th>
                    <th>Net receipts</th>
                    <th>Billed</th>
                    <th>Credit notes</th>
                    <th>Outstanding now</th>
                  </tr>
                </thead>
                <tbody>
                  {data.money.map((row) => (
                    <tr key={row.currency}>
                      <td>
                        <strong>{row.currency}</strong>
                      </td>
                      <td>{money(row.receivedMinor, row.currency)}</td>
                      <td>{money(row.refundedMinor, row.currency)}</td>
                      <td>{money(row.receivedMinor - row.refundedMinor, row.currency)}</td>
                      <td>{money(row.billedMinor, row.currency)}</td>
                      <td>{money(row.creditedMinor, row.currency)}</td>
                      <td>
                        <strong>{money(row.outstandingMinor, row.currency)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.money.length ? (
              <p className="panel-body muted-text">No financial events recorded.</p>
            ) : null}
          </section>

          <div className="dashboard-grid">
            <Distribution
              title="Current pipeline"
              explanation="Current non-archived jobs, independent of the period filter."
              rows={data.pipeline.map((row) => ({
                ...row,
                name: jobStageLabels[row.name as JobStage] ?? row.name,
              }))}
            />
            <Distribution
              title="Current workload"
              explanation="Unpaid, non-archived jobs by assigned professional."
              rows={data.workload}
            />
          </div>

          <Distribution
            title="Service mix"
            explanation="Jobs created in the selected period. Conversion describes the current outcome of quotes created in that period."
            rows={data.services}
          />

          <p className="form-help">
            Completion time uses recorded issue-stage events ({data.completion.count} jobs), not
            inferred status dates. Financial indicators are operational, not statutory accounts.
          </p>
        </>
      ) : null}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <div className="metric-head">{label}</div>
      <div className="metric-value">{value}</div>
    </div>
  );
}

function Distribution({
  title,
  explanation,
  rows,
}: {
  title: string;
  explanation: string;
  rows: { name: string; count: number }[];
}) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <p>{explanation}</p>
        </div>
      </div>
      <div className="panel-body">
        {rows.length ? (
          <ul className="insight-bars">
            {rows.map((row) => (
              <li key={row.name}>
                <div>
                  <span>{row.name}</span>
                  <strong>{row.count}</strong>
                </div>
                <span className="insight-bar" aria-hidden="true">
                  <span style={{ width: `${(row.count / max) * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted-text">No records for this view.</p>
        )}
      </div>
    </section>
  );
}
