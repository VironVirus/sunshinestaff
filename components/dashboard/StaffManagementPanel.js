"use client";

import { useEffect, useMemo, useState } from "react";
import { sendPasswordResetEmail } from "@firebase/auth";
import { departmentOptions } from "@/data/departments";
import {
  buildLeaveGrant,
  buildPayrollBreakdown,
  formatCurrency,
  formatLeaveRecordLabel,
  getEmploymentStartDateKey,
  getLeaveEligibilityDetails,
  getQuarterLabelFromDateKey,
  normalizeLeaveRecords,
} from "@/lib/hr";
import { formatFriendlyDate } from "@/lib/format";
import { auth } from "@/lib/firebase";
import { getHotelDateKey } from "@/lib/hotelTime";
import { downloadTextPdf } from "@/lib/pdf";
import {
  accountApprovalOptions,
  executiveSuperAdminTitles,
  getDefaultStaffTitle,
  getDepartmentName,
  getManagerWorkspaceAccess,
  getPrivilegeList,
  getStaffTitleOptions,
  jobLevelOptions,
} from "@/lib/roles";

const managementSections = [
  { key: "active", label: "Active Staff" },
  { key: "sacked", label: "Sacked Staff" },
  { key: "leave", label: "Leave" },
  { key: "payroll", label: "Payroll" },
];

function toText(value, fallback = "") {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return fallback;
  }

  return String(value);
}

function getStaffDisplayName(staffMember = {}) {
  return toText(staffMember.fullName, "Unnamed staff");
}

function getStaffRoleLabel(staffMember = {}) {
  return toText(staffMember.staffTitle || staffMember.departmentName, "Unassigned");
}

