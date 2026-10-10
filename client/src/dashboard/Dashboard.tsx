import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useAuth, type User } from "../auth/AuthProvider";
import SpotifyMark from "../ui/SpotifyMark";
import {
  RANGE_LABELS,
  isDashboardData,
  type DashboardData,
  type TimeRange,
} from "./model";

function Artwork({ src, alt, round = false }: { src: string | null; alt: string; round?: boolean }) {
  return src ? (
    <img
      src={src}
      alt=""
      width="48"
      height="48"
      className={`h-12 w-12 shrink-0 object-cover ${round ? "rounded-full" : "rounded-lg"}`}
    />
  ) : (
    <div role="img" aria-label={`${alt} artwork unavailable`} className={`grid h-12 w-12 shrink-0 place-items-center bg-surface-raised text-muted ${round ? "rounded-full" : "rounded-lg"}`}>
      ♪
    </div>
  );
}

function EmptyList({ children }: { children: string }) {
  return <p className="py-12 text-center text-sm text-muted">{children}</p>;
}

export default function Dashboard({ initialData, demoUser }: { initialData?: DashboardData; demoUser?: User }) {
  const { user, authedPost, logout, disconnect } = useAuth();
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

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-5 pb-16 pt-6 sm:px-8 lg:px-10">
      <header className="mb-10 flex items-center justify-between gap-5">
        <a href="/" className="text-2xl font-bold tracking-[-0.04em] text-fg">MusiStats</a>
        <details className="relative">
          <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl border border-border-app bg-surface px-3 py-2 transition hover:border-muted/60 focus-visible:outline-2 focus-visible:outline-accent">
            {activeUser?.avatarUrl ? (
              <img src={activeUser.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <div className="grid h-8 w-8 place-items-center rounded-full bg-accent/15 font-semibold text-accent">
                {activeUser?.displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="hidden max-w-44 truncate text-sm font-medium text-fg sm:block">{activeUser?.displayName}</span>
          </summary>
          <div className="absolute right-0 z-10 mt-2 w-56 overflow-hidden rounded-xl border border-border-app bg-surface p-2 shadow-2xl shadow-black/50">
            <button onClick={() => demoUser ? window.location.assign("/") : void logout()} className="w-full rounded-lg px-3 py-2 text-left text-sm text-fg transition hover:bg-surface-raised">Log out</button>
            <p className="px-3 pb-1 pt-3 text-[11px] leading-4 text-muted">Logging out does not stop data collection.</p>
            <button onClick={() => void deleteAccount()} className="w-full rounded-lg px-3 py-2 text-left text-sm text-error transition hover:bg-error/10">Disconnect and delete data</button>
          </div>
        </details>
      </header>

      <section className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Your listening</p>
          <h1 className="text-3xl font-bold tracking-[-0.04em] text-fg sm:text-4xl">Welcome back, {activeUser?.displayName}</h1>
          <p className="mt-2 text-sm text-muted">
            {data?.updatedAt ? `Updated ${new Date(data.updatedAt).toLocaleString()}` : "Your Spotify snapshot"}
          </p>
        </div>
        <div className="flex w-fit rounded-xl border border-border-app bg-surface p-1" aria-label="Stats time range">
          {(Object.keys(RANGE_LABELS) as TimeRange[]).map((value) => (
            <button
              key={value}
              onClick={() => setRange(value)}
              aria-pressed={range === value}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition sm:px-4 ${range === value ? "bg-accent text-accent-fg shadow-[0_2px_0_#087c30]" : "text-muted hover:text-fg"}`}
            >
              {RANGE_LABELS[value]}
            </button>
          ))}
        </div>
      </section>

      {error ? (
        <div role="alert" className="rounded-2xl border border-error/30 bg-error/10 px-5 py-4 text-sm text-error">{error}</div>
      ) : !data ? (
        <div className="grid gap-6 lg:grid-cols-2" aria-label="Loading your stats">
          {[0, 1, 2].map((item) => <div key={item} className={`h-96 animate-pulse rounded-2xl border border-border-app bg-surface ${item === 2 ? "lg:col-span-2 h-64" : ""}`} />)}
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div key={range} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-border-app/80 bg-surface/95 p-5 shadow-xl shadow-black/20 sm:p-6">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-fg">Top tracks</h2>
                <span className="text-xs text-muted">{RANGE_LABELS[range]}</span>
              </div>
              {!selected?.tracks.length ? <EmptyList>No top tracks yet. Keep listening and check back soon.</EmptyList> : (
                <ol className="space-y-2">
                  {selected.tracks.slice(0, 5).map((track, index) => (
                    <li key={track.id}>
                      <a href={track.externalUrl} target="_blank" rel="noreferrer" className="group flex items-center gap-3 rounded-xl p-2 transition hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent">
                        <span className="w-5 text-center text-xs font-semibold text-muted">{index + 1}</span>
                        <Artwork src={track.imageUrl} alt={track.name} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-fg group-hover:text-accent">{track.name}</span>
                          <span className="block truncate text-xs text-muted">{track.artists.join(", ")}</span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="rounded-2xl border border-border-app/80 bg-surface/95 p-5 shadow-xl shadow-black/20 sm:p-6">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-fg">Top artists</h2>
                <span className="text-xs text-muted">{RANGE_LABELS[range]}</span>
              </div>
              {!selected?.artists.length ? <EmptyList>No top artists yet. Keep listening and check back soon.</EmptyList> : (
                <ol className="space-y-2">
                  {selected.artists.slice(0, 5).map((artist, index) => (
                    <li key={artist.id}>
                      <a href={artist.externalUrl} target="_blank" rel="noreferrer" className="group flex items-center gap-3 rounded-xl p-2 transition hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent">
                        <span className="w-5 text-center text-xs font-semibold text-muted">{index + 1}</span>
                        <Artwork src={artist.imageUrl} alt={artist.name} round />
                        <span className="truncate text-sm font-semibold text-fg group-hover:text-accent">{artist.name}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="rounded-2xl border border-border-app/80 bg-surface/95 p-5 shadow-xl shadow-black/20 lg:col-span-2 sm:p-6">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-fg">Recently played</h2>
                <SpotifyMark className="h-5 w-5 text-accent" />
              </div>
              {!data.recent.length ? <EmptyList>No recent plays are available yet.</EmptyList> : (
                <div className="grid gap-2 lg:grid-cols-5">
                  {data.recent.slice(0, 5).map((track) => (
                    <a key={`${track.id}-${track.playedAt}`} href={track.externalUrl} target="_blank" rel="noreferrer" className="group flex min-w-0 items-center gap-3 rounded-xl p-2 transition hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent lg:block">
                      <Artwork src={track.imageUrl} alt={track.name} />
                      <span className="mt-3 min-w-0 lg:block">
                        <span className="block truncate text-sm font-semibold text-fg group-hover:text-accent">{track.name}</span>
                        <span className="block truncate text-xs text-muted">{track.artists.join(", ")}</span>
                        <span className="mt-1 block text-[11px] text-muted/70">{new Date(track.playedAt).toLocaleString()}</span>
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </section>
          </motion.div>
        </AnimatePresence>
      )}
    </main>
  );
}
