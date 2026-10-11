import { describe, expect, it, vi } from "vitest";
import { recordSpotifyRateLimit, SpotifyRateLimitError, waitForSpotifyRequestSlot } from "./rate-limit";

describe("Spotify rate limit", () => {
  it("blocks later requests until Spotify's Retry-After expires", async () => {
    const retryAfterUntil = new Date(Date.now() + 60_000);
    const updateOne = vi.fn().mockResolvedValue({});
    const findOneAndUpdate = vi.fn()
      .mockResolvedValueOnce({ _id: "spotifyRateLimit" })
      .mockResolvedValueOnce(null);
    const findOne = vi.fn().mockResolvedValue({ _id: "spotifyRateLimit", retryAfterUntil });
    const db = { collection: () => ({ updateOne, findOneAndUpdate, findOne }) } as never;

    await expect(waitForSpotifyRequestSlot(db)).resolves.toBeUndefined();
    await recordSpotifyRateLimit(db, 60);
    await expect(waitForSpotifyRequestSlot(db)).rejects.toEqual(expect.any(SpotifyRateLimitError));
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "spotifyRateLimit" },
      { $max: { retryAfterUntil: expect.any(Date) } },
      { upsert: true },
    );
  });
});
