import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { isStatsData, type StatsData, type TimeRange } from "./model";

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

function monthsEarlier(value: string, months: number) {
  const [year, month, day] = value.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month - months, 0)).getUTCDate();
  return dateString(new Date(Date.UTC(year, month - 1 - months, Math.min(day, lastDay))));
}

// The selected range is the current period; unless a custom previous period is chosen, it is the same number of days immediately before.
export function comparisonPeriods(range: TimeRange | "custom", today: string, custom: Period | null, customPrevious?: Period | null): PeriodPair {
  const current = range === "custom" ? custom!
    : { startDate: range === "short_term" ? shiftDate(today, -27) : shiftDate(monthsEarlier(today, range === "medium_term" ? 6 : 12), 1), endDate: today };
  const days = (Date.parse(current.endDate) - Date.parse(current.startDate)) / 86_400_000 + 1;
  if (range === "custom" && customPrevious) return { previous: customPrevious, current };
  return { previous: { startDate: shiftDate(current.startDate, -days), endDate: shiftDate(current.startDate, -1) }, current };
}

function periodLabel(period: Period) {
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

export default function TasteComparison({ range, customDates, previousDates, demoStats }: { range: TimeRange | "custom"; customDates: Period | null; previousDates: Period | null; demoStats?: Record<TimeRange, StatsData> }) {
  const { authedPost } = useAuth();
  const [today] = useState(() => dateString(new Date()));
  const [result, setResult] = useState<{ key: string; comparison?: ComparisonResult; error?: string } | null>(null);
  const periods = comparisonPeriods(range, today, customDates, previousDates);
  const previousStart = periods.previous.startDate;
  const previousEnd = periods.previous.endDate;
  const currentStart = periods.current.startDate;
  const currentEnd = periods.current.endDate;
  const requestKey = JSON.stringify([previousStart, previousEnd, currentStart, currentEnd]);

  useEffect(() => {
    if (demoStats) return;
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
  }, [authedPost, currentEnd, currentStart, demoStats, previousEnd, previousStart, requestKey]);

  const comparison = demoStats
    ? { previous: demoStats.short_term, current: demoStats.medium_term }
    : result?.key === requestKey ? result.comparison ?? null : null;
  const error = result?.key === requestKey ? result.error ?? "" : "";
  const loading = !demoStats && result?.key !== requestKey;
  const previousSummary = comparison?.previous.summary;
  const currentSummary = comparison?.current.summary;
  const metrics = comparison ? [
    { title: "Listening time", previous: previousSummary!.listeningMinutes, current: currentSummary!.listeningMinutes, format: (value: number, period: "previous" | "current") => listeningTime(value, period === "previous" ? previousSummary!.listeningMinutesComplete : currentSummary!.listeningMinutesComplete) },
    { title: "Songs played", previous: previousSummary!.songs, current: currentSummary!.songs, format: (value: number) => value.toLocaleString() },
    { title: "Different artists", previous: previousSummary!.artists, current: currentSummary!.artists, format: (value: number) => value.toLocaleString() },
  ] : [];

  return <>
    <p className="mb-5 text-xs text-muted">Previous: {periodLabel(periods.previous)} <span aria-hidden="true">·</span> Current: {periodLabel(periods.current)}</p>
    {demoStats && <p className="mb-4 text-xs font-medium text-muted">Illustrative demo figures</p>}
    {error && <p role="alert" className="mb-5 rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</p>}
    {loading ? <div className="grid gap-4 sm:grid-cols-3" aria-label="Loading taste comparison">{[0, 1, 2].map((item) => <div key={item} className="h-32 animate-pulse rounded-xl border border-border-app bg-surface" />)}</div> : comparison && <>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">{metrics.map((metric) => <MetricComparison key={metric.title} {...metric} />)}</div>
      <ArtistComparison previous={comparison.previous.topArtistsByPlays} current={comparison.current.topArtistsByPlays} />
      {(!comparison.previous.summary.listeningMinutesComplete || !comparison.current.summary.listeningMinutesComplete) && <p className="mt-4 text-xs text-muted">Listening time and its change are minimums where plays do not include track duration.</p>}
    </>}
  </>;
}
