import { useEffect, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useAuth, type User } from "../auth/AuthProvider";
import SegmentedControl from "../ui/SegmentedControl";
import { RANGE_LABELS, isDashboardData, isSessionsData, summarizeLast24Hours, type Album, type Artist, type DashboardData, type ListeningSession, type TimeRange, type Track } from "./model";

type Page = "dashboard" | "songs" | "artists" | "albums" | "sessions";

const pages: { value: Page; label: string }[] = [
  { value: "dashboard", label: "Dashboard" },
  { value: "songs", label: "Songs" },
  { value: "artists", label: "Artists" },
  { value: "albums", label: "Albums" },
  { value: "sessions", label: "Sessions" },
];

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

function StatCard({ label, value, fullWidth = false, imageUrl, imageAlt, round = false }: { label: string; value: string | number; fullWidth?: boolean; imageUrl?: string | null; imageAlt?: string; round?: boolean }) {
  return <div className={`min-h-44 rounded-2xl border border-border-app/80 bg-surface/95 shadow-xl shadow-black/20 ${fullWidth ? "lg:col-span-2" : ""}`} style={{ padding: "2rem" }}>
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
  return <ol className="space-y-2">{tracks.map((track, index) => <li key={track.id}><a href={track.externalUrl} target="_blank" rel="noreferrer" className="group flex items-center gap-3 rounded-xl p-2 transition hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent"><span className="w-5 text-center text-xs font-semibold text-muted">{index + 1}</span><Artwork src={track.imageUrl} alt={track.name} /><span className="min-w-0"><span className="block truncate text-sm font-semibold text-fg group-hover:text-accent">{track.name}</span><span className="block truncate text-xs text-muted">{track.artists.join(", ")}</span></span></a></li>)}</ol>;
}

function RankedArtists({ artists }: { artists: Artist[] }) {
  if (!artists.length) return <EmptyList>No top artists yet. Keep listening and check back soon.</EmptyList>;
  return <ol className="space-y-2">{artists.map((artist, index) => <li key={artist.id}><a href={artist.externalUrl} target="_blank" rel="noreferrer" className="group flex items-center gap-3 rounded-xl p-2 transition hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent"><span className="w-5 text-center text-xs font-semibold text-muted">{index + 1}</span><Artwork src={artist.imageUrl} alt={artist.name} round /><span className="truncate text-sm font-semibold text-fg group-hover:text-accent">{artist.name}</span></a></li>)}</ol>;
}

function RankedAlbums({ albums }: { albums: Album[] }) {
  if (!albums.length) return <EmptyList>No top albums yet. Keep listening and check back soon.</EmptyList>;
  return <ol className="space-y-2">{albums.map((album, index) => <li key={album.id}><a href={album.externalUrl} target="_blank" rel="noreferrer" className="group flex items-center gap-3 rounded-xl p-2 transition hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent"><span className="w-5 text-center text-xs font-semibold text-muted">{index + 1}</span><Artwork src={album.imageUrl} alt={album.name} /><span className="min-w-0"><span className="block truncate text-sm font-semibold text-fg group-hover:text-accent">{album.name}</span><span className="block truncate text-xs text-muted">{album.artists.join(", ")}</span></span></a></li>)}</ol>;
}

