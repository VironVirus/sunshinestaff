export function toInitials(value = "") {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return "SH";
  }

  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

export function formatFriendlyDate(value, options) {
  if (!value) {
    return "Not updated yet";
  }

  const date =
    value instanceof Date
      ? value
      : typeof value?.toDate === "function"
        ? value.toDate()
        : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not updated yet";
  }

  return new Intl.DateTimeFormat(
    "en-US",
    options ?? {
      dateStyle: "medium",
      timeStyle: "short",
    },
  ).format(date);
}

export function formatBirthday(value) {
  if (!value) {
    return "Date to be added";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
  }).format(date);
}
