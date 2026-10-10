import express from "express";
import cookieParser from "cookie-parser";
import { MongoClient } from "mongodb";
import { registerRoutes } from "./api";

const app = express();
const PORT = 3500;

// Health answers from the moment the process is up — before Mongo connects —
// so the client's deploy-window polling gets a response during startup.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use(express.json());
app.use(cookieParser());

app.listen(PORT, () => console.log(`API listening on :${PORT}`));

const MONGO_URI =
  process.env.MONGO_URI ?? "mongodb://localhost:27017/musistats";

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  registerRoutes(app, client.db());
}

void main();
