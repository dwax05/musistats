import type { Express } from "express";
import type { Db } from "mongodb";
import { registerAuthRoutes } from "./auth/routes";
import { registerDashboardRoutes } from "./dashboard/routes";

// Composition root — each feature exports register*Routes(app, db).
export function registerRoutes(app: Express, db: Db) {
  registerAuthRoutes(app, db);
  registerDashboardRoutes(app, db);
}
