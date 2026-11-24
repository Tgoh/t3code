// @effect-diagnostics globalDate:off -- View-only labels for times already on the wire.
import type { TimestampFormat } from "@t3tools/contracts/settings";

export type ITimestampFormat = TimestampFormat;

// A formatter keeps the default zone it was built in, so these run in UTC on the wall-clock time,
// which Date reads from the current zone.
const timeFormatters = new Map<ITimestampFormat, Intl.DateTimeFormat>();

// Follows getTimestampFormatOptions in apps/web/src/timestampFormat.ts.
function timeFormatter(format: ITimestampFormat): Intl.DateTimeFormat {
  let formatter = timeFormatters.get(format);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      ...(format === "locale" ? {} : { hour12: format === "12-hour" }),
      timeZone: "UTC",
    });
    timeFormatters.set(format, formatter);
  }
  return formatter;
}
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "numeric",
  day: "numeric",
  timeZone: "UTC",
});
const dateWithYearFormatter = new Intl.DateTimeFormat(undefined, {
  month: "numeric",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });

const wallClockAsUtc = (date: Date): Date =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60_000);

const DAY_MS = 86_400_000;

const startOfDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

function ordinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return "th";
  if (day % 10 === 1) return "st";
  if (day % 10 === 2) return "nd";
  return day % 10 === 3 ? "rd" : "th";
}

// Follows parseTimestampDate in apps/web/src/timestampFormat.ts.
function parsed(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Follows formatDayAwareTimestamp in apps/web/src/timestampFormat.ts.
export function dayAwareTimestamp(iso: string, format: ITimestampFormat = "locale"): string {
  const date = parsed(iso);
  if (date === null) return "";
  const now = new Date();
  const wallClock = wallClockAsUtc(date);
  const time = timeFormatter(format).format(wallClock);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days <= 0) return time;
  if (days === 1) return `yesterday at ${time}`;
  const formatter =
    date.getFullYear() === now.getFullYear() ? dateFormatter : dateWithYearFormatter;
  return `${formatter.format(wallClock)} ${time}`;
}

// Follows formatShortTimestamp in apps/web/src/timestampFormat.ts.
export function shortTimestamp(iso: string, format: ITimestampFormat = "locale"): string {
  const date = parsed(iso);
  return date === null ? "" : timeFormatter(format).format(wallClockAsUtc(date));
}

// Follows formatChatTimestampTooltip in apps/web/src/timestampFormat.ts.
export function fullTimestamp(iso: string, format: ITimestampFormat = "locale"): string {
  const date = parsed(iso);
  if (date === null) return "";
  const wallClock = wallClockAsUtc(date);
  const day = date.getDate();
  return `${timeFormatter(format).format(wallClock)}, ${day}${ordinalSuffix(day)} ${monthFormatter.format(wallClock)} ${date.getFullYear()}`;
}

export const MINUTE = 60_000;

export const clockNow = () => Date.now();

export function relativeTime(iso: string, now: number): string {
  const seconds = Math.floor(Math.max(0, now - Date.parse(iso)) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

// Follows relativeElapsedLabel in apps/web/src/timestampFormat.ts.
export function relativeTimeAgo(iso: string, now: number): string {
  const elapsed = relativeTime(iso, now);
  return elapsed === "now" ? "just now" : `${elapsed} ago`;
}

export function timeUntil(iso: string, now: number): string {
  const minutes = Math.ceil(Math.max(0, Date.parse(iso) - now) / MINUTE);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.ceil(hours / 24)}d`;
}
