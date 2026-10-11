import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { isStatsData, type StatsData, type TimeRange } from "./model";

type ComparisonMode = "month" | "year" | "custom";
type Period = { startDate: string; endDate: string };
type PeriodPair = { previous: Period; current: Period };
type ComparisonResult = { previous: StatsData; current: StatsData };

function dateString(date: Date) {
  return date.toISOString().slice(0, 10);
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateString(date);
}

function monthToDatePeriods(today: string): PeriodPair {
  const currentStart = `${today.slice(0, 7)}-01`;
  const previousEndOfMonth = shiftDate(currentStart, -1);
  const previousStart = `${previousEndOfMonth.slice(0, 7)}-01`;
  const dayOfMonth = Number(today.slice(8, 10));
  const previousLastDay = Number(previousEndOfMonth.slice(8, 10));
  return {
    previous: { startDate: previousStart, endDate: `${previousStart.slice(0, 8)}${String(Math.min(dayOfMonth, previousLastDay)).padStart(2, "0")}` },
    current: { startDate: currentStart, endDate: today },
  };
}

export function yearToDatePeriods(today: string): PeriodPair {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const day = Number(today.slice(8, 10));
  const previousYear = year - 1;
  const previousMonthEnd = new Date(Date.UTC(previousYear, month, 0)).getUTCDate();
  const previousEnd = `${previousYear}-${String(month).padStart(2, "0")}-${String(Math.min(day, previousMonthEnd)).padStart(2, "0")}`;
  return {
    previous: { startDate: `${previousYear}-01-01`, endDate: previousEnd },
    current: { startDate: `${year}-01-01`, endDate: today },
  };
}

function validPeriod(period: Period, today: string) {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime())
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
    && value <= today;
  return validDate(period.startDate) && validDate(period.endDate) && period.startDate <= period.endDate;
}

