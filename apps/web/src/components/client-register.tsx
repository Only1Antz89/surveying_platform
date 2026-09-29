"use client";

import { useMemo, useState } from "react";
import { Download, Plus, Search } from "lucide-react";
import { StatusDot } from "@fieldnote/ui";
import type { Client } from "@/lib/demo-data";
import { ActionButton } from "./action-feedback";

export function ClientRegister({ clients }: { clients: Client[] }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("All clients");
  const visible = useMemo(() => clients.filter((client) => `${client.name} ${client.email}`.toLowerCase().includes(query.toLowerCase()) && (kind === "All clients" || client.kind === kind)), [clients, query, kind]);
  return <section className="panel">
    <div className="toolbar"><div className="search"><Search /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clients or email" aria-label="Search clients" /></div><select className="select" value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Client type"><option>All clients</option><option>Individual</option><option>Company</option></select><ActionButton message="CSV export prepared"><Download size={15} />Export</ActionButton><ActionButton className="button button-primary" message="Client creation flow opened"><Plus size={15} />New client</ActionButton></div>
    <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Client</th><th>Type</th><th>Phone</th><th>Properties</th><th>Last activity</th></tr></thead><tbody>{visible.map((client) => <tr key={client.id}><td data-label="Client"><strong>{client.name}</strong><span className="cell-sub">{client.email}</span></td><td data-label="Type"><StatusDot tone={client.kind === "Company" ? "blue" : "slate"}>{client.kind}</StatusDot></td><td data-label="Phone">{client.phone}</td><td data-label="Properties">{client.properties}</td><td data-label="Last activity">{client.lastActivity}</td></tr>)}</tbody></table></div>
    <div className="table-footer"><span>Showing {visible.length} of {clients.length} clients</span><div className="pager"><button className="active">1</button></div></div>
  </section>;
}
