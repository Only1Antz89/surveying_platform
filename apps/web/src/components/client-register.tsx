"use client";

import { FormEvent, useMemo, useState } from "react";
import { Archive, Download, Pencil, Plus, Search, X } from "lucide-react";
import { StatusDot } from "@fieldnote/ui";
import type { Client } from "@/lib/demo-data";

type ApiClient = { id: string; kind: "individual" | "company"; displayName: string; email: string | null; phone: string | null; version: number };

const toClient = (client: ApiClient): Client => ({
  id: client.id,
  name: client.displayName,
  kind: client.kind === "company" ? "Company" : "Individual",
  email: client.email ?? "—",
  phone: client.phone ?? "—",
  properties: 0,
  lastActivity: "Just now",
  version: client.version,
});

export function ClientRegister({ clients: initialClients, canEdit = true }: { clients: Client[]; canEdit?: boolean }) {
  const [clients, setClients] = useState(initialClients);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("All clients");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visible = useMemo(() => clients.filter((client) => `${client.name} ${client.email}`.toLowerCase().includes(query.toLowerCase()) && (kind === "All clients" || client.kind === kind)), [clients, query, kind]);
  const csv = `name,type,email,phone,properties,last activity\n${visible.map((client) => [client.name, client.kind, client.email, client.phone, client.properties, client.lastActivity].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n")}`;

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: form.get("kind"),
        displayName: form.get("displayName"),
        email: String(form.get("email") || "") || undefined,
        phone: String(form.get("phone") || "") || undefined,
      }),
    });
    const payload = await response.json();
    setSaving(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? "The client could not be created.");
      return;
    }
    setClients((current) => [toClient(payload.data), ...current]);
    setCreating(false);
  }

  async function updateClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true); setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/v1/clients/${editing.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: form.get("displayName"), email: String(form.get("email") || "") || null, phone: String(form.get("phone") || "") || null, version: editing.version ?? 1 }) });
    const payload = await response.json(); setSaving(false);
    if (!response.ok) return setError(payload?.error?.message ?? "The client could not be updated.");
    setClients((current) => current.map((client) => client.id === editing.id ? { ...client, name: payload.data.displayName, email: payload.data.email ?? "—", phone: payload.data.phone ?? "—", lastActivity: "Just now", version: payload.data.version } : client));
    setEditing(null);
  }

  async function archiveClient(client: Client) {
    if (!window.confirm(`Archive ${client.name}? Existing jobs will retain their client reference.`)) return;
    setError(null);
    const response = await fetch(`/api/v1/clients/${client.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived: true, version: client.version ?? 1 }) });
    const payload = await response.json();
    if (!response.ok) return setError(payload?.error?.message ?? "The client could not be archived.");
    setClients((current) => current.filter((item) => item.id !== client.id));
  }

  return <>
    <section className="panel">
      <div className="toolbar"><div className="search"><Search /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clients or email" aria-label="Search clients" /></div><select className="select" value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Client type"><option>All clients</option><option>Individual</option><option>Company</option></select><a className="button button-secondary" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download="fieldnote-clients.csv"><Download size={15} />Export</a><button className="button button-primary" onClick={() => setCreating(true)} disabled={!canEdit}><Plus size={15} />New client</button></div>
      {error && !creating && !editing ? <div className="form-section"><p className="form-error" role="alert">{error}</p></div> : null}
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Client</th><th>Type</th><th>Phone</th><th>Properties</th><th>Last activity</th>{canEdit ? <th>Actions</th> : null}</tr></thead><tbody>{visible.map((client) => <tr key={client.id}><td data-label="Client"><strong>{client.name}</strong><span className="cell-sub">{client.email}</span></td><td data-label="Type"><StatusDot tone={client.kind === "Company" ? "blue" : "slate"}>{client.kind}</StatusDot></td><td data-label="Phone">{client.phone}</td><td data-label="Properties">{client.properties}</td><td data-label="Last activity">{client.lastActivity}</td>{canEdit ? <td data-label="Actions"><div className="row-actions"><button className="button button-quiet" onClick={() => { setError(null); setEditing(client); }}><Pencil size={14} />Edit</button><button className="button button-quiet danger" onClick={() => archiveClient(client)}><Archive size={14} />Archive</button></div></td> : null}</tr>)}</tbody></table></div>
      {visible.length === 0 ? <div className="empty-state"><strong>No clients found</strong><span>{clients.length ? "Adjust your search or filter." : "Create your first client to begin."}</span></div> : null}
      <div className="table-footer"><span>Showing {visible.length} of {clients.length} clients</span><div className="pager"><button className="active" aria-label="Page 1">1</button></div></div>
    </section>
    {creating ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreating(false); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-client-title">
        <div className="modal-header"><div><h2 id="new-client-title">New client</h2><p>Add an individual or organisation to this workspace.</p></div><button className="icon-button" aria-label="Close new client form" onClick={() => setCreating(false)}><X size={16} /></button></div>
        <form onSubmit={createClient}>
          <div className="form-section"><div className="form-grid">
            <div className="field"><label htmlFor="client-kind">Client type</label><select id="client-kind" name="kind" className="input" defaultValue="individual"><option value="individual">Individual</option><option value="company">Company</option></select></div>
            <div className="field"><label htmlFor="client-name">Display name</label><input id="client-name" name="displayName" className="input" required minLength={2} maxLength={160} autoFocus /></div>
            <div className="field"><label htmlFor="client-email">Email</label><input id="client-email" name="email" className="input" type="email" /></div>
            <div className="field"><label htmlFor="client-phone">Phone</label><input id="client-phone" name="phone" className="input" maxLength={40} /></div>
          </div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div>
          <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setCreating(false)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Creating…" : "Create client"}</button></div>
        </form>
      </section>
    </div> : null}
    {editing ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-client-title"><div className="modal-header"><div><h2 id="edit-client-title">Edit client</h2><p>Update contact details without changing existing job history.</p></div><button className="icon-button" aria-label="Close edit client form" onClick={() => setEditing(null)}><X size={16} /></button></div><form onSubmit={updateClient}><div className="form-section"><div className="form-grid"><div className="field full"><label htmlFor="edit-client-name">Display name</label><input id="edit-client-name" name="displayName" className="input" defaultValue={editing.name} required minLength={2} maxLength={160} autoFocus /></div><div className="field"><label htmlFor="edit-client-email">Email</label><input id="edit-client-email" name="email" className="input" type="email" defaultValue={editing.email === "—" ? "" : editing.email} /></div><div className="field"><label htmlFor="edit-client-phone">Phone</label><input id="edit-client-phone" name="phone" className="input" maxLength={40} defaultValue={editing.phone === "—" ? "" : editing.phone} /></div></div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></div></form></section></div> : null}
  </>;
}
