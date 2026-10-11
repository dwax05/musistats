import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useAuth, type User } from "../auth/AuthProvider";
import SegmentedControl from "../ui/SegmentedControl";
import SettingsPanel from "../settings/SettingsPanel";
import AssistantPanel from "../assistant/AssistantPanel";
import { RANGE_LABELS, isDashboardData, isSessionsData, isStatsData, isTasteReplayData, isTopDataResponse, summarizeLast24Hours, type Album, type Artist, type ChartSeries, type DashboardData, type ListeningSession, type RankedMetric, type StatsData, type TasteReplayFrame, type TasteReplaySource, type TasteReplayStatus, type TimeRange, type TopData, type Track } from "./model";
import TasteReplay from "./TasteReplay";

type Page = "dashboard" | "assistant" | "stats" | "songs" | "artists" | "albums" | "sessions" | "settings" | "replay";
type SelectedRange = TimeRange | "custom";
type CustomDates = { startDate: string; endDate: string };

const primaryPages: { value: Page; label: string }[] = [
  { value: "dashboard", label: "Dashboard" },
  { value: "assistant", label: "Ask MusiStats" },
  { value: "stats", label: "All stats" },
  { value: "sessions", label: "Sessions" },
];

const topPages: { value: Page; label: string }[] = [
  { value: "songs", label: "Songs" },
  { value: "artists", label: "Artists" },
  { value: "albums", label: "Albums" },
  { value: "replay", label: "Taste replay" },
];

function SettingsIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
    <g transform="translate(0.5 0)">
      <path d="M12 3.2a1.8 1.8 0 0 1 1.8 1.8v1.2a5.4 5.4 0 0 1 1.7.8l.9-.9a1.8 1.8 0 1 1 2.5 2.5l-.9.9a5.4 5.4 0 0 1 .8 1.7h1.2a1.8 1.8 0 1 1 0 3.6h-1.2a5.4 5.4 0 0 1-.8 1.7l.9.9a1.8 1.8 0 1 1-2.5 2.5l-.9-.9a5.4 5.4 0 0 1-1.7.8v1.2a1.8 1.8 0 1 1-3.6 0v-1.2a5.4 5.4 0 0 1-1.7-.8l-.9.9a1.8 1.8 0 1 1-2.5-2.5l.9-.9a5.4 5.4 0 0 1-.8-1.7H3.2a1.8 1.8 0 1 1 0-3.6h1.2a5.4 5.4 0 0 1 .8-1.7L4.3 8.1a1.8 1.8 0 1 1 2.5-2.5l.9.9a5.4 5.4 0 0 1 1.7-.8V4.5A1.8 1.8 0 0 1 12 3.2Z" />
      <circle cx="12" cy="12" r="4.2" />
    </g>
  </svg>;
}

function calendarDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function isValidCustomRange(dates: CustomDates | null): dates is CustomDates {
  if (!dates || dates.startDate > dates.endDate) return false;
  return [dates.startDate, dates.endDate].every((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) && calendarDate(date) === value;
  });
}

function monthLabel(month: Date) {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(month);
}

function formatCustomDate(date: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00.000Z`));
}

function formatCustomRange({ startDate, endDate }: CustomDates) {
  return `${formatCustomDate(startDate)} - ${formatCustomDate(endDate)}`;
}

function CustomRangeCalendar({ dates, initialDate, onChange, onCancel, onApply }: { dates: CustomDates; initialDate: string; onChange: (dates: CustomDates) => void; onCancel: () => void; onApply: () => void }) {
  const [month, setMonth] = useState(() => {
    const selected = dates.startDate || initialDate;
    return new Date(`${selected.slice(0, 7)}-01T00:00:00.000Z`);
  });
  const firstDay = month.getUTCDay();
  const firstVisibleDay = new Date(month);
  firstVisibleDay.setUTCDate(1 - firstDay);
  const days = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(firstVisibleDay);
    day.setUTCDate(firstVisibleDay.getUTCDate() + index);
    return { date: calendarDate(day), day: day.getUTCDate(), currentMonth: day.getUTCMonth() === month.getUTCMonth() };
  });
  const choose = (date: string) => {
    if (!dates.startDate || dates.endDate || date < dates.startDate) return onChange({ startDate: date, endDate: "" });
    onChange({ startDate: dates.startDate, endDate: date });
  };

  return <div className="w-80 rounded-2xl border border-border-app bg-surface p-4 shadow-2xl shadow-black/40">
    <div className="mb-4 flex items-center justify-between"><button type="button" aria-label="Previous month" onClick={() => setMonth((value) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() - 1, 1)))} className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface-raised hover:text-fg">‹</button><h2 className="text-sm font-semibold text-fg">{monthLabel(month)}</h2><button type="button" aria-label="Next month" onClick={() => setMonth((value) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1)))} className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface-raised hover:text-fg">›</button></div>
    <div className="grid grid-cols-7 text-center text-[11px] font-semibold uppercase tracking-wide text-muted">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day} className="pb-2">{day}</span>)}</div>
    <div className="grid grid-cols-7 gap-y-1">{days.map(({ date, day, currentMonth }) => {
      const endpoint = date === dates.startDate || date === dates.endDate;
      const inRange = Boolean(dates.startDate && dates.endDate && date > dates.startDate && date < dates.endDate);
      return <div key={date} className={inRange ? "bg-accent/20" : ""}><button type="button" aria-pressed={endpoint} aria-label={new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${date}T00:00:00.000Z`))} onClick={() => choose(date)} className={`mx-auto grid h-9 w-9 place-items-center rounded-lg text-sm transition focus-visible:outline-2 focus-visible:outline-accent ${endpoint ? "bg-accent font-bold text-accent-fg shadow-[0_2px_0_#087c30]" : inRange ? "text-accent" : currentMonth ? "text-fg hover:bg-surface-raised" : "text-muted/50 hover:bg-surface-raised"}`}>{day}</button></div>;
    })}</div>
    <p className="mt-4 text-center text-xs text-muted">{dates.startDate && dates.endDate ? formatCustomRange(dates) : dates.startDate ? "Select an end date" : "Select a start date"}</p>
    <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-xs font-semibold text-muted hover:text-fg">Cancel</button><button type="button" disabled={!dates.startDate || !dates.endDate} onClick={onApply} className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-fg disabled:cursor-not-allowed disabled:opacity-40">Apply</button></div>
  </div>;
}

