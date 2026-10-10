import type { Express } from "express";
import type { Db } from "mongodb";
import { registerAuthRoutes } from "./routes/auth";
import { registerDashboardRoutes } from "./routes/dashboard";

// Composition root — each route module exports register*Routes(app, db).
// Convention: every endpoint is a POST returning 200 with { error: "" }.
export function registerRoutes(app: Express, db: Db) {
  registerAuthRoutes(app, db);
  registerDashboardRoutes(app, db);
  app.post("/api/hello", (_req, res) => {
    res.json({ error: "", message: "hello from musistats" });
  });
}
