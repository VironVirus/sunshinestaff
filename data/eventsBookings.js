export const defaultEventsBookings = {
  events: [],
  updatedAt: null,
  updatedByName: "",
  updatedByDepartment: "",
};

function normalizeEvent(eventEntry = {}) {
  if (!eventEntry?.id || typeof eventEntry?.eventDate !== "string" ||
      typeof eventEntry?.venue !== "string" || typeof eventEntry?.eventType !== "string") {
    return null;
  }

  return {
    id: eventEntry.id,
    eventDate: eventEntry.eventDate,
    venue: eventEntry.venue.trim().slice(0, 120),
    eventType: eventEntry.eventType.trim().slice(0, 120),
    expectedGuests: Math.min(Math.max(Number(eventEntry.expectedGuests) || 0, 0), 10000),
    cateringServices: typeof eventEntry.cateringServices === "string" ? eventEntry.cateringServices.trim().slice(0, 500) : "",
    decorationNeeded: typeof eventEntry.decorationNeeded === "string" ? eventEntry.decorationNeeded.trim().slice(0, 500) : "",
    seatingArrangement: typeof eventEntry.seatingArrangement === "string" ? eventEntry.seatingArrangement.trim().slice(0, 500) : "",
    projectorRequired: Boolean(eventEntry.projectorRequired),
    soundSystemRequired: Boolean(eventEntry.soundSystemRequired),
    staffInCharge: typeof eventEntry.staffInCharge === "string" ? eventEntry.staffInCharge.trim().slice(0, 120) : "",
    createdAt: eventEntry.createdAt ?? "",
    createdByName: eventEntry.createdByName ?? "",
    createdByDepartment: eventEntry.createdByDepartment ?? "",
  };
}

export function normalizeEvents(events = []) {
  return (Array.isArray(events) ? events : [])
    .map((eventEntry) => normalizeEvent(eventEntry))
    .filter(Boolean)
    .sort((left, right) => {
      if (left.eventDate === right.eventDate) {
        return left.eventType.localeCompare(right.eventType);
      }

      return left.eventDate.localeCompare(right.eventDate);
    })
    .slice(0, 200);
}

export function mergeEventsBookings(payload = {}) {
  return {
    ...defaultEventsBookings,
    ...payload,
    events: normalizeEvents(payload.events ?? []),
  };
}
