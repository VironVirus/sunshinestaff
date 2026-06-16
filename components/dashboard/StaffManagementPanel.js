"use client";

import { useEffect, useMemo, useState } from "react";
import { departmentOptions } from "@/data/departments";
import {
  executiveSuperAdminTitles,
  getDefaultStaffTitle,
  getDepartmentName,
  getManagerWorkspaceAccess,
  getPrivilegeList,
  getStaffTitleOptions,
  jobLevelOptions,
} from "@/lib/roles";

function buildAccessLevel({ departmentKey, jobLevel, staffTitle }) {
  const executiveSuperAdmin = executiveSuperAdminTitles.includes(staffTitle);

  if (executiveSuperAdmin) {
    return {
      isSuperAdmin: true,
      accessLevel: "super_admin",
    };
  }

  if (departmentKey === "it" && jobLevel === "manager" && staffTitle === getDefaultStaffTitle("it", "manager")) {
    return {
      isSuperAdmin: true,
      accessLevel: "super_admin",
    };
  }

  return {
    isSuperAdmin: false,
    accessLevel:
      jobLevel === "manager"
        ? "department_manager"
        : jobLevel === "supervisor"
          ? "department_supervisor"
          : "line_staff",
  };
}

function getDefaultTitleForChange(departmentKey, jobLevel, currentTitle) {
  if (executiveSuperAdminTitles.includes(currentTitle)) {
    return currentTitle;
  }

  return getDefaultStaffTitle(departmentKey, jobLevel);
}

