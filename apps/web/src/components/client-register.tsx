"use client";

import { FormEvent, useMemo, useState } from "react";
import { Archive, ContactRound, Download, Pencil, Plus, Star, Trash2, Search, X } from "lucide-react";
import { StatusDot } from "@surveynt/ui";
import type { Client } from "@/lib/demo-data";
import "./client-record.css";

type ApiClient = { id: string; kind: "individual" | "company"; displayName: string; email: string | null; phone: string | null; version: number };
type ClientContact = { id: string; name: string; email: string | null; phone: string | null; preferredChannel: "email" | "phone" | "sms" | "post"; primary: boolean };

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

export function ClientRegister({ clients: initialClients, canEdit = true, apiBase = "/api/v1/clients", organisationSlug }: { clients: Client[]; canEdit?: boolean; apiBase?: string; organisationSlug?: string }) {
  const [clients, setClients] = useState(initialClients);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("All clients");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [contacts, setContacts] = useState<ClientContact[]>([]);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visible = useMemo(() => clients.filter((client) => `${client.name} ${client.email}`.toLowerCase().includes(query.toLowerCase()) && (kind === "All clients" || client.kind === kind)), [clients, query, kind]);
  const csv = `name,type,email,phone,properties,last activity\n${visible.map((client) => [client.name, client.kind, client.email, client.phone, client.properties, client.lastActivity].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n")}`;

  function fetchClient(url: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    if (organisationSlug) headers.set("x-demo-organisation-slug", organisationSlug);
    return fetch(url, { ...options, headers });
  }

  async function openClient(client: Client) {
    try {
      setError(null); setLoadingRecord(true); setEditing(null);
      const response = await fetchClient(`${apiBase}/${client.id}`);
      const payload = await response.json(); setLoadingRecord(false);
      if (!response.ok) return setError(payload?.error?.message ?? "The client record could not be opened.");
      setContacts(payload.data.contacts as ClientContact[]);
      setEditing({ ...client, ...toClient(payload.data.client), properties: client.properties });
    } catch (error) {
      setError(error instanceof Error ? error.message : "The client request failed. Please retry.");
    } finally {
      setSaving(false);
      setLoadingRecord(false);
    }
  }

  async function createClient(event: FormEvent<HTMLFormElement>) {
    try {
      if (!canEdit) return;
      event.preventDefault();
      setSaving(true);
      setError(null);
      const form = new FormData(event.currentTarget);
      const response = await fetchClient(apiBase, {
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
    } catch (error) {
      setError(error instanceof Error ? error.message : "The client request failed. Please retry.");
    } finally {
      setSaving(false);
      setLoadingRecord(false);
    }
  }

  async function updateClient(event: FormEvent<HTMLFormElement>) {
    try {
      if (!canEdit) return;
      event.preventDefault();
      if (!editing) return;
      setSaving(true); setError(null);
      const form = new FormData(event.currentTarget);
      const response = await fetchClient(`${apiBase}/${editing.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: form.get("displayName"), email: String(form.get("email") || "") || null, phone: String(form.get("phone") || "") || null, version: editing.version ?? 1 }) });
      const payload = await response.json(); setSaving(false);
      if (!response.ok) return setError(payload?.error?.message ?? "The client could not be updated.");
      setClients((current) => current.map((client) => client.id === editing.id ? { ...client, name: payload.data.displayName, email: payload.data.email ?? "—", phone: payload.data.phone ?? "—", lastActivity: "Just now", version: payload.data.version } : client));
      setEditing((current) => current ? { ...current, name: payload.data.displayName, email: payload.data.email ?? "—", phone: payload.data.phone ?? "—", lastActivity: "Just now", version: payload.data.version } : current);
    } catch (error) {
      setError(error instanceof Error ? error.message : "The client request failed. Please retry.");
    } finally {
      setSaving(false);
      setLoadingRecord(false);
    }
  }

  async function archiveClient(client: Client) {
    try {
      if (!canEdit) return;
      if (!window.confirm(`Archive ${client.name}? Existing jobs will retain their client reference.`)) return;
      setError(null);
      const response = await fetchClient(`${apiBase}/${client.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived: true, version: client.version ?? 1 }) });
      const payload = await response.json();
      if (!response.ok) return setError(payload?.error?.message ?? "The client could not be archived.");
      setClients((current) => current.filter((item) => item.id !== client.id));
    } catch (error) {
      setError(error instanceof Error ? error.message : "The client request failed. Please retry.");
    } finally {
      setSaving(false);
      setLoadingRecord(false);
    }
  }

  async function addContact(event: FormEvent<HTMLFormElement>) {
    try {
      if (!canEdit) return;
      event.preventDefault();
      if (!editing) return;
      setSaving(true); setError(null);
      const formElement = event.currentTarget;
      const form = new FormData(formElement);
      const response = await fetchClient(`${apiBase}/${editing.id}/contacts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name"), email: String(form.get("email") || "") || null, phone: String(form.get("phone") || "") || null, preferredChannel: form.get("preferredChannel"), primary: form.get("primary") === "on" }) });
      const payload = await response.json(); setSaving(false);
      if (!response.ok) return setError(payload?.error?.message ?? "The contact could not be added.");
      const created = payload.data as ClientContact;
      setContacts((current) => [created, ...current.map((contact) => created.primary ? { ...contact, primary: false } : contact)]);
      formElement.reset();
    } catch (error) {
      setError(error instanceof Error ? error.message : "The client request failed. Please retry.");
    } finally {
      setSaving(false);
      setLoadingRecord(false);
    }
  }

  async function updateContact(contact: ClientContact, changes: Partial<Pick<ClientContact, "preferredChannel" | "primary">>) {
    try {
      if (!canEdit) return;
      if (!editing) return;
      setError(null);
      const response = await fetchClient(`${apiBase}/${editing.id}/contacts/${contact.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(changes) });
      const payload = await response.json();
      if (!response.ok) return setError(payload?.error?.message ?? "The contact could not be updated.");
      setContacts((current) => current.map((item) => item.id === contact.id ? { ...item, ...changes } : changes.primary ? { ...item, primary: false } : item));
    } catch (error) {
      setError(error instanceof Error ? error.message : "The client request failed. Please retry.");
    } finally {
      setSaving(false);
      setLoadingRecord(false);
    }
  }

  async function deleteContact(contact: ClientContact) {
    try {
      if (!canEdit) return;
      if (!editing || !window.confirm(`Remove ${contact.name} from this client record?`)) return;
      setError(null);
      const response = await fetchClient(`${apiBase}/${editing.id}/contacts/${contact.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) return setError(payload?.error?.message ?? "The contact could not be removed.");
      setContacts((current) => current.filter((item) => item.id !== contact.id));
    } catch (error) {
      setError(error instanceof Error ? error.message : "The client request failed. Please retry.");
    } finally {
      setSaving(false);
      setLoadingRecord(false);
    }
  }

  return <>
    <section className="panel">
      <div className="toolbar"><div className="search"><Search /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clients or email" aria-label="Search clients" /></div><select className="select" value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Client type"><option>All clients</option><option>Individual</option><option>Company</option></select><a className="button button-secondary" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download="surveynt-clients.csv"><Download size={15} />Export</a><button className="button button-primary" onClick={() => setCreating(true)} disabled={!canEdit}><Plus size={15} />New client</button></div>
      {error && !creating && !editing ? <div className="form-section"><p className="form-error" role="alert">{error}</p></div> : null}
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Client</th><th>Type</th><th>Phone</th><th>Properties</th><th>Last activity</th><th>Record</th></tr></thead><tbody>{visible.map((client) => <tr key={client.id}><td data-label="Client"><button className="table-link-button" onClick={() => openClient(client)}><strong>{client.name}</strong><span className="cell-sub">{client.email}</span></button></td><td data-label="Type"><StatusDot tone={client.kind === "Company" ? "blue" : "slate"}>{client.kind}</StatusDot></td><td data-label="Phone">{client.phone}</td><td data-label="Properties">{client.properties}</td><td data-label="Last activity">{client.lastActivity}</td><td data-label="Record"><div className="row-actions"><button className="button button-quiet" onClick={() => openClient(client)}><ContactRound size={14} />Open</button>{canEdit ? <button className="button button-quiet danger" onClick={() => archiveClient(client)}><Archive size={14} />Archive</button> : null}</div></td></tr>)}</tbody></table></div>
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
    {loadingRecord ? <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Loading client record"><div className="job-loading"><ContactRound size={18} />Loading client record…</div></section></div> : null}
    {editing ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}><section className="modal client-record-modal" role="dialog" aria-modal="true" aria-labelledby="edit-client-title">
      <div className="modal-header"><div><span className="eyebrow">{editing.kind}</span><h2 id="edit-client-title">{editing.name}</h2><p>Maintain the client identity, contacts and communication preferences.</p></div><button className="icon-button" aria-label="Close client record" onClick={() => setEditing(null)}><X size={16} /></button></div>
      <div className="client-record-layout">
        <div><form onSubmit={updateClient}><div className="form-section"><h2>Client details</h2><p>The primary details used in registers and correspondence.</p><div className="form-grid"><div className="field full"><label htmlFor="edit-client-name">Display name</label><input id="edit-client-name" name="displayName" className="input" defaultValue={editing.name} required minLength={2} maxLength={160} disabled={!canEdit} /></div><div className="field"><label htmlFor="edit-client-email">General email</label><input id="edit-client-email" name="email" className="input" type="email" defaultValue={editing.email === "—" ? "" : editing.email} disabled={!canEdit} /></div><div className="field"><label htmlFor="edit-client-phone">General phone</label><input id="edit-client-phone" name="phone" className="input" maxLength={40} defaultValue={editing.phone === "—" ? "" : editing.phone} disabled={!canEdit} /></div></div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div>{canEdit ? <div className="modal-actions"><button className="button button-primary" disabled={saving}><Pencil size={14} />{saving ? "Saving…" : "Save client details"}</button></div> : null}</form></div>
        <aside className="client-contacts" aria-label="Client contacts"><div className="client-contacts-heading"><div><h3>Contacts</h3><p>{contacts.length} {contacts.length === 1 ? "person" : "people"} linked</p></div><ContactRound size={17} /></div>
          <div className="contact-list">{contacts.length ? contacts.map((contact) => <article className="contact-card" key={contact.id}><div className="contact-card-title"><div><strong>{contact.name}</strong>{contact.primary ? <span><Star size={11} />Primary</span> : null}</div>{canEdit ? <button className="icon-button" aria-label={`Remove ${contact.name}`} onClick={() => deleteContact(contact)}><Trash2 size={14} /></button> : null}</div><dl><div><dt>Email</dt><dd>{contact.email || "—"}</dd></div><div><dt>Phone</dt><dd>{contact.phone || "—"}</dd></div></dl><div className="contact-preference"><label htmlFor={`channel-${contact.id}`}>Preferred contact</label><select id={`channel-${contact.id}`} className="select" value={contact.preferredChannel} disabled={!canEdit} onChange={(event) => updateContact(contact, { preferredChannel: event.target.value as ClientContact["preferredChannel"] })}><option value="email">Email</option><option value="phone">Phone call</option><option value="sms">SMS</option><option value="post">Post</option></select>{canEdit && !contact.primary ? <button className="button button-quiet" onClick={() => updateContact(contact, { primary: true })}><Star size={13} />Make primary</button> : null}</div></article>) : <div className="empty-state compact"><strong>No contacts yet</strong><span>Add the first named contact below.</span></div>}</div>
{canEdit ? <details className="contact-add-panel"><summary><Plus size={16}/>Add a contact</summary><form className="contact-add-form" onSubmit={addContact}><h3>Add contact</h3><div className="field"><label htmlFor="contact-name">Name</label><input id="contact-name" name="name" className="input" required minLength={2} maxLength={160} /></div><div className="form-grid"><div className="field"><label htmlFor="contact-email">Email</label><input id="contact-email" name="email" className="input" type="email" /></div><div className="field"><label htmlFor="contact-phone">Phone</label><input id="contact-phone" name="phone" className="input" maxLength={40} /></div></div><div className="form-grid"><div className="field"><label htmlFor="contact-channel">Preferred contact</label><select id="contact-channel" name="preferredChannel" className="input" defaultValue="email"><option value="email">Email</option><option value="phone">Phone call</option><option value="sms">SMS</option><option value="post">Post</option></select></div><label className="check-field"><input name="primary" type="checkbox" />Primary contact</label></div><button className="button button-secondary" disabled={saving}><Plus size={14} />{saving ? "Adding…" : "Add contact"}</button></form></details> : null}
        </aside>
      </div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setEditing(null)}>Close</button></div>
    </section></div> : null}
  </>;
}
