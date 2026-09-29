import { MailPlus } from "lucide-react";
import { roleLabels } from "@fieldnote/domain";
import { StatusDot } from "@fieldnote/ui";
import { ActionButton } from "@/components/action-feedback";
import { PageHeader } from "@/components/page-header";
import { members } from "@/lib/demo-data";

export const metadata = { title: "Team" };
export default function TeamPage() { return <main className="page"><PageHeader title="Team" description="Control practice access, professional roles and current workload." actions={<ActionButton className="button button-primary" message="Team invitation prepared"><MailPlus size={15} />Invite teammate</ActionButton>} /><section className="panel"><div className="panel-header"><div><h2>Practice members</h2><p>Five of eight available seats</p></div><StatusDot tone="green">MFA required</StatusDot></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Workload</th><th>Access</th></tr></thead><tbody>{members.map((member) => <tr key={member.id}><td data-label="Member"><div style={{ display: "flex", gap: 10, alignItems: "center" }}><span className="avatar">{member.initials}</span><span><strong>{member.name}</strong><span className="cell-sub">{member.email}</span></span></div></td><td data-label="Role">{roleLabels[member.role]}</td><td data-label="Status"><StatusDot tone={member.status === "Active" ? "green" : "amber"}>{member.status}</StatusDot></td><td data-label="Workload">{member.workload}</td><td data-label="Access"><ActionButton message={`Access controls opened for ${member.name}`} className="button button-quiet">Manage</ActionButton></td></tr>)}</tbody></table></div></section></main>; }