function TimeRangeSelector<T extends string>({ ariaLabel, options, value, onChange, calendar, onCalendarDismiss }: { ariaLabel: string; options: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void; calendar?: ReactNode; onCalendarDismiss?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!calendar) return;
    function closeCalendar(event: PointerEvent) {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) onCalendarDismiss?.();
    }
    document.addEventListener("pointerdown", closeCalendar);
    return () => document.removeEventListener("pointerdown", closeCalendar);
  }, [calendar, onCalendarDismiss]);

  return <div ref={ref} className="relative"><SegmentedControl ariaLabel={ariaLabel} options={options} value={value} onChange={onChange} /><AnimatePresence initial={false}>{calendar && <motion.div initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }} transition={{ duration: 0.16, ease: "easeOut" }} className="absolute right-0 z-10 mt-2 origin-top-right">{calendar}</motion.div>}</AnimatePresence></div>;
}

function Artwork({ src, alt, round = false }: { src: string | null; alt: string; round?: boolean }) {
  return src ? <img src={src} alt="" width="48" height="48" className={`h-12 w-12 shrink-0 object-cover ${round ? "rounded-full" : "rounded-lg"}`} /> : <div role="img" aria-label={`${alt} artwork unavailable`} className={`grid h-12 w-12 shrink-0 place-items-center bg-surface-raised text-muted ${round ? "rounded-full" : "rounded-lg"}`}>♪</div>;
}

function EmptyList({ children }: { children: string }) {
  return <p className="py-12 text-center text-sm text-muted">{children}</p>;
}

function formatDuration(minutes: number | null) {
  if (minutes === null) return "Not available";
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function formatSessionRange(startedAt: string, endedAt: string) {
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  return `${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(startedAt))} · ${time.format(new Date(startedAt))}–${time.format(new Date(endedAt))}`;
}

function SessionItem({ session, index }: { session: ListeningSession; index: number }) {
  const [open, setOpen] = useState(false);
  const contentId = `session-${session.id}`;

  return <motion.li layout><section className="overflow-hidden rounded-2xl border border-border-app/80 bg-surface/95 shadow-xl shadow-black/20"><button type="button" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen(!open)} className="flex w-full items-center gap-4 p-5 text-left transition hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/15 text-sm font-bold text-accent">{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-fg">{formatSessionRange(session.startedAt, session.endedAt)}</span><span className="mt-1 block text-xs text-muted">{session.songs} songs · {session.artists} artists</span></span><span className="flex shrink-0 items-center gap-3 text-sm font-semibold text-fg"><span>{formatDuration(session.minutes)}</span><span aria-hidden="true" className="rounded-full bg-surface-raised px-2.5 py-1 text-xs font-semibold text-muted">{open ? "Hide" : "View"}</span></span></button><AnimatePresence initial={false}>{open && <motion.div id={contentId} aria-hidden={!open} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} className="overflow-hidden"><div className="border-t border-border-app px-5 pb-5 pt-4">{session.topArtist && <p className="mb-4 text-sm text-muted">Top artist: <span className="font-semibold text-fg">{session.topArtist.name}</span></p>}<ol className="space-y-1">{session.tracks.map((track) => <li key={`${track.id}-${track.playedAt}`}><a href={track.externalUrl} target="_blank" rel="noreferrer" className="group flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent"><span className="w-16 shrink-0 text-xs text-muted">{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(track.playedAt))}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold text-fg group-hover:text-accent">{track.name}</span><span className="block truncate text-xs text-muted">{track.artists.join(", ")}</span></span></a></li>)}</ol></div></motion.div>}</AnimatePresence></section></motion.li>;
}

