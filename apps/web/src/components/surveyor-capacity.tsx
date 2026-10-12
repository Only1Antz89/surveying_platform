"use client";
import { useState } from "react";
import Link from "@/components/workspace-link";
import { workloadHeadroom, type SurveyorCapacity } from "@/lib/surveyor-capacity";

export function SurveyorCapacityView({people,slug,compact=false}:{people:SurveyorCapacity[];slug:string;compact?:boolean}) {
  const [query,setQuery]=useState("");
  const [base,setBase]=useState("");
  const [headroomOnly,setHeadroomOnly]=useState(false);
  const visible=people.filter(person=>(!headroomOnly || (workloadHeadroom(person)??0)>0) && (!base || person.base===base) && `${person.name} ${person.base??""} ${person.services.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  const known=people.filter(person=>workloadHeadroom(person)!==null);
  return <section className="panel" aria-label="Surveyor capacity"><div className="panel-header"><div><h2>Surveyor capacity</h2><p>{known.filter(person=>(workloadHeadroom(person)??0)>0).length} with workload headroom · {people.length-known.length} with capacity not configured</p></div>{compact?<Link className="panel-link" href={`/app/${slug}/team`}>View all surveyors →</Link>:null}</div>
    <div className="panel-body"><p className="form-help">Active jobs are compared with each surveyor’s declared limit. Check service skills, coverage and calendar availability when assigning a job.</p>
    {!compact?<div className="form-grid"><label className="field">Search surveyors<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Name, base or service"/></label><label className="field">Operating base<select value={base} onChange={event=>setBase(event.target.value)}><option value="">All locations</option>{[...new Set(people.flatMap(person=>person.base?[person.base]:[]))].map(location=><option key={location}>{location}</option>)}</select></label></div>:null}
    <label className="checkbox-row"><input type="checkbox" checked={headroomOnly} onChange={event=>setHeadroomOnly(event.target.checked)}/> Show surveyors with workload headroom</label></div>
    <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Surveyor</th>{!compact?<th>Services & base</th>:null}<th>Active jobs / limit</th><th>Inspections today</th><th>Headroom</th></tr></thead><tbody>{visible.map(person=>{const remaining=workloadHeadroom(person);return <tr key={person.id}><td><Link href={`/app/${slug}/staff/${person.id}`}><strong>{person.name}</strong></Link></td>{!compact?<td>{person.base??"Base not configured"}<span className="cell-sub">{person.services.join(" · ")||"Services not configured"}</span></td>:null}<td>{person.activeJobs} / {person.capacityJobs??"not configured"}</td><td>{person.inspectionsToday}</td><td><span className={`status ${remaining===null?"status-slate":remaining>0?"status-green":"status-amber"}`}>{remaining===null?"Not configured":remaining>0?`${remaining} more jobs`:"At capacity"}</span></td></tr>;})}</tbody></table></div>
    {!visible.length?<div className="empty-state"><strong>No matching surveyors</strong><span>Adjust the filters or review your team configuration.</span></div>:null}
  </section>;
}
