"use client";

import { useEffect, useMemo, useState } from "react";
import { formatFriendlyDate } from "@/lib/format";
import { isLead, isSuperAdmin } from "@/lib/roles";

function formatShiftDate(value) {
  if (!value) {
    return "";
  }

  return formatFriendlyDate(new Date(value), {
    dateStyle: "full",
  });
}

export default function TeamSchedulePanel({
  profile,
  teamMembers,
  departmentShifts,
  onSaveShift,
  onRemoveShift,
}) {
  const canManageShifts = isLead(profile) || isSuperAdmin(profile);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [shiftDate, setShiftDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [removingShiftId, setRemovingShiftId] = useState("");
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const myShifts = useMemo(
    () => departmentShifts.filter((shift) => shift.userId === profile?.uid),
    [departmentShifts, profile?.uid],
  );

  useEffect(() => {
    if (!selectedUserId && teamMembers[0]?.uid) {
      setSelectedUserId(teamMembers[0].uid);
    }

    if (
      selectedUserId &&
      !teamMembers.some((member) => member.uid === selectedUserId)
    ) {
      setSelectedUserId(teamMembers[0]?.uid ?? "");
    }
  }, [selectedUserId, teamMembers]);

  async function handleAssignShift(event) {
    event.preventDefault();

    if (!selectedUserId || !shiftDate) {
      return;
    }

    setSaving(true);
    setFeedback({ type: "", message: "" });

    try {
      await onSaveShift({
        userId: selectedUserId,
        shiftDate,
      });
      setFeedback({ type: "success", message: "Shift saved." });
      setShiftDate("");
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveShift(shiftId) {
    setRemovingShiftId(shiftId);
    setFeedback({ type: "", message: "" });

    try {
      await onRemoveShift(shiftId);
      setFeedback({ type: "success", message: "Shift removed." });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setRemovingShiftId("");
    }
  }

  return (
    <section className="panel p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="section-title">Team</h2>
        <span className="badge">{teamMembers.length} staff</span>
      </div>

      {canManageShifts ? (
        <>
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <p className="metric-label">Team members</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {teamMembers.length > 0 ? (
                teamMembers.map((member) => (
                  <span
                    key={member.uid}
                    className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    {member.fullName}
                  </span>
                ))
              ) : (
                <span className="text-sm text-slate-500">No staff yet.</span>
              )}
            </div>
          </div>

          <form onSubmit={handleAssignShift} className="mt-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field">
                <span>Staff</span>
                <select
                  value={selectedUserId}
                  onChange={(event) => setSelectedUserId(event.target.value)}
                  disabled={saving || teamMembers.length === 0}
                >
                  <option value="">Select staff</option>
                  {teamMembers.map((member) => (
                    <option key={member.uid} value={member.uid}>
                      {member.fullName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Shift date</span>
                <input
                  type="date"
                  value={shiftDate}
                  onChange={(event) => setShiftDate(event.target.value)}
                  disabled={saving}
                />
              </label>
            </div>

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
              disabled={saving || !selectedUserId || !shiftDate}
              className="button-primary mt-5 w-full"
            >
              {saving ? "Saving..." : "Save shift"}
            </button>
          </form>

          <div className="mt-5 space-y-3">
            {departmentShifts.length > 0 ? (
              departmentShifts.map((shift) => (
                <div
                  key={shift.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4"
                >
                  <div>
                    <p className="font-semibold text-[#162338]">{shift.staffName}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {formatShiftDate(shift.shiftDate)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveShift(shift.id)}
                    disabled={removingShiftId === shift.id}
                    className="button-secondary"
                  >
                    {removingShiftId === shift.id ? "Removing..." : "Remove"}
                  </button>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-500">
                No shifts assigned.
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="mt-5 space-y-3">
          {myShifts.length > 0 ? (
            myShifts.map((shift) => (
              <div
                key={shift.id}
                className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4"
              >
                <p className="font-semibold text-[#162338]">{formatShiftDate(shift.shiftDate)}</p>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-500">
              No shifts assigned.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