function periodLabel(period: Period) {
  if (!period.startDate || !period.endDate) return "Select dates";
  const format = (value: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`));
  return `${format(period.startDate)} – ${format(period.endDate)}`;
}

function listeningTime(minutes: number, complete: boolean) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const value = hours ? `${hours}h ${remainder}m` : `${remainder}m`;
  return `${complete ? "" : "≥ "}${value}`;
}

function changeLabel(previous: number, current: number) {
  if (previous === 0) return current === 0 ? "No change" : "New this period";
  const change = current - previous;
  const percentage = Math.round(change / previous * 100);
  const sign = change > 0 ? "+" : "";
  return `${sign}${change.toLocaleString()} (${sign}${percentage}%)`;
}

function MetricComparison({ title, previous, current, format }: { title: string; previous: number; current: number; format: (value: number, period: "previous" | "current") => string }) {
  const change = current - previous;
  const positive = change >= 0;
  return <section className="min-w-0 rounded-xl border border-border-app bg-surface p-5">
    <h2 className="text-sm font-semibold text-muted">{title}</h2>
    <p className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-2xl font-bold text-fg"><span>{format(current, "current")}</span><span className="text-sm font-medium text-muted">vs {format(previous, "previous")}</span></p>
    <p className={`mt-2 text-sm font-semibold ${positive ? "text-accent" : "text-error"}`}>{changeLabel(previous, current)}</p>
  </section>;
}

function ArtistComparison({ previous, current }: { previous: StatsData["topArtistsByPlays"]; current: StatsData["topArtistsByPlays"] }) {
  const previousByName = new Map(previous.map((artist) => [artist.name.trim().toLocaleLowerCase(), artist]));
  const currentByName = new Map(current.map((artist) => [artist.name.trim().toLocaleLowerCase(), artist]));
  const rows = [...new Set([...previousByName.keys(), ...currentByName.keys()])]
    .map((key) => ({ key, previous: previousByName.get(key), current: currentByName.get(key) }))
    .sort((left, right) => (right.current?.value ?? -1) - (left.current?.value ?? -1) || (right.previous?.value ?? -1) - (left.previous?.value ?? -1));
  const shared = rows.filter((row) => row.previous && row.current).sort((left, right) => (right.current!.value - right.previous!.value) - (left.current!.value - left.previous!.value))[0];
  const biggestRiser = shared && shared.current!.value > shared.previous!.value ? shared : null;

  return <section className="rounded-xl border border-border-app bg-surface p-5 sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Artist movement</p><h2 className="mt-1 text-lg font-semibold text-fg">Top artists by plays</h2></div>
      {biggestRiser && <p className="text-sm text-muted">Largest rise among shared top artists: <span className="font-semibold text-fg">{biggestRiser.current!.name}</span> <span className="font-semibold text-accent">+{(biggestRiser.current!.value - biggestRiser.previous!.value).toLocaleString()} plays</span></p>}
    </div>
    {!rows.length ? <p className="py-10 text-center text-sm text-muted">No artist plays in either period.</p> : <div className="mt-5 overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <thead><tr className="border-b border-border-app text-xs font-semibold text-muted"><th className="pb-3 pr-4">Artist</th><th className="pb-3 pr-4">Previous</th><th className="pb-3 pr-4">Current</th><th className="pb-3">Movement</th></tr></thead>
        <tbody>{rows.map((row) => {
          const movement = row.previous && row.current
            ? changeLabel(row.previous.value, row.current.value)
            : row.current ? "Entered top 10" : "Left top 10";
          return <tr key={row.key} className="border-b border-border-app/70 last:border-0">
            <th scope="row" className="max-w-64 truncate py-3 pr-4 font-semibold text-fg">{row.current?.name ?? row.previous?.name}</th>
            <td className="py-3 pr-4 text-muted">{row.previous ? row.previous.value.toLocaleString() : "Outside top 10"}</td>
            <td className="py-3 pr-4 text-muted">{row.current ? row.current.value.toLocaleString() : "Outside top 10"}</td>
            <td className="py-3 font-medium text-fg">{movement}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
    <p className="mt-3 text-xs text-muted">Artists outside a period’s top 10 are shown as “Outside top 10”; that does not mean zero plays.</p>
  </section>;
}

export default function TasteComparison({ onBack, demoStats }: { onBack: () => void; demoStats?: Record<TimeRange, StatsData> }) {
  const { authedPost } = useAuth();
  const [today] = useState(() => dateString(new Date()));
  const [mode, setMode] = useState<ComparisonMode>("month");
  const [customPeriods, setCustomPeriods] = useState<PeriodPair>(() => monthToDatePeriods(today));
  const [result, setResult] = useState<{ key: string; comparison?: ComparisonResult; error?: string } | null>(null);
  const periods = mode === "year" ? yearToDatePeriods(today) : mode === "custom" ? customPeriods : monthToDatePeriods(today);
  const previousStart = periods.previous.startDate;
  const previousEnd = periods.previous.endDate;
  const currentStart = periods.current.startDate;
  const currentEnd = periods.current.endDate;
  const requestKey = JSON.stringify([previousStart, previousEnd, currentStart, currentEnd]);
  const periodsValid = validPeriod(periods.previous, today)
    && validPeriod(periods.current, today)
    && previousEnd < currentStart;
  const invalidMessage = !validPeriod(periods.previous, today) || !validPeriod(periods.current, today)
    ? "Enter valid past dates for both periods."
    : "Choose separate, non-overlapping periods in chronological order.";

  useEffect(() => {
    if (!periodsValid || demoStats) return;
    let active = true;
    const request = (startDate: string, endDate: string) => authedPost("/api/stats", { range: "custom", startDate, endDate });
    void Promise.all([request(previousStart, previousEnd), request(currentStart, currentEnd)]).then(([previous, current]) => {
      if (!active) return;
      if (!isStatsData(previous) || !isStatsData(current)) {
        const offline = previous.error === "offline" || current.error === "offline";
        setResult({ key: requestKey, error: offline ? "MusiStats is temporarily unavailable." : "Your taste comparison could not be loaded." });
        return;
      }
      setResult({ key: requestKey, comparison: { previous: previous.stats, current: current.stats } });
    }).catch((requestError: unknown) => {
      if (!active) return;
      console.error("Taste comparison request failed.", requestError);
      setResult({ key: requestKey, error: "Your taste comparison could not be loaded." });
    });
    return () => { active = false; };
  }, [authedPost, currentEnd, currentStart, demoStats, periodsValid, previousEnd, previousStart, requestKey]);

  const comparison = demoStats
    ? { previous: demoStats.short_term, current: demoStats.medium_term }
    : result?.key === requestKey ? result.comparison ?? null : null;
  const error = !periodsValid ? invalidMessage : result?.key === requestKey ? result.error ?? "" : "";
  const loading = periodsValid && !demoStats && result?.key !== requestKey;
  const previousSummary = comparison?.previous.summary;
  const currentSummary = comparison?.current.summary;
  const metrics = comparison ? [
    { title: "Listening time", previous: previousSummary!.listeningMinutes, current: currentSummary!.listeningMinutes, format: (value: number, period: "previous" | "current") => listeningTime(value, period === "previous" ? previousSummary!.listeningMinutesComplete : currentSummary!.listeningMinutesComplete) },
    { title: "Songs played", previous: previousSummary!.songs, current: currentSummary!.songs, format: (value: number) => value.toLocaleString() },
    { title: "Different artists", previous: previousSummary!.artists, current: currentSummary!.artists, format: (value: number) => value.toLocaleString() },
  ] : [];

  return <main className="min-h-screen w-full px-4 py-6 sm:px-6 lg:px-10">
    <div className="mx-auto w-full max-w-7xl">
      <button type="button" onClick={onBack} className="mb-7 rounded-lg px-3 py-2 text-sm font-semibold text-muted transition hover:bg-surface-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">← Dashboard</button>
      <header className="mb-8 flex flex-col gap-5 border-b border-border-app pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Your listening</p><h1 className="text-3xl font-bold text-fg sm:text-4xl">Taste comparison</h1><p className="mt-2 text-sm text-muted">See how your music tastes changed between two periods.</p></div>
        <label className="grid gap-2 text-xs font-semibold text-muted">Compare periods<select aria-label="Compare periods" value={mode} onChange={(event) => setMode(event.target.value as ComparisonMode)} className="min-h-10 min-w-56 rounded-lg border border-border-app bg-surface px-3 text-sm text-fg focus-visible:outline-2 focus-visible:outline-accent"><option value="month">This month vs. last month</option><option value="year">This year vs. last year</option><option value="custom">Custom date ranges</option></select></label>
      </header>

      {mode === "custom" && <fieldset className="mb-6 grid gap-4 rounded-xl border border-border-app bg-surface p-5 sm:grid-cols-2">
        {[{ key: "previous" as const, label: "Previous period" }, { key: "current" as const, label: "Current period" }].map(({ key, label }) => <div key={key} className="grid gap-3">
          <legend className="text-sm font-semibold text-fg">{label}</legend>
          <label className="grid gap-1.5 text-xs font-medium text-muted">From<input type="date" max={today} value={customPeriods[key].startDate} onChange={(event) => setCustomPeriods((value) => ({ ...value, [key]: { ...value[key], startDate: event.target.value } }))} className="min-h-10 rounded-lg border border-border-app bg-bg px-3 text-sm text-fg" /></label>
          <label className="grid gap-1.5 text-xs font-medium text-muted">Through<input type="date" max={today} value={customPeriods[key].endDate} onChange={(event) => setCustomPeriods((value) => ({ ...value, [key]: { ...value[key], endDate: event.target.value } }))} className="min-h-10 rounded-lg border border-border-app bg-bg px-3 text-sm text-fg" /></label>
        </div>)}
        {!periodsValid && <p role="alert" className="text-sm text-error sm:col-span-2">{invalidMessage}</p>}
      </fieldset>}

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-muted">Previous: {periodLabel(periods.previous)} <span aria-hidden="true">·</span> Current: {periodLabel(periods.current)}</p></div>
      {demoStats && <p className="mb-4 text-xs font-medium text-muted">Illustrative demo figures</p>}
      {error && <p role="alert" className="mb-5 rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</p>}
      {loading ? <div className="grid gap-4 sm:grid-cols-3" aria-label="Loading taste comparison">{[0, 1, 2].map((item) => <div key={item} className="h-32 animate-pulse rounded-xl border border-border-app bg-surface" />)}</div> : comparison && <>
        <div className="mb-6 grid gap-4 sm:grid-cols-3">{metrics.map((metric) => <MetricComparison key={metric.title} {...metric} />)}</div>
        <ArtistComparison previous={comparison.previous.topArtistsByPlays} current={comparison.current.topArtistsByPlays} />
        {(!comparison.previous.summary.listeningMinutesComplete || !comparison.current.summary.listeningMinutesComplete) && <p className="mt-4 text-xs text-muted">Listening time and its change are minimums where plays do not include track duration.</p>}
      </>}
    </div>
  </main>;
}
