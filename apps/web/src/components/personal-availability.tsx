"use client";

import { CalendarDays, Clock3, MapPin, ShieldCheck } from "lucide-react";
import "./personal-availability.css";

export type PersonalWork = { timezone: string; workingHours: Record<string, { start: string; end: string; closed?: boolean }>; routeOrigin: string | null; latitude: number | null; longitude: number | null };
const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export function PersonalAvailability({ work, onChange }: { work: PersonalWork; onChange: (work: PersonalWork) => void }) {
  const custom = days.filter(day => work.workingHours[day] && !work.workingHours[day].closed).length;
  const unavailable = days.filter(day => work.workingHours[day]?.closed).length;
  return <div className="settings-section personal-availability">
    <header className="availability-heading"><span className="availability-icon"><CalendarDays size={22}/></span><div><h2>Availability & location</h2><p>A working week that fits your inspections.</p></div></header>
    <div className="availability-summary"><span><strong>{7 - custom - unavailable}</strong> practice days</span><span><strong>{custom}</strong> custom days</span><span><strong>{unavailable}</strong> unavailable</span></div>
    <section aria-labelledby="weekly-hours-heading" className="availability-card">
      <div className="availability-card-heading"><div><h3 id="weekly-hours-heading">Weekly working hours</h3><p>Use practice hours, set your own, or mark a day unavailable.</p></div><label className="field availability-timezone"><span><Clock3 size={14}/> Timezone</span><select value={work.timezone} onChange={e => onChange({ ...work, timezone: e.target.value })}><option>Europe/London</option><option>Europe/Dublin</option><option>UTC</option></select></label></div>
      <div className="availability-week">{days.map(day => {
        const hours = work.workingHours[day];
        const mode = !hours ? "inherit" : hours.closed ? "closed" : "custom";
        return <div className={`availability-day availability-day-${mode}`} key={day}>
          <div className="availability-day-name"><span className="availability-day-dot"/><strong>{day[0].toUpperCase() + day.slice(1)}</strong></div>
          <label className="field"><span className="availability-mobile-label">Availability</span><select aria-label={`${day} availability`} value={mode} onChange={event => {
            const workingHours = { ...work.workingHours };
            if (event.target.value === "inherit") delete workingHours[day];
            else workingHours[day] = { start: hours?.start ?? "09:00", end: hours?.end ?? "17:00", closed: event.target.value === "closed" };
            onChange({ ...work, workingHours });
          }}><option value="inherit">Practice hours</option><option value="custom">My hours</option><option value="closed">Unavailable</option></select></label>
          {mode === "custom" ? <div className="availability-time-range"><label className="field"><span>From</span><input type="time" aria-label={`${day} start`} value={hours.start} onChange={event => onChange({ ...work, workingHours: { ...work.workingHours, [day]: { ...hours, start: event.target.value } } })}/></label><span aria-hidden="true">–</span><label className="field"><span>Until</span><input type="time" aria-label={`${day} end`} value={hours.end} onChange={event => onChange({ ...work, workingHours: { ...work.workingHours, [day]: { ...hours, end: event.target.value } } })}/></label></div> : <p className="availability-day-hint">{mode === "closed" ? "Not available for bookings" : "Follows your practice schedule"}</p>}
        </div>;
      })}</div>
      <p className="availability-policy"><ShieldCheck size={17}/><span>Practice closures, holidays and existing bookings still apply. Personal hours cannot override them.</span></p>
    </section>
    <section aria-labelledby="route-origin-heading" className="availability-card">
      <div className="availability-card-heading"><div><h3 id="route-origin-heading"><MapPin size={18}/> Your route starting point</h3><p>Set the address you normally depart from for fieldwork planning.</p></div></div>
      <label className="field"><span>Starting address</span><input maxLength={500} placeholder="Office or preferred departure address" value={work.routeOrigin ?? ""} onChange={e => onChange({ ...work, routeOrigin: e.target.value || null })}/></label>
      <details className="availability-coordinates"><summary>Precise coordinates <span>Optional</span></summary><p>Enter both coordinates only if you know the location. An address alone is not a verified map position.</p><div className="form-grid"><label className="field"><span>Latitude</span><input type="number" min={-90} max={90} step="any" value={work.latitude ?? ""} onChange={e => onChange({ ...work, latitude: e.target.value ? Number(e.target.value) : null })}/></label><label className="field"><span>Longitude</span><input type="number" min={-180} max={180} step="any" value={work.longitude ?? ""} onChange={e => onChange({ ...work, longitude: e.target.value ? Number(e.target.value) : null })}/></label></div></details>
    </section>
  </div>;
}
