import { describe, expect, it } from "vitest";
import { emptyThemeSlots, isThemeSlots, sanitizeThemeCss } from "./model";

describe("theme storage validation", () => {
  it("canonicalizes only supported hex color variables", () => {
    expect(sanitizeThemeCss(":root { --accent: #AABBCC; --bg: #010203; }")).toBe(":root {\n  --bg: #010203;\n  --accent: #aabbcc;\n}");
  });

  it("rejects unsupported CSS, unsafe values, and empty themes", () => {
    expect(sanitizeThemeCss("@import url(https://example.test);" )).toBeNull();
    expect(sanitizeThemeCss(":root { --bg: url(https://example.test); }" )).toBeNull();
    expect(sanitizeThemeCss(":root { --unknown: #112233; }" )).toBeNull();
    expect(sanitizeThemeCss(":root {}" )).toBeNull();
  });

  it("accepts exactly three empty or complete theme slots", () => {
    const colors = Object.fromEntries([
      ["--bg", "#111111"], ["--surface", "#222222"], ["--surface-raised", "#333333"],
      ["--border", "#444444"], ["--fg", "#555555"], ["--muted", "#666666"],
      ["--accent", "#777777"], ["--accent-fg", "#888888"], ["--error", "#999999"],
    ]);
    expect(isThemeSlots([null, colors, null])).toBe(true);
    expect(isThemeSlots([null, colors])).toBe(false);
    expect(isThemeSlots([null, { "--bg": "url(https://example.test)" }, null])).toBe(false);
    expect(emptyThemeSlots()).toEqual([null, null, null]);
  });
});