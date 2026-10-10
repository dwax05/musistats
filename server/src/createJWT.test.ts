import { describe, expect, it } from "vitest";
import { createAccessToken, verifyAccessToken } from "./createJWT";

describe("createJWT", () => {
  it("round-trips a payload", () => {
    const token = createAccessToken({ userId: "u1", login: "sam" });
    expect(verifyAccessToken(token)).toEqual({ userId: "u1", login: "sam" });
  });

  it("rejects garbage", () => {
    expect(verifyAccessToken("not-a-token")).toBeNull();
  });
});