export default function Dashboard({ initialData, initialSessions, demoUser }: { initialData?: DashboardData; initialSessions?: Record<TimeRange, ListeningSession[]>; demoUser?: User }) {
  const { user, authedPost, logout, disconnect } = useAuth();
  const [page, setPage] = useState<Page>("dashboard");
  const [range, setRange] = useState<TimeRange>("medium_term");
  const [data, setData] = useState<DashboardData | null>(initialData ?? null);
  const [error, setError] = useState("");
  const [sessions, setSessions] = useState<Partial<Record<TimeRange, ListeningSession[]>>>(initialSessions ?? {});
  const [sessionsError, setSessionsError] = useState<{ range: TimeRange; message: string } | null>(null);
  const activeUser = demoUser ?? user;
  const selectedSessions = sessions[range];

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
    if (initialSessions !== undefined || page !== "sessions" || selectedSessions !== undefined) return;
    let active = true;
    void authedPost("/api/sessions", { range }).then((response) => {
      if (!active) return;
      if (!isSessionsData(response)) setSessionsError({ range, message: response.error === "offline" ? "MusiStats is temporarily unavailable." : "Your listening sessions could not be loaded." });
      else setSessions((current) => ({ ...current, [range]: response.sessions }));
    });
    return () => { active = false; };
  }, [authedPost, initialSessions, page, range, selectedSessions]);

  async function deleteAccount() {
    if (!window.confirm("Disconnect Spotify and permanently delete all imported MusiStats data?")) return;
    if (demoUser) return window.location.assign("/");
    const deleteError = await disconnect();
    if (deleteError) setError(deleteError);
  }

  const selected = data?.top[range];
  const last24Hours = data?.last24Hours ?? summarizeLast24Hours(data?.recent ?? []);
  const contentTitle = page === "songs" ? "Top songs" : page === "artists" ? "Top artists" : page === "albums" ? "Top albums" : "Longest listening sessions";
  const stats = [
    { label: "Songs listened in the last 24 hours", value: last24Hours.songs },
    { label: "Time listened in the last 24 hours", value: formatDuration(last24Hours.minutes) },
    { label: "Artists listened in the last 24 hours", value: last24Hours.artists },
    { label: "Most listened artist", value: last24Hours.topArtist?.name ?? "—", imageUrl: last24Hours.topArtist?.imageUrl, imageAlt: last24Hours.topArtist?.name, round: true },
    { label: "Most listened song", value: last24Hours.topTrack?.name ?? "—", imageUrl: last24Hours.topTrack?.imageUrl, imageAlt: last24Hours.topTrack?.name },
  ];

  return <main className="min-h-screen w-full lg:flex">
    <aside className="border-b border-border-app px-5 pb-6 pt-6 sm:px-8 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r lg:bg-surface lg:px-6 lg:py-8">
      <div className="flex items-center justify-between lg:contents">
        <a href="/" className="text-2xl font-bold tracking-[-0.04em] text-fg">MusiStats</a>
        <details className="relative lg:order-3 lg:mt-auto"><summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl border border-border-app bg-surface px-3 py-2 transition hover:border-muted/60 focus-visible:outline-2 focus-visible:outline-accent">{activeUser?.avatarUrl ? <img src={activeUser.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" /> : <div className="grid h-8 w-8 place-items-center rounded-full bg-accent/15 font-semibold text-accent">{activeUser?.displayName.charAt(0).toUpperCase()}</div>}<span className="hidden max-w-44 truncate text-sm font-medium text-fg sm:block">{activeUser?.displayName}</span></summary>
          <div className="absolute right-0 z-10 mt-2 w-56 overflow-hidden rounded-xl border border-border-app bg-surface p-2 shadow-2xl shadow-black/50 lg:bottom-full lg:right-auto lg:left-0 lg:mb-2 lg:mt-0"><button onClick={() => demoUser ? window.location.assign("/") : void logout()} className="w-full rounded-lg px-3 py-2 text-left text-sm text-fg transition hover:bg-surface-raised">Log out</button><p className="px-3 pb-1 pt-3 text-[11px] leading-4 text-muted">Logging out does not stop data collection.</p><button onClick={() => void deleteAccount()} className="w-full rounded-lg px-3 py-2 text-left text-sm text-error transition hover:bg-error/10">Disconnect and delete data</button></div>
        </details>
      </div>

      <nav aria-label="MusiStats pages" className="mt-6 flex gap-1 overflow-x-auto border-b border-border-app lg:mt-10 lg:flex-col lg:gap-1 lg:overflow-visible lg:border-0 lg:pr-2">{pages.map((item) => <button key={item.value} type="button" onClick={() => setPage(item.value)} aria-current={page === item.value ? "page" : undefined} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-semibold transition lg:rounded-xl lg:border-l-2 lg:border-b-0 lg:px-3 lg:text-left ${page === item.value ? "border-accent text-fg lg:bg-accent/10" : "border-transparent text-muted hover:text-fg lg:hover:bg-surface-raised"}`}>{item.label}</button>)}</nav>
    </aside>

    <div className="mx-auto w-full max-w-7xl px-5 pb-16 pt-8 sm:px-8 lg:px-10 lg:pt-10">
      <section className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Your listening</p><h1 className="text-3xl font-bold tracking-[-0.04em] text-fg sm:text-4xl">{page === "dashboard" ? `Welcome back, ${activeUser?.displayName}` : contentTitle}</h1><p className="mt-2 text-sm text-muted">{page === "dashboard" ? "Your last 24 hours" : page === "sessions" ? "Grouped plays with 45 minutes or less between tracks" : data?.updatedAt ? `Updated ${new Date(data.updatedAt).toLocaleString()}` : "Your Spotify snapshot"}</p></div>{page !== "dashboard" && <SegmentedControl ariaLabel="Stats time range" options={(Object.keys(RANGE_LABELS) as TimeRange[]).map((value) => ({ value, label: RANGE_LABELS[value] }))} value={range} onChange={setRange} />}</section>

      {error ? <div role="alert" className="rounded-2xl border border-error/30 bg-error/10 px-5 py-4 text-sm text-error">{error}</div> : !data ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading your stats">{[0, 1, 2, 3, 4].map((item) => <div key={item} className="h-40 animate-pulse rounded-2xl border border-border-app bg-surface" />)}</div> : <AnimatePresence mode="wait"><motion.div key={`${page}-${range}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>{page === "dashboard" ? <><dl className="grid gap-6 lg:grid-cols-2">{stats.map((stat, index) => <StatCard key={stat.label} {...stat} fullWidth={index === 0} />)}</dl><div className="mt-6 grid gap-6 lg:grid-cols-2"><ActivityChart title="Time listened over the last 24 hours" values={last24Hours.minutesByHour} emptyMessage="Hourly listening time is not available yet." /><ActivityChart title="Listening distribution over the last 24 hours" values={last24Hours.playsByHour} emptyMessage="No listening activity in the last 24 hours." /></div></> : page === "sessions" ? sessionsError?.range === range && selectedSessions === undefined ? <div role="alert" className="rounded-2xl border border-error/30 bg-error/10 px-5 py-4 text-sm text-error">{sessionsError.message}</div> : selectedSessions === undefined ? <div className="space-y-4" aria-label="Loading your listening sessions">{[0, 1].map((item) => <div key={item} className="h-24 animate-pulse rounded-2xl border border-border-app bg-surface" />)}</div> : <SessionList sessions={selectedSessions} /> : <section className="rounded-2xl border border-border-app/80 bg-surface/95 p-5 shadow-xl shadow-black/20 sm:p-6"><div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold text-fg">{contentTitle}</h2><span className="text-xs text-muted">{RANGE_LABELS[range]}</span></div>{page === "songs" && <RankedTracks tracks={selected?.tracks ?? []} />}{page === "artists" && <RankedArtists artists={selected?.artists ?? []} />}{page === "albums" && <RankedAlbums albums={selected?.albums ?? []} />}</section>}</motion.div></AnimatePresence>}
    </div>
  </main>;
}
