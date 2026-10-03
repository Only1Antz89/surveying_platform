"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, Download, Link2 } from "lucide-react";

type Appointment = { id: string; jobId: string; status: string; startsAt: Date; endsAt: Date };
type View = "day" | "week" | "month";
const dateKey = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(value));
const time = (value: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

export function OperationsCalendar({ appointments, slug }: { appointments: Appointment[]; slug: string }) {
  const [view, setView] = useState<View>("week"); const [anchor, setAnchor] = useState(() => dateKey(appointments[0]?.startsAt ?? new Date()));
  const groups = useMemo(() => {
    const chosen = new Date(`${anchor}T12:00:00Z`); const weekStart = new Date(chosen); weekStart.setUTCDate(chosen.getUTCDate() - (chosen.getUTCDay() + 6) % 7);
    const visible = appointments.filter((appointment) => { const date = new Date(appointment.startsAt); if (view === "day") return dateKey(date) === anchor; if (view === "month") return dateKey(date).slice(0, 7) === anchor.slice(0, 7); const day = new Date(`${dateKey(date)}T12:00:00Z`); return day >= weekStart && day < new Date(weekStart.getTime() + 7 * 86_400_000); });
    const grouped = new Map<string, Appointment[]>(); for (const appointment of visible) { const key = dateKey(appointment.startsAt); grouped.set(key, [...(grouped.get(key) ?? []), appointment]); } return [...grouped];
  }, [anchor, appointments, view]);
  return <section className="panel"><div className="panel-header"><div><h2>Practice calendar</h2><p>Times are shown in Europe/London. Conflicting external edits become review items.</p></div><div className="calendar-actions"><a className="button button-quiet" href="/api/v1/calendar/ical"><Download size={15} /> iCal</a><a className="button button-quiet" href="/api/v1/calendar/oauth/connect?provider=google"><Link2 size={15} /> Google</a><a className="button button-quiet" href="/api/v1/calendar/oauth/connect?provider=microsoft"><Link2 size={15} /> Microsoft 365</a></div></div><div className="calendar-toolbar"><div role="group" aria-label="Calendar view">{(["day", "week", "month"] as const).map((item) => <button type="button" key={item} aria-pressed={view === item} onClick={() => setView(item)}>{item}</button>)}</div><label><span className="sr-only">Calendar date</span><input type="date" value={anchor} onChange={(event) => setAnchor(event.target.value)} /></label></div>
    {groups.length ? <div className="calendar-board">{groups.map(([date, rows]) => <section className="calendar-day" key={date}><h3>{new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}</h3>{rows.map((appointment) => <article key={appointment.id}><time>{time(appointment.startsAt)}–{time(appointment.endsAt)}</time><strong>{appointment.status}</strong><Link href={`/app/${slug}/jobs`}>Open job</Link></article>)}</section>)}</div> : <div className="empty-state"><CalendarDays size={28} color="#3b82f6" /><strong>No appointments in this {view}</strong><span>Choose another date or wait for a confirmed booking.</span></div>}
  </section>;
}
