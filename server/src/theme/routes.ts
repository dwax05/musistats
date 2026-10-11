import type { Express } from "express";
import type { Db } from "mongodb";
import { authPayload, requireAuth } from "../auth/routes";
import { emptyThemeSlots, isThemeSlots, sanitizeThemeCss, type ThemeSlots } from "./model";

type ThemeDocument = {
  userId: string;
  css: string;
  slots: ThemeSlots;
  updatedAt: Date;
};

export async function ensureThemeIndexes(db: Db) {
  await db.collection<ThemeDocument>("Themes").createIndex({ userId: 1 }, { unique: true });
}

export function registerThemeRoutes(app: Express, db: Db) {
  app.post("/api/theme/get", requireAuth, async (req, res) => {
    const { userId } = authPayload(req);
    try {
      const theme = await db.collection<ThemeDocument>("Themes").findOne({ userId });
      const css = theme ? sanitizeThemeCss(theme.css) : null;
      const slots = theme && isThemeSlots(theme.slots) ? theme.slots : emptyThemeSlots();
      res.json({ error: "", css, slots });
    } catch (error) {
      console.error(`Theme lookup failed for ${userId}:`, error);
      res.status(503).json({ error: "theme_unavailable" });
    }
  });

  app.post("/api/theme/save", requireAuth, async (req, res) => {
    const css = sanitizeThemeCss(req.body?.css);
    if (!css) return res.status(400).json({ error: "invalid_theme" });
    const { userId } = authPayload(req);
    try {
      await db.collection<ThemeDocument>("Themes").updateOne(
        { userId },
        { $set: { css, updatedAt: new Date() }, $setOnInsert: { slots: emptyThemeSlots() } },
        { upsert: true },
      );
      res.json({ error: "", css, saved: true });
    } catch (error) {
      console.error(`Theme save failed for ${userId}:`, error);
      res.status(503).json({ error: "theme_unavailable" });
    }
  });

  app.post("/api/theme/slots", requireAuth, async (req, res) => {
    if (!isThemeSlots(req.body?.slots)) return res.status(400).json({ error: "invalid_theme_slots" });
    const { userId } = authPayload(req);
    try {
      const slots = req.body.slots as ThemeSlots;
      await db.collection<ThemeDocument>("Themes").updateOne(
        { userId },
        { $set: { slots, updatedAt: new Date() }, $setOnInsert: { css: "" } },
        { upsert: true },
      );
      res.json({ error: "", slots });
    } catch (error) {
      console.error(`Theme slots update failed for ${userId}:`, error);
      res.status(503).json({ error: "theme_unavailable" });
    }
  });
}