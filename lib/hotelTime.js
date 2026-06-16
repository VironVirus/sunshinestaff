export const HOTEL_TIME_ZONE = "Africa/Lagos";
export const HOTEL_DAY_RESET_HOUR = 6;

function coerceDate(value) {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value?.toDate === "function") {
    return value.toDate();
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function getHotelParts(value = new Date()) {
  const date = coerceDate(value) ?? new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: HOTEL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function toDateKey({ year, month, day }) {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

export function parseDateKey(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey ?? "")) {
    return null;
  }

  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return Number.isNaN(date.getTime()) ? null : date;
}

export function addDaysToDateKey(dateKey, days) {
  const date = parseDateKey(dateKey);

  if (!date) {
    return "";
  }

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function getHotelDateKey(value = new Date()) {
  return toDateKey(getHotelParts(value));
}

export function getOperationalDateKey(value = new Date()) {
  const hotelParts = getHotelParts(value);
  const hotelDateKey = toDateKey(hotelParts);

  if (hotelParts.hour < HOTEL_DAY_RESET_HOUR) {
    return addDaysToDateKey(hotelDateKey, -1);
  }

  return hotelDateKey;
}

export function getDaysBetweenDateKeys(startDateKey, endDateKey) {
  const start = parseDateKey(startDateKey);
  const end = parseDateKey(endDateKey);

  if (!start || !end) {
    return 0;
  }

  return Math.floor((end.getTime() - start.getTime()) / 86400000);
}

export function formatDateKey(dateKey, options) {
  const date = parseDateKey(dateKey);

  if (!date) {
    return dateKey || "";
  }

  return new Intl.DateTimeFormat(
    "en-US",
    options ?? {
      dateStyle: "full",
      timeZone: "UTC",
    },
  ).format(date);
}

export function isWithinOperationalDate(value, targetDateKey = getOperationalDateKey()) {
  const date = coerceDate(value);

  if (!date) {
    return false;
  }

  return getOperationalDateKey(date) === targetDateKey;
}