function SessionList({ sessions }: { sessions: ListeningSession[] }) {
  if (!sessions.length) return <EmptyList>No listening sessions yet. Keep listening and check back soon.</EmptyList>;
  return <LayoutGroup><ol className="space-y-4">{sessions.map((session, index) => <SessionItem key={session.id} session={session} index={index} />)}</ol></LayoutGroup>;
}

function GraphCard({ title, children, fullWidth = false }: { title: string; children: ReactNode; fullWidth?: boolean }) {
  return <section className={`rounded-2xl border border-border-app/80 bg-surface/95 p-5 shadow-xl shadow-black/20 sm:p-6 ${fullWidth ? "lg:col-span-2" : ""}`}><h2 className="text-lg font-semibold text-fg">{title}</h2>{children}</section>;
}

function MetricBarChart({ title, metrics, format }: { title: string; metrics: RankedMetric[]; format: (value: number) => string }) {
  const highest = Math.max(...metrics.map((metric) => metric.value), 0);
  return <GraphCard title={title}>{highest === 0 ? <EmptyList>No data for this range.</EmptyList> : <ol className="mt-6 space-y-3">{metrics.map((metric) => <li key={metric.name} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 text-xs"><span className="truncate font-semibold text-fg" title={metric.name}>{metric.name}</span><span className="h-2 overflow-hidden rounded-full bg-surface-raised"><span className="block h-full rounded-full bg-accent" style={{ width: `${metric.value / highest * 100}%` }} /></span><span className="text-muted">{format(metric.value)}</span></li>)}</ol>}</GraphCard>;
}

function TimelineLabels({ series }: { series: ChartSeries }) {
  return <div className="mt-3 flex justify-between text-xs text-muted"><span>{series.labels[0]}</span><span>{series.labels[series.labels.length - 1]}</span></div>;
}

function ChartYAxis({ minimum, maximum, format }: { minimum: number; maximum: number; format: (value: number) => string }) {
  return <div aria-hidden="true" className="flex h-40 flex-col justify-between pb-1 text-right text-[11px] text-muted"><span>{format(maximum)}</span><span>{format(minimum)}</span></div>;
}

function TimeBarChart({ title, series, format }: { title: string; series: ChartSeries; format: (value: number) => string }) {
  const highest = Math.max(...series.values, 0);
  return <GraphCard title={title} fullWidth>{highest === 0 ? <EmptyList>No data for this range.</EmptyList> : <div className="mt-6 grid grid-cols-[3rem_1fr] gap-3"><ChartYAxis minimum={0} maximum={highest} format={format} /><div><div role="img" aria-label={title} className="flex h-40 items-end gap-px border-b border-border-app">{series.values.map((value, index) => <span key={`${series.labels[index]}-${index}`} className="min-w-0 flex-1 bg-accent/70" style={{ height: `${Math.max(4, value / highest * 100)}%` }} />)}</div><TimelineLabels series={series} /></div></div>}</GraphCard>;
}

function LineChart({ title, series, format }: { title: string; series: ChartSeries; format: (value: number) => string }) {
  const lowest = series.values.length ? Math.min(...series.values) : 0;
  const highest = series.values.length ? Math.max(...series.values) : 0;
  const span = highest - lowest || 1;
  const points = series.values.map((value, index) => ({ x: index / Math.max(series.values.length - 1, 1) * 100, y: 100 - (value - lowest) / span * 100 }));
  const path = points.reduce((line, point, index) => {
    if (index === 0) return `M${point.x},${point.y}`;
    const previous = points[index - 1];
    const controlX = (previous.x + point.x) / 2;
    return `${line} C${controlX},${previous.y} ${controlX},${point.y} ${point.x},${point.y}`;
  }, "");
  const areaPath = `${path} L100,100 L0,100 Z`;
  return <GraphCard title={title}>{!series.values.length ? <EmptyList>No data for this range.</EmptyList> : <div className="mt-6 grid grid-cols-[3rem_1fr] gap-3"><ChartYAxis minimum={lowest} maximum={highest} format={format} /><div><svg role="img" aria-label={title} viewBox="0 0 100 100" preserveAspectRatio="none" className="h-40 w-full overflow-visible"><path d="M0 100H100" stroke="currentColor" className="text-border-app" vectorEffect="non-scaling-stroke" /><path d={areaPath} fill="currentColor" className="text-accent/15" /><path d={path} fill="none" stroke="currentColor" className="text-accent" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" /></svg><TimelineLabels series={series} /></div></div>}</GraphCard>;
}

function StatsPanel({ stats }: { stats: StatsData }) {
  return <div className="grid gap-6 lg:grid-cols-2"><MetricBarChart title="Top artists by plays" metrics={stats.topArtistsByPlays} format={(value) => `${Math.round(value)} plays`} /><MetricBarChart title="Top artists by listening time" metrics={stats.topArtistsByMinutes} format={(value) => `${Math.round(value)}m`} /><TimeBarChart title="Listening distribution over time" series={stats.listeningDistribution} format={(value) => `${Math.round(value)}m`} /><LineChart title="Songs listened to over time" series={stats.songsListened} format={(value) => String(Math.round(value))} /><LineChart title="Different artists listened to over time" series={stats.artistsListened} format={(value) => String(Math.round(value))} /></div>;
}

function StatCard({ label, value, className = "", imageUrl, imageAlt, round = false }: { label: string; value: string | number; className?: string; imageUrl?: string | null; imageAlt?: string; round?: boolean }) {
  return <div className={`min-h-44 rounded-2xl border border-border-app/80 bg-surface/95 shadow-xl shadow-black/20 ${className}`} style={{ padding: "2rem" }}>
    <dt className="text-base font-semibold text-fg">{label}</dt>
    <dd className="mt-7 flex items-center justify-between gap-4 text-3xl font-bold tracking-[-0.03em] text-fg"><span className="truncate" title={String(value)}>{value}</span>{imageAlt && <Artwork src={imageUrl ?? null} alt={imageAlt} round={round} />}</dd>
  </div>;
}

function ActivityChart({ title, values, emptyMessage }: { title: string; values?: number[]; emptyMessage: string }) {
  const highest = Math.max(...(values ?? []), 0);
  return <section className="rounded-2xl border border-border-app/80 bg-surface/95 shadow-xl shadow-black/20" style={{ padding: "2rem" }}>
    <h2 className="text-lg font-semibold text-fg">{title}</h2>
    {highest === 0 ? <p className="grid h-40 place-items-center text-sm text-muted">{emptyMessage}</p> : <><div role="img" aria-label={`${title} by hour`} className="mt-6 flex h-40 items-end gap-1 border-b border-border-app">{values?.map((value, hour) => <span key={hour} className="min-w-0 flex-1 rounded-t-sm bg-accent/70" style={{ height: `${Math.max(4, value / highest * 100)}%` }} />)}</div><div className="mt-3 flex justify-between text-xs text-muted"><span>12am</span><span>6am</span><span>Noon</span><span>6pm</span><span>Now</span></div></>}
  </section>;
}

function RankedTracks({ tracks }: { tracks: Track[] }) {
  if (!tracks.length) return <EmptyList>No top songs yet. Keep listening and check back soon.</EmptyList>;
  return <ol className="space-y-2">{tracks.map((track, index) => <li key={track.id}><a href={track.externalUrl} target="_blank" rel="noreferrer" className="group flex items-center gap-3 rounded-xl p-2 transition hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent"><span className="w-5 text-center text-xs font-semibold text-muted">{index + 1}</span><Artwork src={track.imageUrl} alt={track.name} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-fg group-hover:text-accent">{track.name}</span><span className="block truncate text-xs text-muted">{track.artists.join(", ")}</span></span>{track.plays !== undefined && <span className="shrink-0 text-xs font-semibold text-muted">{track.plays} {track.plays === 1 ? "play" : "plays"}</span>}</a></li>)}</ol>;
}

function RankedArtists({ artists }: { artists: Artist[] }) {
  if (!artists.length) return <EmptyList>No top artists yet. Keep listening and check back soon.</EmptyList>;
  return <ol className="space-y-2">{artists.map((artist, index) => <li key={artist.id}><a href={artist.externalUrl} target="_blank" rel="noreferrer" className="group flex items-center gap-3 rounded-xl p-2 transition hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent"><span className="w-5 text-center text-xs font-semibold text-muted">{index + 1}</span><Artwork src={artist.imageUrl} alt={artist.name} round /><span className="truncate text-sm font-semibold text-fg group-hover:text-accent">{artist.name}</span></a></li>)}</ol>;
}

function RankedAlbums({ albums }: { albums: Album[] }) {
  if (!albums.length) return <EmptyList>No top albums yet. Keep listening and check back soon.</EmptyList>;
  return <ol className="space-y-2">{albums.map((album, index) => <li key={album.id}><a href={album.externalUrl} target="_blank" rel="noreferrer" className="group flex items-center gap-3 rounded-xl p-2 transition hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent"><span className="w-5 text-center text-xs font-semibold text-muted">{index + 1}</span><Artwork src={album.imageUrl} alt={album.name} /><span className="min-w-0"><span className="block truncate text-sm font-semibold text-fg group-hover:text-accent">{album.name}</span><span className="block truncate text-xs text-muted">{album.artists.join(", ")}</span></span></a></li>)}</ol>;
}

export default function Dashboard({ initialData, initialSessions, initialStats, initialTasteReplay, demoUser }: { initialData?: DashboardData; initialSessions?: Record<TimeRange, ListeningSession[]>; initialStats?: Record<TimeRange, StatsData>; initialTasteReplay?: Record<TimeRange, TasteReplayFrame[]>; demoUser?: User }) {
  const { user, authedPost, logout, disconnect } = useAuth();
  const [page, setPage] = useState<Page>("dashboard");
  const [range, setRange] = useState<SelectedRange>("medium_term");
  const [customOpen, setCustomOpen] = useState(false);
  const [customDates, setCustomDates] = useState<CustomDates | null>(null);
  const [today] = useState(() => calendarDate(new Date()));
  const [customDraft, setCustomDraft] = useState<CustomDates>({ startDate: "", endDate: "" });
  const [data, setData] = useState<DashboardData | null>(initialData ?? null);
  const [error, setError] = useState("");
  const [sessions, setSessions] = useState<Record<string, ListeningSession[]>>(initialSessions ?? {});
  const [sessionsError, setSessionsError] = useState<{ key: string; message: string } | null>(null);
  const [stats, setStats] = useState<Record<string, StatsData>>(initialStats ?? {});
  const [statsError, setStatsError] = useState<{ key: string; message: string } | null>(null);
  const [customTop, setCustomTop] = useState<{ key: string; value: TopData } | null>(null);
  const [customTopError, setCustomTopError] = useState<{ key: string; message: string } | null>(null);
  const [tasteReplay, setTasteReplay] = useState<Partial<Record<TimeRange, TasteReplayFrame[]>>>(initialTasteReplay ?? {});
  const [tasteReplayStatus, setTasteReplayStatus] = useState<Partial<Record<TimeRange, TasteReplayStatus>>>({});
  const [tasteReplaySource, setTasteReplaySource] = useState<Partial<Record<TimeRange, TasteReplaySource>>>({});
  const [tasteReplayInterval, setTasteReplayInterval] = useState<Partial<Record<TimeRange, number>>>({});
  const [tasteReplayError, setTasteReplayError] = useState<{ range: TimeRange; message: string } | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const activeUser = demoUser ?? user;
  const rangeKey = range === "custom" && customDates ? `custom:${customDates.startDate}:${customDates.endDate}` : range;
  const selectedSessions = sessions[rangeKey];
  const selectedStats = stats[rangeKey];
  const replayRange = range === "short_term" || range === "custom" ? "medium_term" : range;
  const selectedReplay = tasteReplay[replayRange];

  const loadTasteReplay = useCallback(async (isActive: () => boolean) => {
    try {
      const response = await authedPost("/api/taste-replay", { range: replayRange });
      if (!isActive()) return;
      if (!isTasteReplayData(response)) {
        setTasteReplayError({ range: replayRange, message: response.error === "offline" ? "MusiStats is temporarily unavailable." : "Your taste replay could not be loaded." });
        setTasteReplayStatus((current) => ({ ...current, [replayRange]: "genre_lookup_failed" }));
        return;
      }
      setTasteReplay((current) => ({ ...current, [replayRange]: response.frames }));
      setTasteReplayStatus((current) => ({ ...current, [replayRange]: response.status }));
      setTasteReplaySource((current) => ({ ...current, [replayRange]: response.source }));
      setTasteReplayInterval((current) => ({ ...current, [replayRange]: response.intervalDays }));
    } catch (error) {
      if (!isActive()) return;
      console.error("Taste replay request failed.", error);
      setTasteReplayError({ range: replayRange, message: "Your taste replay could not be loaded." });
      setTasteReplayStatus((current) => ({ ...current, [replayRange]: "genre_lookup_failed" }));
    }
  }, [authedPost, replayRange]);

  useEffect(() => {
    if (initialData) return;
    let active = true;
    void authedPost("/api/dashboard").then((response) => {
      if (!active) return;
      if (!isDashboardData(response)) setError(response.error === "offline" ? "MusiStats is temporarily unavailable." : "Your stats could not be loaded.");
      else setData(response);
    });
    return () => { active = false; };
  }, [authedPost, initialData]);

  useEffect(() => {
    if ((initialSessions !== undefined && range !== "custom") || page !== "sessions" || selectedSessions !== undefined || range === "custom" && !customDates) return;
    let active = true;
    void authedPost("/api/sessions", range === "custom" ? { range, ...customDates! } : { range }).then((response) => {
      if (!active) return;
      if (!isSessionsData(response)) setSessionsError({ key: rangeKey, message: response.error === "offline" ? "MusiStats is temporarily unavailable." : "Your listening sessions could not be loaded." });
      else setSessions((current) => ({ ...current, [rangeKey]: response.sessions }));
    });
    return () => { active = false; };
  }, [authedPost, customDates, initialSessions, page, range, rangeKey, selectedSessions]);

  useEffect(() => {
    if ((initialStats !== undefined && range !== "custom") || page !== "stats" || selectedStats !== undefined || range === "custom" && !customDates) return;
    let active = true;
    void authedPost("/api/stats", range === "custom" ? { range, ...customDates! } : { range }).then((response) => {
      if (!active) return;
      if (!isStatsData(response)) setStatsError({ key: rangeKey, message: response.error === "offline" ? "MusiStats is temporarily unavailable." : "Your stats could not be loaded." });
      else setStats((current) => ({ ...current, [rangeKey]: response.stats }));
    });
    return () => { active = false; };
  }, [authedPost, customDates, initialStats, page, range, rangeKey, selectedStats]);

  useEffect(() => {
    if (page === "replay" || !topPages.some((item) => item.value === page) || range === "custom" && !customDates) return;
    let active = true;
    void authedPost("/api/dashboard/top", range === "custom" ? { range, ...customDates! } : { range }).then((response) => {
      if (!active) return;
      if (!isTopDataResponse(response)) setCustomTopError({ key: rangeKey, message: response.error === "offline" ? "MusiStats is temporarily unavailable." : "Your top tracks could not be loaded." });
      else {
        setCustomTop({ key: rangeKey, value: response.top });
        setCustomTopError(null);
      }
    });
    return () => { active = false; };
  }, [authedPost, customDates, page, range, rangeKey]);

  useEffect(() => {
    if (initialTasteReplay !== undefined || page !== "replay" || selectedReplay !== undefined) return;
    let active = true;
    void loadTasteReplay(() => active);
    return () => { active = false; };
  }, [initialTasteReplay, loadTasteReplay, page, selectedReplay]);

  useEffect(() => {
    const status = tasteReplayStatus[replayRange];
    if (initialTasteReplay !== undefined || page !== "replay" || status !== "loading_genres" && status !== "genre_lookup_failed") return;
    let active = true;
    let pending = false;
    const intervalId = window.setInterval(() => {
      if (pending) return;
      pending = true;
      void loadTasteReplay(() => active).finally(() => { pending = false; });
    }, status === "loading_genres" ? 5000 : 30_000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [initialTasteReplay, loadTasteReplay, page, replayRange, tasteReplayStatus]);

  useEffect(() => {
    function closeProfileMenu(event: PointerEvent) {
      const menu = profileMenuRef.current;
      if (menu && event.target instanceof Node && !menu.contains(event.target)) setProfileOpen(false);
    }
    function closeProfileMenuOnEscape(event: KeyboardEvent) { if (event.key === "Escape") setProfileOpen(false); }
    document.addEventListener("pointerdown", closeProfileMenu);
    document.addEventListener("keydown", closeProfileMenuOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeProfileMenu);
      document.removeEventListener("keydown", closeProfileMenuOnEscape);
    };
  }, []);

  const invalidateTasteReplay = useCallback(() => {
    setTasteReplay({});
    setTasteReplayStatus({});
    setTasteReplaySource({});
    setTasteReplayInterval({});
    setTasteReplayError(null);
  }, []);

  async function deleteAccount() {
    if (!window.confirm("Disconnect Spotify and permanently delete all imported MusiStats data?")) return;
    if (demoUser) return window.location.assign("/");
    const deleteError = await disconnect();
    if (deleteError) setError(deleteError);
  }

  const selected = customTop?.key === rangeKey ? customTop.value : null;
  const last24Hours = data?.last24Hours ?? summarizeLast24Hours(data?.recent ?? []);
  const contentTitle = page === "settings" ? "Settings" : page === "assistant" ? "Ask MusiStats" : page === "stats" ? "All stats" : page === "songs" ? "Top songs" : page === "artists" ? "Top artists" : page === "albums" ? "Top albums" : page === "replay" ? "Taste replay" : "Longest listening sessions";
  const summaryStats = [
    { label: "Songs listened to in the last 24 hours", value: last24Hours.songs, className: "lg:col-span-2" },
    { label: "Time listened to in the last 24 hours", value: formatDuration(last24Hours.minutes), className: "lg:col-span-2" },
    { label: "Artists listened to in the last 24 hours", value: last24Hours.artists, className: "lg:col-span-2" },
    { label: "Most listened to artist", value: last24Hours.topArtist?.name ?? "—", imageUrl: last24Hours.topArtist?.imageUrl, imageAlt: last24Hours.topArtist?.name, round: true, className: "lg:col-span-3" },
    { label: "Most listened to song", value: last24Hours.topTrack?.name ?? "—", imageUrl: last24Hours.topTrack?.imageUrl, imageAlt: last24Hours.topTrack?.name, className: "md:col-span-2 lg:col-span-3" },
  ];

  const rangeOptions: { value: SelectedRange; label: string }[] = [...(Object.keys(RANGE_LABELS) as TimeRange[]).map((value) => ({ value, label: RANGE_LABELS[value] })), { value: "custom", label: "Custom" }];
  const replayRangeOptions = rangeOptions.filter((option): option is { value: TimeRange; label: string } => option.value === "medium_term" || option.value === "long_term");
  const changeRange = (value: SelectedRange) => {
    if (value === "custom") {
      if (customOpen) return setCustomOpen(false);
      setCustomDraft(isValidCustomRange(customDates) ? customDates : { startDate: today, endDate: today });
      return setCustomOpen(true);
    }
    setCustomOpen(false);
    setRange(value);
  };
  const applyCustomRange = () => {
    if (!customDraft.startDate || !customDraft.endDate) return;
    setCustomDates(customDraft);
    setRange("custom");
    setCustomOpen(false);
  };

  return <main className="min-h-screen w-full p-3 sm:p-5 lg:flex lg:gap-5">
    <motion.aside layout="position" transition={{ layout: { duration: 0.35, ease: "easeOut" } }} className="relative rounded-3xl border border-border-app bg-surface/95 px-5 py-6 shadow-xl shadow-black/20 sm:px-8 lg:sticky lg:top-5 lg:flex lg:h-[calc(100vh-2.5rem)] lg:w-64 lg:shrink-0 lg:flex-col lg:bg-surface lg:px-6 lg:py-8">
      <div className="flex items-center justify-between lg:block">
        <div><a href="/" className="text-2xl font-bold tracking-[-0.04em] text-fg">MusiStats</a><p className="mt-2 hidden text-xs text-muted lg:block">Your listening library</p></div>
        <div ref={profileMenuRef} className="relative flex items-center gap-2 lg:absolute lg:bottom-6 lg:left-6 lg:right-6"><button type="button" aria-expanded={profileOpen} aria-controls="profile-menu" aria-haspopup="menu" onClick={() => setProfileOpen((open) => !open)} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-0 py-0 text-left transition hover:text-accent focus-visible:outline-2 focus-visible:outline-accent">{activeUser?.avatarUrl ? <img src={activeUser.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" /> : <div className="grid h-8 w-8 place-items-center rounded-full bg-accent/15 font-semibold text-accent">{activeUser?.displayName.charAt(0).toUpperCase()}</div>}<span className="hidden max-w-44 truncate text-sm font-medium text-fg sm:block">{activeUser?.displayName}</span></button><button type="button" onClick={() => setPage("settings")} aria-label="Settings" title="Settings" aria-current={page === "settings" ? "page" : undefined} className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl transition hover:bg-surface-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent ${page === "settings" ? "bg-accent/10 text-accent" : "text-muted"}`}><SettingsIcon /></button>
          <AnimatePresence initial={false}>{profileOpen && <motion.div id="profile-menu" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.16, ease: "easeOut" }} className="absolute right-0 z-10 mt-2 w-56 origin-top-right overflow-hidden rounded-xl border border-border-app bg-surface p-2 shadow-2xl shadow-black/50 lg:bottom-full lg:right-auto lg:left-0 lg:mb-3 lg:mt-0 lg:origin-bottom-left"><button onClick={() => demoUser ? window.location.assign("/") : void logout()} className="w-full rounded-lg px-3 py-2 text-left text-sm text-fg transition hover:bg-surface-raised">Log out</button><p className="px-3 pb-1 pt-3 text-[11px] leading-4 text-muted">Logging out does not stop data collection.</p><button onClick={() => void deleteAccount()} className="w-full rounded-lg px-3 py-2 text-left text-sm text-error transition hover:bg-error/10">Disconnect and delete data</button></motion.div>}</AnimatePresence>
      </div>
      </div>

      <nav aria-label="MusiStats pages" className="mt-5 flex gap-1 overflow-x-auto border-t border-border-app pt-3 lg:mt-14 lg:flex-col lg:gap-1 lg:overflow-visible lg:border-0 lg:pt-0"><div className="flex shrink-0 gap-1 lg:flex-col">{primaryPages.map((item) => <button key={item.value} type="button" onClick={() => setPage(item.value)} aria-current={page === item.value ? "page" : undefined} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-semibold transition lg:rounded-xl lg:border-l-2 lg:border-b-0 lg:px-3 lg:text-left ${page === item.value ? "border-accent text-fg lg:bg-accent/10" : "border-transparent text-muted hover:text-fg lg:hover:bg-surface-raised"}`}>{item.label}</button>)}</div><div className="flex shrink-0 gap-1 lg:mt-6 lg:flex-col lg:border-t lg:border-border-app lg:pt-5"><p className="hidden px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted lg:block">Your top</p><div className="flex gap-1 lg:flex-col">{topPages.map((item) => <button key={item.value} type="button" onClick={() => setPage(item.value)} aria-current={page === item.value ? "page" : undefined} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-semibold transition lg:rounded-xl lg:border-l-2 lg:border-b-0 lg:px-3 lg:text-left ${page === item.value ? "border-accent text-fg lg:bg-accent/10" : "border-transparent text-muted hover:text-fg lg:hover:bg-surface-raised"}`}>{item.label}</button>)}</div></div></nav>
    </motion.aside>

    <div className="mx-auto w-full max-w-7xl px-2 pb-16 pt-8 sm:px-3 lg:px-8 lg:py-5">
      <section className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Your listening</p><h1 className="text-3xl font-bold tracking-[-0.04em] text-fg sm:text-4xl">{page === "dashboard" ? `Welcome back, ${activeUser?.displayName}` : contentTitle}</h1><p className="mt-2 text-sm text-muted">{page === "dashboard" ? "Your last 24 hours" : page === "settings" ? "Manage your listening history" : page === "assistant" ? "Explore your listening history in your own words" : page === "replay" ? "Animate genre changes from your imported Spotify history" : page === "stats" ? "Your listening patterns, at a glance" : page === "sessions" ? "Grouped plays with 45 minutes or less between tracks" : data?.updatedAt ? `Updated ${new Date(data.updatedAt).toLocaleString()}` : "Your Spotify snapshot"}</p></div>{page === "replay" ? <TimeRangeSelector ariaLabel="Taste replay time range" options={replayRangeOptions} value={replayRange} onChange={setRange} /> : page !== "dashboard" && page !== "settings" && page !== "assistant" && <TimeRangeSelector ariaLabel="Stats time range" options={rangeOptions} value={customOpen ? "custom" : range} onChange={changeRange} calendar={customOpen && <CustomRangeCalendar dates={customDraft} initialDate={today} onChange={setCustomDraft} onCancel={() => setCustomOpen(false)} onApply={applyCustomRange} />} onCalendarDismiss={() => setCustomOpen(false)} />}</section>

      {page === "settings" ? <SettingsPanel authedPost={authedPost} onHistoryChanged={invalidateTasteReplay} /> : page === "assistant" ? <AssistantPanel authedPost={authedPost} demo={Boolean(demoUser)} /> : page === "replay" ? tasteReplayError?.range === replayRange && selectedReplay === undefined ? <div role="alert" className="rounded-2xl border border-error/30 bg-error/10 px-5 py-4 text-sm text-error">{tasteReplayError.message}</div> : selectedReplay === undefined ? <div className="h-96 animate-pulse rounded-2xl border border-border-app bg-surface" aria-label="Loading your taste replay" /> : <TasteReplay frames={selectedReplay} status={tasteReplayStatus[replayRange]} source={tasteReplaySource[replayRange]} intervalDays={tasteReplayInterval[replayRange]} /> : error ? <div role="alert" className="rounded-2xl border border-error/30 bg-error/10 px-5 py-4 text-sm text-error">{error}</div> : !data ? <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-6" aria-label="Loading your stats">{[0, 1, 2, 3, 4].map((item) => <div key={item} className={`h-40 animate-pulse rounded-2xl border border-border-app bg-surface ${item < 3 ? "lg:col-span-2" : item === 4 ? "md:col-span-2 lg:col-span-3" : "lg:col-span-3"}`} />)}</div> : <AnimatePresence mode="wait"><motion.div key={`${page}-${rangeKey}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>{page === "dashboard" ? <><dl className="grid gap-6 md:grid-cols-2 lg:grid-cols-6">{summaryStats.map((stat) => <StatCard key={stat.label} {...stat} />)}</dl><div className="mt-6"><ActivityChart title="Listening distribution over the last 24 hours" values={last24Hours.playsByHour} emptyMessage="No listening activity in the last 24 hours." /></div></> : page === "stats" ? statsError?.key === rangeKey && selectedStats === undefined ? <div role="alert" className="rounded-2xl border border-error/30 bg-error/10 px-5 py-4 text-sm text-error">{statsError.message}</div> : selectedStats === undefined ? <div className="grid gap-6 lg:grid-cols-2" aria-label="Loading your stats">{[0, 1, 2, 3, 4, 5, 6].map((item) => <div key={item} className="h-56 animate-pulse rounded-2xl border border-border-app bg-surface" />)}</div> : <StatsPanel stats={selectedStats} /> : page === "sessions" ? sessionsError?.key === rangeKey && selectedSessions === undefined ? <div role="alert" className="rounded-2xl border border-error/30 bg-error/10 px-5 py-4 text-sm text-error">{sessionsError.message}</div> : selectedSessions === undefined ? <div className="space-y-4" aria-label="Loading your listening sessions">{[0, 1].map((item) => <div key={item} className="h-24 animate-pulse rounded-2xl border border-border-app bg-surface" />)}</div> : <SessionList sessions={selectedSessions} /> : customTopError?.key === rangeKey ? <div role="alert" className="rounded-2xl border border-error/30 bg-error/10 px-5 py-4 text-sm text-error">{customTopError.message}</div> : selected === null ? <div className="h-56 animate-pulse rounded-2xl border border-border-app bg-surface" aria-label="Loading your top tracks" /> : <section className="rounded-2xl border border-border-app/80 bg-surface/95 p-5 shadow-xl shadow-black/20 sm:p-6"><div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold text-fg">{contentTitle}</h2><span className="text-xs text-muted">{range === "custom" ? formatCustomRange(customDates!) : RANGE_LABELS[range]}</span></div>{page === "songs" && <RankedTracks tracks={selected?.tracks ?? []} />}{page === "artists" && <RankedArtists artists={selected?.artists ?? []} />}{page === "albums" && <RankedAlbums albums={selected?.albums ?? []} />}</section>}</motion.div></AnimatePresence>}
    </div>
  </main>;
}
