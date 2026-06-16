export const defaultEventsBookings = {
  events: [],
  updatedAt: null,
  updatedByName: "",
  updatedByDepartment: "",
};

function normalizeEvent(eventEntry = {}) {
  if (!eventEntry?.id || !eventEntry?.eventDate || !eventEntry?.venue || !eventEntry?.eventType) {
    return null;
  }

  return {
    id: eventEntry.id,
    eventDate: eventEntry.eventDate,
    venue: eventEntry.venue.trim(),
    eventType: eventEntry.eventType.trim(),
    expectedGuests: Math.max(Number(eventEntry.expectedGuests) || 0, 0),
    cateringServices: eventEntry.cateringServices?.trim() ?? "",
    decorationNeeded: eventEntry.decorationNeeded?.trim() ?? "",
    seatingArrangement: eventEntry.seatingArrangement?.trim() ?? "",
    projectorRequired: Boolean(eventEntry.projectorRequired),
    soundSystemRequired: Boolean(eventEntry.soundSystemRequired),
    staffInCharge: eventEntry.staffInCharge?.trim() ?? "",
    createdAt: eventEntry.createdAt ?? "",
    createdByName: eventEntry.createdByName ?? "",
    createdByDepartment: eventEntry.createdByDepartment ?? "",
  };
}

export function normalizeEvents(events = []) {
  return events
    .map((eventEntry) => normalizeEvent(eventEntry))
    .filter(Boolean)
    .sort((left, right) => {
      if (left.eventDate === right.eventDate) {
        return left.eventType.localeCompare(right.eventType);
      }

      return left.eventDate.localeCompare(right.eventDate);
    });
}

export function mergeEventsBookings(payload = {}) {
  return {
    ...defaultEventsBookings,
    ...payload,
    events: normalizeEvents(payload.events ?? []),
  };
}
