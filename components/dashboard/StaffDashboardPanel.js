"use client";

import { useEffect, useMemo, useState } from "react";
import { formatBirthday, formatFriendlyDate } from "@/lib/format";
import {
  buildPayrollBreakdown,
  formatCurrency,
  formatLeaveRecordLabel,
  getLeaveEligibilityDetails,
} from "@/lib/hr";
import { formatDateKey } from "@/lib/hotelTime";

function DetailRow({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4">
      <p className="metric-label">{label}</p>
      <p className="mt-2 text-sm font-semibold text-[#162338]">{value}</p>
    </div>
  );
}

function formatShiftDate(value) {
  if (!value) {
    return "";
  }

  return formatFriendlyDate(new Date(value), {
    dateStyle: "full",
  });
}

function getLeaveHeadline(leaveDetails) {
  switch (leaveDetails.status) {
    case "scheduled":
      return "Leave has been scheduled for you.";
    case "on_leave":
      return "You are currently on approved leave.";
    case "overstayed":
      return "Overstayed leave. Report to Human Resource immediately.";
    case "eligible":
      return "You are eligible for leave.";
    case "quarter_used":
      return "This quarter leave slot has already been used.";
    case "year_complete":
      return "Your yearly leave allocation has already been used.";
    case "not_eligible":
      return "You are not yet eligible for leave.";
    default:
      return "Human Resource needs to confirm your employment start date.";
  }
}

function getLeaveTone(leaveDetails) {
  if (leaveDetails.status === "overstayed") {
    return "border-rose-200 bg-rose-50 text-rose-900";
  }

  if (leaveDetails.status === "on_leave" || leaveDetails.status === "scheduled") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }

  if (leaveDetails.status === "eligible") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  return "border-slate-200 bg-slate-50 text-slate-700";
}

