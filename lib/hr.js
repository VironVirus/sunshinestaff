import {
  addDaysToDateKey,
  compareDateKeys,
  formatDateKey,
  getDaysBetweenDateKeys,
  getHotelDateKey,
  parseDateKey,
} from "@/lib/hotelTime";

export const ANNUAL_LEAVE_DAYS = 21;
export const QUARTERLY_LEAVE_DAYS = 7;
export const LEAVE_RETURN_HOUR = 8;
const LEAVE_QUARTERS = [1, 2, 3];

function coerceDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value?.toDate === "function") {
    return value.toDate();
  }

  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return parseDateKey(value);
    }

    const parsed = new Date(value);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  if (typeof value === "number") {
    const parsed = new Date(value);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function toDateKey(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = coerceDate(value);
  return date ? date.toISOString().slice(0, 10) : "";
}

function toMonthKey(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string" && /^\d{4}-\d{2}$/.test(value)) {
    return value;
  }

  const date = coerceDate(value);
  return date ? date.toISOString().slice(0, 7) : "";
}

function toNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function getReturnDateTime(returnDateKey) {
  if (!returnDateKey) {
    return null;
  }

  const returnDate = new Date(`${returnDateKey}T${String(LEAVE_RETURN_HOUR).padStart(2, "0")}:00:00+01:00`);
  return Number.isNaN(returnDate.getTime()) ? null : returnDate;
}

function getDaysInMonth(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(monthKey ?? "")) {
    return 30;
  }

  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

export function getQuarterNumberFromDateKey(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey ?? "")) {
    return 0;
  }

  const month = Number(dateKey.slice(5, 7));
  return Math.ceil(month / 3);
}

export function getQuarterLabelFromDateKey(dateKey) {
  const quarterNumber = getQuarterNumberFromDateKey(dateKey);
  return quarterNumber > 0 ? `Q${quarterNumber}` : "";
}

export function normalizeLeaveRecords(records = []) {
  return records
    .filter((record) => record?.id && record?.startDate)
    .map((record) => {
      const days = Math.max(toNumber(record.days) || QUARTERLY_LEAVE_DAYS, 1);
      const quarter = record.quarter || getQuarterNumberFromDateKey(record.startDate);
      const year = record.year || Number(record.startDate.slice(0, 4));

      return {
        ...record,
        days,
        quarter,
        year,
        endDate: record.endDate || addDaysToDateKey(record.startDate, days - 1),
        returnDate: record.returnDate || addDaysToDateKey(record.startDate, days),
        quarterKey: record.quarterKey || `${year}-Q${quarter}`,
      };
    })
    .sort((left, right) => {
      const startComparison = compareDateKeys(right.startDate, left.startDate);

      if (startComparison !== 0) {
        return startComparison;
      }

      return String(right.grantedAt ?? "").localeCompare(String(left.grantedAt ?? ""));
    });
}

export function getEmploymentStartDateKey(profile = null) {
  const safeProfile = profile ?? {};

  return (
    safeProfile.employmentStartDate ||
    toDateKey(safeProfile.createdAt) ||
    toDateKey(safeProfile.updatedAt) ||
    ""
  );
}

export function buildLeaveGrant({
  startDateKey,
  actorName = "",
  actorUid = "",
  days = QUARTERLY_LEAVE_DAYS,
}) {
  const quarter = getQuarterNumberFromDateKey(startDateKey);

  if (!startDateKey) {
    throw new Error("Select a leave start date first.");
  }

  if (quarter < 1 || quarter > 3) {
    throw new Error("Leave can only be granted in the first three quarters of the year.");
  }

  const safeDays = Math.max(toNumber(days) || QUARTERLY_LEAVE_DAYS, 1);
  const year = Number(startDateKey.slice(0, 4));

  return {
    id: `leave-${Date.now()}`,
    startDate: startDateKey,
    endDate: addDaysToDateKey(startDateKey, safeDays - 1),
    returnDate: addDaysToDateKey(startDateKey, safeDays),
    days: safeDays,
    quarter,
    year,
    quarterKey: `${year}-Q${quarter}`,
    grantedAt: new Date().toISOString(),
    grantedByName: actorName,
    grantedByUid: actorUid,
  };
}

