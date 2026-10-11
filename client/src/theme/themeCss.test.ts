import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_VARIABLES, parseThemeCss, readableOn, serializeThemeCss } from "./themeCss";

describe("editable theme CSS", () => {
  it("round-trips the allowlisted palette variables", () => {
    const css = serializeThemeCss([{ key: "--accent", value: "#aabbcc" }]);
    expect(parseThemeCss(css)).toEqual({ ...DEFAULT_THEME_VARIABLES, "--accent": "#aabbcc" });
  });

  it("rejects rules, unsupported variables, and executable CSS values", () => {
    expect(parseThemeCss(":root { --bg: url(https://example.test); }" )).toBeNull();
    expect(parseThemeCss(":root { --unknown: #aabbcc; }" )).toBeNull();
    expect(parseThemeCss("@import url(https://example.test);" )).toBeNull();
    expect(parseThemeCss("--bg: #abc;" )).toBeNull();
  });

  it("picks readable text for a swatch", () => {
    expect(readableOn("#ffc904")).toBe("#000000");
    expect(readableOn("#191724")).toBe("#ffffff");
  });
});