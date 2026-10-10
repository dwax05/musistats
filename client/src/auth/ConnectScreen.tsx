import { useEffect, useState } from "react";
import { motion } from "motion/react";
import SpotifyMark from "../ui/SpotifyMark";

export default function ConnectScreen() {
  const [authError] = useState(() => new URLSearchParams(window.location.search).get("auth_error"));

  useEffect(() => {
    if (authError) window.history.replaceState({}, "", window.location.pathname);
  }, [authError]);

  return (
    <main className="grid min-h-screen place-items-center px-5 py-12">
      <motion.section
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
        className="w-full max-w-md rounded-3xl border border-border-app/70 bg-surface/95 p-8 text-center shadow-2xl shadow-black/50 backdrop-blur-sm sm:p-10"
      >
        <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-2xl border border-accent/30 bg-accent/10 shadow-[0_0_35px_rgba(29,185,84,0.12)]">
          <SpotifyMark className="h-7 w-7 text-accent" />
        </div>
        <h1 className="text-4xl font-bold tracking-[-0.04em] text-fg">MusiStats</h1>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-muted">
          See the artists and tracks that define your listening, all in one place.
        </p>

        {authError && (
          <div role="alert" className="mt-6 rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
            Spotify connection was cancelled or could not be completed. Please try again.
          </div>
        )}

        <a
          href={import.meta.env.DEV ? "http://127.0.0.1:5173/api/auth/spotify" : "/api/auth/spotify"}
          className="mt-7 flex w-full items-center justify-center gap-2.5 rounded-xl bg-accent px-4 py-3 font-semibold text-accent-fg shadow-[0_4px_0_#087c30] transition hover:brightness-110 active:translate-y-1 active:shadow-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          <SpotifyMark className="h-5 w-5" />
          Connect with Spotify
        </a>

        <p className="mt-6 text-xs leading-5 text-muted">
          MusiStats stores your listening data for personal analytics. You can disconnect and delete it at any time.
        </p>
      </motion.section>
    </main>
  );
}
