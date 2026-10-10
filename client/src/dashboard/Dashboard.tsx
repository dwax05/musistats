import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useAuth, type User } from "../auth/AuthProvider";
import SegmentedControl from "../ui/SegmentedControl";
import { RANGE_LABELS, isDashboardData, summarizeLast24Hours, type Album, type Artist, type DashboardData, type TimeRange, type Track } from "./model";

type Page = "dashboard" | "songs" | "artists" | "albums";

const pages: { value: Page; label: string }[] = [
  { value: "dashboard", label: "Dashboard" },
  { value: "songs", label: "Songs" },
  { value: "artists", label: "Artists" },
  { value: "albums", label: "Albums" },
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

function StatCard({ label, value, fullWidth = false }: { label: string; value: string | number; fullWidth?: boolean }) {
  return <div className={`min-h-44 rounded-2xl border border-border-app/80 bg-surface/95 shadow-xl shadow-black/20 ${fullWidth ? "lg:col-span-2" : ""}`} style={{ padding: "2rem" }}>
    <dt className="text-base font-semibold text-fg">{label}</dt>
    <dd className="mt-7 truncate text-3xl font-bold tracking-[-0.03em] text-fg" title={String(value)}>{value}</dd>
  </div>;
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

export default function Dashboard({ initialData, demoUser }: { initialData?: DashboardData; demoUser?: User }) {
  const { user, authedPost, logout, disconnect } = useAuth();
  const [page, setPage] = useState<Page>("dashboard");
  const [range, setRange] = useState<TimeRange>("medium_term");
  const [data, setData] = useState<DashboardData | null>(initialData ?? null);
  const [error, setError] = useState("");
  const activeUser = demoUser ?? user;

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

  async function deleteAccount() {
    if (!window.confirm("Disconnect Spotify and permanently delete all imported MusiStats data?")) return;
    if (demoUser) return window.location.assign("/");
    const deleteError = await disconnect();
    if (deleteError) setError(deleteError);
  }

  const selected = data?.top[range];
  const last24Hours = data?.last24Hours ?? summarizeLast24Hours(data?.recent ?? []);
  const contentTitle = page === "songs" ? "Top songs" : page === "artists" ? "Top artists" : "Top albums";

  return <main className="mx-auto min-h-screen w-full max-w-7xl px-5 pb-16 pt-6 sm:px-8 lg:px-10">
    <header className="mb-7 flex flex-wrap items-center justify-between gap-5">
      <a href="/" className="text-2xl font-bold tracking-[-0.04em] text-fg">MusiStats</a>
      <details className="relative"><summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl border border-border-app bg-surface px-3 py-2 transition hover:border-muted/60 focus-visible:outline-2 focus-visible:outline-accent">{activeUser?.avatarUrl ? <img src={activeUser.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" /> : <div className="grid h-8 w-8 place-items-center rounded-full bg-accent/15 font-semibold text-accent">{activeUser?.displayName.charAt(0).toUpperCase()}</div>}<span className="hidden max-w-44 truncate text-sm font-medium text-fg sm:block">{activeUser?.displayName}</span></summary>
        <div className="absolute right-0 z-10 mt-2 w-56 overflow-hidden rounded-xl border border-border-app bg-surface p-2 shadow-2xl shadow-black/50"><button onClick={() => demoUser ? window.location.assign("/") : void logout()} className="w-full rounded-lg px-3 py-2 text-left text-sm text-fg transition hover:bg-surface-raised">Log out</button><p className="px-3 pb-1 pt-3 text-[11px] leading-4 text-muted">Logging out does not stop data collection.</p><button onClick={() => void deleteAccount()} className="w-full rounded-lg px-3 py-2 text-left text-sm text-error transition hover:bg-error/10">Disconnect and delete data</button></div>
      </details>
    </header>

    <nav aria-label="MusiStats pages" className="mb-10 flex gap-1 overflow-x-auto border-b border-border-app">{pages.map((item) => <button key={item.value} type="button" onClick={() => setPage(item.value)} aria-current={page === item.value ? "page" : undefined} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-semibold transition ${page === item.value ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}>{item.label}</button>)}</nav>

    <section className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Your listening</p><h1 className="text-3xl font-bold tracking-[-0.04em] text-fg sm:text-4xl">{page === "dashboard" ? `Welcome back, ${activeUser?.displayName}` : contentTitle}</h1><p className="mt-2 text-sm text-muted">{page === "dashboard" ? "Your last 24 hours" : data?.updatedAt ? `Updated ${new Date(data.updatedAt).toLocaleString()}` : "Your Spotify snapshot"}</p></div>{page !== "dashboard" && <SegmentedControl ariaLabel="Stats time range" options={(Object.keys(RANGE_LABELS) as TimeRange[]).map((value) => ({ value, label: RANGE_LABELS[value] }))} value={range} onChange={setRange} />}</section>

    {error ? <div role="alert" className="rounded-2xl border border-error/30 bg-error/10 px-5 py-4 text-sm text-error">{error}</div> : !data ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading your stats">{[0, 1, 2, 3, 4].map((item) => <div key={item} className="h-40 animate-pulse rounded-2xl border border-border-app bg-surface" />)}</div> : <AnimatePresence mode="wait"><motion.div key={`${page}-${range}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>{page === "dashboard" ? <dl className="grid gap-6 lg:grid-cols-2">{[["Songs listened in the last 24 hours", last24Hours.songs], ["Time listened in the last 24 hours", formatDuration(last24Hours.minutes)], ["Artists listened in the last 24 hours", last24Hours.artists], ["Most listened artist", last24Hours.topArtist ?? "—"], ["Most listened song", last24Hours.topTrack ?? "—"]].map(([label, value], index) => <StatCard key={label} label={String(label)} value={value} fullWidth={index === 0} />)}</dl> : <section className="rounded-2xl border border-border-app/80 bg-surface/95 p-5 shadow-xl shadow-black/20 sm:p-6"><div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold text-fg">{contentTitle}</h2><span className="text-xs text-muted">{RANGE_LABELS[range]}</span></div>{page === "songs" && <RankedTracks tracks={selected?.tracks ?? []} />}{page === "artists" && <RankedArtists artists={selected?.artists ?? []} />}{page === "albums" && <RankedAlbums albums={selected?.albums ?? []} />}</section>}</motion.div></AnimatePresence>}
  </main>;
}