export default function StaffDashboardPanel({ profile, departmentShifts }) {
  const [now, setNow] = useState(() => new Date());
  const myShifts = (departmentShifts ?? []).filter((shift) => shift.userId === profile?.uid);
  const hasProfileNotification = Boolean(profile?.lastProfileNotification?.trim());
  const leaveDetails = useMemo(() => getLeaveEligibilityDetails(profile, now), [now, profile]);
  const payroll = useMemo(() => buildPayrollBreakdown(profile, now), [now, profile]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 60000);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="panel p-6">
      <h2 className="section-title">Staff Dashboard</h2>

      {hasProfileNotification ? (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
          <p className="font-semibold">Notification</p>
          <p className="mt-2">{profile.lastProfileNotification}</p>
          {profile.lastProfileNotificationAt ? (
            <p className="mt-2 text-xs text-amber-700">
              {formatFriendlyDate(new Date(profile.lastProfileNotificationAt), {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DetailRow label="Department" value={profile?.departmentName ?? "Not set"} />
        <DetailRow label="Staff title" value={profile?.staffTitle ?? "Not set"} />
        <DetailRow label="Birthday" value={formatBirthday(profile?.birthday)} />
        <DetailRow
          label="Employment start"
          value={profile?.employmentStartDate ? formatDateKey(profile.employmentStartDate) : "Not set"}
        />
      </div>

      <div className="mt-4 rounded-[28px] border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="metric-label">Leave Status</p>
            <h3 className="mt-2 text-xl font-semibold text-[#162338]">{getLeaveHeadline(leaveDetails)}</h3>
            <p className="mt-2 text-sm text-slate-500">
              Annual leave is 21 days and is issued in 7-day blocks across the first three quarters.
            </p>
          </div>
          <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${getLeaveTone(leaveDetails)}`}>
            {leaveDetails.status === "on_leave"
              ? `${leaveDetails.daysRemaining} day(s) remaining`
              : leaveDetails.status === "overstayed"
                ? `${leaveDetails.overdueDays} day(s) overdue`
                : leaveDetails.status === "eligible"
                  ? `${leaveDetails.remainingAnnualDays} day(s) available`
                  : leaveDetails.status === "not_eligible"
                    ? leaveDetails.eligibilityDateKey
                      ? `Eligible from ${formatDateKey(leaveDetails.eligibilityDateKey)}`
                      : "Not yet eligible"
                    : "Review details below"}
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DetailRow
            label="Eligibility date"
            value={
              leaveDetails.eligibilityDateKey
                ? formatDateKey(leaveDetails.eligibilityDateKey)
                : "Awaiting HR update"
            }
          />
          <DetailRow
            label="Remaining leave this year"
            value={`${leaveDetails.remainingAnnualDays} day(s)`}
          />
          <DetailRow
            label="Next leave slot"
            value={leaveDetails.nextAvailableQuarterLabel || "None available now"}
          />
          <DetailRow
            label="Return countdown"
            value={
              leaveDetails.status === "on_leave"
                ? `${leaveDetails.hoursUntilReturn} hour(s) till return`
                : leaveDetails.status === "overstayed"
                  ? `${leaveDetails.overdueHours} hour(s) overdue`
                  : "No active leave"
            }
          />
        </div>

        {leaveDetails.openLeaveRecord ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-600">
            <p className="font-semibold text-[#162338]">Current leave record</p>
            <p className="mt-2">{formatLeaveRecordLabel(leaveDetails.openLeaveRecord)}</p>
            {leaveDetails.openLeaveRecord.grantedByName ? (
              <p className="mt-2 text-xs text-slate-500">
                Granted by {leaveDetails.openLeaveRecord.grantedByName}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-[28px] border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="metric-label">Payroll and Attendance</p>
            <h3 className="mt-2 text-xl font-semibold text-[#162338]">{payroll.payrollMonthLabel}</h3>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Updated by{" "}
            <span className="font-semibold text-[#162338]">
              {profile?.salaryUpdatedByName?.trim() || "Human Resource"}
            </span>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DetailRow label="Monthly salary" value={formatCurrency(payroll.monthlySalary)} />
          <DetailRow label="Daily wage" value={formatCurrency(payroll.dailyWage)} />
          <DetailRow label="Attendance days" value={`${payroll.attendanceDays} day(s)`} />
          <DetailRow label="Absence days" value={`${payroll.absenceDays} day(s)`} />
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DetailRow label="Lateness count" value={`${payroll.lateCount} time(s)`} />
          <DetailRow label="Absence deduction" value={formatCurrency(payroll.absenceDeduction)} />
          <DetailRow label="Lateness deduction" value={formatCurrency(payroll.latenessDeduction)} />
          <DetailRow label="Net salary" value={formatCurrency(payroll.netSalary)} />
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-600">
          <p className="font-semibold text-[#162338]">Salary breakdown and deductibles</p>
          <div className="mt-3 space-y-2">
            <p>Gross salary: {formatCurrency(payroll.monthlySalary)}</p>
            <p>Absence deduction: {formatCurrency(payroll.absenceDeduction)}</p>
            <p>Lateness deduction: {formatCurrency(payroll.latenessDeduction)}</p>
            <p>Total deductions: {formatCurrency(payroll.totalDeductions)}</p>
            <p className="font-semibold text-[#162338]">Net salary: {formatCurrency(payroll.netSalary)}</p>
            <p>Surcharges: {profile?.surcharges?.trim() || "None"}</p>
          </div>
          {profile?.salaryUpdatedAt ? (
            <p className="mt-3 text-xs text-slate-500">
              Last updated{" "}
              {formatFriendlyDate(new Date(profile.salaryUpdatedAt), {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DetailRow label="Phone number" value={profile?.phoneNumber?.trim() || "Not set"} />
        <DetailRow label="Home address" value={profile?.homeAddress?.trim() || "Not set"} />
        <DetailRow label="Surcharges" value={profile?.surcharges?.trim() || "None"} />
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4">
          <p className="metric-label">My shifts</p>
          <div className="mt-3 space-y-3">
            {myShifts.length > 0 ? (
              myShifts.map((shift) => (
                <div
                  key={shift.id}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-[#162338]"
                >
                  {formatShiftDate(shift.shiftDate)}
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
                No shifts assigned.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
