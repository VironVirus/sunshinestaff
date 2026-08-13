import {
  cookingGasOptions,
  nightDutyOutletConfig,
} from "@/data/nightDuty";
import { roomGroups } from "@/data/hotelRooms";

function asFiniteNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function averageRecorded(values) {
  const recorded = values.map(asFiniteNumber).filter((value) => value !== null);

  return {
    average: recorded.length > 0 ? sum(recorded) / recorded.length : null,
    recordedDays: recorded.length,
  };
}

function durationToMinutes(hours, minutes) {
  return Math.max(Math.trunc(Number(hours) || 0), 0) * 60 +
    Math.min(Math.max(Math.trunc(Number(minutes) || 0), 0), 59);
}

function aggregateNamedDurations(reports, fieldName, hourKey, minuteKey) {
  const entriesByName = new Map();

  reports.forEach((report) => {
    (report[fieldName] ?? []).forEach((entry) => {
      const name = String(entry?.name ?? "").trim();
      if (!name) return;
      const key = name.toLocaleLowerCase("en-US");
      const current = entriesByName.get(key) ?? { name, totalMinutes: 0, entries: 0 };
      current.totalMinutes += durationToMinutes(entry?.[hourKey], entry?.[minuteKey]);
      current.entries += 1;
      entriesByName.set(key, current);
    });
  });

  return [...entriesByName.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function buildNightDutyRangeAnalytics(reports = [], expectedDateKeys = []) {
  const orderedReports = [...reports].sort((left, right) =>
    String(left.operationalDateKey ?? "").localeCompare(
      String(right.operationalDateKey ?? ""),
    ),
  );
  const reportDateKeys = new Set(
    orderedReports.map((report) => report.operationalDateKey).filter(Boolean),
  );
  const missingDateKeys = expectedDateKeys.filter((dateKey) => !reportDateKeys.has(dateKey));
  const occupancyTotals = orderedReports.map((report) => Number(report.occupancyTotal) || 0);
  const totalInHouse = sum(occupancyTotals);

  const occupancyByFloor = roomGroups.map((group) => {
    const dailyValues = orderedReports.map((report) => Number(
      report.occupancyByFloor?.find((floor) => floor.floorKey === group.key)?.occupiedRooms,
    ) || 0);

    return {
      floorKey: group.key,
      floorLabel: group.label,
      totalOccupants: sum(dailyValues),
      averageOccupants: dailyValues.length > 0 ? sum(dailyValues) / dailyValues.length : 0,
      highestOccupancy: dailyValues.length > 0 ? Math.max(...dailyValues) : 0,
    };
  });

  const incomeByOutlet = nightDutyOutletConfig.map((outlet) => {
    const fields = outlet.fields.map((field) => ({
      ...field,
      total: sum(orderedReports.map((report) =>
        report.income?.[outlet.key]?.[field.key],
      )),
    }));

    return {
      key: outlet.key,
      label: outlet.label,
      fields,
      grandRevenueTotal: sum(orderedReports.map((report) =>
        report.incomeSections?.find((section) => section.key === outlet.key)
          ?.grandRevenueTotal,
      )),
      actualRevenueTotal: sum(orderedReports.map((report) =>
        report.incomeSections?.find((section) => section.key === outlet.key)
          ?.actualRevenueTotal,
      )),
    };
  });

  const dailyIncome = orderedReports.map((report) => ({
    operationalDateKey: report.operationalDateKey,
    outlets: Object.fromEntries(nightDutyOutletConfig.map((outlet) => [
      outlet.key,
      Number(report.incomeSections?.find((section) => section.key === outlet.key)
        ?.grandRevenueTotal) || 0,
    ])),
    grandRevenueTotal: Number(report.grandIncomeTotal) || 0,
    actualRevenueTotal: Number(report.actualRevenueTotal) || 0,
  }));

  const departmentalNotes = orderedReports.flatMap((report) =>
    (report.groupedStaff ?? [])
      .filter((department) => String(department.note ?? "").trim())
      .map((department) => ({
        operationalDateKey: report.operationalDateKey,
        departmentKey: department.value,
        departmentLabel: department.label,
        note: department.note.trim(),
      })),
  );

  const gasAverages = cookingGasOptions.map((gas) => ({
    ...gas,
    ...averageRecorded(orderedReports.map((report) => report.gasLevels?.[gas.value])),
  }));
  const hotWater = averageRecorded(
    orderedReports.map((report) => report.hotWaterTemperature),
  );

  return {
    reportCount: orderedReports.length,
    selectedDayCount: expectedDateKeys.length,
    missingDateKeys,
    totalInHouse,
    averageOccupancy: orderedReports.length > 0
      ? totalInHouse / orderedReports.length
      : 0,
    highestOccupancy: occupancyTotals.length > 0 ? Math.max(...occupancyTotals) : 0,
    lowestOccupancy: occupancyTotals.length > 0 ? Math.min(...occupancyTotals) : 0,
    occupancyByFloor,
    incomeByOutlet,
    dailyIncome,
    grandRevenueTotal: sum(orderedReports.map((report) => report.grandIncomeTotal)),
    actualRevenueTotal: sum(orderedReports.map((report) => report.actualRevenueTotal)),
    departmentalNotes,
    gasAverages,
    averageHotWaterTemperature: hotWater.average,
    hotWaterRecordedDays: hotWater.recordedDays,
    totalWaterSupplied: sum(orderedReports.map((report) => report.waterSupplyCount)),
    generatorServiceTotals: aggregateNamedDurations(
      orderedReports,
      "generatorServices",
      "serviceHours",
      "serviceMinutes",
    ),
    powerSupplyTotals: aggregateNamedDurations(
      orderedReports,
      "powerSupplies",
      "durationHours",
      "durationMinutes",
    ),
    guestIncidentDays: orderedReports.filter((report) => report.guestIncident?.hasIncident).length,
    employeeIncidentDays: orderedReports.filter((report) => report.employeeIncident?.hasIncident).length,
    totalEvents: sum(orderedReports.map((report) => report.eventsSnapshot?.length)),
    totalComplaints: sum(orderedReports.map((report) => report.complaintsSnapshot?.length)),
    totalBrunchAttendees: sum(orderedReports.map((report) =>
      report.income?.restaurant?.brunchAttendees,
    )),
  };
}
