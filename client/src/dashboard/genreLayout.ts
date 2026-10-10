import type { GenreShare } from "./model";

export type BubblePosition = { x: number; y: number };
export type LaidOutGenre = GenreShare & BubblePosition & { radius: number };

const WIDTH = 720;
const HEIGHT = 520;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;
const MAX_RADIUS = 98;
const EDGE_GAP = 12;
const COLLISION_GAP = 6;
const COLLISION_STRENGTH = 0.08;
const GRAVITY = 0.002;
const ITERATIONS = 100;

function hash(value: string): number {
  let result = 0;
  for (const character of value) result = (result * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(result);
}

function constrain(node: LaidOutGenre): void {
  node.x = Math.max(node.radius + EDGE_GAP, Math.min(WIDTH - node.radius - EDGE_GAP, node.x));
  node.y = Math.max(node.radius + EDGE_GAP, Math.min(HEIGHT - node.radius - EDGE_GAP, node.y));
}

function separateOverlaps(nodes: LaidOutGenre[]): void {
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    let overlapFound = false;
    for (let left = 0; left < nodes.length; left += 1) {
      const first = nodes[left];
      if (!first) continue;
      for (let right = left + 1; right < nodes.length; right += 1) {
        const second = nodes[right];
        if (!second || !first.radius || !second.radius) continue;

        let dx = second.x - first.x;
        let dy = second.y - first.y;
        let distance = Math.hypot(dx, dy);
        const minimumDistance = first.radius + second.radius + COLLISION_GAP;
        if (distance >= minimumDistance - 0.001) continue;
        if (distance === 0) {
          const angle = (hash(`${first.name}:${second.name}`) % 360) * (Math.PI / 180);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }

        const displacement = (minimumDistance - distance) / 2;
        const xShift = (dx / distance) * displacement;
        const yShift = (dy / distance) * displacement;
        first.x -= xShift;
        first.y -= yShift;
        second.x += xShift;
        second.y += yShift;
        constrain(first);
        constrain(second);
        overlapFound = true;
      }
    }
    if (!overlapFound) break;
  }
}

export function layoutGenreBubbles(
  genres: GenreShare[],
  previousPositions: ReadonlyMap<string, BubblePosition> = new Map(),
  iterations = ITERATIONS,
): LaidOutGenre[] {
  const largestWeight = Math.max(...genres.map((genre) => genre.weight), 0);
  const nodes = genres.map((genre, index): LaidOutGenre => {
    const previous = previousPositions.get(genre.name);
    const angle = (hash(genre.name) % 360) * (Math.PI / 180);
    const distance = 8 + Math.sqrt(index) * 18;
    const node = {
      ...genre,
      radius: genre.weight > 0 && largestWeight > 0
        ? MAX_RADIUS * Math.sqrt(genre.weight / largestWeight)
        : 0,
      x: previous?.x ?? CENTER_X + Math.cos(angle) * distance,
      y: previous?.y ?? CENTER_Y + Math.sin(angle) * distance,
    };
    constrain(node);
    return node;
  });

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const node of nodes) {
      if (!node.radius) continue;
      node.x += (CENTER_X - node.x) * GRAVITY;
      node.y += (CENTER_Y - node.y) * GRAVITY;
    }

    for (let left = 0; left < nodes.length; left += 1) {
      const first = nodes[left];
      if (!first) continue;
      for (let right = left + 1; right < nodes.length; right += 1) {
        const second = nodes[right];
        if (!second) continue;
        if (!first.radius || !second.radius) continue;

        let dx = second.x - first.x;
        let dy = second.y - first.y;
        let distance = Math.hypot(dx, dy);
        const minimumDistance = first.radius + second.radius + COLLISION_GAP;
        if (distance >= minimumDistance) continue;
        if (distance === 0) {
          const angle = (hash(`${first.name}:${second.name}`) % 360) * (Math.PI / 180);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }

        const displacement = ((minimumDistance - distance) / 2) * COLLISION_STRENGTH;
        const xShift = (dx / distance) * displacement;
        const yShift = (dy / distance) * displacement;
        first.x -= xShift;
        first.y -= yShift;
        second.x += xShift;
        second.y += yShift;
      }
    }

    for (const node of nodes) constrain(node);
  }

  separateOverlaps(nodes);
  return nodes;
}
