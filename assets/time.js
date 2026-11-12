/**
 * Attendance Rakah - Saudi Arabia time helpers
 * Always store timestamps as UTC ISO-8601 in Supabase.
 * Convert only for display using the Asia/Riyadh IANA timezone.
 */
export const SAUDI_TIME_ZONE = "Asia/Riyadh";

const dateTimeFormatter = new Intl.DateTimeFormat("ar-SA", {
  timeZone: SAUDI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true
});

const timeFormatter = new Intl.DateTimeFormat("ar-SA", {
  timeZone: SAUDI_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: true
});

const dateFormatter = new Intl.DateTimeFormat("ar-SA", {
  timeZone: SAUDI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function toValidDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== "string" && typeof value !== "number") return null;
  // Supabase timestamptz values should include Z or an explicit UTC offset.
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatSaudiDateTime(value, fallback = "—") {
  const date = toValidDate(value);
  return date ? dateTimeFormatter.format(date) : fallback;
}

export function formatSaudiTime(value, fallback = "—") {
  const date = toValidDate(value);
  return date ? timeFormatter.format(date) : fallback;
}

export function formatSaudiDate(value, fallback = "—") {
  const date = toValidDate(value);
  return date ? dateFormatter.format(date) : fallback;
}

/**
 * Use this for date/time boundaries built from a Saudi calendar date.
 * Returns a UTC ISO string for safe timestamptz comparisons.
 */
export function saudiLocalDateTimeToUtcIso(year, month, day, hour = 0, minute = 0, second = 0) {
  // Riyadh is UTC+03:00 and does not observe daylight saving time.
  return new Date(Date.UTC(year, month - 1, day, hour - 3, minute, second)).toISOString();
}
