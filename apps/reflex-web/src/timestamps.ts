// @effect-diagnostics globalDate:off -- View-only labels for times already on the wire.
const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dateFormatter = new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric" });
const dateWithYearFormatter = new Intl.DateTimeFormat(undefined, {
  month: "numeric",
  day: "numeric",
  year: "numeric",
});
const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "long" });

const DAY_MS = 86_400_000;

const startOfDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

function ordinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return "th";
  if (day % 10 === 1) return "st";
  if (day % 10 === 2) return "nd";
  return day % 10 === 3 ? "rd" : "th";
}

// Both follow apps/web/src/timestampFormat.ts on its default "locale" setting.
export function dayAwareTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const time = timeFormatter.format(date);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days <= 0) return time;
  if (days === 1) return `yesterday at ${time}`;
  const formatter =
    date.getFullYear() === now.getFullYear() ? dateFormatter : dateWithYearFormatter;
  return `${formatter.format(date)} ${time}`;
}

export function fullTimestamp(iso: string): string {
  const date = new Date(iso);
  const day = date.getDate();
  return `${timeFormatter.format(date)}, ${day}${ordinalSuffix(day)} ${monthFormatter.format(date)} ${date.getFullYear()}`;
}

export const MINUTE = 60_000;

export function relativeTime(iso: string, now: number): string {
  const seconds = Math.floor(Math.max(0, now - Date.parse(iso)) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

export function timeUntil(iso: string, now: number): string {
  const minutes = Math.ceil(Math.max(0, Date.parse(iso) - now) / MINUTE);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.ceil(hours / 24)}d`;
}