export default function StaffManagementPanel({
  profile,
  staffDirectory,
  onSaveStaffProfile,
}) {
  const access = getManagerWorkspaceAccess(profile);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [form, setForm] = useState({
    fullName: "",
    birthday: "",
    departmentKey: "",
    jobLevel: "line_staff",
    staffTitle: "",
    surcharges: "",
    leaveEligibility: "",
    employmentStatus: "active",
  });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });

  const selectedStaff = useMemo(
    () => staffDirectory.find((staffMember) => staffMember.uid === selectedUserId) ?? null,
    [selectedUserId, staffDirectory],
  );

  const titleOptions = useMemo(
    () => getStaffTitleOptions(form.departmentKey, form.jobLevel),
    [form.departmentKey, form.jobLevel],
  );

  useEffect(() => {
    if (!selectedUserId && staffDirectory[0]?.uid) {
      setSelectedUserId(staffDirectory[0].uid);
    }

    if (
      selectedUserId &&
      !staffDirectory.some((staffMember) => staffMember.uid === selectedUserId)
    ) {
      setSelectedUserId(staffDirectory[0]?.uid ?? "");
    }
  }, [selectedUserId, staffDirectory]);

  useEffect(() => {
    if (!selectedStaff) {
      return;
    }

    setForm({
      fullName: selectedStaff.fullName ?? "",
      birthday: selectedStaff.birthday ?? "",
      departmentKey: selectedStaff.departmentKey ?? "",
      jobLevel: selectedStaff.jobLevel ?? "line_staff",
      staffTitle:
        selectedStaff.staffTitle ??
        getDefaultStaffTitle(selectedStaff.departmentKey, selectedStaff.jobLevel),
      surcharges: selectedStaff.surcharges ?? "",
      leaveEligibility: selectedStaff.leaveEligibility ?? "",
      employmentStatus: selectedStaff.employmentStatus ?? "active",
    });
  }, [selectedStaff]);

  useEffect(() => {
    if (!titleOptions.some((option) => option.value === form.staffTitle)) {
      setForm((current) => ({
        ...current,
        staffTitle: getDefaultStaffTitle(current.departmentKey, current.jobLevel),
      }));
    }
  }, [form.staffTitle, titleOptions]);

  if (!access.canManageStaff) {
    return null;
  }

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateDepartment(value) {
    setForm((current) => ({
      ...current,
      departmentKey: value,
      staffTitle: getDefaultStaffTitle(value, current.jobLevel),
    }));
  }

  function updateJobLevel(value) {
    setForm((current) => ({
      ...current,
      jobLevel: value,
      staffTitle: getDefaultStaffTitle(current.departmentKey, value),
    }));
  }

  async function saveStaff(message, overrides = {}) {
    if (!selectedStaff) {
      return;
    }

    setSaving(true);
    setFeedback({ type: "", message: "" });

    const nextValues = {
      ...form,
      ...overrides,
    };
    const accessValues = buildAccessLevel(nextValues);

    try {
      await onSaveStaffProfile(selectedStaff.uid, {
        fullName: nextValues.fullName.trim(),
        birthday: nextValues.birthday,
        departmentKey: nextValues.departmentKey,
        departmentName: getDepartmentName(nextValues.departmentKey),
        jobLevel: nextValues.jobLevel,
        staffTitle: nextValues.staffTitle.trim(),
        surcharges: nextValues.surcharges.trim(),
        leaveEligibility: nextValues.leaveEligibility.trim(),
        employmentStatus: nextValues.employmentStatus,
        isSuperAdmin: accessValues.isSuperAdmin,
        accessLevel: accessValues.accessLevel,
        privileges: getPrivilegeList(nextValues.departmentKey, nextValues.jobLevel),
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
    await saveStaff("Staff profile updated.");
  }

  async function handleSackStaff() {
    await saveStaff("Staff marked as sacked.", {
      employmentStatus: "sacked",
    });
  }

  async function handlePromoteStaff() {
    await saveStaff("Staff promoted to manager.", {
      jobLevel: "manager",
      staffTitle: getDefaultTitleForChange(form.departmentKey, "manager", form.staffTitle),
    });
  }

  async function handleSetSupervisor() {
    await saveStaff("Staff changed to supervisor.", {
      jobLevel: "supervisor",
      staffTitle: getDefaultTitleForChange(form.departmentKey, "supervisor", form.staffTitle),
    });
  }

  async function handleDemoteStaff() {
    await saveStaff("Staff changed to line staff.", {
      jobLevel: "line_staff",
      staffTitle: getDefaultTitleForChange(form.departmentKey, "line_staff", form.staffTitle),
    });
  }

  async function handleSuspendStaff() {
    await saveStaff("Staff marked as suspended.", {
      employmentStatus: "suspended",
    });
  }

  async function handleReactivateStaff() {
    await saveStaff("Staff reactivated.", {
      employmentStatus: "active",
    });
  }

  return (
    <section className="panel p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="section-title">Staff Management</h2>
        <span className="badge">{staffDirectory.length} staff</span>
      </div>

      <div className="mt-5 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="subpanel">
          <label className="field">
            <span>Staff</span>
            <select
              value={selectedUserId}
              onChange={(event) => setSelectedUserId(event.target.value)}
              disabled={saving}
            >
              <option value="">Select staff</option>
              {staffDirectory.map((staffMember) => (
                <option key={staffMember.uid} value={staffMember.uid}>
                  {staffMember.fullName} - {staffMember.staffTitle || staffMember.departmentName}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-4 space-y-3">
            {staffDirectory.map((staffMember) => (
              <button
                key={staffMember.uid}
                type="button"
                onClick={() => setSelectedUserId(staffMember.uid)}
                className={`block w-full rounded-2xl border px-4 py-3 text-left text-sm ${
                  selectedUserId === staffMember.uid
                    ? "border-[#c59d40] bg-[#f9f2e4] text-[#5f4a18]"
                    : "border-slate-200 bg-slate-50/80 text-slate-700"
                }`}
              >
                <div className="font-semibold">{staffMember.fullName}</div>
                <div className="mt-1 text-xs">
                  {staffMember.staffTitle || staffMember.departmentName}
                  {staffMember.employmentStatus ? ` - ${staffMember.employmentStatus}` : ""}
                </div>
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="subpanel">
          {selectedStaff ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="field">
                  <span>Full name</span>
                  <input
                    type="text"
                    value={form.fullName}
                    onChange={(event) => updateField("fullName", event.target.value)}
                    disabled={saving}
                    required
                  />
                </label>

                <label className="field">
                  <span>Birthday</span>
                  <input
                    type="date"
                    value={form.birthday}
                    onChange={(event) => updateField("birthday", event.target.value)}
                    disabled={saving}
                    required
                  />
                </label>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="field">
                  <span>Department</span>
                  <select
                    value={form.departmentKey}
                    onChange={(event) => updateDepartment(event.target.value)}
                    disabled={saving}
                  >
                    {departmentOptions.map((department) => (
                      <option key={department.value} value={department.value}>
                        {department.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Role level</span>
                  <select
                    value={form.jobLevel}
                    onChange={(event) => updateJobLevel(event.target.value)}
                    disabled={saving}
                  >
                    {jobLevelOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="field">
                  <span>Staff title</span>
                  <select
                    value={form.staffTitle}
                    onChange={(event) => updateField("staffTitle", event.target.value)}
                    disabled={saving}
                  >
                    {titleOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Status</span>
                  <select
                    value={form.employmentStatus}
                    onChange={(event) => updateField("employmentStatus", event.target.value)}
                    disabled={saving}
                  >
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                    <option value="sacked">Sacked</option>
                  </select>
                </label>
              </div>

              <label className="field mt-4">
                <span>Surcharges</span>
                <textarea
                  value={form.surcharges}
                  onChange={(event) => updateField("surcharges", event.target.value)}
                  rows={3}
                  disabled={saving}
                />
              </label>

              <label className="field mt-4">
                <span>Leave eligibility</span>
                <input
                  type="text"
                  value={form.leaveEligibility}
                  onChange={(event) => updateField("leaveEligibility", event.target.value)}
                  disabled={saving}
                />
              </label>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-600">
                Sign-in email: <span className="font-semibold text-[#162338]">{selectedStaff.email}</span>
              </div>

              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                Suspended and sacked staff are removed from active teams, birthdays, and future dashboard access.
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

              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <button type="submit" disabled={saving} className="button-primary flex-1">
                  {saving ? "Saving..." : "Save staff"}
                </button>
                <button
                  type="button"
                  onClick={form.jobLevel === "manager" ? handleDemoteStaff : handlePromoteStaff}
                  disabled={saving}
                  className="button-secondary flex-1"
                >
                  {saving
                    ? "Saving..."
                    : form.jobLevel === "manager"
                      ? "Set as line staff"
                      : "Set as manager"}
                </button>
                <button
                  type="button"
                  onClick={handleSetSupervisor}
                  disabled={saving || form.jobLevel === "supervisor"}
                  className="button-secondary flex-1"
                >
                  {saving ? "Saving..." : form.jobLevel === "supervisor" ? "Already supervisor" : "Set as supervisor"}
                </button>
                <button
                  type="button"
                  onClick={form.employmentStatus === "active" ? handleSuspendStaff : handleReactivateStaff}
                  disabled={saving}
                  className="button-secondary flex-1"
                >
                  {saving
                    ? "Saving..."
                    : form.employmentStatus === "active"
                      ? "Suspend staff"
                      : "Reactivate staff"}
                </button>
                <button
                  type="button"
                  onClick={handleSackStaff}
                  disabled={saving}
                  className="button-secondary flex-1 md:col-span-2 xl:col-span-3"
                >
                  {saving ? "Saving..." : "Sack staff"}
                </button>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-500">
              No staff selected.
            </div>
          )}
        </form>
      </div>
    </section>
  );
}
