"use client";

import { useMemo, useState } from "react";
import { formatFriendlyDate } from "@/lib/format";
import { getManagerWorkspaceAccess } from "@/lib/roles";

const emptyEventForm = {
  eventDate: "",
  venue: "",
  eventType: "",
  expectedGuests: "",
  cateringServices: "",
  decorationNeeded: "",
  seatingArrangement: "",
  projectorRequired: "no",
  soundSystemRequired: "no",
  staffInCharge: "",
};

function formatEventDate(value) {
  if (!value) {
    return "";
  }

  return formatFriendlyDate(new Date(value), {
    dateStyle: "full",
  });
}

export default function EventsBookingsPanel({
  profile,
  eventsBookings,
  onSaveEventBooking,
}) {
  const access = getManagerWorkspaceAccess(profile);
  const events = useMemo(() => eventsBookings?.events ?? [], [eventsBookings?.events]);
  const [eventForm, setEventForm] = useState(emptyEventForm);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });

  if (!access.canViewEvents) {
    return null;
  }

  function updateEventForm(field, value) {
    setEventForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function saveEvents(nextEvents, message) {
    setSaving(true);
    setFeedback({ type: "", message: "" });

    try {
      await onSaveEventBooking({
        events: nextEvents,
      });
      setFeedback({ type: "success", message });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const eventId = `event-${Date.now()}`;
    const nextEvents = [
      ...events,
      {
        id: eventId,
        eventDate: eventForm.eventDate,
        venue: eventForm.venue,
        eventType: eventForm.eventType,
        expectedGuests: eventForm.expectedGuests,
        cateringServices: eventForm.cateringServices,
        decorationNeeded: eventForm.decorationNeeded,
        seatingArrangement: eventForm.seatingArrangement,
        projectorRequired: eventForm.projectorRequired === "yes",
        soundSystemRequired: eventForm.soundSystemRequired === "yes",
        staffInCharge: eventForm.staffInCharge,
        createdAt: new Date().toISOString(),
        createdByName: profile?.fullName ?? "",
        createdByDepartment: profile?.departmentName ?? "",
      },
    ];

    await saveEvents(nextEvents, "Event saved.");
    setEventForm(emptyEventForm);
  }

  async function handleRemoveEvent(eventId) {
    await saveEvents(
      events.filter((eventEntry) => eventEntry.id !== eventId),
      "Event removed.",
    );
  }

  return (
    <div className="space-y-6">
      <section className="panel p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="section-title">Events and Bookings</h2>
          <span className="badge">{events.length} events</span>
        </div>

        <div className="mt-5 space-y-4">
          {events.length > 0 ? (
            events.map((eventEntry) => (
              <div
                key={eventEntry.id}
                className="rounded-[28px] border border-slate-200 bg-slate-50/80 px-5 py-5"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div>
                      <p className="font-display text-2xl text-[#162338]">
                        {eventEntry.eventType}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {formatEventDate(eventEntry.eventDate)} - {eventEntry.venue}
                      </p>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                        Expected guests:{" "}
                        <span className="font-semibold text-[#162338]">
                          {eventEntry.expectedGuests}
                        </span>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                        Seating:{" "}
                        <span className="font-semibold text-[#162338]">
                          {eventEntry.seatingArrangement || "Not set"}
                        </span>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                        Staff in charge:{" "}
                        <span className="font-semibold text-[#162338]">
                          {eventEntry.staffInCharge || "Not set"}
                        </span>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                        Catering services:{" "}
                        <span className="font-semibold text-[#162338]">
                          {eventEntry.cateringServices || "Not set"}
                        </span>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                        Decoration needed:{" "}
                        <span className="font-semibold text-[#162338]">
                          {eventEntry.decorationNeeded || "Not set"}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3 text-sm text-slate-600">
                      <span className="rounded-full border border-slate-200 bg-white px-4 py-2">
                        Projector:{" "}
                        <span className="font-semibold text-[#162338]">
                          {eventEntry.projectorRequired ? "Yes" : "No"}
                        </span>
                      </span>
                      <span className="rounded-full border border-slate-200 bg-white px-4 py-2">
                        Sound system:{" "}
                        <span className="font-semibold text-[#162338]">
                          {eventEntry.soundSystemRequired ? "Yes" : "No"}
                        </span>
                      </span>
                    </div>

                    <p className="text-xs text-slate-500">
                      {eventEntry.createdByName}
                      {eventEntry.createdByDepartment ? ` - ${eventEntry.createdByDepartment}` : ""}
                    </p>
                  </div>

                  {access.canEditEvents ? (
                    <button
                      type="button"
                      onClick={() => handleRemoveEvent(eventEntry.id)}
                      disabled={saving}
                      className="button-secondary"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-500">
              No events or bookings yet.
            </div>
          )}
        </div>
      </section>

      {access.canEditEvents ? (
        <section className="panel p-6">
          <h2 className="section-title">Add Event or Booking</h2>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4 no-print">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field">
                <span>Date</span>
                <input
                  type="date"
                  value={eventForm.eventDate}
                  onChange={(event) => updateEventForm("eventDate", event.target.value)}
                  disabled={saving}
                  required
                />
              </label>

              <label className="field">
                <span>Venue</span>
                <input
                  type="text"
                  value={eventForm.venue}
                  onChange={(event) => updateEventForm("venue", event.target.value)}
                  disabled={saving}
                  required
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field">
                <span>Type of event</span>
                <input
                  type="text"
                  value={eventForm.eventType}
                  onChange={(event) => updateEventForm("eventType", event.target.value)}
                  disabled={saving}
                  required
                />
              </label>

              <label className="field">
                <span>Expected guests</span>
                <input
                  type="number"
                  min="0"
                  value={eventForm.expectedGuests}
                  onChange={(event) => updateEventForm("expectedGuests", event.target.value)}
                  disabled={saving}
                  required
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field">
                <span>Seating arrangement</span>
                <input
                  type="text"
                  value={eventForm.seatingArrangement}
                  onChange={(event) => updateEventForm("seatingArrangement", event.target.value)}
                  disabled={saving}
                  required
                />
              </label>

              <label className="field">
                <span>Staff in charge</span>
                <input
                  type="text"
                  value={eventForm.staffInCharge}
                  onChange={(event) => updateEventForm("staffInCharge", event.target.value)}
                  disabled={saving}
                  required
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field">
                <span>Projector</span>
                <select
                  value={eventForm.projectorRequired}
                  onChange={(event) => updateEventForm("projectorRequired", event.target.value)}
                  disabled={saving}
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </label>

              <label className="field">
                <span>Sound system</span>
                <select
                  value={eventForm.soundSystemRequired}
                  onChange={(event) => updateEventForm("soundSystemRequired", event.target.value)}
                  disabled={saving}
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </label>
            </div>

            <label className="field">
              <span>Catering services</span>
              <textarea
                value={eventForm.cateringServices}
                onChange={(event) => updateEventForm("cateringServices", event.target.value)}
                rows={3}
                disabled={saving}
                required
              />
            </label>

            <label className="field">
              <span>Decoration needed</span>
              <textarea
                value={eventForm.decorationNeeded}
                onChange={(event) => updateEventForm("decorationNeeded", event.target.value)}
                rows={3}
                disabled={saving}
                required
              />
            </label>

            {feedback.message ? (
              <div
                className={`rounded-2xl px-4 py-3 text-sm ${
                  feedback.type === "success"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-rose-50 text-rose-700"
                }`}
              >
                {feedback.message}
              </div>
            ) : null}

            <button type="submit" disabled={saving} className="button-primary w-full">
              {saving ? "Saving..." : "Submit event"}
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
