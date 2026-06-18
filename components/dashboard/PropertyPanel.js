"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getRoomOptionsForFloor,
  roomFloorOptions,
  roomGroups,
} from "@/data/hotelRooms";
import {
  defaultUtilities,
  getUtilityLabel,
  propertyUtilityFields,
} from "@/data/propertyStatus";
import { formatFriendlyDate } from "@/lib/format";
import { getPropertyAccess } from "@/lib/roles";

function formatUpdatedAt(value) {
  if (!value) {
    return "";
  }

  const dateValue = typeof value?.toDate === "function" ? value.toDate() : new Date(value);

  if (Number.isNaN(dateValue.getTime())) {
    return "";
  }

  return formatFriendlyDate(dateValue, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
      <span className="text-sm font-medium text-slate-600">{label}</span>
      <span className="text-sm font-semibold text-[#162338]">{value}</span>
    </div>
  );
}

function buildRoomIssueSections(roomIssues = []) {
  const roomIssueMap = new Map(roomIssues.map((roomIssue) => [roomIssue.roomNumber, roomIssue]));

  return roomGroups.map((group) => ({
    key: group.key,
    label: group.label,
    rooms: group.rooms
      .filter((roomNumber) => roomIssueMap.has(roomNumber))
      .map((roomNumber) => roomIssueMap.get(roomNumber)),
  }));
}

function buildRoomIssueMetaLine(roomIssue) {
  return [roomIssue.updatedByName || "", roomIssue.updatedByDepartment || ""]
    .filter(Boolean)
    .join(" - ");
}

