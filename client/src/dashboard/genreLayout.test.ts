import { describe, expect, it } from "vitest";
import { layoutGenreBubbles } from "./genreLayout";

describe("genre bubble force layout", () => {
  it("pulls bubbles toward the center while resolving overlaps", () => {
    const layout = layoutGenreBubbles([
      { name: "ambient", weight: 0.4 },
      { name: "indie", weight: 0.35 },
      { name: "pop", weight: 0.25 },
    ], new Map([
      ["ambient", { x: 80, y: 70 }],
      ["indie", { x: 640, y: 80 }],
      ["pop", { x: 90, y: 460 }],
    ]));

    for (let left = 0; left < layout.length; left += 1) {
      const first = layout[left];
      if (!first) continue;
      for (let right = left + 1; right < layout.length; right += 1) {
        const second = layout[right];
        if (!second) continue;
        expect(Math.hypot(second.x - first.x, second.y - first.y))
          .toBeGreaterThanOrEqual(first.radius + second.radius + 5.9);
      }
    }

    const initialDistance = Math.hypot(80 - 360, 70 - 260);
    const finalDistance = Math.hypot(layout[0]!.x - 360, layout[0]!.y - 260);
    expect(finalDistance).toBeLessThan(initialDistance);
  });

  it("keeps zero-weight genres at invisible, stable positions", () => {
    const layout = layoutGenreBubbles([{ name: "unknown", weight: 0 }]);
    expect(layout).toHaveLength(1);
    expect(layout[0]?.radius).toBe(0);
  });

  it("scales small bubbles continuously instead of imposing a minimum visible size", () => {
    const belowThreshold = layoutGenreBubbles([
      { name: "small", weight: 0.029 },
      { name: "large", weight: 0.5 },
    ]);
    const aboveThreshold = layoutGenreBubbles([
      { name: "small", weight: 0.031 },
      { name: "large", weight: 0.5 },
    ]);

    expect(belowThreshold[0]?.radius).toBeGreaterThan(0);
    expect(aboveThreshold[0]!.radius).toBeGreaterThan(belowThreshold[0]!.radius);
    expect(aboveThreshold[0]!.radius - belowThreshold[0]!.radius).toBeLessThan(1);
  });

  it("supports incremental force steps as bubble weights change", () => {
    const start = layoutGenreBubbles([
      { name: "indie", weight: 1 },
      { name: "ambient", weight: 0 },
    ], new Map([
      ["indie", { x: 280, y: 260 }],
      ["ambient", { x: 460, y: 260 }],
    ]), 1);
    const midpoint = layoutGenreBubbles([
      { name: "indie", weight: 0.75 },
      { name: "ambient", weight: 0.25 },
    ], new Map(start.map(({ name, x, y }) => [name, { x, y }])), 1);
    const end = layoutGenreBubbles([
      { name: "indie", weight: 0.5 },
      { name: "ambient", weight: 0.5 },
    ], new Map(midpoint.map(({ name, x, y }) => [name, { x, y }])), 1);

    expect(midpoint[1]!.radius).toBeGreaterThan(start[1]!.radius);
    expect(midpoint[1]!.radius).toBeLessThan(end[1]!.radius);
    expect(Math.hypot(midpoint[0]!.x - start[0]!.x, midpoint[0]!.y - start[0]!.y))
      .toBeGreaterThan(0);
  });

  it("keeps bubbles from overlapping during a single animation step", () => {
    const layout = layoutGenreBubbles([
      { name: "indie", weight: 1 },
      { name: "ambient", weight: 1 },
      { name: "pop", weight: 0.8 },
    ], new Map([
      ["indie", { x: 340, y: 260 }],
      ["ambient", { x: 380, y: 260 }],
      ["pop", { x: 360, y: 300 }],
    ]), 1);

    for (let left = 0; left < layout.length; left += 1) {
      const first = layout[left];
      if (!first) continue;
      for (let right = left + 1; right < layout.length; right += 1) {
        const second = layout[right];
        if (!second) continue;
        expect(Math.hypot(second.x - first.x, second.y - first.y))
          .toBeGreaterThanOrEqual(first.radius + second.radius + 5.9);
      }
    }
  });

  it("does not pull bubbles together as their radii shrink", () => {
    const positions = new Map([
      ["indie", { x: 235, y: 260 }],
      ["ambient", { x: 485, y: 260 }],
    ]);
    const beforeDistance = 250;
    const layout = layoutGenreBubbles([
      { name: "indie", weight: 0.1 },
      { name: "ambient", weight: 0.9 },
    ], positions, 0);

    expect(Math.hypot(layout[1]!.x - layout[0]!.x, layout[1]!.y - layout[0]!.y))
      .toBe(beforeDistance);
  });

  it("pushes a growing bubble apart by only the overlap amount", () => {
    const startingLayout = layoutGenreBubbles([
      { name: "indie", weight: 0.1 },
      { name: "ambient", weight: 0.9 },
    ], new Map([
      ["indie", { x: 270, y: 260 }],
      ["ambient", { x: 450, y: 260 }],
    ]), 0);
    const nextLayout = layoutGenreBubbles([
      { name: "indie", weight: 0.7 },
      { name: "ambient", weight: 0.9 },
    ], new Map(startingLayout.map(({ name, x, y }) => [name, { x, y }])), 1);
    const startDistance = Math.hypot(
      startingLayout[1]!.x - startingLayout[0]!.x,
      startingLayout[1]!.y - startingLayout[0]!.y,
    );
    const nextDistance = Math.hypot(
      nextLayout[1]!.x - nextLayout[0]!.x,
      nextLayout[1]!.y - nextLayout[0]!.y,
    );

    expect(nextDistance).toBeGreaterThan(startDistance);
    expect(nextDistance)
      .toBeGreaterThanOrEqual(nextLayout[0]!.radius + nextLayout[1]!.radius + 5.9);
    expect(Math.hypot(nextLayout[0]!.x - startingLayout[0]!.x, nextLayout[0]!.y - startingLayout[0]!.y))
      .toBeLessThan(20);
  });

  it("starts bubbles in a compact cluster", () => {
    const layout = layoutGenreBubbles([
      { name: "rock", weight: 0.3 },
      { name: "alternative", weight: 0.2 },
      { name: "indie", weight: 0.15 },
      { name: "pop", weight: 0.12 },
      { name: "shoegaze", weight: 0.1 },
      { name: "ambient", weight: 0.08 },
      { name: "metal", weight: 0.05 },
    ]);
    const farthestCenterDistance = Math.max(...layout.map(({ x, y }) => Math.hypot(x - 360, y - 260)));

    expect(farthestCenterDistance).toBeLessThan(260);
  });
});