function buildAccessLevel({ staffTitle, currentIsSuperAdmin, jobLevel }) {
  const executiveSuperAdmin = executiveSuperAdminTitles.includes(staffTitle);

  if (executiveSuperAdmin || currentIsSuperAdmin) {
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

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function printTextReport(title, lines) {
  if (typeof window === "undefined") {
    return;
  }

  const reportWindow = window.open("", "_blank", "width=900,height=720");

  if (!reportWindow) {
    return;
  }

  reportWindow.document.write(`
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #1f2937; margin: 32px; }
          h1 { color: #162338; margin-bottom: 12px; }
          pre { white-space: pre-wrap; line-height: 1.8; font-size: 14px; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        <pre>${escapeHtml(lines.join("\n"))}</pre>
      </body>
    </html>
  `);

  reportWindow.document.close();
  reportWindow.focus();
  reportWindow.print();
}

function SectionButton({ active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2.5 text-sm font-semibold transition ${
        active
          ? "bg-[#162338] text-white"
          : "bg-white text-slate-600 hover:text-[#162338]"
      }`}
    >
      {label}
    </button>
  );
}

function StaffMetric({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4">
      <p className="metric-label">{label}</p>
      <p className="mt-2 text-sm font-semibold text-[#162338]">{value}</p>
    </div>
  );
}

function groupStaffByDepartment(staffMembers = []) {
  const departmentOrder = new Map(
    departmentOptions.map((department, index) => [department.value, index]),
  );
  const grouped = new Map();

  staffMembers.forEach((staffMember) => {
    const key = staffMember.departmentKey || "unassigned";
    const label = staffMember.departmentName || "Unassigned";
    const currentGroup = grouped.get(key) ?? {
      key,
      label,
      members: [],
    };

    currentGroup.members.push(staffMember);
    grouped.set(key, currentGroup);
  });

  return [...grouped.values()]
    .sort((left, right) => {
      const leftOrder = departmentOrder.get(left.key) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = departmentOrder.get(right.key) ?? Number.MAX_SAFE_INTEGER;

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return toText(left.label).localeCompare(toText(right.label));
    })
    .map((group) => ({
      ...group,
      members: [...group.members].sort((left, right) =>
        getStaffDisplayName(left).localeCompare(getStaffDisplayName(right)),
      ),
    }));
}

function getSackedDate(staffMember = {}) {
  const value = staffMember?.sackedAt ?? staffMember?.updatedAt ?? null;

  if (!value) {
    return null;
  }

  const parsedDate = value instanceof Date ? value : new Date(value);

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function countCurrentlyOnLeave(staffMembers = []) {
  return staffMembers.filter((staffMember) => {
    const leaveStatus = getLeaveEligibilityDetails(staffMember).status;
    return leaveStatus === "on_leave" || leaveStatus === "overstayed";
  }).length;
}

function countSackedWithinWindow(staffMembers = [], days = 7) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  return staffMembers.filter((staffMember) => {
    const sackedDate = getSackedDate(staffMember);
    return sackedDate ? sackedDate.getTime() >= cutoff : false;
  }).length;
}

function SpreadsheetTable({
  columns,
  rows,
  emptyMessage,
  className = "",
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={`overflow-x-auto rounded-3xl border border-slate-200 bg-white ${className}`}>
      <table className="min-w-full border-collapse text-left text-sm">
        <thead className="bg-slate-100 text-xs uppercase tracking-[0.14em] text-slate-500">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className="border-b border-slate-200 px-4 py-3 font-semibold">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={row.id ?? `${rowIndex}-${columns[0]?.key ?? "row"}`}
              className="odd:bg-white even:bg-slate-50/60"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className="border-b border-slate-200 px-4 py-3 align-top text-slate-700"
                >
                  {row[column.key] ?? "-"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StaffDirectoryList({
  groups,
  selectedUserId,
  onSelect,
  emptyMessage,
}) {
  const [openGroupKey, setOpenGroupKey] = useState(groups[0]?.key ?? "");

  useEffect(() => {
    if (groups.length === 0) {
      setOpenGroupKey("");
      return;
    }

    if (!groups.some((group) => group.key === openGroupKey)) {
      setOpenGroupKey(groups[0].key);
    }
  }, [groups, openGroupKey]);

  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.key} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
          <button
            type="button"
            onClick={() => setOpenGroupKey(group.key)}
            className={`flex w-full items-center justify-between gap-3 rounded-2xl px-1 py-1 text-left ${
              openGroupKey === group.key ? "text-[#162338]" : "text-slate-600"
            }`}
          >
            <div>
              <p className="text-sm font-semibold">{group.label}</p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-slate-500">
                {group.members.length} staff
              </p>
            </div>
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-full border text-lg transition ${
                openGroupKey === group.key
                  ? "border-[#162338] bg-[#162338] text-white"
                  : "border-slate-200 bg-white text-slate-500"
              }`}
              aria-hidden="true"
            >
              {openGroupKey === group.key ? "−" : "+"}
            </span>
          </button>

          {openGroupKey === group.key ? (
            <div className="mt-3 space-y-2">
              {group.members.map((staffMember) => (
                <button
                  key={staffMember.uid}
                  type="button"
                  onClick={() => onSelect(staffMember.uid)}
                  className={`block w-full rounded-2xl border px-4 py-3 text-left text-sm ${
                    selectedUserId === staffMember.uid
                      ? "border-[#c59d40] bg-[#f9f2e4] text-[#5f4a18]"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  <div className="font-semibold">{getStaffDisplayName(staffMember)}</div>
                  <div className="mt-1 text-xs">
                    {getStaffRoleLabel(staffMember)}
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function buildPayrollReportLines(staffMembers = []) {
  const groupedStaff = groupStaffByDepartment(staffMembers);
  const lines = [
    "Sunshine Hotel Payroll Report",
    `Generated: ${formatFriendlyDate(new Date(), {
      dateStyle: "full",
      timeStyle: "short",
    })}`,
    "",
  ];

  if (groupedStaff.length === 0) {
    lines.push("No active staff payroll records found.");
    return lines;
  }

  groupedStaff.forEach((group) => {
    let departmentNetTotal = 0;

    lines.push(group.label);
    group.members.forEach((staffMember, index) => {
      const payroll = buildPayrollBreakdown(staffMember);
      departmentNetTotal += payroll.netSalary;
      lines.push(
        `${index + 1}. ${getStaffDisplayName(staffMember)} | ${getStaffRoleLabel(staffMember) || group.label}`,
      );
      lines.push(`Payroll month: ${payroll.payrollMonthLabel}`);
      lines.push(`Gross salary: ${formatCurrency(payroll.monthlySalary)}`);
      lines.push(`Absence deduction: ${formatCurrency(payroll.absenceDeduction)}`);
      lines.push(`Lateness deduction: ${formatCurrency(payroll.latenessDeduction)}`);
      lines.push(`Pension deduction: ${formatCurrency(payroll.pensionAmount)}`);
      lines.push(`Tax deduction: ${formatCurrency(payroll.taxAmount)}`);
      lines.push(`Total deductions: ${formatCurrency(payroll.totalDeductions)}`);
      lines.push(`Net salary: ${formatCurrency(payroll.netSalary)}`);
      lines.push("");
    });
    lines.push(`Department total net salary: ${formatCurrency(departmentNetTotal)}`);
    lines.push("");
  });

  return lines;
}

function getLeaveStatusText(leaveDetails) {
  switch (leaveDetails.status) {
    case "scheduled":
      return "Scheduled";
    case "on_leave":
      return "On leave";
    case "overstayed":
      return "Overstayed leave";
    case "eligible":
      return "Eligible";
    case "quarter_used":
      return "Quarter already used";
    case "year_complete":
      return "Year complete";
    case "not_eligible":
      return "Not yet eligible";
    default:
      return "Start date needed";
  }
}

export default function StaffManagementPanel({
  profile,
  staffDirectory = [],
  onSaveStaffProfile,
}) {
  const access = getManagerWorkspaceAccess(profile);
  const [activeSection, setActiveSection] = useState("active");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedLeaveUserId, setSelectedLeaveUserId] = useState("");
  const [selectedPayrollUserId, setSelectedPayrollUserId] = useState("");
  const [form, setForm] = useState({
    fullName: "",
    birthday: "",
    phoneNumber: "",
    homeAddress: "",
    departmentKey: "",
    jobLevel: "line_staff",
    staffTitle: "",
    surcharges: "",
    employmentStatus: "active",
    approvalStatus: "pending",
    employmentStartDate: "",
  });
  const [leaveForm, setLeaveForm] = useState({
    startDate: getHotelDateKey(),
  });
  const [payrollForm, setPayrollForm] = useState({
    monthlySalary: "",
    payrollMonthKey: getHotelDateKey().slice(0, 7),
    absenceDays: "0",
    lateCount: "0",
    pensionAmount: "0",
    taxAmount: "0",
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [sendingPasswordReset, setSendingPasswordReset] = useState(false);
  const [savingLeave, setSavingLeave] = useState(false);
  const [savingPayroll, setSavingPayroll] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState({ type: "", message: "" });
  const [leaveFeedback, setLeaveFeedback] = useState({ type: "", message: "" });
  const [payrollFeedback, setPayrollFeedback] = useState({ type: "", message: "" });

  const activeStaff = useMemo(
    () =>
      staffDirectory.filter((staffMember) => (staffMember.employmentStatus ?? "active") !== "sacked"),
    [staffDirectory],
  );
  const sackedStaff = useMemo(
    () =>
      staffDirectory.filter((staffMember) => (staffMember.employmentStatus ?? "active") === "sacked"),
    [staffDirectory],
  );
  const activeStaffByDepartment = useMemo(
    () => groupStaffByDepartment(activeStaff),
    [activeStaff],
  );
  const sackedStaffByDepartment = useMemo(
    () => groupStaffByDepartment(sackedStaff),
    [sackedStaff],
  );
  const currentDirectoryGroups =
    activeSection === "sacked" ? sackedStaffByDepartment : activeStaffByDepartment;
  const currentDirectory =
    activeSection === "sacked" ? sackedStaff : activeStaff;

  const selectedStaff = useMemo(
    () => staffDirectory.find((staffMember) => staffMember.uid === selectedUserId) ?? null,
    [selectedUserId, staffDirectory],
  );
  const selectedLeaveStaff = useMemo(
    () => activeStaff.find((staffMember) => staffMember.uid === selectedLeaveUserId) ?? null,
    [activeStaff, selectedLeaveUserId],
  );
  const selectedPayrollStaff = useMemo(
    () => activeStaff.find((staffMember) => staffMember.uid === selectedPayrollUserId) ?? null,
    [activeStaff, selectedPayrollUserId],
  );
  const staffAnalysis = useMemo(
    () => ({
      totalStaff: activeStaff.length,
      onLeave: countCurrentlyOnLeave(activeStaff),
      sackedThisWeek: countSackedWithinWindow(sackedStaff),
    }),
    [activeStaff, sackedStaff],
  );

  const titleOptions = useMemo(
    () => getStaffTitleOptions(form.departmentKey, form.jobLevel),
    [form.departmentKey, form.jobLevel],
  );
  const leaveDetails = useMemo(
    () => getLeaveEligibilityDetails(selectedLeaveStaff),
    [selectedLeaveStaff],
  );
  const payrollPreview = useMemo(
    () =>
      buildPayrollBreakdown({
        ...selectedPayrollStaff,
        monthlySalary: payrollForm.monthlySalary,
        payrollMonthKey: payrollForm.payrollMonthKey,
        absenceDays: payrollForm.absenceDays,
        lateCount: payrollForm.lateCount,
        pensionAmount: payrollForm.pensionAmount,
        taxAmount: payrollForm.taxAmount,
      }),
    [payrollForm, selectedPayrollStaff],
  );
  const payrollPreviewRows = useMemo(
    () => [
      {
        id: "month",
        heading: "Payroll month",
        value: payrollPreview.payrollMonthLabel,
      },
      {
        id: "gross",
        heading: "Gross salary",
        value: formatCurrency(payrollPreview.monthlySalary),
      },
      {
        id: "daily",
        heading: "Daily wage",
        value: formatCurrency(payrollPreview.dailyWage),
      },
      {
        id: "attendance",
        heading: "Attendance days",
        value: payrollPreview.attendanceDays,
      },
      {
        id: "absence-days",
        heading: "Absence days",
        value: payrollPreview.absenceDays,
      },
      {
        id: "absence",
        heading: "Absence deduction",
        value: formatCurrency(payrollPreview.absenceDeduction),
      },
      {
        id: "late-count",
        heading: "Lateness count",
        value: payrollPreview.lateCount,
      },
      {
        id: "late-deduction",
        heading: "Lateness deduction",
        value: formatCurrency(payrollPreview.latenessDeduction),
      },
      {
        id: "pension",
        heading: "Pension deduction",
        value: formatCurrency(payrollPreview.pensionAmount),
      },
      {
        id: "tax",
        heading: "Tax deduction",
        value: formatCurrency(payrollPreview.taxAmount),
      },
      {
        id: "total-deductions",
        heading: "Total deductions",
        value: formatCurrency(payrollPreview.totalDeductions),
      },
      {
        id: "net",
        heading: "Net salary",
        value: formatCurrency(payrollPreview.netSalary),
      },
    ],
    [payrollPreview],
  );
  const payrollSheetRows = useMemo(
    () =>
      activeStaffByDepartment.flatMap((group) =>
        group.members.map((staffMember) => {
          const payroll = buildPayrollBreakdown(staffMember);

          return {
            id: `${group.key}-${staffMember.uid}`,
            department: group.label,
            staffName: getStaffDisplayName(staffMember),
            role: getStaffRoleLabel(staffMember),
            payrollMonth: payroll.payrollMonthLabel,
            grossSalary: formatCurrency(payroll.monthlySalary),
            absenceDays: payroll.absenceDays,
            lateCount: payroll.lateCount,
            pension: formatCurrency(payroll.pensionAmount),
            tax: formatCurrency(payroll.taxAmount),
            totalDeductions: formatCurrency(payroll.totalDeductions),
            netSalary: formatCurrency(payroll.netSalary),
          };
        }),
      ),
    [activeStaffByDepartment],
  );

  useEffect(() => {
    if (!selectedUserId && currentDirectory[0]?.uid) {
      setSelectedUserId(currentDirectory[0].uid);
      return;
    }

    if (
      selectedUserId &&
      !currentDirectory.some((staffMember) => staffMember.uid === selectedUserId)
    ) {
      setSelectedUserId(currentDirectory[0]?.uid ?? "");
    }
  }, [currentDirectory, selectedUserId]);

  useEffect(() => {
    if (!selectedLeaveUserId && activeStaff[0]?.uid) {
      setSelectedLeaveUserId(activeStaff[0].uid);
      return;
    }

    if (
      selectedLeaveUserId &&
      !activeStaff.some((staffMember) => staffMember.uid === selectedLeaveUserId)
    ) {
      setSelectedLeaveUserId(activeStaff[0]?.uid ?? "");
    }
  }, [activeStaff, selectedLeaveUserId]);

  useEffect(() => {
    if (!selectedPayrollUserId && activeStaff[0]?.uid) {
      setSelectedPayrollUserId(activeStaff[0].uid);
      return;
    }

    if (
      selectedPayrollUserId &&
      !activeStaff.some((staffMember) => staffMember.uid === selectedPayrollUserId)
    ) {
      setSelectedPayrollUserId(activeStaff[0]?.uid ?? "");
    }
  }, [activeStaff, selectedPayrollUserId]);

  useEffect(() => {
    if (!selectedStaff) {
      return;
    }

    setForm({
      fullName: selectedStaff.fullName ?? "",
      birthday: selectedStaff.birthday ?? "",
      phoneNumber: selectedStaff.phoneNumber ?? "",
      homeAddress: selectedStaff.homeAddress ?? "",
      departmentKey: selectedStaff.departmentKey ?? "",
      jobLevel: selectedStaff.jobLevel ?? "line_staff",
      staffTitle:
        selectedStaff.staffTitle ??
        getDefaultStaffTitle(selectedStaff.departmentKey, selectedStaff.jobLevel),
      surcharges: selectedStaff.surcharges ?? "",
      employmentStatus: selectedStaff.employmentStatus ?? "active",
      approvalStatus: selectedStaff.approvalStatus ?? "pending",
      employmentStartDate: getEmploymentStartDateKey(selectedStaff),
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

  useEffect(() => {
    if (!selectedPayrollStaff) {
      return;
    }

    setPayrollForm({
      monthlySalary: String(selectedPayrollStaff.monthlySalary ?? ""),
      payrollMonthKey:
        selectedPayrollStaff.payrollMonthKey ?? getHotelDateKey().slice(0, 7),
      absenceDays: String(selectedPayrollStaff.absenceDays ?? 0),
      lateCount: String(selectedPayrollStaff.lateCount ?? 0),
      pensionAmount: String(selectedPayrollStaff.pensionAmount ?? 0),
      taxAmount: String(selectedPayrollStaff.taxAmount ?? 0),
    });
  }, [selectedPayrollStaff]);

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

    setSavingProfile(true);
    setProfileFeedback({ type: "", message: "" });

    const nextValues = {
      ...form,
      ...overrides,
    };
    const nextSackedAt = Object.prototype.hasOwnProperty.call(overrides, "sackedAt")
      ? overrides.sackedAt
      : (selectedStaff.sackedAt ?? null);
    const nextSackedByName = Object.prototype.hasOwnProperty.call(overrides, "sackedByName")
      ? overrides.sackedByName
      : (selectedStaff.sackedByName ?? "");
    const accessValues = buildAccessLevel({
      ...nextValues,
      currentIsSuperAdmin: Boolean(selectedStaff.isSuperAdmin),
    });

    try {
      await onSaveStaffProfile(selectedStaff.uid, {
        fullName: toText(nextValues.fullName).trim(),
        birthday: nextValues.birthday,
        phoneNumber: toText(nextValues.phoneNumber).trim(),
        homeAddress: toText(nextValues.homeAddress).trim(),
        departmentKey: nextValues.departmentKey,
        departmentName: getDepartmentName(nextValues.departmentKey),
        jobLevel: nextValues.jobLevel,
        staffTitle: toText(nextValues.staffTitle).trim(),
        surcharges: toText(nextValues.surcharges).trim(),
        employmentStatus: nextValues.employmentStatus,
        approvalStatus: nextValues.approvalStatus,
        employmentStartDate: nextValues.employmentStartDate,
        sackedAt: nextSackedAt,
        sackedByName: nextSackedByName,
        isSuperAdmin: accessValues.isSuperAdmin,
        accessLevel: accessValues.accessLevel,
        privileges: getPrivilegeList(nextValues.departmentKey, nextValues.jobLevel),
      });

      setProfileFeedback({ type: "success", message });
    } catch (error) {
      setProfileFeedback({ type: "error", message: error.message });
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    await saveStaff("Staff profile updated.");
  }

  async function handleSendPasswordReset() {
    const email = toText(selectedStaff?.email).trim().toLowerCase();

    if (!auth || !email) {
      setProfileFeedback({
        type: "error",
        message: "This staff account does not have a valid sign-in email.",
      });
      return;
    }

    setSendingPasswordReset(true);
    setProfileFeedback({ type: "", message: "" });

    try {
      await sendPasswordResetEmail(auth, email);
      setProfileFeedback({
        type: "success",
        message: `Password reset instructions were sent to ${email}.`,
      });
    } catch {
      setProfileFeedback({
        type: "error",
        message: "The password reset email could not be sent. Check the staff email and try again.",
      });
    } finally {
      setSendingPasswordReset(false);
    }
  }

  async function handleSackStaff() {
    await saveStaff("Staff moved to sacked staff.", {
      employmentStatus: "sacked",
      sackedAt: new Date().toISOString(),
      sackedByName: profile?.fullName ?? "",
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
      sackedAt: null,
      sackedByName: "",
    });
  }

  async function handleApproveStaff() {
    await saveStaff("Staff account approved.", {
      approvalStatus: "approved",
    });
  }

  async function handleSetPendingApproval() {
    await saveStaff("Staff account moved back to pending approval.", {
      approvalStatus: "pending",
    });
  }

  async function handleGrantLeave(event) {
    event.preventDefault();

    if (!selectedLeaveStaff) {
      return;
    }

    setSavingLeave(true);
    setLeaveFeedback({ type: "", message: "" });

    try {
      const currentLeaveRecords = normalizeLeaveRecords(selectedLeaveStaff.leaveRecords ?? []);

      if (currentLeaveRecords.some((record) => !record.returnedAt && !record.returnedDateKey)) {
        throw new Error("This staff already has an open leave record. Mark the return first.");
      }

      if (!leaveDetails.eligible) {
        throw new Error("This staff is not yet eligible for leave.");
      }

      const nextLeaveRecord = buildLeaveGrant({
        startDateKey: leaveForm.startDate,
        actorName: profile?.fullName ?? "",
        actorUid: profile?.uid ?? "",
      });

      if (
        currentLeaveRecords.some((record) => record.quarterKey === nextLeaveRecord.quarterKey)
      ) {
        throw new Error("This quarter has already been used for the selected staff.");
      }

      await onSaveStaffProfile(selectedLeaveStaff.uid, {
        leaveRecords: normalizeLeaveRecords([nextLeaveRecord, ...currentLeaveRecords]),
      });

      setLeaveFeedback({ type: "success", message: "Leave granted successfully." });
      setLeaveForm({
        startDate: getHotelDateKey(),
      });
    } catch (error) {
      setLeaveFeedback({ type: "error", message: error.message });
    } finally {
      setSavingLeave(false);
    }
  }

  async function handleMarkReturned(recordId) {
    if (!selectedLeaveStaff) {
      return;
    }

    setSavingLeave(true);
    setLeaveFeedback({ type: "", message: "" });

    try {
      const nextRecords = normalizeLeaveRecords(selectedLeaveStaff.leaveRecords ?? []).map((record) =>
        record.id === recordId
          ? {
              ...record,
              returnedAt: new Date().toISOString(),
              returnedDateKey: getHotelDateKey(),
              returnedByName: profile?.fullName ?? "",
            }
          : record,
      );

      await onSaveStaffProfile(selectedLeaveStaff.uid, {
        leaveRecords: nextRecords,
      });

      setLeaveFeedback({ type: "success", message: "Leave return recorded." });
    } catch (error) {
      setLeaveFeedback({ type: "error", message: error.message });
    } finally {
      setSavingLeave(false);
    }
  }

  async function handleSavePayroll(event) {
    event.preventDefault();

    if (!selectedPayrollStaff) {
      return;
    }

    setSavingPayroll(true);
    setPayrollFeedback({ type: "", message: "" });

    try {
      await onSaveStaffProfile(selectedPayrollStaff.uid, {
        monthlySalary: Number(payrollForm.monthlySalary || 0),
        payrollMonthKey: payrollForm.payrollMonthKey,
        absenceDays: Number(payrollForm.absenceDays || 0),
        lateCount: Number(payrollForm.lateCount || 0),
        pensionAmount: Number(payrollForm.pensionAmount || 0),
        taxAmount: Number(payrollForm.taxAmount || 0),
        salaryUpdatedAt: new Date().toISOString(),
        salaryUpdatedByName: profile?.fullName ?? "",
      });

      setPayrollFeedback({ type: "success", message: "Payroll record updated." });
    } catch (error) {
      setPayrollFeedback({ type: "error", message: error.message });
    } finally {
      setSavingPayroll(false);
    }
  }

  const payrollReportLines = buildPayrollReportLines(activeStaff);

  return (
    <section className="panel p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="section-title">Staff Management</h2>
          <p className="mt-2 text-sm text-slate-500">
            Staff records, approvals, leave control, payroll, and department grouping.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="badge">{activeStaff.length} active staff</span>
          <span className="badge">{sackedStaff.length} sacked staff</span>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2 rounded-[24px] bg-slate-100 p-2">
        {managementSections.map((section) => (
          <SectionButton
            key={section.key}
            label={section.label}
            active={activeSection === section.key}
            onClick={() => setActiveSection(section.key)}
          />
        ))}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StaffMetric
          label="Total staff"
          value={`${staffAnalysis.totalStaff} active staff record(s)`}
        />
        <StaffMetric
          label="Currently on leave"
          value={`${staffAnalysis.onLeave} staff member(s)`}
        />
        <StaffMetric
          label="Sacked within the week"
          value={`${staffAnalysis.sackedThisWeek} staff member(s)`}
        />
      </div>

      {(activeSection === "active" || activeSection === "sacked") && (
        <div className="mt-5 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <div className="subpanel">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-600">
              <p className="font-semibold text-[#162338]">
                {activeSection === "sacked" ? "Sacked staff by department" : "Active staff by department"}
              </p>
              <p className="mt-2">
                Open one department at a time, choose a staff member on the left, and manage the record on the right.
              </p>
            </div>

            <div className="mt-4">
              <StaffDirectoryList
                groups={currentDirectoryGroups}
                selectedUserId={selectedUserId}
                onSelect={setSelectedUserId}
                emptyMessage={
                  activeSection === "sacked"
                    ? "No staff have been moved to sacked staff yet."
                    : "No staff records found."
                }
              />
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
                      disabled={savingProfile}
                      required
                    />
                  </label>

                  <label className="field">
                    <span>Birthday</span>
                    <input
                      type="date"
                      value={form.birthday}
                      onChange={(event) => updateField("birthday", event.target.value)}
                      disabled={savingProfile}
                      required
                    />
                  </label>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="field">
                    <span>Phone number</span>
                    <input
                      type="tel"
                      value={form.phoneNumber}
                      onChange={(event) => updateField("phoneNumber", event.target.value)}
                      disabled={savingProfile}
                      required
                    />
                  </label>

                  <label className="field">
                    <span>Home address</span>
                    <input
                      type="text"
                      value={form.homeAddress}
                      onChange={(event) => updateField("homeAddress", event.target.value)}
                      disabled={savingProfile}
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
                      disabled={savingProfile}
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
                      disabled={savingProfile}
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
                      disabled={savingProfile}
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
                      disabled={savingProfile}
                    >
                      <option value="active">Active</option>
                      <option value="suspended">Suspended</option>
                      <option value="sacked">Sacked</option>
                    </select>
                  </label>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="field">
                    <span>Approval</span>
                    <select
                      value={form.approvalStatus}
                      onChange={(event) => updateField("approvalStatus", event.target.value)}
                      disabled={savingProfile}
                    >
                      {accountApprovalOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Employment start date</span>
                    <input
                      type="date"
                      value={form.employmentStartDate}
                      onChange={(event) => updateField("employmentStartDate", event.target.value)}
                      disabled={savingProfile}
                      required
                    />
                  </label>
                </div>

                <label className="field mt-4">
                  <span>Surcharges</span>
                  <textarea
                    value={form.surcharges}
                    onChange={(event) => updateField("surcharges", event.target.value)}
                    rows={3}
                    disabled={savingProfile}
                  />
                </label>

                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-600">
                  <p>
                    Sign-in email:{" "}
                    <span className="font-semibold text-[#162338]">
                      {toText(selectedStaff.email, "Not set")}
                    </span>
                  </p>
                  <p className="mt-2">
                    Approval status:{" "}
                    <span className="font-semibold text-[#162338]">
                      {form.approvalStatus === "approved" ? "Approved" : "Pending approval"}
                    </span>
                  </p>
                  {selectedStaff?.approvedByName ? (
                    <p className="mt-2 text-xs text-slate-500">
                      Approved by {selectedStaff.approvedByName}
                    </p>
                  ) : null}
                </div>

                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                  Sacked staff are removed from the active list and kept inside the Sacked Staff tab. Pending accounts cannot log in until HR or a super admin approves them.
                </div>

                {profileFeedback.message ? (
                  <div
                    className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
                      profileFeedback.type === "success"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-rose-50 text-rose-700"
                    }`}
                  >
                    {profileFeedback.message}
                  </div>
                ) : null}

                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <button type="submit" disabled={savingProfile} className="button-primary flex-1">
                    {savingProfile ? "Saving..." : "Save staff"}
                  </button>
                  <button
                    type="button"
                    onClick={
                      form.approvalStatus === "approved"
                        ? handleSetPendingApproval
                        : handleApproveStaff
                    }
                    disabled={savingProfile}
                    className="button-secondary flex-1"
                  >
                    {savingProfile
                      ? "Saving..."
                      : form.approvalStatus === "approved"
                        ? "Set pending approval"
                        : "Approve account"}
                  </button>
                  <button
                    type="button"
                    onClick={form.jobLevel === "manager" ? handleDemoteStaff : handlePromoteStaff}
                    disabled={savingProfile}
                    className="button-secondary flex-1"
                  >
                    {savingProfile
                      ? "Saving..."
                      : form.jobLevel === "manager"
                        ? "Set as line staff"
                        : "Set as manager"}
                  </button>
                  <button
                    type="button"
                    onClick={handleSetSupervisor}
                    disabled={savingProfile || form.jobLevel === "supervisor"}
                    className="button-secondary flex-1"
                  >
                    {savingProfile
                      ? "Saving..."
                      : form.jobLevel === "supervisor"
                        ? "Already supervisor"
                        : "Set as supervisor"}
                  </button>
                  <button
                    type="button"
                    onClick={
                      form.employmentStatus === "active"
                        ? handleSuspendStaff
                        : handleReactivateStaff
                    }
                    disabled={savingProfile}
                    className="button-secondary flex-1"
                  >
                    {savingProfile
                      ? "Saving..."
                      : form.employmentStatus === "active"
                        ? "Suspend staff"
                        : "Reactivate staff"}
                  </button>
                  <button
                    type="button"
                    onClick={handleSackStaff}
                    disabled={savingProfile || activeSection === "sacked"}
                    className="button-secondary flex-1"
                  >
                    {savingProfile ? "Saving..." : "Move to sacked staff"}
                  </button>
                  <button
                    type="button"
                    onClick={handleSendPasswordReset}
                    disabled={savingProfile || sendingPasswordReset || !selectedStaff.email}
                    className="button-secondary flex-1 md:col-span-2"
                  >
                    {sendingPasswordReset ? "Sending reset..." : "Send password reset"}
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
      )}

      {activeSection === "leave" && (
        <div className="mt-5 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="subpanel">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-600">
              <p className="font-semibold text-[#162338]">Leave staff list</p>
              <p className="mt-2">
                Choose a department, pick a staff member, then grant leave or mark return on the right.
              </p>
            </div>

            <div className="mt-4">
              <StaffDirectoryList
                groups={activeStaffByDepartment}
                selectedUserId={selectedLeaveUserId}
                onSelect={setSelectedLeaveUserId}
                emptyMessage="No active staff available for leave management."
              />
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <StaffMetric
                label="Leave status"
                value={selectedLeaveStaff ? getLeaveStatusText(leaveDetails) : "Not set"}
              />
              <StaffMetric
                label="Employment start"
                value={
                  selectedLeaveStaff
                    ? form.employmentStartDate && selectedStaff?.uid === selectedLeaveUserId
                      ? form.employmentStartDate
                      : getEmploymentStartDateKey(selectedLeaveStaff) || "Not set"
                    : "Not set"
                }
              />
              <StaffMetric
                label="Eligibility date"
                value={leaveDetails.eligibilityDateKey || "Awaiting HR update"}
              />
              <StaffMetric
                label="Remaining annual leave"
                value={`${leaveDetails.remainingAnnualDays} day(s)`}
              />
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <StaffMetric
                label="Next leave slot"
                value={leaveDetails.nextAvailableQuarterLabel || "None available now"}
              />
              <StaffMetric
                label="Current leave"
                value={
                  leaveDetails.openLeaveRecord
                    ? formatLeaveRecordLabel(leaveDetails.openLeaveRecord)
                    : "No open leave"
                }
              />
            </div>
          </div>

          <div className="subpanel">
            <form onSubmit={handleGrantLeave} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="field">
                  <span>Leave start date</span>
                  <input
                    type="date"
                    value={leaveForm.startDate}
                    onChange={(event) =>
                      setLeaveForm({
                        startDate: event.target.value,
                      })
                    }
                    disabled={savingLeave}
                    required
                  />
                </label>

                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-600">
                  <p>
                    Quarter:{" "}
                    <span className="font-semibold text-[#162338]">
                      {getQuarterLabelFromDateKey(leaveForm.startDate) || "Select a date"}
                    </span>
                  </p>
                  <p className="mt-2">Duration: 7 days</p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-600">
                HR grants leave in 7-day blocks. Once the return date passes, the staff dashboard will begin to show an overstayed leave warning until HR records the return.
              </div>

              {leaveFeedback.message ? (
                <div
                  className={`rounded-2xl px-4 py-3 text-sm ${
                    leaveFeedback.type === "success"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-rose-50 text-rose-700"
                  }`}
                >
                  {leaveFeedback.message}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <button type="submit" disabled={savingLeave} className="button-primary">
                  {savingLeave ? "Saving..." : "Grant leave"}
                </button>
                {leaveDetails.openLeaveRecord ? (
                  <button
                    type="button"
                    onClick={() => handleMarkReturned(leaveDetails.openLeaveRecord.id)}
                    disabled={savingLeave}
                    className="button-secondary"
                  >
                    {savingLeave ? "Saving..." : "Mark return"}
                  </button>
                ) : null}
              </div>
            </form>

            <div className="mt-5 space-y-3">
              <p className="text-sm font-semibold text-[#162338]">Leave history</p>
              {leaveDetails.leaveRecords.length > 0 ? (
                leaveDetails.leaveRecords.map((record) => (
                  <div
                    key={record.id}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-600"
                  >
                    <p className="font-semibold text-[#162338]">
                      {record.quarterKey} - {formatLeaveRecordLabel(record)}
                    </p>
                    <p className="mt-2">
                      Granted by {record.grantedByName || "Human Resource"}
                    </p>
                    <p className="mt-2">
                      {record.returnedAt
                        ? `Returned on ${record.returnedDateKey || "recorded date"}`
                        : "Return not recorded yet"}
                    </p>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-500">
                  No leave history for this staff member yet.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeSection === "payroll" && (
        <div className="mt-5 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="subpanel">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-600">
              <p className="font-semibold text-[#162338]">Payroll staff list</p>
              <p className="mt-2">
                Select a department, choose a staff member, then update salary, attendance, pension, and tax on the right.
              </p>
            </div>

            <div className="mt-4">
              <StaffDirectoryList
                groups={activeStaffByDepartment}
                selectedUserId={selectedPayrollUserId}
                onSelect={setSelectedPayrollUserId}
                emptyMessage="No active staff available for payroll."
              />
            </div>

            <div className="flex flex-wrap gap-3 no-print">
              <button
                type="button"
                onClick={() => printTextReport("Sunshine Hotel Payroll Report", payrollReportLines)}
                className="button-secondary"
              >
                Print payroll
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadTextPdf({
                    filename: "sunshine-hotel-payroll.pdf",
                    title: "Sunshine Hotel Payroll Report",
                    lines: payrollReportLines,
                  })
                }
                className="button-secondary"
              >
                Download PDF
              </button>
            </div>
          </div>

          <div className="space-y-6">
            <form onSubmit={handleSavePayroll} className="subpanel space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="field">
                  <span>Monthly salary</span>
                  <input
                    type="number"
                    min="0"
                    value={payrollForm.monthlySalary}
                    onChange={(event) =>
                      setPayrollForm((current) => ({
                        ...current,
                        monthlySalary: event.target.value,
                      }))
                    }
                    disabled={savingPayroll}
                    required
                  />
                </label>

                <label className="field">
                  <span>Payroll month</span>
                  <input
                    type="month"
                    value={payrollForm.payrollMonthKey}
                    onChange={(event) =>
                      setPayrollForm((current) => ({
                        ...current,
                        payrollMonthKey: event.target.value,
                      }))
                    }
                    disabled={savingPayroll}
                    required
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="field">
                  <span>Absence days</span>
                  <input
                    type="number"
                    min="0"
                    value={payrollForm.absenceDays}
                    onChange={(event) =>
                      setPayrollForm((current) => ({
                        ...current,
                        absenceDays: event.target.value,
                      }))
                    }
                    disabled={savingPayroll}
                    required
                  />
                </label>

                <label className="field">
                  <span>Lateness count</span>
                  <input
                    type="number"
                    min="0"
                    value={payrollForm.lateCount}
                    onChange={(event) =>
                      setPayrollForm((current) => ({
                        ...current,
                        lateCount: event.target.value,
                      }))
                    }
                    disabled={savingPayroll}
                    required
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="field">
                  <span>Pension deduction</span>
                  <input
                    type="number"
                    min="0"
                    value={payrollForm.pensionAmount}
                    onChange={(event) =>
                      setPayrollForm((current) => ({
                        ...current,
                        pensionAmount: event.target.value,
                      }))
                    }
                    disabled={savingPayroll}
                    required
                  />
                </label>

                <label className="field">
                  <span>Tax deduction</span>
                  <input
                    type="number"
                    min="0"
                    value={payrollForm.taxAmount}
                    onChange={(event) =>
                      setPayrollForm((current) => ({
                        ...current,
                        taxAmount: event.target.value,
                      }))
                    }
                    disabled={savingPayroll}
                    required
                  />
                </label>
              </div>

              {payrollFeedback.message ? (
                <div
                  className={`rounded-2xl px-4 py-3 text-sm ${
                    payrollFeedback.type === "success"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-rose-50 text-rose-700"
                  }`}
                >
                  {payrollFeedback.message}
                </div>
              ) : null}

              <button type="submit" disabled={savingPayroll} className="button-primary">
                {savingPayroll ? "Saving..." : "Save payroll"}
              </button>
            </form>

            <div className="subpanel">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="section-title">Payroll Preview</p>
                  <p className="mt-2 text-sm text-slate-500">
                    Excel-style breakdown for the selected staff record.
                  </p>
                </div>
                <span className="badge">
                  {selectedPayrollStaff ? getStaffDisplayName(selectedPayrollStaff) : "No staff selected"}
                </span>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StaffMetric label="Gross salary" value={formatCurrency(payrollPreview.monthlySalary)} />
                <StaffMetric label="Absence deduction" value={formatCurrency(payrollPreview.absenceDeduction)} />
                <StaffMetric label="Tax deduction" value={formatCurrency(payrollPreview.taxAmount)} />
                <StaffMetric label="Net salary" value={formatCurrency(payrollPreview.netSalary)} />
              </div>

              <div className="mt-5">
                <SpreadsheetTable
                  columns={[
                    { key: "heading", label: "Row heading" },
                    { key: "value", label: "Value" },
                  ]}
                  rows={payrollPreviewRows}
                  emptyMessage="No payroll preview available yet."
                />
              </div>
            </div>

            <div className="subpanel">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="section-title">Payroll Sheet</p>
                  <p className="mt-2 text-sm text-slate-500">
                    Company-wide payroll presented in spreadsheet form.
                  </p>
                </div>
                <span className="badge">{payrollSheetRows.length} row(s)</span>
              </div>

              <div className="mt-5">
                <SpreadsheetTable
                  columns={[
                    { key: "department", label: "Department" },
                    { key: "staffName", label: "Staff name" },
                    { key: "role", label: "Role" },
                    { key: "payrollMonth", label: "Payroll month" },
                    { key: "grossSalary", label: "Gross salary" },
                    { key: "absenceDays", label: "Absence days" },
                    { key: "lateCount", label: "Late count" },
                    { key: "pension", label: "Pension" },
                    { key: "tax", label: "Tax" },
                    { key: "totalDeductions", label: "Total deductions" },
                    { key: "netSalary", label: "Net salary" },
                  ]}
                  rows={payrollSheetRows}
                  emptyMessage="No active staff payroll records found."
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
