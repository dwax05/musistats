import express from "express";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAccessToken } from "../auth/tokens";
import { registerThemeRoutes } from "./routes";

beforeEach(() => {
  process.env.ACCESS_TOKEN_SECRET = "theme-route-test-secret";
});

function routeHarness(saved: Record<string, unknown> | null = null) {
  const userId = new ObjectId().toString();
  const findOne = vi.fn().mockResolvedValue(saved);
  const updateOne = vi.fn().mockResolvedValue({});
  const collection = vi.fn().mockReturnValue({ findOne, updateOne });
  const app = express();
  registerThemeRoutes(app, { collection } as never);

  function handlerFor(path: string) {
    const route = app.router.stack.find((layer) => layer.route?.path === path)?.route;
    if (!route) throw new Error(`Theme route ${path} was not registered`);
    return route.stack;
  }

  const req: { headers: { authorization: string }; body: unknown } = {
    headers: { authorization: `Bearer ${createAccessToken({ userId, displayName: "Test", avatarUrl: null })}` },
    body: {},
  };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  async function invoke(path: string, body: unknown = {}) {
    req.body = body;
    const [auth, handler] = handlerFor(path);
    auth!.handle(req as never, res as never, vi.fn());
    await handler!.handle(req as never, res as never, vi.fn());
  }

  return { userId, findOne, updateOne, collection, req, res, invoke };
}

describe("theme routes", () => {
  it("returns an empty theme and three empty slots for a new account", async () => {
    const harness = routeHarness();
    await harness.invoke("/api/theme/get");

    expect(harness.collection).toHaveBeenCalledWith("Themes");
    expect(harness.findOne).toHaveBeenCalledWith({ userId: harness.userId });
    expect(harness.res.json).toHaveBeenCalledWith({ error: "", css: null, slots: [null, null, null] });
  });

  it("saves canonical theme CSS scoped to the authenticated user", async () => {
    const harness = routeHarness();
    await harness.invoke("/api/theme/save", { css: ":root { --accent: #AABBCC; }" });

    expect(harness.updateOne).toHaveBeenCalledWith(
      { userId: harness.userId },
      expect.objectContaining({ $set: expect.objectContaining({ css: ":root {\n  --accent: #aabbcc;\n}" }) }),
      { upsert: true },
    );
    expect(harness.res.json).toHaveBeenCalledWith({ error: "", css: ":root {\n  --accent: #aabbcc;\n}", saved: true });
  });

  it("rejects unsafe imported CSS without writing to MongoDB", async () => {
    const harness = routeHarness();
    await harness.invoke("/api/theme/save", { css: ":root { --bg: url(https://example.test); }" });

    expect(harness.res.status).toHaveBeenCalledWith(400);
    expect(harness.res.json).toHaveBeenCalledWith({ error: "invalid_theme" });
    expect(harness.updateOne).not.toHaveBeenCalled();
  });

  it("validates three save slots and scopes updates to the authenticated user", async () => {
    const harness = routeHarness();
    const colors = Object.fromEntries([
      ["--bg", "#111111"], ["--surface", "#222222"], ["--surface-raised", "#333333"],
      ["--border", "#444444"], ["--fg", "#555555"], ["--muted", "#666666"],
      ["--accent", "#777777"], ["--accent-fg", "#888888"], ["--error", "#999999"],
    ]);
    const slots = [colors, null, colors];
    await harness.invoke("/api/theme/slots", { slots });

    expect(harness.updateOne).toHaveBeenCalledWith(
      { userId: harness.userId },
      expect.objectContaining({ $set: expect.objectContaining({ slots }) }),
      { upsert: true },
    );
    expect(harness.res.json).toHaveBeenCalledWith({ error: "", slots });
  });
});