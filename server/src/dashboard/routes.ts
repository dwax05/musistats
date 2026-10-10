import { ObjectId, type Db } from "mongodb";
import type { Express } from "express";
import { authPayload, requireAuth } from "../auth/routes";

const EMPTY_TOP = {
  short_term: { artists: [], tracks: [] },
  medium_term: { artists: [], tracks: [] },
  long_term: { artists: [], tracks: [] },
};

export function registerDashboardRoutes(app: Express, db: Db) {
  app.post("/api/dashboard", requireAuth, async (req, res) => {
    const { userId } = authPayload(req);
    if (!ObjectId.isValid(userId)) return res.status(401).json({ error: "unauthorized" });

    const [user, snapshot, plays] = await Promise.all([
      db.collection("Users").findOne({ _id: new ObjectId(userId) }),
      db.collection("TopSnapshots").findOne({ userId }, { sort: { capturedAt: -1 } }),
      db.collection("RecentPlays").find({ userId }).sort({ playedAt: -1 }).limit(5).toArray(),
    ]);
    if (!user) return res.status(401).json({ error: "unauthorized" });

    res.json({
      error: "",
      updatedAt: user.lastSyncedAt ?? snapshot?.capturedAt ?? null,
      top: snapshot?.top ?? EMPTY_TOP,
      recent: plays.map((play) => ({
        id: play.trackId,
        name: play.name,
        artists: play.artists,
        imageUrl: play.imageUrl,
        externalUrl: play.externalUrl,
        playedAt: play.playedAt,
      })),
    });
  });
}
