import { describe, expect, it } from "vitest";
import { formatUtcMinute, localToIso } from "./datetime";

describe("formatUtcMinute", () => {
  it("renders an ISO instant at UTC minute precision", () => {
    expect(formatUtcMinute("2026-10-15T13:00:00.000Z")).toBe("2026-10-15 13:00");
  });

  it("renders a non-UTC offset input in UTC", () => {
    // 09:00 at -04:00 is 13:00 UTC.
    expect(formatUtcMinute("2026-10-15T09:00:00-04:00")).toBe("2026-10-15 13:00");
    // A +05:30 instant rounds back across the previous UTC day.
    expect(formatUtcMinute("2026-10-15T05:00:00+05:30")).toBe("2026-10-14 23:30");
  });

  it("returns an em dash for unparseable input instead of 'Invalid Date'", () => {
    expect(formatUtcMinute("not-a-date")).toBe("—");
    expect(formatUtcMinute("")).toBe("—");
  });

  it("keeps its deliberate divergence from localToIso's undefined-on-garbage", () => {
    // Both reject junk, but one is a display formatter (always a string) and the
    // other a transport converter (no value to send); the contrast is pinned.
    expect(localToIso("not-a-date")).toBeUndefined();
    expect(formatUtcMinute("not-a-date")).toBe("—");
  });
});
