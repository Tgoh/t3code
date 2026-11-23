// @effect-diagnostics globalDate:off -- Times built only to format them.
import { describe, expect, it, vi } from "vite-plus/test";

import { dayAwareTimestamp, fullTimestamp, shortTimestamp } from "./timestamps";

// Node re-resolves the default zone when TZ is assigned, like a browser after the OS zone changes.
function useTimeZone(timeZone: string): Disposable {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  return {
    [Symbol.dispose]: () => {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    },
  };
}

const timeIn = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone }).format(
    new Date(iso),
  );

describe("timestamps after the system time zone changes", () => {
  it("renders the full timestamp in the new zone", () => {
    const monthEnd = "2026-10-31T20:00:00.000Z";
    using _zone = useTimeZone("America/New_York");
    expect(fullTimestamp(monthEnd)).toBe(
      `${timeIn(monthEnd, "America/New_York")}, 31st October 2026`,
    );

    process.env.TZ = "Asia/Bangkok";
    expect(fullTimestamp(monthEnd)).toBe(`${timeIn(monthEnd, "Asia/Bangkok")}, 1st November 2026`);
  });

  it("renders today's time in the new zone", () => {
    const now = "2026-11-07T04:45:43.877Z";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    using _clock = { [Symbol.dispose]: () => vi.useRealTimers() };
    using _zone = useTimeZone("America/New_York");
    expect(dayAwareTimestamp(now)).toBe(timeIn(now, "America/New_York"));

    process.env.TZ = "Asia/Bangkok";
    expect(dayAwareTimestamp(now)).toBe(timeIn(now, "Asia/Bangkok"));
  });
});

describe("the time format setting", () => {
  const afternoon = "2026-11-07T15:05:00.000Z";
  const hourIn = (format: "12-hour" | "24-hour") =>
    new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: format === "12-hour",
      timeZone: "UTC",
    }).format(new Date(afternoon));

  it.each(["12-hour", "24-hour"] as const)("renders %s times", (format) => {
    using _zone = useTimeZone("UTC");
    expect(shortTimestamp(afternoon, format)).toBe(hourIn(format));
    expect(fullTimestamp(afternoon, format)).toBe(`${hourIn(format)}, 7th November 2026`);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(afternoon);
    using _clock = { [Symbol.dispose]: () => vi.useRealTimers() };
    expect(dayAwareTimestamp(afternoon, format)).toBe(hourIn(format));
  });

  it("keeps 12-hour and 24-hour apart", () => {
    using _zone = useTimeZone("UTC");
    expect(shortTimestamp(afternoon, "12-hour")).not.toBe(shortTimestamp(afternoon, "24-hour"));
  });
});
