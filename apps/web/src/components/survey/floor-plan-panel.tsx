"use client";

import { useEffect, useMemo, useState } from "react";
import { LayoutGrid, Pencil, Plus, Ruler, Trash2, X } from "lucide-react";
import { workspaceFetch } from "@/lib/workspace-request";
import { floorLabels, floors, schematicLayout, squareFeet, summariseFloors, type Floor, type Room } from "@/lib/floor-plan-model";

type Draft = { floor: Floor; name: string; lengthM: string; widthM: string; heightM: string; areaOverrideM2: string; notes: string };
const emptyDraft = (floor: Floor = "ground"): Draft => ({ floor, name: "", lengthM: "", widthM: "", heightM: "", areaOverrideM2: "", notes: "" });
const metres = (value: string) => value.trim() === "" ? null : Math.round(Number(value) * 100) / 100;
const fixed = (value: number | null) => value == null ? "" : String(value);
const area = (value: number) => `${value.toLocaleString("en-GB", { maximumFractionDigits: 2 })} m²`;

function FloorSchematic({ rooms, label }: { rooms: Room[]; label: string }) {
  const layout = schematicLayout(rooms);
  if (!layout.rects.length) return null;
  const pad = 0.4, scale = 22;
  const width = (layout.width + pad * 2) * scale, height = (layout.height + pad * 2) * scale;
  return <figure className="floor-schematic">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label} schematic: ${rooms.length} rooms drawn to their recorded dimensions`}>
      {layout.rects.map((rect) => {
        const x = (rect.x + pad) * scale, y = (rect.y + pad) * scale, w = rect.width * scale, h = rect.height * scale;
        return <g key={rect.id}>
          <rect x={x} y={y} width={w} height={h} className={rect.measured ? "room-rect" : "room-rect unmeasured"} />
          {w > 44 && h > 26 ? <text x={x + w / 2} y={y + h / 2 - 3} textAnchor="middle" className="room-name">{rect.name.length > Math.floor(w / 6.5) ? `${rect.name.slice(0, Math.max(3, Math.floor(w / 6.5) - 1))}…` : rect.name}</text> : null}
          {w > 44 && h > 38 ? <text x={x + w / 2} y={y + h / 2 + 11} textAnchor="middle" className="room-area">{rect.areaM2 != null ? `${rect.areaM2} m²` : "not measured"}</text> : null}
        </g>;
      })}
    </svg>
    <figcaption>Schematic: rooms drawn to their recorded size; positions are illustrative.</figcaption>
  </figure>;
}

/**
 * Rooms measured on site, grouped by floor with gross internal area totals and a
 * schematic plan. Measurements are factual records and feed the report's
 * accommodation schedule; they never change a professional finding.
 */
export function FloorPlanPanel({ surveyId, canEdit, online, demo }: { surveyId: string; canEdit: boolean; online: boolean; demo: boolean }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<Room | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const summary = useMemo(() => summariseFloors(rooms), [rooms]);

  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    workspaceFetch(`/api/v1/surveys/${surveyId}/rooms`, { signal: controller.signal }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw Error(payload.error?.message ?? "Measurements are unavailable.");
      setRooms(payload.data); setLoaded(true);
    }).catch((error: Error) => { if (error.name !== "AbortError") setMessage(error.message); });
    return () => controller.abort();
  }, [surveyId, online]);

  function startAdd() { setEditing(null); setDraft(emptyDraft(rooms.at(-1)?.floor ?? "ground")); setMessage(""); }
  function startEdit(room: Room) { setEditing(room); setDraft({ floor: room.floor, name: room.name, lengthM: fixed(room.lengthM), widthM: fixed(room.widthM), heightM: fixed(room.heightM), areaOverrideM2: fixed(room.areaOverrideM2), notes: room.notes ?? "" }); setMessage(""); }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const body = { floor: draft.floor, name: draft.name, lengthM: metres(draft.lengthM), widthM: metres(draft.widthM), heightM: metres(draft.heightM), areaOverrideM2: metres(draft.areaOverrideM2), notes: draft.notes.trim() || null, ...(editing ? { version: editing.version } : {}) };
    setBusy(true); setMessage("");
    try {
      const response = await workspaceFetch(editing ? `/api/v1/surveys/${surveyId}/rooms/${editing.id}` : `/api/v1/surveys/${surveyId}/rooms`, { method: editing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw Error(payload.error?.message ?? "The room could not be saved.");
      const saved: Room = editing ? { ...editing, ...payload.data } : { ...payload.data, position: rooms.length };
      setRooms((current) => editing ? current.map((room) => room.id === saved.id ? saved : room) : [...current, saved]);
      setDraft(null); setEditing(null);
      setMessage(payload.meta?.persisted === false ? "Preview only: this room is shown here but not saved." : editing ? "Room updated." : "Room added.");
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }

  async function remove(room: Room) {
    setBusy(true); setMessage("");
    try {
      const response = await workspaceFetch(`/api/v1/surveys/${surveyId}/rooms/${room.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw Error(payload.error?.message ?? "The room could not be removed.");
      setRooms((current) => current.filter((item) => item.id !== room.id));
      if (editing?.id === room.id) { setDraft(null); setEditing(null); }
      setMessage(payload.meta?.persisted === false ? "Preview only: nothing was saved." : `${room.name} removed.`);
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }

  const editable = canEdit && online;
  return <section className="panel floor-plan-panel" aria-labelledby="floor-plan-heading">
    <div className="panel-header"><div><h2 id="floor-plan-heading">Floor plan &amp; measurements</h2><p>{rooms.length ? `${rooms.length} room${rooms.length === 1 ? "" : "s"} · ${area(summary.totalAreaM2)} (${squareFeet(summary.totalAreaM2).toLocaleString("en-GB")} sq ft) measured${summary.unmeasured ? ` · ${summary.unmeasured} not measured` : ""}` : "Record rooms by floor to build the accommodation schedule."}</p></div><Ruler size={17} color="#3b82f6" aria-hidden="true" /></div>
    {!online ? <p className="form-help assistant-empty">Measurements need a connection. Your survey answers still save on this device.</p> : null}
    {online && !loaded && !message ? <p className="form-help assistant-empty">Loading measurements…</p> : null}
    {summary.floors.map((floor) => <div key={floor.floor} className="floor-group">
      <div className="floor-group-head"><strong>{floor.label}</strong><span>{area(floor.measuredAreaM2)}{floor.unmeasured ? ` · ${floor.unmeasured} not measured` : ""}</span></div>
      <ul className="room-list">{floor.rooms.map((room) => <li key={room.id}>
        <div><strong>{room.name}</strong><span className="cell-sub">{room.lengthM != null && room.widthM != null ? `${room.lengthM} × ${room.widthM} m` : room.areaOverrideM2 != null ? "Area recorded directly" : "Not measured"}{room.heightM != null ? ` · ${room.heightM} m high` : ""}{room.notes ? ` · ${room.notes}` : ""}</span></div>
        <span className="room-area-value">{room.areaM2 != null ? area(room.areaM2) : "—"}</span>
        {editable ? <span className="row-actions"><button type="button" className="icon-button" aria-label={`Edit ${room.name}`} disabled={busy} onClick={() => startEdit(room)}><Pencil size={14} /></button><button type="button" className="icon-button danger" aria-label={`Remove ${room.name}`} disabled={busy} onClick={() => void remove(room)}><Trash2 size={14} /></button></span> : null}
      </li>)}</ul>
      {showPlan ? <FloorSchematic rooms={floor.rooms} label={floor.label} /> : null}
    </div>)}
    {draft ? <form className="room-form" onSubmit={save} aria-label={editing ? `Edit ${editing.name}` : "Add a room"}>
      <div className="form-grid">
        <div className="field"><label htmlFor="room-floor">Floor</label><select id="room-floor" className="select" value={draft.floor} onChange={(event) => setDraft({ ...draft, floor: event.target.value as Floor })}>{floors.map((floor) => <option key={floor} value={floor}>{floorLabels[floor]}</option>)}</select></div>
        <div className="field"><label htmlFor="room-name">Room</label><input id="room-name" className="input" required maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Kitchen" /></div>
        <div className="field"><label htmlFor="room-length">Length (m)</label><input id="room-length" className="input" type="number" inputMode="decimal" min="0.01" max="500" step="0.01" value={draft.lengthM} onChange={(event) => setDraft({ ...draft, lengthM: event.target.value })} /></div>
        <div className="field"><label htmlFor="room-width">Width (m)</label><input id="room-width" className="input" type="number" inputMode="decimal" min="0.01" max="500" step="0.01" value={draft.widthM} onChange={(event) => setDraft({ ...draft, widthM: event.target.value })} /></div>
        <div className="field"><label htmlFor="room-height">Ceiling height (m)</label><input id="room-height" className="input" type="number" inputMode="decimal" min="0.01" max="50" step="0.01" value={draft.heightM} onChange={(event) => setDraft({ ...draft, heightM: event.target.value })} /></div>
        <div className="field"><label htmlFor="room-area">Area if irregular (m²)</label><input id="room-area" className="input" type="number" inputMode="decimal" min="0.01" max="100000" step="0.01" value={draft.areaOverrideM2} onChange={(event) => setDraft({ ...draft, areaOverrideM2: event.target.value })} /></div>
        <div className="field full"><label htmlFor="room-notes">Notes</label><input id="room-notes" className="input" maxLength={500} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="For example: measured to the bay" /></div>
      </div>
      <p className="form-help">Leave dimensions blank if a room could not be measured. Irregular areas override length × width.</p>
      <div className="form-actions"><button type="button" className="button button-quiet" onClick={() => { setDraft(null); setEditing(null); }}><X size={15} />Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : editing ? "Save room" : "Add room"}</button></div>
    </form> : null}
    <div className="completion-footer">
      {editable && !draft ? <button type="button" className="button button-secondary" onClick={startAdd}><Plus size={15} />Add room</button> : null}
      {rooms.length ? <button type="button" className="button button-quiet" aria-pressed={showPlan} onClick={() => setShowPlan((value) => !value)}><LayoutGrid size={15} />{showPlan ? "Hide plan" : "Show plan"}</button> : null}
    </div>
    {demo ? <p className="form-help">Fictional preview rooms. Changes are not saved.</p> : null}
    <p role="status" className="form-help">{message}</p>
  </section>;
}
