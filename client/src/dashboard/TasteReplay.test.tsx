import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TasteReplay from "./TasteReplay";
import { interpolateReplayFrame } from "./replayFrame";

describe("TasteReplay", () => {
  it("interpolates the replay continuously between adjacent frames", () => {
    const frame = interpolateReplayFrame([
      { capturedAt: "2026-10-01T00:00:00.000Z", genres: [{ name: "ambient", weight: 1 }] },
      { capturedAt: "2026-10-03T00:00:00.000Z", genres: [{ name: "dream pop", weight: 1 }] },
    ], 0.5);

    expect(frame).toEqual({
      capturedAt: "2026-10-02T00:00:00.000Z",
      genres: [
        { name: "ambient", weight: 0.5 },
        { name: "dream pop", weight: 0.5 },
      ],
    });
  });

  it("renders play controls, genre bubbles, and timeline for available frames", () => {
    const markup = renderToStaticMarkup(<TasteReplay frames={[
      {
        capturedAt: "2026-10-01T00:00:00.000Z",
        genres: [
          { name: "indie pop", weight: 0.7 },
          { name: "dream pop", weight: 0.3 },
        ],
      },
      { capturedAt: "2026-10-02T00:00:00.000Z", genres: [{ name: "dream pop", weight: 1 }] },
    ]} />);

    expect(markup).toContain("Play");
    expect(markup).toContain('aria-label="indie pop, 70 percent"');
    expect(markup).toContain("<text");
    expect(markup).toContain("font-size");
    expect(markup).toContain("indie pop");
    expect(markup).toContain('aria-label="Taste replay timeline"');
    expect(markup).toContain('step="any"');
    expect(markup).not.toContain("1 of 2");
    expect(markup).not.toContain("disabled=\"\"");
    expect(markup).toContain('role="group"');
    expect(markup).toContain('role="img" tabindex="0"');
    expect(markup).not.toContain("<title>");
  });

  it("reserves stable slots for genres that appear later in the replay", () => {
    const markup = renderToStaticMarkup(<TasteReplay frames={[
      { capturedAt: "2026-10-01T00:00:00.000Z", genres: [{ name: "zeta", weight: 1 }] },
      { capturedAt: "2026-10-02T00:00:00.000Z", genres: [{ name: "alpha", weight: 1 }] },
    ]} />);

    expect(markup).toContain('aria-label="zeta, 100 percent"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('font-size="0"');
    expect(markup).toContain(">alpha</text>");
    expect(markup).not.toContain("al…");
    expect(markup).not.toContain("clip-path=");
    expect(markup).not.toContain("textLength=");
  });

  it("keeps the 3% cutoff and hides sub-threshold bubbles and labels", () => {
    const markup = renderToStaticMarkup(<TasteReplay frames={[
      {
        capturedAt: "2026-10-01T00:00:00.000Z",
        genres: [
          { name: "indie", weight: 0.95 },
          { name: "ambient", weight: 0.04 },
          { name: "microgenre", weight: 0.01 },
        ],
      },
      { capturedAt: "2026-10-02T00:00:00.000Z", genres: [{ name: "indie", weight: 1 }] },
    ]} source="imported_history" />);

    expect(markup).toContain('aria-label="indie, 95 percent"');
    expect(markup).toContain('aria-label="ambient, 4 percent"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("Genres under 3% are hidden");
    expect(markup).not.toContain('aria-label="microgenre');
    expect(markup).toMatch(/<circle aria-hidden="true"[^>]*r="0"/);
  });

  it("grows a bubble smoothly from zero size above the cutoff without opacity changes", () => {
    const markup = renderToStaticMarkup(<TasteReplay frames={[
      {
        capturedAt: "2026-10-01T00:00:00.000Z",
        genres: [
          { name: "main", weight: 0.965 },
          { name: "rising", weight: 0.035 },
        ],
      },
      {
        capturedAt: "2026-10-02T00:00:00.000Z",
        genres: [
          { name: "main", weight: 0.965 },
          { name: "rising", weight: 0.035 },
        ],
      },
    ]} />);
    const risingGenre = markup.match(/<circle[^>]*aria-label="rising, 4 percent"[^>]*r="([^"]+)"/);
    const risingLabel = markup.match(/<text aria-hidden="false"[^>]*font-size="9"[^>]*>(rising)<\/text>/);

    expect(Number(risingGenre?.[1])).toBeGreaterThan(0);
    expect(Number(risingGenre?.[1])).toBeLessThan(98 * Math.sqrt(0.035));
    expect(markup).not.toMatch(/<circle[^>]*opacity=/);
    expect(risingLabel?.[1]).toBe("rising");
  });

  it("keeps below-cutoff genres mounted at zero radius for animated transitions", () => {
    const markup = renderToStaticMarkup(<TasteReplay frames={[
      { capturedAt: "2026-10-01T00:00:00.000Z", genres: [{ name: "ambient", weight: 1 }] },
      { capturedAt: "2026-10-02T00:00:00.000Z", genres: [{ name: "indie", weight: 1 }] },
    ]} />);

    expect(markup).toContain('aria-label="ambient, 100 percent"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('r="0"');
    expect(markup).not.toMatch(/<circle[^>]*opacity=/);
  });

  it("starts bubbles at zero radius at 3% and grows them smoothly above the cutoff", () => {
    const atCutoff = renderToStaticMarkup(<TasteReplay frames={[
      {
        capturedAt: "2026-10-01T00:00:00.000Z",
        genres: [
          { name: "main", weight: 0.97 },
          { name: "rising", weight: 0.03 },
        ],
      },
      {
        capturedAt: "2026-10-02T00:00:00.000Z",
        genres: [
          { name: "main", weight: 0.97 },
          { name: "rising", weight: 0.03 },
        ],
      },
    ]} />);
    const crossing = renderToStaticMarkup(<TasteReplay frames={[
      {
        capturedAt: "2026-10-01T00:00:00.000Z",
        genres: [
          { name: "main", weight: 0.96 },
          { name: "rising", weight: 0.04 },
        ],
      },
      {
        capturedAt: "2026-10-02T00:00:00.000Z",
        genres: [
          { name: "main", weight: 0.96 },
          { name: "rising", weight: 0.04 },
        ],
      },
    ]} />);
    const cutoffRadius = Number(atCutoff.match(/<circle[^>]*aria-hidden="true"[^>]*r="([^"]+)"/)?.[1]);
    const crossingRadius = Number(crossing.match(/<circle[^>]*aria-label="rising, 4 percent"[^>]*r="([^"]+)"/)?.[1]);

    expect(cutoffRadius).toBe(0);
    expect(crossingRadius).toBeGreaterThan(0);
    expect(crossingRadius).toBeLessThan(98 * Math.sqrt(0.04));
    expect(atCutoff).not.toMatch(/<circle[^>]*opacity=/);
    expect(crossing).not.toMatch(/<circle[^>]*opacity=/);
  });

  it("briefly explains imported listening shares", () => {
    const markup = renderToStaticMarkup(<TasteReplay
      frames={[
        { capturedAt: "2026-10-01T00:00:00.000Z", genres: [{ name: "ambient", weight: 1 }] },
        { capturedAt: "2026-10-02T00:00:00.000Z", genres: [{ name: "dream pop", weight: 1 }] },
      ]}
      source="imported_history"
    />);

    expect(markup).toContain("Bubble size shows each genre&#x27;s share of listening time.");
    expect(markup).toContain("Genres under 3% are hidden.");
    expect(markup).not.toContain("centered window");
  });

  it("does not render a misleading bubble chart for one time point", () => {
    const markup = renderToStaticMarkup(<TasteReplay frames={[{
      capturedAt: "2026-10-02T00:00:00.000Z",
      genres: [{ name: "dream pop", weight: 1 }],
    }]} />);

    expect(markup).toContain("only one time point");
    expect(markup).toContain("wait for more Spotify snapshots");
    expect(markup).not.toContain('aria-label="dream pop, 100 percent"');
    expect(markup).not.toContain('aria-label="Taste replay timeline"');
  });

  it("explains background genre loading and lookup failures", () => {
    const loadingMarkup = renderToStaticMarkup(<TasteReplay frames={[]} status="loading_genres" />);
    expect(loadingMarkup).toContain("Loading artist genre tags");

    const replayLoadingMarkup = renderToStaticMarkup(<TasteReplay
      frames={[
        { capturedAt: "2026-10-01T00:00:00.000Z", genres: [{ name: "ambient", weight: 1 }] },
        { capturedAt: "2026-10-02T00:00:00.000Z", genres: [{ name: "dream pop", weight: 1 }] },
      ]}
      status="loading_genres"
    />);
    expect(replayLoadingMarkup).not.toContain("Loading more");

    const unconfiguredMarkup = renderToStaticMarkup(<TasteReplay frames={[]} status="provider_not_configured" />);
    expect(unconfiguredMarkup).toContain("Genre lookup is not configured");

    const failedMarkup = renderToStaticMarkup(<TasteReplay frames={[]} status="genre_lookup_failed" />);
    expect(failedMarkup).toContain("Genre lookup hit a temporary problem");
    expect(failedMarkup).toContain("retry automatically");
  });

  it("explains when there is no replay history yet", () => {
    const markup = renderToStaticMarkup(<TasteReplay frames={[]} />);

    expect(markup).toContain("No genre history yet");
  });

});
