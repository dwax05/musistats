import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_ID, THEME_GROUPS, THEME_PRESETS, isThemeId, resolveThemeId } from "./themePresets";

describe("theme presets", () => {
  it("defaults to Spotify", () => {
    expect(DEFAULT_THEME_ID).toBe("spotify");
  });

  it("provides the 15 palettes in five groups", () => {
    expect(THEME_GROUPS).toHaveLength(5);
    expect(THEME_PRESETS).toHaveLength(15);
    expect(new Set(THEME_PRESETS.map((theme) => theme.id)).size).toBe(15);
  });

  it("validates preset ids and migrates the previous light preference", () => {
    expect(isThemeId("solarized-light")).toBe(true);
    expect(isThemeId("not-a-theme")).toBe(false);
    expect(resolveThemeId("dracula")).toBe("dracula");
    expect(resolveThemeId(null, "light")).toBe("solarized-light");
    expect(resolveThemeId(null, "dark")).toBe(DEFAULT_THEME_ID);
  });
});
