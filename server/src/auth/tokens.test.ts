import { describe, expect, it } from "vitest";
import { createAccessToken, verifyAccessToken } from "./tokens";

describe("auth tokens", () => {
  it("round-trips a payload", () => {
    const payload = { userId: "u1", displayName: "Sam", avatarUrl: null };
    const token = createAccessToken(payload);
    expect(verifyAccessToken(token)).toEqual(payload);
  });

  it("rejects garbage", () => {
    expect(verifyAccessToken("not-a-token")).toBeNull();
  });
});
