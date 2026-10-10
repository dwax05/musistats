import type { TasteReplayFrame } from "./model";

export function interpolateReplayFrame(frames: TasteReplayFrame[], position: number): TasteReplayFrame | undefined {
  const lastPosition = Math.max(0, frames.length - 1);
  const boundedPosition = Math.max(0, Math.min(position, lastPosition));
  const leftIndex = Math.floor(boundedPosition);
  const rightIndex = Math.min(leftIndex + 1, lastPosition);
  const progress = boundedPosition - leftIndex;
  const leftFrame = frames[leftIndex];
  if (!leftFrame) return undefined;
  const rightFrame = frames[rightIndex] ?? leftFrame;
  const weights = new Map<string, { name: string; weight: number }>();

  for (const genre of leftFrame.genres) {
    weights.set(genre.name, { ...genre, weight: genre.weight * (1 - progress) });
  }
  for (const genre of rightFrame.genres) {
    const current = weights.get(genre.name);
    if (current) current.weight += genre.weight * progress;
    else weights.set(genre.name, { name: genre.name, weight: genre.weight * progress });
  }

  const startTime = Date.parse(leftFrame.capturedAt);
  const endTime = Date.parse(rightFrame.capturedAt);
  return {
    capturedAt: new Date(startTime + (endTime - startTime) * progress).toISOString(),
    genres: [...weights.values()],
  };
}
