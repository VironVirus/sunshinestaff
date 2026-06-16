"use client";

import { useEffect, useMemo, useState } from "react";
import { getRoomOptionsForFloor, roomFloorOptions } from "@/data/hotelRooms";
import {
  getRoomComplaintLabel,
  roomComplaintOptions,
} from "@/data/propertyStatus";
import { formatFriendlyDate } from "@/lib/format";
import { getPropertyAccess } from "@/lib/roles";

function formatReportedAt(value) {
  if (!value) {
    return "";
  }

  return formatFriendlyDate(new Date(value), {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function RoomComplaintsPanel({
  profile,
  propertyStatus,
  onSaveRoomComplaints,
}) {
  const access = getPropertyAccess(profile);
  const roomComplaints = useMemo(
    () => propertyStatus?.roomComplaints ?? [],
    [propertyStatus?.roomComplaints],
  );
  const activeRoomComplaints = useMemo(
    () => roomComplaints.filter((complaint) => !complaint.resolvedAt),
    [roomComplaints],
  );
  const [selectedFloor, setSelectedFloor] = useState("");
  const [selectedRoom, setSelectedRoom] = useState("");
  const [complaintType, setComplaintType] = useState(roomComplaintOptions[0]?.value ?? "");
  const [complaintNote, setComplaintNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });

  const roomOptions = useMemo(
    () => getRoomOptionsForFloor(selectedFloor),
    [selectedFloor],
  );

  useEffect(() => {
    if (
      selectedRoom &&
      !roomOptions.some((room) => room.value === selectedRoom)
    ) {
      setSelectedRoom("");
    }
  }, [roomOptions, selectedRoom]);

  if (!access.canViewComplaints) {
    return null;
  }

  async function saveComplaints(nextRoomComplaints, message) {
    setSaving(true);
    setFeedback({ type: "", message: "" });

    try {
      await onSaveRoomComplaints({
        roomComplaints: nextRoomComplaints,
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

    if (!selectedFloor || !selectedRoom || !complaintType) {
      return;
    }

    const complaintId = `complaint-${Date.now()}`;
    const nextRoomComplaints = [
      ...roomComplaints,
      {
        id: complaintId,
        roomNumber: selectedRoom,
        complaintType,
        complaintNote: complaintNote.trim(),
        reportedAt: new Date().toISOString(),
        resolvedAt: "",
        updatedByName: profile?.fullName ?? "",
        updatedByDepartment: profile?.departmentName ?? "",
      },
    ];

    await saveComplaints(nextRoomComplaints, `${selectedRoom} complaint added.`);
    setSelectedRoom("");
    setComplaintType(roomComplaintOptions[0]?.value ?? "");
    setComplaintNote("");
  }

  async function handleClearComplaint(complaintId, roomNumber) {
    await saveComplaints(
      roomComplaints.map((complaint) =>
        complaint.id === complaintId
          ? {
              ...complaint,
              resolvedAt: new Date().toISOString(),
            }
          : complaint,
      ),
      `${roomNumber} complaint cleared.`,
    );
  }

  return (
    <section className="panel p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="section-title">Room Complaints</h2>
        <span className="badge">{activeRoomComplaints.length} active</span>
      </div>

      <div className="mt-5 space-y-3">
        {activeRoomComplaints.length > 0 ? (
          activeRoomComplaints.map((complaint) => (
            <div
              key={complaint.id}
              className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold text-[#162338]">{complaint.roomNumber}</p>
                  <p className="mt-1 text-sm text-slate-500">{complaint.floorLabel}</p>
                  <p className="mt-3 text-sm text-slate-700">
                    {getRoomComplaintLabel(complaint.complaintType)}
                  </p>
                  {complaint.complaintNote ? (
                    <p className="mt-2 text-sm text-slate-500">{complaint.complaintNote}</p>
                  ) : null}
                  <p className="mt-2 text-xs text-slate-500">
                    {complaint.updatedByName}
                    {complaint.updatedByDepartment ? ` - ${complaint.updatedByDepartment}` : ""}
                    {complaint.reportedAt ? ` - ${formatReportedAt(complaint.reportedAt)}` : ""}
                  </p>
                </div>

                {access.canEditComplaints ? (
                  <button
                    type="button"
                    onClick={() => handleClearComplaint(complaint.id, complaint.roomNumber)}
                    disabled={saving}
                    className="button-secondary"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-500">
            No room complaints.
          </div>
        )}
      </div>

      {access.canEditComplaints ? (
        <form onSubmit={handleSubmit} className="subpanel mt-6 no-print">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="field">
              <span>Floor</span>
              <select
                value={selectedFloor}
                onChange={(event) => {
                  setSelectedFloor(event.target.value);
                  setSelectedRoom("");
                }}
                disabled={saving}
              >
                <option value="">Select floor</option>
                {roomFloorOptions.map((floor) => (
                  <option key={floor.value} value={floor.value}>
                    {floor.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Room</span>
              <select
                value={selectedRoom}
                onChange={(event) => setSelectedRoom(event.target.value)}
                disabled={saving || !selectedFloor}
              >
                <option value="">Select room</option>
                {roomOptions.map((room) => (
                  <option key={room.value} value={room.value}>
                    {room.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="field">
              <span>Complaint</span>
              <select
                value={complaintType}
                onChange={(event) => setComplaintType(event.target.value)}
                disabled={saving}
              >
                {roomComplaintOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field mt-4">
            <span>Note</span>
            <textarea
              value={complaintNote}
              onChange={(event) => setComplaintNote(event.target.value)}
              rows={3}
              disabled={saving}
            />
          </label>

          {feedback.message ? (
            <div
              className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
                feedback.type === "success"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-rose-50 text-rose-700"
              }`}
            >
              {feedback.message}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={saving || !selectedFloor || !selectedRoom || !complaintType}
            className="button-primary mt-5 w-full"
          >
            {saving ? "Saving..." : "Send complaint"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
