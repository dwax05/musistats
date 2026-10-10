import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SegmentedControl from "./SegmentedControl";

describe("SegmentedControl", () => {
  it("marks the controlled value as selected", () => {
    const markup = renderToStaticMarkup(
      <SegmentedControl
        ariaLabel="Example"
        options={[{ value: "week", label: "Week" }, { value: "year", label: "Year" }]}
        value="year"
        onChange={() => {}}
      />,
    );

    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("translateX(100%)");
  });
});
