"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, ListChecks, TriangleAlert } from "lucide-react";
import type { CheckItem } from "@surveynt/assistant";
import { completionReportFromPack } from "@/lib/completion-input";
import type { SurveyPack } from "@/lib/surveys";

/**
 * Completion checks computed on the device from the survey pack, so they work
 * offline. The server runs the same checks again before internal review or issue.
 */
export function CompletionPanel({ pack, pendingCount, onGoTo }: { pack: SurveyPack; pendingCount: number; onGoTo: (sectionKey: string, elementKey: string) => void }) {
  const report = useMemo(() => completionReportFromPack(pack), [pack]);
  const [showAll, setShowAll] = useState(false);
  if (!report) return <section className="panel"><div className="empty-state compact"><strong>No completion rules for template {pack.survey.templateVersion}</strong><span>Checks will run when a rule set for this template version is published.</span></div></section>;
  const failures = report.items.filter((item) => item.status === "fail");
  const hard = failures.filter((item) => item.severity === "hard_gate");
  const advisory = failures.filter((item) => item.severity === "advisory");
  const row = (item: CheckItem) => {
    const [sectionKey, elementKey] = item.elementKey?.split(".") ?? [];
    return <li key={item.id} className={`completion-item ${item.status} ${item.severity}`}>
      {item.status === "pass" ? <CheckCircle2 size={15} aria-label="Passed" /> : item.severity === "hard_gate" ? <CircleAlert size={15} aria-label="Must be resolved" /> : <TriangleAlert size={15} aria-label="Advisory" />}
      <div>
        {sectionKey && elementKey && item.status === "fail" ? <button type="button" className="table-link-button" onClick={() => onGoTo(sectionKey, elementKey)}><strong>{item.title}</strong></button> : <strong>{item.title}</strong>}
        {item.detail ? <span>{item.detail}</span> : null}
        {item.justification && item.status === "fail" ? <span className="cell-sub">Why: {item.justification}</span> : null}
        {item.status === "fail" && item.severity === "hard_gate" ? <span className="cell-sub">{item.overrideReasons.length ? "Can proceed with a recorded reason when moving the job on." : "Must be resolved before internal review."}</span> : null}
      </div>
    </li>;
  };
  return <section className="panel completion-panel" aria-labelledby="completion-heading">
    <div className="panel-header"><div><h2 id="completion-heading">Completion checks</h2><p>{report.ready ? "Ready for internal review." : `${hard.length} to resolve before internal review · ${advisory.length} advisory`} Rules {report.ruleSetVersion} for template {report.templateVersion}.</p></div><ListChecks size={17} color="#3b82f6" aria-hidden="true" /></div>
    {pendingCount ? <p className="identity-warning intel-inline">{pendingCount} change{pendingCount === 1 ? "" : "s"} saved on this device {pendingCount === 1 ? "is" : "are"} not yet included. Sync to update these checks.</p> : null}
    {!showAll && failures.length ? <ul className="completion-list">{[...hard, ...advisory].slice(0, 3).map(row)}</ul> : !failures.length ? <p className="form-help assistant-empty">All checks pass.</p> : null}
    <div className="completion-footer"><button type="button" className="button button-quiet" onClick={() => setShowAll((value) => !value)} aria-expanded={showAll}>{showAll ? "Hide full checklist" : `Show full checklist (${report.items.length} items)`}</button></div>
    {showAll ? <ul className="completion-list full">{report.items.map(row)}</ul> : null}
  </section>;
}