export default function PropertyPanel({
  profile,
  propertyStatus,
  onSaveRoomIssues,
  onSaveUtilities,
}) {
  const access = getPropertyAccess(profile);
  const roomIssues = useMemo(
    () => propertyStatus?.roomIssues ?? [],
    [propertyStatus?.roomIssues],
  );
  const roomIssueSections = useMemo(
    () => buildRoomIssueSections(roomIssues),
    [roomIssues],
  );
  const affectedFloors = useMemo(
    () => roomIssueSections.filter((section) => section.rooms.length > 0).length,
    [roomIssueSections],
  );
  const utilities = useMemo(
    () => propertyStatus?.utilities ?? defaultUtilities,
    [propertyStatus?.utilities],
  );
  const [selectedFloor, setSelectedFloor] = useState("");
  const [selectedRoom, setSelectedRoom] = useState("");
  const [outOfOrder, setOutOfOrder] = useState("yes");
  const [issueNote, setIssueNote] = useState("");
  const [utilityForm, setUtilityForm] = useState(defaultUtilities);
  const [savingRoomIssue, setSavingRoomIssue] = useState(false);
  const [savingUtilities, setSavingUtilities] = useState(false);
  const [feedback, setFeedback] = useState({
    roomIssues: { type: "", message: "" },
    utilities: { type: "", message: "" },
  });

  const availableRooms = useMemo(
    () => getRoomOptionsForFloor(selectedFloor),
    [selectedFloor],
  );

  useEffect(() => {
    setUtilityForm({
      ...defaultUtilities,
      ...utilities,
    });
  }, [utilities]);

  useEffect(() => {
    if (
      selectedRoom &&
      !availableRooms.some((room) => room.value === selectedRoom)
    ) {
      setSelectedRoom("");
      setOutOfOrder("yes");
      setIssueNote("");
    }
  }, [availableRooms, selectedRoom]);

  useEffect(() => {
    if (!selectedRoom) {
      setOutOfOrder("yes");
      setIssueNote("");
      return;
    }

    const currentIssue = roomIssues.find((roomIssue) => roomIssue.roomNumber === selectedRoom);

    if (currentIssue) {
      setOutOfOrder("yes");
      setIssueNote(currentIssue.issueNote ?? "");
      return;
    }

    setOutOfOrder("yes");
    setIssueNote("");
  }, [roomIssues, selectedRoom]);

  if (!access.canViewPanel) {
    return null;
  }

  async function handleSaveRoomIssue(event) {
    event.preventDefault();

    if (!selectedFloor || !selectedRoom) {
      return;
    }

    if (outOfOrder === "yes" && !issueNote.trim()) {
      setFeedback((current) => ({
        ...current,
        roomIssues: {
          type: "error",
          message: "Add what needs to be done before saving the room.",
        },
      }));
      return;
    }

    setSavingRoomIssue(true);
    setFeedback((current) => ({
      ...current,
      roomIssues: { type: "", message: "" },
    }));

    try {
      const nextRoomIssues = roomIssues.filter(
        (roomIssue) => roomIssue.roomNumber !== selectedRoom,
      );

      if (outOfOrder === "yes") {
        nextRoomIssues.push({
          roomNumber: selectedRoom,
          outOfOrder: true,
          issueNote: issueNote.trim(),
          updatedByName: profile?.fullName ?? "",
          updatedByDepartment: profile?.departmentName ?? "",
        });
      }

      await onSaveRoomIssues({
        roomIssues: nextRoomIssues,
      });

      setSelectedRoom("");
      setOutOfOrder("yes");
      setIssueNote("");
      setFeedback((current) => ({
        ...current,
        roomIssues: {
          type: "success",
          message:
            outOfOrder === "yes"
              ? `${selectedRoom} updated.`
              : `${selectedRoom} cleared from out-of-order.`,
        },
      }));
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        roomIssues: { type: "error", message: error.message },
      }));
    } finally {
      setSavingRoomIssue(false);
    }
  }

  async function handleClearRoomIssue(roomNumber) {
    setSavingRoomIssue(true);
    setFeedback((current) => ({
      ...current,
      roomIssues: { type: "", message: "" },
    }));

    try {
      await onSaveRoomIssues({
        roomIssues: roomIssues.filter((roomIssue) => roomIssue.roomNumber !== roomNumber),
      });
      setFeedback((current) => ({
        ...current,
        roomIssues: { type: "success", message: `${roomNumber} cleared.` },
      }));
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        roomIssues: { type: "error", message: error.message },
      }));
    } finally {
      setSavingRoomIssue(false);
    }
  }

  async function handleSaveUtilities(event) {
    event.preventDefault();
    setSavingUtilities(true);
    setFeedback((current) => ({
      ...current,
      utilities: { type: "", message: "" },
    }));

    try {
      await onSaveUtilities({
        utilities: utilityForm,
      });
      setFeedback((current) => ({
        ...current,
        utilities: { type: "success", message: "Utility levels updated." },
      }));
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        utilities: { type: "error", message: error.message },
      }));
    } finally {
      setSavingUtilities(false);
    }
  }

  return (
    <section className="panel p-6">
      <h2 className="section-title">Property</h2>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <div className="subpanel">
          <span className="metric-label">Out-of-order rooms</span>
          <span className="metric-value">{roomIssues.length}</span>
        </div>
        <div className="subpanel">
          <span className="metric-label">Floors affected</span>
          <span className="metric-value">{affectedFloors}</span>
        </div>
        <div className="subpanel">
          <span className="metric-label">Utilities tracked</span>
          <span className="metric-value">{propertyUtilityFields.length}</span>
        </div>
      </div>

      <div className="subpanel mt-6">
        <div className="flex items-center justify-between gap-3">
          <p className="metric-label">Out-of-order dashboard</p>
          <span className="badge">{affectedFloors} floor(s)</span>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
          {roomIssueSections.map((section) => (
            <div
              key={section.key}
              className={`rounded-2xl border p-3 ${
                section.rooms.length > 0
                  ? "border-rose-200 bg-rose-50/70"
                  : "border-slate-200 bg-slate-50/70"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[#162338]">{section.label}</p>
                <span className="text-[11px] font-semibold text-slate-500">
                  {section.rooms.length} room(s)
                </span>
              </div>

              {section.rooms.length > 0 ? (
                <div className="mt-3 max-h-[18rem] space-y-2 overflow-y-auto pr-1">
                  {section.rooms.map((roomIssue) => (
                    <div
                      key={roomIssue.roomNumber}
                      className="rounded-xl border border-white/90 bg-white/95 px-3 py-2.5 shadow-sm"
                    >
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <span className="rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white">
                              {roomIssue.roomNumber}
                            </span>
                          </div>
                          {roomIssue.issueNote ? (
                            <p
                              className="mt-2 truncate text-[11px] text-slate-700"
                              title={roomIssue.issueNote}
                            >
                              {roomIssue.issueNote}
                            </p>
                          ) : null}
                          {buildRoomIssueMetaLine(roomIssue) ? (
                            <p
                              className="mt-1 truncate text-[10px] text-slate-500"
                              title={buildRoomIssueMetaLine(roomIssue)}
                            >
                              {buildRoomIssueMetaLine(roomIssue)}
                            </p>
                          ) : null}
                        </div>

                        {access.canEditRoomIssues ? (
                          <button
                            type="button"
                            onClick={() => handleClearRoomIssue(roomIssue.roomNumber)}
                            disabled={savingRoomIssue}
                            className="rounded-full border border-rose-300 bg-white px-2 py-1 text-[10px] font-semibold text-rose-900 transition hover:bg-rose-100"
                          >
                            Clear
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-500">No rooms marked out of order.</p>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          {access.canEditRoomIssues ? (
            <form onSubmit={handleSaveRoomIssue} className="subpanel no-print">
              <p className="metric-label">Update room status</p>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="field">
                  <span>Floor</span>
                  <select
                    value={selectedFloor}
                    onChange={(event) => {
                      setSelectedFloor(event.target.value);
                      setSelectedRoom("");
                    }}
                    disabled={savingRoomIssue}
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
                    disabled={savingRoomIssue || !selectedFloor}
                  >
                    <option value="">Select room</option>
                    {availableRooms.map((room) => (
                      <option key={room.value} value={room.value}>
                        {room.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="field">
                  <span>Out of order</span>
                  <select
                    value={outOfOrder}
                    onChange={(event) => setOutOfOrder(event.target.value)}
                    disabled={savingRoomIssue}
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
              </div>

              <label className="field mt-4">
                <span>What needs to be done</span>
                <textarea
                  value={issueNote}
                  onChange={(event) => setIssueNote(event.target.value)}
                  disabled={savingRoomIssue || outOfOrder === "no"}
                  rows={4}
                  className="min-h-[120px]"
                />
              </label>

              {feedback.roomIssues.message ? (
                <div
                  className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
                    feedback.roomIssues.type === "success"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-rose-50 text-rose-700"
                  }`}
                >
                  {feedback.roomIssues.message}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={savingRoomIssue || !selectedFloor || !selectedRoom}
                className="button-primary mt-5 w-full"
              >
                {savingRoomIssue ? "Saving..." : "Save room status"}
              </button>
            </form>
          ) : null}
        </div>

        {access.canViewUtilities ? (
          <div className="space-y-4">
            <div className="subpanel">
              <p className="metric-label">Utility levels</p>
              <div className="mt-4 space-y-3">
                {propertyUtilityFields.map((field) => (
                  <DetailRow
                    key={field.key}
                    label={field.label}
                    value={getUtilityLabel(field.key, utilities[field.key])}
                  />
                ))}
              </div>

              {propertyStatus?.utilitiesUpdatedByName || propertyStatus?.utilitiesUpdatedAt ? (
                <div className="mt-4 text-xs text-slate-500">
                  {propertyStatus.utilitiesUpdatedByName
                    ? `Updated by ${propertyStatus.utilitiesUpdatedByName}`
                    : ""}
                  {propertyStatus.utilitiesUpdatedByDepartment
                    ? ` - ${propertyStatus.utilitiesUpdatedByDepartment}`
                    : ""}
                  {formatUpdatedAt(propertyStatus.utilitiesUpdatedAt)
                    ? ` - ${formatUpdatedAt(propertyStatus.utilitiesUpdatedAt)}`
                    : ""}
                </div>
              ) : null}
            </div>

            {access.canEditUtilities ? (
              <form onSubmit={handleSaveUtilities} className="subpanel no-print">
                <div className="grid gap-4">
                  {propertyUtilityFields.map((field) => (
                    <label key={field.key} className="field">
                      <span>{field.label}</span>
                      {field.inputType === "number" ? (
                        <input
                          type="number"
                          min="0"
                          value={utilityForm[field.key] ?? ""}
                          onChange={(event) =>
                            setUtilityForm((current) => ({
                              ...current,
                              [field.key]: event.target.value,
                            }))
                          }
                          disabled={savingUtilities}
                        />
                      ) : (
                        <select
                          value={utilityForm[field.key] ?? ""}
                          onChange={(event) =>
                            setUtilityForm((current) => ({
                              ...current,
                              [field.key]: event.target.value,
                            }))
                          }
                          disabled={savingUtilities}
                        >
                          <option value="">Select level</option>
                          {field.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </label>
                  ))}
                </div>

                {feedback.utilities.message ? (
                  <div
                    className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
                      feedback.utilities.type === "success"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-rose-50 text-rose-700"
                    }`}
                  >
                    {feedback.utilities.message}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={savingUtilities}
                  className="button-primary mt-5 w-full"
                >
                  {savingUtilities ? "Saving..." : "Save utility levels"}
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
