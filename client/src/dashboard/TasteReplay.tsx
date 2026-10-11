import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { TasteReplayFrame, TasteReplaySource, TasteReplayStatus } from "./model";
import { layoutGenreBubbles } from "./genreLayout";
import { interpolateReplayFrame } from "./replayFrame";

const REPLAY_STEP_MS = 2700;
const MIN_FRAME_INTERVAL_MS = 1000 / 30;
const ANIMATION_LAYOUT_ITERATIONS = 1;
const MIN_GENRE_SHARE = 0.03;
const GENRE_SIZE_RAMP = 0.02;

function bubbleWeight(weight: number): number {
  if (weight <= MIN_GENRE_SHARE) return 0;
  const progress = Math.min(1, (weight - MIN_GENRE_SHARE) / GENRE_SIZE_RAMP);
  const easedProgress = progress * progress * (3 - 2 * progress);
  return weight * easedProgress;
}

function genreColor(name: string) {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 62% 44%)`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(new Date(value));
}

export default function TasteReplay({
  frames,
  status = "ready",
  source = "spotify_snapshots",
}: {
  frames: TasteReplayFrame[];
  status?: TasteReplayStatus;
  source?: TasteReplaySource;
  intervalDays?: number;
}) {
  const [timelinePosition, setTimelinePosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tooltip, setTooltip] = useState<{ name: string; x: number; y: number; pinned: boolean } | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const playbackStartPosition = useRef(0);
  const tooltipId = useId();
  const canPlay = frames.length > 1;
  const lastPosition = Math.max(0, frames.length - 1);
  const displayPosition = Math.min(timelinePosition, lastPosition);
  const frame = useMemo(
    () => interpolateReplayFrame(frames, displayPosition),
    [displayPosition, frames],
  );
  const genreSlots = useMemo(() => {
    const totalGenreWeights = new Map<string, number>();
    for (const replayFrame of frames) {
      for (const genre of replayFrame.genres) {
        totalGenreWeights.set(genre.name, (totalGenreWeights.get(genre.name) ?? 0) + genre.weight);
      }
    }
    return [...totalGenreWeights.keys()].sort((left, right) =>
      (totalGenreWeights.get(right) ?? 0) - (totalGenreWeights.get(left) ?? 0) || left.localeCompare(right),
    );
  }, [frames]);
  const currentGenres = useMemo(
    () => new Map(
      frame?.genres
        .filter((genre) => genre.weight >= MIN_GENRE_SHARE)
        .map((genre) => [genre.name, genre]) ?? [],
    ),
    [frame],
  );
  const layoutInputs = useMemo(
    () => genreSlots.map((name) => ({ name, weight: bubbleWeight(currentGenres.get(name)?.weight ?? 0) })),
    [currentGenres, genreSlots],
  );
  const [layout, setLayout] = useState(() => layoutGenreBubbles(layoutInputs));
  const positions = useRef(new Map(layout.map(({ name, x, y }) => [name, { x, y }])));
  const layoutByName = new Map(layout.map((genre) => [genre.name, genre]));
  const tooltipGenre = tooltip ? currentGenres.get(tooltip.name) : undefined;

  function setTooltipFromPointer(name: string, event: ReactPointerEvent<SVGCircleElement>, pinned = false) {
    const chartBounds = chartRef.current?.getBoundingClientRect();
    if (!chartBounds) return;
    setTooltip({
      name,
      x: Math.min(chartBounds.width - 12, Math.max(12, event.clientX - chartBounds.left)),
      y: Math.max(72, event.clientY - chartBounds.top),
      pinned,
    });
  }

  function setTooltipFromFocus(name: string, circle: SVGCircleElement) {
    const chartBounds = chartRef.current?.getBoundingClientRect();
    const circleBounds = circle.getBoundingClientRect();
    if (!chartBounds) return;
    setTooltip({
      name,
      x: Math.min(chartBounds.width - 12, Math.max(12, circleBounds.left + circleBounds.width / 2 - chartBounds.left)),
      y: Math.max(72, circleBounds.top + circleBounds.height / 2 - chartBounds.top),
      pinned: true,
    });
  }

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      const nextLayout = layoutGenreBubbles(
        layoutInputs,
        positions.current,
        ANIMATION_LAYOUT_ITERATIONS,
      );
      positions.current = new Map(nextLayout.map(({ name, x, y }) => [name, { x, y }]));
      setLayout(nextLayout);
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [layoutInputs]);

  useEffect(() => {
    if (!playing) return;
    const startedAt = performance.now();
    const startPosition = playbackStartPosition.current;
    let animationFrame = 0;
    let lastUpdateAt = 0;
    const animateTimeline = (now: number) => {
      const position = Math.min(lastPosition, startPosition + (now - startedAt) / REPLAY_STEP_MS);
      if (now - lastUpdateAt >= MIN_FRAME_INTERVAL_MS || position === lastPosition) {
        setTimelinePosition(position);
        lastUpdateAt = now;
      }
      if (position < lastPosition) {
        animationFrame = window.requestAnimationFrame(animateTimeline);
      } else {
        setPlaying(false);
      }
    };
    animationFrame = window.requestAnimationFrame(animateTimeline);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [frames.length, lastPosition, playing]);

  function togglePlayback() {
    if (!canPlay) return;
    if (playing) {
      setPlaying(false);
      return;
    }
    if (displayPosition >= lastPosition) {
      playbackStartPosition.current = 0;
      setTimelinePosition(0);
    } else playbackStartPosition.current = displayPosition;
    setPlaying(true);
  }

  if (!frame) {
    return <p className="rounded-2xl border border-border-app/80 bg-surface/95 px-6 py-12 text-center text-sm text-muted">
      {status === "loading_genres"
        ? "Loading artist genre tags. Imported listening history can take a little while to prepare."
        : status === "provider_not_configured"
          ? "Genre lookup is not configured. Cached genre data will still be shown when available."
        : status === "genre_lookup_failed"
          ? "Genre lookup hit a temporary problem. Taste Replay will retry automatically."
          : status === "no_genre_data"
        ? source === "imported_history"
          ? "Spotify has no genre data for these imported artists."
          : "Spotify has no genre data for your top artists yet."
        : "No genre history yet. Daily replay snapshots will appear after your next Spotify sync."}
    </p>;
  }

  if (!canPlay) {
    return <p className="rounded-2xl border border-border-app/80 bg-surface/95 px-6 py-12 text-center text-sm text-muted">
      {status === "loading_genres"
        ? "Loading artist genre tags. There is only one genre time point available so far."
        : "There is only one time point in this range, so there is not enough history to replay yet. Import more listening history or wait for more Spotify snapshots."}
    </p>;
  }

  return <section className="rounded-2xl border border-border-app/80 bg-surface/95 p-5 shadow-xl shadow-black/20 sm:p-7">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Your sound, over time</p>
        <h2 aria-live="polite" className="mt-1 text-xl font-semibold text-fg">{formatDate(frame.capturedAt)}</h2>
      </div>
      <button type="button" onClick={togglePlayback} disabled={!canPlay} className="rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-accent-fg shadow-[0_3px_0_#087c30] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60">
        {!canPlay ? "Waiting for history" : playing ? "Pause" : displayPosition >= lastPosition ? "Play again" : "Play"}
      </button>
    </div>

    <div ref={chartRef} className="relative mt-8">
    <svg role="group" aria-label={`Genre listening shares on ${formatDate(frame.capturedAt)}`} viewBox="0 0 720 520" className="h-[360px] w-full rounded-2xl bg-black/15 sm:h-[420px]">
      {genreSlots.map((name) => {
        const genre = currentGenres.get(name);
        const bubble = layoutByName.get(name);
        const position = bubble ?? { x: 360, y: 260 };
        const radius = bubble?.radius ?? 0;
        const fontSize = radius === 0 ? 0 : Math.min(14, Math.max(9, Math.min(radius * 0.35, (radius * 1.7) / (name.length * 0.58))));
        const labelVisible = radius > 0;
        return <g key={name}>
          <circle
            aria-hidden={!radius}
            aria-label={radius && genre ? `${name}, ${Math.round(genre.weight * 100)} percent` : undefined}
            aria-describedby={tooltip?.name === name && radius ? tooltipId : undefined}
            role="img"
            tabIndex={radius ? 0 : -1}
            cx={position.x}
            cy={position.y}
            r={radius}
            fill={genreColor(name)}
            className="cursor-pointer outline-none focus-visible:stroke-white focus-visible:stroke-2"
            onPointerEnter={(event) => setTooltipFromPointer(name, event)}
            onPointerMove={(event) => {
              if (event.pointerType !== "touch" && tooltip?.name === name && !tooltip.pinned) {
                setTooltipFromPointer(name, event);
              }
            }}
            onPointerLeave={() => {
              if (!tooltip?.pinned) setTooltip(null);
            }}
            onPointerDown={(event) => {
              if (event.pointerType === "touch") setTooltipFromPointer(name, event, true);
            }}
            onFocus={(event) => setTooltipFromFocus(name, event.currentTarget)}
            onBlur={() => setTooltip(null)}
          />
          <text
            aria-hidden={!labelVisible}
            x={position.x}
            y={position.y}
            fontSize={fontSize}
            textAnchor="middle"
            dominantBaseline="central"
            className="pointer-events-none fill-white font-semibold"
          >
            {name}
          </text>
        </g>;
      })}
    </svg>
    {tooltip && tooltipGenre && <div
      id={tooltipId}
      role="tooltip"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-xl border border-border-app bg-surface-raised px-3 py-2 shadow-xl shadow-black/40"
      style={{ left: tooltip.x, top: tooltip.y - 12 }}
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-fg">
        <span className="size-2.5 rounded-full" style={{ backgroundColor: genreColor(tooltip.name) }} />
        {tooltip.name}
      </p>
      <p className="mt-0.5 text-xs text-muted">
        {Math.round(tooltipGenre.weight * 100)}% {source === "imported_history" ? "of listening time" : "relative genre share"}
      </p>
    </div>}
    </div>

    <div className="mt-6 flex flex-col gap-3">
      <label htmlFor="taste-replay-timeline" className="flex justify-between text-xs text-muted">
        <span>{formatDate(frames[0].capturedAt)}</span>
        <span>{formatDate(frames[frames.length - 1].capturedAt)}</span>
      </label>
      <input
        id="taste-replay-timeline"
        aria-label="Taste replay timeline"
        type="range"
        min={0}
        max={frames.length - 1}
        step="any"
        value={displayPosition}
        disabled={!canPlay}
        onChange={(event) => {
          setPlaying(false);
          const position = Number(event.currentTarget.value);
          setTimelinePosition(position);
          playbackStartPosition.current = position;
        }}
        className="w-full accent-accent"
      />
    </div>
    {!canPlay && <p className="mt-4 text-sm text-muted">
      A replay needs at least two time points in this range. Try another time range or import more history.
    </p>}
    <p className="mt-5 text-xs leading-5 text-muted">
      {source === "imported_history"
        ? "Bubble size shows each genre's share of listening time. Genres under 3% are hidden."
        : "Bubble size shows relative genre share. Genres under 3% are hidden."}
    </p>
  </section>;
}
