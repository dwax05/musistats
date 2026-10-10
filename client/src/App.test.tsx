import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConnectScreen } from "./App";

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: { div: "div", section: "section" },
}));

describe("Spotify login", () => {
  it("starts local OAuth on the same host as the Spotify callback", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { search: "" } },
    });

    const html = renderToStaticMarkup(<ConnectScreen />);

    expect(html).toContain('href="http://127.0.0.1:5173/api/auth/spotify"');
  });
});
