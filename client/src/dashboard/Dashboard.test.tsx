import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Dashboard from "./Dashboard";
import { DEMO_DASHBOARD, DEMO_USER } from "./fixture";

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({ user: null, authedPost: async () => ({ error: "" }), logout: async () => {}, disconnect: async () => "" }),
}));

describe("dashboard navigation", () => {
  it("groups secondary pages behind collapsed Explore, Library, and Taste sections", () => {
    const markup = renderToStaticMarkup(<Dashboard initialData={DEMO_DASHBOARD} demoUser={DEMO_USER} />);

    expect(markup).toContain('aria-label="MusiStats pages"');
    expect(markup).toContain('aria-controls="sidebar-pages"');
    expect(markup).toContain(">Explore<");
    expect(markup).toContain(">Library<");
    expect(markup).toContain(">Taste<");
    expect(markup).not.toContain('id="sidebar-explore"');
    expect(markup).not.toContain('id="sidebar-library"');
    expect(markup).not.toContain('id="sidebar-taste"');
    expect(markup).toContain(">Show</span>");
  });
});
