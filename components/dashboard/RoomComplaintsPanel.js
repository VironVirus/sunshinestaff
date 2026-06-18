"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getRoomOptionsForFloor,
  roomFloorOptions,
  roomGroups,
} from "@/data/hotelRooms";
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

function groupActiveComplaints(roomComplaints = []) {
  const roomMap = new Map();

  roomComplaints.forEach((complaint) => {
    if (complaint.resolvedAt) {
      return;
    }

    const currentGroup = roomMap.get(complaint.roomNumber) ?? {
      roomNumber: complaint.roomNumber,
      floorLabel: complaint.floorLabel,
      complaints: [],
    };

    currentGroup.complaints.push(complaint);
    roomMap.set(complaint.roomNumber, currentGroup);
  });

  return [...roomMap.values()];
}

function buildComplaintFloorSections(roomGroupsWithComplaints = []) {
  const roomComplaintMap = new Map(
    roomGroupsWithComplaints.map((roomGroup) => [roomGroup.roomNumber, roomGroup]),
  );

  return roomGroups.map((group) => {
    const rooms = group.rooms
      .filter((roomNumber) => roomComplaintMap.has(roomNumber))
      .map((roomNumber) => roomComplaintMap.get(roomNumber));

    return {
      key: group.key,
      label: group.label,
      rooms,
      complaintsCount: rooms.reduce((total, roomGroup) => total + roomGroup.complaints.length, 0),
    };
  });
}

function buildComplaintMetaLine(complaint) {
  const details = [
    complaint.updatedByName || "Staff",
    complaint.updatedByDepartment || "",
    complaint.reportedAt ? formatReportedAt(complaint.reportedAt) : "",
  ].filter(Boolean);

  return details.join(" - ");
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
  const groupedActiveComplaints = useMemo(
    () => groupActiveComplaints(activeRoomComplaints),
    [activeRoomComplaints],
  );
  const complaintSections = useMemo(
    () => buildComplaintFloorSections(groupedActiveComplaints),
    [groupedActiveComplaints],
  );
  const activeComplaintRooms = useMemo(
    () => complaintSections.reduce((total, section) => total + section.rooms.length, 0),
    [complaintSections],
  );
  const floorsWithComplaints = useMemo(
    () => complaintSections.filter((section) => section.rooms.length > 0).length,
    [complaintSections],
  );
  const [selectedFloor, setSelectedFloor] = useState("");
  const [selectedRoom, setSelectedRoom] = useState("");
  const [selectedComplaintTypes, setSelectedComplaintTypes] = useState([]);
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

  function toggleComplaintType(value) {
    setSelectedComplaintTypes((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
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

    if (!selectedFloor || !selectedRoom || selectedComplaintTypes.length === 0) {
      return;
    }

    const existingOpenTypes = new Set(
      activeRoomComplaints
        .filter((complaint) => complaint.roomNumber === selectedRoom)
        .map((complaint) => complaint.complaintType),
    );
    const nextComplaintTypes = selectedComplaintTypes.filter(
      (complaintType) => !existingOpenTypes.has(complaintType),
    );

    if (nextComplaintTypes.length === 0) {
      setFeedback({
        type: "error",
        message: "The selected complaint(s) are already active for this room.",
      });
      return;
    }

    const nextRoomComplaints = [
      ...roomComplaints,
      ...nextComplaintTypes.map((complaintType, index) => ({
        id: `complaint-${Date.now()}-${index + 1}`,
        roomNumber: selectedRoom,
        complaintType,
        complaintNote: complaintNote.trim(),
        reportedAt: new Date().toISOString(),
        resolvedAt: "",
        updatedByName: profile?.fullName ?? "",
        updatedByDepartment: profile?.departmentName ?? "",
      })),
    ];

    await saveComplaints(
      nextRoomComplaints,
      `${selectedRoom} complaint${nextComplaintTypes.length > 1 ? "s" : ""} added.`,
    );
    setSelectedRoom("");
    setSelectedComplaintTypes([]);
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

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <div className="subpanel">
          <span className="metric-label">Active issues</span>
          <span className="metric-value">{activeRoomComplaints.length}</span>
        </div>
        <div className="subpanel">
          <span className="metric-label">Rooms affected</span>
          <span className="metric-value">{activeComplaintRooms}</span>
        </div>
        <div className="subpanel">
          <span className="metric-label">Floors affected</span>
          <span className="metric-value">{floorsWithComplaints}</span>
        </div>
      </div>

      <div className="subpanel mt-6">
        <div className="flex items-center justify-between gap-3">
          <p className="metric-label">Complaint dashboard</p>
          <span className="badge">{floorsWithComplaints} floor(s)</span>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
          {complaintSections.map((section) => (
            <div
              key={section.key}
              className={`rounded-2xl border p-3 ${
                section.rooms.length > 0
                  ? "border-amber-200 bg-amber-50/70"
                  : "border-slate-200 bg-slate-50/70"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[#162338]">{section.label}</p>
                <span className="text-[11px] font-semibold text-slate-500">
                  {section.complaintsCount} issue(s)
                </span>
              </div>

              {section.rooms.length > 0 ? (
                <div className="mt-3 max-h-[18rem] space-y-2 overflow-y-auto pr-1">
                  {section.rooms.map((roomGroup) => (
                    <div
                      key={roomGroup.roomNumber}
                      className="rounded-xl border border-white/90 bg-white/95 px-3 py-2.5 shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="rounded-full bg-[#162338] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white">
                          {roomGroup.roomNumber}
                        </span>
                        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {roomGroup.complaints.length} issue(s)
                        </span>
                      </div>

                      <div className="mt-2 space-y-2">
                        {roomGroup.complaints.map((complaint) => (
                          <div
                            key={complaint.id}
                            className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-2.5 py-2"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-semibold text-slate-800">
                                {getRoomComplaintLabel(complaint.complaintType)}
                              </p>
                              {complaint.complaintNote ? (
                                <p
                                  className="truncate text-[10px] text-slate-600"
                                  title={complaint.complaintNote}
                                >
                                  {complaint.complaintNote}
                                </p>
                              ) : null}
                              <p
                                className="truncate text-[10px] text-slate-500"
                                title={buildComplaintMetaLine(complaint)}
                              >
                                {buildComplaintMetaLine(complaint)}
                              </p>
                            </div>

                            {access.canEditComplaints ? (
                              <button
                                type="button"
                                onClick={() =>
                                  handleClearComplaint(complaint.id, complaint.roomNumber)
                                }
                                disabled={saving}
                                className="rounded-full border border-amber-300 bg-white px-2 py-1 text-[10px] font-semibold text-amber-900 transition hover:bg-amber-100"
                              >
                                Clear
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-500">No active complaints.</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {access.canEditComplaints ? (
        <form onSubmit={handleSubmit} className="subpanel mt-6 no-print">
          <p className="metric-label">Log complaint</p>

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

          <div className="mt-4">
            <span className="text-sm font-medium text-slate-700">Complaint issues</span>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {roomComplaintOptions.map((option) => {
                const checked = selectedComplaintTypes.includes(option.value);

                return (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm ${
                      checked
                        ? "border-[#162338] bg-[#162338] text-white"
                        : "border-slate-200 bg-slate-50/80 text-slate-700"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleComplaintType(option.value)}
                      disabled={saving}
                    />
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </div>
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
            disabled={saving || !selectedFloor || !selectedRoom || selectedComplaintTypes.length === 0}
            className="button-primary mt-5 w-full"
          >
            {saving ? "Saving..." : "Send complaint(s)"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
