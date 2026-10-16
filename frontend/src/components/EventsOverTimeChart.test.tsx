import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import EventsOverTimeChart from "./EventsOverTimeChart";
import { formatUtcMinute } from "../lib/datetime";
import type { HourBucket, WindowDisclosure } from "../lib/stats";

afterEach(cleanup);

const HOUR_MS = 3_600_000;
// Deliberately not on the hour: window-anchored buckets must not be presented
// as clock-aligned "HH:00" ticks.
const START_MS = Date.UTC(2026, 9, 15, 12, 37, 0);

/** 24 contiguous hour buckets, oldest first, carrying the supplied counts. */
function buckets(counts: number[]): HourBucket[] {
  return counts.map((count, i) => ({
    startIso: new Date(START_MS + i * HOUR_MS).toISOString(),
    endIso: new Date(START_MS + (i + 1) * HOUR_MS).toISOString(),
    count,
  }));
}

const DISCLOSURE: WindowDisclosure = {
  text: "All 30 events in the last 24h",
  truncated: false,
};

const counts1To24 = Array.from({ length: 24 }, (_, i) => i + 1);

function renderChart(b: HourBucket[], disclosure: WindowDisclosure = DISCLOSURE) {
  return render(<EventsOverTimeChart buckets={b} disclosure={disclosure} />);
}

describe("EventsOverTimeChart", () => {
  it("draws one bar per bucket, oldest on the left", () => {
    const b = buckets(counts1To24);
    const { container } = renderChart(b);

    const rects = [...container.querySelectorAll("rect")];
    expect(rects).toHaveLength(24);

    // Oldest is leftmost and x is non-decreasing across the given order.
    const xs = rects.map((r) => Number(r.getAttribute("x")));
    expect(xs[0]).toBeLessThan(xs[23]);
    expect([...xs].sort((a, c) => a - c)).toEqual(xs);

    // The leftmost bar is bound to buckets[0], not a re-sorted copy.
    expect(rects[0].querySelector("title")?.textContent).toContain(
      formatUtcMinute(b[0].startIso),
    );
  });

  it("labels each bar with its own start instant, not an hour-aligned guess", () => {
    const b = buckets(counts1To24);
    const { container } = renderChart(b);

    const titles = [...container.querySelectorAll("rect title")].map((t) => t.textContent);
    expect(titles).toHaveLength(24);

    // Bucket 6 starts 5h after START_MS (12:37 + 5h = 17:37) and holds 6 events.
    expect(titles[5]).toBe("2026-10-15 17:37 UTC — 6 events");
    expect(titles[0]).toBe("2026-10-15 12:37 UTC — 1 events");
    expect(titles[23]).toBe("2026-10-16 11:37 UTC — 24 events");

    // Every title is derived from the bucket it belongs to.
    for (let i = 0; i < b.length; i++) {
      expect(titles[i]).toBe(`${formatUtcMinute(b[i].startIso)} UTC — ${b[i].count} events`);
    }
  });

  it("is exposed as an image whose accessible name is exactly the disclosure template", () => {
    const { container } = renderChart(buckets(counts1To24));
    const svg = container.querySelector("svg");

    expect(svg?.getAttribute("viewBox")).toBe("0 0 480 120");
    expect(svg?.getAttribute("class")).toBe("h-32 w-full");
    expect(svg?.getAttribute("role")).toBe("img");
    // Byte-for-byte: a period after "24h" and a space before the disclosure text.
    expect(svg?.getAttribute("aria-label")).toBe(
      `Events per hour over the last 24h. ${DISCLOSURE.text}`,
    );
    expect(
      screen.getByRole("img", { name: `Events per hour over the last 24h. ${DISCLOSURE.text}` }),
    ).toBeTruthy();
  });

  it("shows the real first start and last end on the axis, never claiming HH:00", () => {
    const b = buckets(counts1To24);
    const { container } = renderChart(b);

    const axis = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(axis).toContain(`${formatUtcMinute(b[0].startIso)} UTC`);
    expect(axis).toContain(`${formatUtcMinute(b[23].endIso)} UTC`);

    // The window does not begin on the hour, so no axis tick may assert one.
    expect(container.textContent).not.toMatch(/\d{2}:00 UTC/);
    expect(container.textContent).not.toContain("2026-10-15 12:00 UTC");
  });

  it("renders a flat baseline and a 'no events' label when every bucket is zero", () => {
    const b = buckets(Array.from({ length: 24 }, () => 0));
    const { container } = renderChart(b);

    // A baseline is still drawn so the axis has something to sit on.
    const baseline = container.querySelector("line");
    expect(baseline).toBeTruthy();
    expect(screen.getByText(/no events/i)).toBeTruthy();

    // One bar per bucket survives, each zero-height rather than NaN.
    const rects = [...container.querySelectorAll("rect")];
    expect(rects).toHaveLength(24);
    for (const r of rects) {
      expect(Number(r.getAttribute("height"))).toBe(0);
      for (const attr of ["x", "y", "width", "height"]) {
        expect(Number.isFinite(Number(r.getAttribute(attr)))).toBe(true);
      }
    }

    // No division by a zero max may leak a NaN into any rendered attribute.
    expect(container.innerHTML).not.toMatch(/NaN/);
  });
});