export function getLeaveEligibilityDetails(profile = null, now = new Date()) {
  const safeProfile = profile ?? {};
  const todayKey = getHotelDateKey(now);
  const employmentStartDateKey = getEmploymentStartDateKey(safeProfile);
  const eligibilityDateKey = employmentStartDateKey
    ? addDaysToDateKey(employmentStartDateKey, 365)
    : "";
  const eligible =
    Boolean(eligibilityDateKey) && compareDateKeys(todayKey, eligibilityDateKey) >= 0;
  const leaveRecords = normalizeLeaveRecords(safeProfile.leaveRecords ?? []);
  const currentYear = Number(todayKey.slice(0, 4));
  const currentQuarter = getQuarterNumberFromDateKey(todayKey);
  const currentYearRecords = leaveRecords.filter((record) => record.year === currentYear);
  const usedQuarterNumbers = new Set(currentYearRecords.map((record) => record.quarter));
  const grantedDaysThisYear = currentYearRecords.reduce(
    (total, record) => total + (record.days ?? QUARTERLY_LEAVE_DAYS),
    0,
  );
  const remainingAnnualDays = Math.max(ANNUAL_LEAVE_DAYS - grantedDaysThisYear, 0);
  const availableQuarterNumbers = eligible
    ? LEAVE_QUARTERS.filter(
        (quarterNumber) =>
          quarterNumber <= Math.min(currentQuarter, 3) &&
          !usedQuarterNumbers.has(quarterNumber),
      )
    : [];
  const openLeaveRecord =
    leaveRecords.find((record) => !record.returnedAt && !record.returnedDateKey) ?? null;
  const returnAt = openLeaveRecord ? getReturnDateTime(openLeaveRecord.returnDate) : null;

  let status = "not_set";

  if (!employmentStartDateKey) {
    status = "not_set";
  } else if (openLeaveRecord) {
    if (compareDateKeys(todayKey, openLeaveRecord.startDate) < 0) {
      status = "scheduled";
    } else if (returnAt && returnAt.getTime() > now.getTime()) {
      status = "on_leave";
    } else {
      status = "overstayed";
    }
  } else if (!eligible) {
    status = "not_eligible";
  } else if (availableQuarterNumbers.length > 0) {
    status = "eligible";
  } else if (currentQuarter === 4) {
    status = "year_complete";
  } else {
    status = "quarter_used";
  }

  const millisecondsUntilReturn = returnAt ? returnAt.getTime() - now.getTime() : 0;
  const millisecondsOverdue = returnAt ? now.getTime() - returnAt.getTime() : 0;

  return {
    employmentStartDateKey,
    eligibilityDateKey,
    eligible,
    daysUntilEligible:
      eligible || !eligibilityDateKey
        ? 0
        : Math.max(getDaysBetweenDateKeys(todayKey, eligibilityDateKey), 0),
    currentQuarter,
    availableQuarterNumbers,
    nextAvailableQuarterLabel: availableQuarterNumbers[0]
      ? `Q${availableQuarterNumbers[0]} ${currentYear}`
      : "",
    leaveRecords,
    currentYearRecords,
    grantedDaysThisYear,
    remainingAnnualDays,
    openLeaveRecord,
    returnAt,
    status,
    daysRemaining:
      status === "on_leave" && returnAt
        ? Math.max(Math.ceil(millisecondsUntilReturn / 86400000), 0)
        : 0,
    hoursUntilReturn:
      status === "on_leave" && returnAt
        ? Math.max(Math.ceil(millisecondsUntilReturn / 3600000), 0)
        : 0,
    overdueDays:
      status === "overstayed" && returnAt
        ? Math.max(Math.floor(millisecondsOverdue / 86400000), 0)
        : 0,
    overdueHours:
      status === "overstayed" && returnAt
        ? Math.max(Math.floor(millisecondsOverdue / 3600000), 0)
        : 0,
  };
}

export function getLeaveDashboardSummary(profile = null, now = new Date()) {
  const leaveDetails = getLeaveEligibilityDetails(profile, now);

  switch (leaveDetails.status) {
    case "scheduled":
      return `Scheduled from ${formatDateKey(leaveDetails.openLeaveRecord?.startDate)}`;
    case "on_leave":
      return `${leaveDetails.daysRemaining} day(s) left`;
    case "overstayed":
      return `Overstayed by ${leaveDetails.overdueDays} day(s)`;
    case "eligible":
      return `${leaveDetails.remainingAnnualDays} day(s) available`;
    case "quarter_used":
      return "Current quarter already used";
    case "year_complete":
      return "Annual leave complete";
    case "not_eligible":
      return leaveDetails.eligibilityDateKey
        ? `Eligible from ${formatDateKey(leaveDetails.eligibilityDateKey)}`
        : "Not yet eligible";
    default:
      return "Employment start date needed";
  }
}

export function formatLeaveRecordLabel(record) {
  if (!record) {
    return "No leave record";
  }

  return `${formatDateKey(record.startDate)} to ${formatDateKey(record.endDate)} (return ${formatDateKey(record.returnDate)})`;
}

export function formatCurrency(value) {
  return `N${toNumber(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function getPayrollMonthLabel(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(monthKey ?? "")) {
    return "Not set";
  }

  const date = new Date(`${monthKey}-01T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return monthKey;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(date);
}

export function buildPayrollBreakdown(profile = null, now = new Date()) {
  const safeProfile = profile ?? {};
  const payrollMonthKey =
    toMonthKey(safeProfile.payrollMonthKey) || getHotelDateKey(now).slice(0, 7);
  const monthlySalary = Math.max(toNumber(safeProfile.monthlySalary), 0);
  const absenceDays = Math.max(toNumber(safeProfile.absenceDays), 0);
  const lateCount = Math.max(toNumber(safeProfile.lateCount), 0);
  const pensionAmount = Math.max(toNumber(safeProfile.pensionAmount), 0);
  const taxAmount = Math.max(toNumber(safeProfile.taxAmount), 0);
  const daysInMonth = getDaysInMonth(payrollMonthKey);
  const dailyWage = monthlySalary / 30;
  const absenceDeduction = dailyWage * absenceDays;
  const latenessDeduction = lateCount * 1000;
  const totalDeductions =
    absenceDeduction + latenessDeduction + pensionAmount + taxAmount;
  const netSalary = monthlySalary - totalDeductions;

  return {
    payrollMonthKey,
    payrollMonthLabel: getPayrollMonthLabel(payrollMonthKey),
    monthlySalary,
    daysInMonth,
    attendanceDays: Math.max(daysInMonth - absenceDays, 0),
    absenceDays,
    lateCount,
    dailyWage,
    absenceDeduction,
    latenessDeduction,
    pensionAmount,
    taxAmount,
    totalDeductions,
    netSalary,
    salaryUpdatedAt: safeProfile.salaryUpdatedAt ?? "",
    salaryUpdatedByName: safeProfile.salaryUpdatedByName ?? "",
  };
}
