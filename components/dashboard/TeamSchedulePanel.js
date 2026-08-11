"use client";

import { useEffect, useMemo, useState } from "react";
import { departmentOptions } from "@/data/departments";
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
  const superAdmin = isSuperAdmin(profile);
  const canManageShifts = isLead(profile) || superAdmin;
  const [selectedDepartmentKey, setSelectedDepartmentKey] = useState(
    superAdmin ? departmentOptions[0]?.value ?? "" : profile?.departmentKey ?? "",
  );
  const [selectedUserId, setSelectedUserId] = useState("");
  const [shiftDate, setShiftDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [removingShiftId, setRemovingShiftId] = useState("");
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const myShifts = useMemo(
    () => departmentShifts.filter((shift) => shift.userId === profile?.uid),
    [departmentShifts, profile?.uid],
  );
  const visibleTeamMembers = useMemo(
    () => teamMembers.filter((member) => member.departmentKey === selectedDepartmentKey),
    [selectedDepartmentKey, teamMembers],
  );
  const visibleDepartmentShifts = useMemo(
    () => departmentShifts.filter(
      (shift) => (shift.departmentKey ?? profile?.departmentKey) === selectedDepartmentKey,
    ),
    [departmentShifts, profile?.departmentKey, selectedDepartmentKey],
  );

  useEffect(() => {
    if (!selectedUserId && visibleTeamMembers[0]?.uid) {
      setSelectedUserId(visibleTeamMembers[0].uid);
    }

    if (
      selectedUserId &&
      !visibleTeamMembers.some((member) => member.uid === selectedUserId)
    ) {
      setSelectedUserId(visibleTeamMembers[0]?.uid ?? "");
    }
  }, [selectedUserId, visibleTeamMembers]);

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
        departmentKey: selectedDepartmentKey,
      });
      setFeedback({ type: "success", message: "Shift saved." });
      setShiftDate("");
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveShift(shift) {
    const removalKey = `${shift.departmentKey ?? selectedDepartmentKey}:${shift.id}`;
    setRemovingShiftId(removalKey);
    setFeedback({ type: "", message: "" });

    try {
      await onRemoveShift(shift.id, shift.departmentKey ?? selectedDepartmentKey);
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
        <span className="badge">{visibleTeamMembers.length} staff</span>
      </div>

      {canManageShifts ? (
        <>
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <p className="metric-label">Team members</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {visibleTeamMembers.length > 0 ? (
                visibleTeamMembers.map((member) => (
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
            <div className={`grid gap-4 ${superAdmin ? "lg:grid-cols-3" : "sm:grid-cols-2"}`}>
              {superAdmin ? (
                <label className="field">
                  <span>Department</span>
                  <select
                    value={selectedDepartmentKey}
                    onChange={(event) => setSelectedDepartmentKey(event.target.value)}
                    disabled={saving}
                  >
                    {departmentOptions.map((department) => (
                      <option key={department.value} value={department.value}>
                        {department.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="field">
                <span>Staff</span>
                <select
                  value={selectedUserId}
                  onChange={(event) => setSelectedUserId(event.target.value)}
                  disabled={saving || visibleTeamMembers.length === 0}
                >
                  <option value="">Select staff</option>
                  {visibleTeamMembers.map((member) => (
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
            {visibleDepartmentShifts.length > 0 ? (
              visibleDepartmentShifts.map((shift) => {
                const removalKey = `${shift.departmentKey ?? selectedDepartmentKey}:${shift.id}`;

                return (
                <div
                  key={removalKey}
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
                    onClick={() => handleRemoveShift(shift)}
                    disabled={removingShiftId === removalKey}
                    className="button-secondary"
                  >
                    {removingShiftId === removalKey ? "Removing..." : "Remove"}
                  </button>
                </div>
                );
              })
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
