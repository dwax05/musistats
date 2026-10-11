import { useEffect, useState } from "react";
import type { ApiResponse } from "../auth/AuthProvider";
import { heatLevel, isCalendarData, localDate, monthGrid, shiftMonth, type CalendarDay } from "./model";

const HEAT_CLASSES = ["bg-surface-raised/40 text-muted", "bg-accent/15 text-fg", "bg-accent/35 text-fg", "bg-accent/60 text-fg", "bg-accent/90 text-accent-fg"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function formatDate(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(new Date(`${date}T00:00:00.000Z`));
}

function DayDetail({ date, day }: { date: string; day: CalendarDay | undefined }) {
  return <section className="rounded-2xl border border-border-app/80 bg-surface/95 p-5 shadow-xl shadow-black/20 sm:p-6" aria-live="polite">
    <h2 className="text-lg font-semibold text-fg">{formatDate(date, { weekday: "long", month: "long", day: "numeric" })}</h2>
    {!day ? <p className="py-12 text-center text-sm text-muted">No listening recorded on this day.</p> : <>
      <dl className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-surface-raised px-4 py-3"><dt className="text-xs text-muted">Time listened</dt><dd className="mt-1 text-2xl font-bold tracking-[-0.03em] text-fg">{formatMinutes(day.minutes)}</dd></div>
        <div className="rounded-xl bg-surface-raised px-4 py-3"><dt className="text-xs text-muted">Songs played</dt><dd className="mt-1 text-2xl font-bold tracking-[-0.03em] text-fg">{day.plays}</dd></div>
      </dl>
      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-[0.16em] text-muted">Top songs</h3>
      <ol className="space-y-1">{day.topTracks.map((track, index) => {
        const content = <><span className="w-5 text-center text-xs font-semibold text-muted">{index + 1}</span>{track.imageUrl ? <img src={track.imageUrl} alt="" width="40" height="40" className="h-10 w-10 shrink-0 rounded-lg object-cover" /> : <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-raised text-muted">♪</span>}<span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-fg group-hover:text-accent">{track.name}</span><span className="block truncate text-xs text-muted">{track.artists.join(", ")}</span></span><span className="shrink-0 text-xs font-semibold text-muted">{track.plays} {track.plays === 1 ? "play" : "plays"}</span></>;
        return <li key={track.id}>{track.externalUrl ? <a href={track.externalUrl} target="_blank" rel="noreferrer" className="group flex items-center gap-3 rounded-xl p-2 transition hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent">{content}</a> : <div className="flex items-center gap-3 p-2">{content}</div>}</li>;
      })}</ol>
    </>}
  </section>;
}

export default function CalendarPanel({ authedPost, demo }: { authedPost: (url: string, body?: unknown) => Promise<ApiResponse>; demo: boolean }) {
  const [today] = useState(() => localDate(new Date()));
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [selectedDate, setSelectedDate] = useState(today);
  const [months, setMonths] = useState<Record<string, CalendarDay[]>>({});
  const [error, setError] = useState<{ month: string; message: string } | null>(null);
  const days = months[month];

  useEffect(() => {
    if (days !== undefined) return;
    let active = true;
    if (demo) {
      void import("../dashboard/fixture").then(({ demoCalendar }) => {
        if (active) setMonths((current) => ({ ...current, [month]: demoCalendar(month, today) }));
      });
    } else {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      void authedPost("/api/calendar", { month, timeZone }).then((response) => {
        if (!active) return;
        if (!isCalendarData(response)) setError({ month, message: response.error === "offline" ? "MusiStats is temporarily unavailable." : "Your listening calendar could not be loaded." });
        else setMonths((current) => ({ ...current, [month]: response.days }));
      });
    }
    return () => { active = false; };
  }, [authedPost, days, demo, month, today]);

  const byDate = new Map((days ?? []).map((day) => [day.date, day]));
  const busiest = Math.max(0, ...(days ?? []).map((day) => day.minutes));
  const totalMinutes = (days ?? []).reduce((sum, day) => sum + day.minutes, 0);
  const changeMonth = (by: number) => {
    const next = shiftMonth(month, by);
    setMonth(next);
    setSelectedDate(next === thisMonth ? today : `${next}-01`);
  };

  return <div className="grid gap-6 lg:grid-cols-5">
    <section className="rounded-2xl border border-border-app/80 bg-surface/95 p-5 shadow-xl shadow-black/20 sm:p-6 lg:col-span-3">
      <div className="mb-5 flex items-center justify-between gap-3">
        <button type="button" aria-label="Previous month" onClick={() => changeMonth(-1)} className="grid h-9 w-9 place-items-center rounded-lg text-lg text-muted transition hover:bg-surface-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">‹</button>
        <div className="text-center"><h2 className="text-lg font-semibold text-fg">{formatDate(`${month}-01`, { month: "long", year: "numeric" })}</h2>{days && <p className="text-xs text-muted">{formatMinutes(totalMinutes)} this month</p>}</div>
        <button type="button" aria-label="Next month" disabled={month >= thisMonth} onClick={() => changeMonth(1)} className="grid h-9 w-9 place-items-center rounded-lg text-lg text-muted transition hover:bg-surface-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent">›</button>
      </div>
      {error?.month === month && days === undefined ? <div role="alert" className="rounded-2xl border border-error/30 bg-error/10 px-5 py-4 text-sm text-error">{error.message}</div> : <>
        <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-muted sm:gap-2">{WEEKDAYS.map((weekday) => <span key={weekday} className="pb-1">{weekday}</span>)}</div>
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2" aria-busy={days === undefined}>{monthGrid(month).map((cell) => {
          if (!cell.inMonth) return <span key={cell.date} aria-hidden="true" />;
          const day = byDate.get(cell.date);
          const future = cell.date > today;
          const selected = cell.date === selectedDate;
          const level = days === undefined || future ? 0 : heatLevel(day?.minutes ?? 0, busiest);
          const label = `${formatDate(cell.date, { dateStyle: "full" })}: ${day ? `${formatMinutes(day.minutes)}, ${day.plays} ${day.plays === 1 ? "song" : "songs"}` : "no listening"}`;
          return <button key={cell.date} type="button" disabled={future || days === undefined} aria-pressed={selected} aria-label={label} title={label} onClick={() => setSelectedDate(cell.date)} className={`flex aspect-square min-h-11 flex-col items-start justify-between rounded-lg p-1.5 text-left transition focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default sm:p-2 ${days === undefined ? "animate-pulse bg-surface-raised/40" : HEAT_CLASSES[level]} ${future ? "opacity-30" : "hover:brightness-125"} ${selected ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""}`}><span className="text-xs font-semibold sm:text-sm">{cell.day}</span>{day && <span className="hidden text-[10px] font-medium opacity-80 sm:block">{formatMinutes(day.minutes)}</span>}</button>;
        })}</div>
        <div className="mt-4 flex items-center justify-end gap-1.5 text-[11px] text-muted" aria-hidden="true"><span className="mr-1">Less</span>{HEAT_CLASSES.map((classes) => <span key={classes} className={`h-3 w-3 rounded-sm ${classes}`} />)}<span className="ml-1">More</span></div>
      </>}
    </section>
    <div className="lg:col-span-2">{days === undefined ? <div className="h-80 animate-pulse rounded-2xl border border-border-app bg-surface" aria-label="Loading your listening calendar" /> : <DayDetail date={selectedDate} day={byDate.get(selectedDate)} />}</div>
  </div>;
}
