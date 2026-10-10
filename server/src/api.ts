import type { Express } from "express";
import type { Db } from "mongodb";
import { registerAuthRoutes } from "./auth/routes";
import { registerDashboardRoutes } from "./dashboard/routes";
import { registerSessionRoutes } from "./sessions/routes";
import { registerStatsRoutes } from "./stats/routes";
import { registerImportRoutes } from "./imports/routes";
import { registerAssistantRoutes } from "./assistant/routes";
import { registerTasteRoutes } from "./taste/routes";

// Composition root — each feature exports register*Routes(app, db).
export function registerRoutes(app: Express, db: Db) {
  registerAuthRoutes(app, db);
  registerDashboardRoutes(app, db);
  registerSessionRoutes(app, db);
  registerStatsRoutes(app, db);
  registerImportRoutes(app, db);
  registerAssistantRoutes(app, db);
  registerTasteRoutes(app, db);
}
