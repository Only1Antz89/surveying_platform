import { featureAdoption } from "@/lib/feature-usage";

/** How many practices used each part of Surveynt in the last 30 days. Counts only; no user data. */
export async function FeatureAdoption({ preview }: { preview: boolean }) {
  const data = preview ? null : await featureAdoption(30);
  return <section className="panel">
    <div className="panel-header"><div><h2>Feature adoption</h2><p>Practices that opened each area in the last 30 days{data ? `, out of ${data.practices} active practices` : ""}. Counted per practice per day, with no user identifiers.</p></div></div>
    <div className="panel-body">
      {!data ? <p className="muted">Recorded once a database is configured.</p> : data.features.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Area</th><th>Practices</th><th>Adoption</th><th>Visits</th></tr></thead><tbody>{data.features.map((row) => <tr key={row.feature}><td>{row.label}</td><td>{row.practices}</td><td><span className="adoption-bar" style={{ ["--share" as string]: `${data.practices ? Math.round(row.practices / data.practices * 100) : 0}%` }}><span /></span>{data.practices ? `${Math.round(row.practices / data.practices * 100)}%` : "—"}</td><td>{row.uses.toLocaleString("en-GB")}</td></tr>)}</tbody></table></div> : <p className="muted">No usage recorded yet.</p>}
    </div>
  </section>;
}
