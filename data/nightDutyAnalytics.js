import {
  cookingGasOptions,
  getGuestRefundTotal,
  nightDutyOutletConfig,
} from "@/data/nightDuty";
import {
  guestRoomGroups,
  guestRoomCount,
  normalizeRoomNumbers,
} from "@/data/hotelRooms";

const TARGET_OCCUPANCY_PERCENTAGE = 60;
export const BRUNCH_ATTENDANCE_TARGET = 60;

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

function getDaysInMonth(monthKey) {
  const [year, month] = String(monthKey ?? "").split("-").map(Number);
  return year > 0 && month >= 1 && month <= 12
    ? new Date(Date.UTC(year, month, 0)).getUTCDate()
    : 0;
}

function getWeekStartDateKey(dateKey) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  const daysFromMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysFromMonday);
  return date.toISOString().slice(0, 10);
}

function safePercentage(actual, target) {
  return Number(target) > 0 ? (Number(actual || 0) / Number(target)) * 100 : null;
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

function getFrontOfficeGuestMix(report = {}) {
  const floors = Array.isArray(report.frontOfficeOccupancyByFloor)
    ? report.frontOfficeOccupancyByFloor
    : [];
  const recordedFloors = floors.filter((floor) =>
    Object.prototype.hasOwnProperty.call(floor ?? {}, "walkInGuests") &&
    Object.prototype.hasOwnProperty.call(floor ?? {}, "corporateGuests"),
  );

  if (recordedFloors.length !== guestRoomGroups.length) return null;

  const walkInGuests = sum(recordedFloors.map((floor) => floor.walkInGuests));
  const corporateGuests = sum(recordedFloors.map((floor) => floor.corporateGuests));

  return {
    walkInGuests,
    corporateGuests,
    totalGuests: walkInGuests + corporateGuests,
  };
}

export function buildNightDutyRangeAnalytics(
  reports = [],
  expectedDateKeys = [],
  monthlyTargets = {},
) {
  const orderedReports = [...reports].sort((left, right) =>
    String(left.operationalDateKey ?? "").localeCompare(
      String(right.operationalDateKey ?? ""),
    ),
  );
  const reportDateKeys = new Set(
    orderedReports.map((report) => report.operationalDateKey).filter(Boolean),
  );
  const missingDateKeys = expectedDateKeys.filter((dateKey) => !reportDateKeys.has(dateKey));
  const embeddedFrontOfficeReports = Array.isArray(orderedReports[0]?.rangeOccupancyReports)
    ? orderedReports[0].rangeOccupancyReports
    : [];
  const allFrontOfficeOccupancyReports = (embeddedFrontOfficeReports.length > 0
    ? embeddedFrontOfficeReports
    : orderedReports.filter(
        (report) =>
          report.frontOfficeOccupancyReport?.hasReport === true &&
          report.frontOfficeOccupancyReport?.occupancySource !== "night_duty",
      )
  ).sort((left, right) => String(left.operationalDateKey ?? "").localeCompare(
    String(right.operationalDateKey ?? ""),
  ));
  const expectedDateSet = new Set(expectedDateKeys);
  const frontOfficeOccupancyReports = allFrontOfficeOccupancyReports.filter((report) =>
    expectedDateSet.size === 0 || expectedDateSet.has(report.operationalDateKey),
  );
  const frontOfficeOccupancyByDate = new Map(
    frontOfficeOccupancyReports.map((report) => [report.operationalDateKey, {
      ...report,
      occupancySource: "front_office",
    }]),
  );
  const nightDutyFallbackReports = orderedReports
    .filter((report) => !frontOfficeOccupancyByDate.has(report.operationalDateKey))
    .map((report) => ({
      operationalDateKey: report.operationalDateKey,
      occupancySource: "night_duty",
      frontOfficeOccupancyByFloor: report.occupancyByFloor,
      frontOfficeOccupancyReport: {
        hasReport: true,
        inHouse: Number(report.occupancyTotal) || 0,
        outOfOrderRoomNumbers: normalizeRoomNumbers(
          report.frontOfficeOccupancyReport?.outOfOrderRoomNumbers ??
            report.outOfOrderRoomNumbers,
        ),
      },
    }));
  const occupancyReports = [
    ...frontOfficeOccupancyByDate.values(),
    ...nightDutyFallbackReports,
  ].sort((left, right) => String(left.operationalDateKey ?? "").localeCompare(
    String(right.operationalDateKey ?? ""),
  ));
  const occupancyReportDateKeys = new Set(
    occupancyReports.map((report) => report.operationalDateKey).filter(Boolean),
  );
  const missingOccupancyDateKeys = expectedDateKeys.filter(
    (dateKey) => !occupancyReportDateKeys.has(dateKey),
  );
  const outOfOrderTimelineByDate = new Map();
  [...allFrontOfficeOccupancyReports, ...orderedReports].forEach((report) => {
    const dateKey = report?.operationalDateKey;
    const rawRooms = report?.frontOfficeOccupancyReport?.outOfOrderRoomNumbers ??
      report?.outOfOrderRoomNumbers;
    if (!dateKey || !Array.isArray(rawRooms)) return;
    outOfOrderTimelineByDate.set(dateKey, normalizeRoomNumbers(rawRooms));
  });
  const outOfOrderTimeline = [...outOfOrderTimelineByDate.entries()]
    .map(([operationalDateKey, roomNumbers]) => ({ operationalDateKey, roomNumbers }))
    .sort((left, right) => left.operationalDateKey.localeCompare(right.operationalDateKey));
  const getOutOfOrderPosition = (dateKey) => [...outOfOrderTimeline]
    .reverse()
    .find((entry) => entry.operationalDateKey <= dateKey) ?? null;
  const rangeEndDateKey = expectedDateKeys.at(-1) ?? occupancyReports.at(-1)?.operationalDateKey ?? "";
  const latestOutOfOrderPosition = getOutOfOrderPosition(rangeEndDateKey);
  const latestOutOfOrderRoomNumbers = latestOutOfOrderPosition?.roomNumbers ?? [];
  const latestOutOfOrderDateKey = latestOutOfOrderPosition?.operationalDateKey ?? "";
  const latestOutOfOrderRooms = latestOutOfOrderRoomNumbers.length;
  const rangeAvailableRooms = Math.max(
    guestRoomCount - latestOutOfOrderRooms,
    0,
  );
  const targetOccupiedRooms = Math.ceil(
    rangeAvailableRooms * (TARGET_OCCUPANCY_PERCENTAGE / 100),
  );
  const dailyOccupancy = occupancyReports.map((report) => {
    const snapshot = report.frontOfficeOccupancyReport;
    const effectiveOutOfOrder = getOutOfOrderPosition(report.operationalDateKey);
    const outOfOrderRoomNumbers = effectiveOutOfOrder?.roomNumbers ?? [];
    const outOfOrderRooms = outOfOrderRoomNumbers.length;
    const availableRooms = Math.max(guestRoomCount - outOfOrderRooms, 0);
    const dailyTargetOccupiedRooms = Math.ceil(
      availableRooms * (TARGET_OCCUPANCY_PERCENTAGE / 100),
    );
    const occupiedRooms = Math.min(
      Math.max(Number(snapshot.inHouse) || 0, 0),
      availableRooms,
    );

    return {
      operationalDateKey: report.operationalDateKey,
      occupancySource: report.occupancySource ?? "front_office",
      occupiedRooms,
      outOfOrderRoomNumbers,
      outOfOrderRooms,
      outOfOrderEffectiveDateKey: effectiveOutOfOrder?.operationalDateKey ?? "",
      availableRooms,
      targetOccupancyPercentage: TARGET_OCCUPANCY_PERCENTAGE,
      targetOccupiedRooms: dailyTargetOccupiedRooms,
      targetVarianceRooms: occupiedRooms - dailyTargetOccupiedRooms,
      occupancyPercentage: availableRooms > 0
        ? (occupiedRooms / availableRooms) * 100
        : 0,
    };
  });
  const occupancyTotals = dailyOccupancy.map((day) => day.occupiedRooms);
  const totalInHouse = sum(occupancyTotals);

  const occupancyByFloor = guestRoomGroups.map((group) => {
    const dailyValues = occupancyReports.map((report) => Number(
      report.frontOfficeOccupancyByFloor?.find((floor) => floor.floorKey === group.key)?.occupiedRooms,
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
    roomRevenue: Number(report.income?.frontOffice?.roomRevenue) || 0,
  }));
  const revenueSourceDefinitions = nightDutyOutletConfig.flatMap((outlet) =>
    outlet.fields
      .filter((field) =>
        !field.nonFinancial &&
        !field.separateAccount &&
        field.key !== "brunchRevenue",
      )
      .map((field) => ({
        sourceKey: `${outlet.key}.${field.key}`,
        outletKey: outlet.key,
        outletLabel: outlet.label,
        fieldKey: field.key,
        fieldLabel: field.label,
        treatment: field.excludeFromRevenue ? "Grand Revenue only" : "Actual Revenue",
      })),
  );
  const revenueSources = revenueSourceDefinitions.map((source) => ({
    ...source,
    total: sum(orderedReports.map((report) =>
      report.income?.[source.outletKey]?.[source.fieldKey],
    )),
  }));
  const dailyRevenueSources = orderedReports.map((report) => ({
    operationalDateKey: report.operationalDateKey,
    values: Object.fromEntries(revenueSourceDefinitions.map((source) => [
      source.sourceKey,
      Number(report.income?.[source.outletKey]?.[source.fieldKey]) || 0,
    ])),
  }));
  const dailyFoodBeverage = orderedReports.map((report) => {
    const food = sum(nightDutyOutletConfig.map((outlet) =>
      report.income?.[outlet.key]?.food,
    ));
    const beverage = sum(nightDutyOutletConfig.map((outlet) =>
      report.income?.[outlet.key]?.beverage,
    ));

    return {
      operationalDateKey: report.operationalDateKey,
      food,
      beverage,
      combined: food + beverage,
    };
  });
  const foodBeverageTotals = {
    food: sum(dailyFoodBeverage.map((day) => day.food)),
    beverage: sum(dailyFoodBeverage.map((day) => day.beverage)),
    combined: sum(dailyFoodBeverage.map((day) => day.combined)),
  };
  const foodBeverageReportedDays = dailyFoodBeverage.filter((day) => day.combined > 0);
  const bestFoodBeverageDay = [...foodBeverageReportedDays]
    .sort((left, right) => right.combined - left.combined)[0] ?? null;
  const dailyBrunch = orderedReports
    .map((report) => ({
      operationalDateKey: report.operationalDateKey,
      revenue: Number(report.income?.restaurant?.brunchRevenue) || 0,
      attendees: Number(report.income?.restaurant?.brunchAttendees) || 0,
    }))
    .filter((day) => day.revenue > 0 || day.attendees > 0)
    .map((day) => ({
      ...day,
      targetAttendees: BRUNCH_ATTENDANCE_TARGET,
      attendeeVariance: day.attendees - BRUNCH_ATTENDANCE_TARGET,
      targetReached: day.attendees >= BRUNCH_ATTENDANCE_TARGET,
    }));
  const totalBrunchAttendees = sum(dailyBrunch.map((day) => day.attendees));
  const brunchTargetAttendees = BRUNCH_ATTENDANCE_TARGET * dailyBrunch.length;
  const dailyGuestRefunds = orderedReports
    .map((report) => ({
      operationalDateKey: report.operationalDateKey,
      amount: getGuestRefundTotal(report.income),
    }))
    .filter((day) => day.amount > 0);
  const dailyOccupancyGuestMix = occupancyReports.flatMap((report) => {
    const guestMix = getFrontOfficeGuestMix(report);

    return guestMix
      ? [{ operationalDateKey: report.operationalDateKey, ...guestMix }]
      : [];
  });
  const totalWalkInGuests = sum(dailyOccupancyGuestMix.map((day) => day.walkInGuests));
  const totalCorporateGuests = sum(dailyOccupancyGuestMix.map((day) => day.corporateGuests));
  const totalCategorizedGuests = totalWalkInGuests + totalCorporateGuests;

  const latestGeneratorReport = [...orderedReports].reverse().find(
    (report) => Array.isArray(report.generatorServices) && report.generatorServices.length > 0,
  );
  const latestGeneratorServiceReading = latestGeneratorReport
    ? {
        operationalDateKey: latestGeneratorReport.operationalDateKey,
        entries: latestGeneratorReport.generatorServices.map((entry) => ({
          name: String(entry?.name ?? "Generator").trim() || "Generator",
          serviceHours: Math.max(Math.trunc(Number(entry?.serviceHours) || 0), 0),
          serviceMinutes: Math.min(
            Math.max(Math.trunc(Number(entry?.serviceMinutes) || 0), 0),
            59,
          ),
        })),
      }
    : null;

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

  const grandRevenueTotal = sum(orderedReports.map((report) => report.grandIncomeTotal));
  const actualRevenueTotal = sum(orderedReports.map((report) => report.actualRevenueTotal));
  const incomeByOutletWithShare = incomeByOutlet.map((outlet) => ({
    ...outlet,
    revenueSharePercentage: grandRevenueTotal > 0
      ? (outlet.grandRevenueTotal / grandRevenueTotal) * 100
      : 0,
  }));

  const fnbOutletKeys = new Set(["kennysBar", "tropicsBar", "restaurant"]);
  const dailyDepartmentRevenue = orderedReports.map((report) => {
    const frontOfficeRevenue = Number(
      report.incomeSections?.find((section) => section.key === "frontOffice")
        ?.actualRevenueTotal,
    ) || 0;
    const foodBeverageRevenue = sum(
      (report.incomeSections ?? [])
        .filter((section) => fnbOutletKeys.has(section.key))
        .map((section) => section.actualRevenueTotal),
    );
    return {
      operationalDateKey: report.operationalDateKey,
      frontOfficeRevenue,
      foodBeverageRevenue,
    };
  });

  const reportsByDate = new Map(
    orderedReports.map((report) => [report.operationalDateKey, report]),
  );
  const targetDateKeys = expectedDateKeys.length > 0
    ? expectedDateKeys
    : orderedReports.map((report) => report.operationalDateKey);
  const dailyTargetAnalysis = targetDateKeys.map((dateKey) => {
    const report = reportsByDate.get(dateKey);
    const monthKey = dateKey.slice(0, 7);
    const target = monthlyTargets?.[monthKey] ?? {};
    const daysInMonth = getDaysInMonth(monthKey);
    const roomTarget = daysInMonth > 0
      ? (Number(target.roomRevenueTarget) || 0) / daysInMonth
      : 0;
    const foodBeverageTarget = daysInMonth > 0
      ? (Number(target.foodBeverageRevenueTarget) || 0) / daysInMonth
      : 0;
    const roomActual = Number(report?.income?.frontOffice?.roomRevenue) || 0;
    const departmentRevenue = dailyDepartmentRevenue.find(
      (day) => day.operationalDateKey === dateKey,
    );
    const foodBeverageActual = departmentRevenue?.foodBeverageRevenue ?? 0;
    return {
      operationalDateKey: dateKey,
      roomActual,
      roomTarget,
      roomVariance: roomActual - roomTarget,
      roomAttainmentPercentage: safePercentage(roomActual, roomTarget),
      foodBeverageActual,
      foodBeverageTarget,
      foodBeverageVariance: foodBeverageActual - foodBeverageTarget,
      foodBeverageAttainmentPercentage: safePercentage(
        foodBeverageActual,
        foodBeverageTarget,
      ),
    };
  });
  const aggregateTargets = (entries) => ({
    roomActual: sum(entries.map((entry) => entry.roomActual)),
    roomTarget: sum(entries.map((entry) => entry.roomTarget)),
    foodBeverageActual: sum(entries.map((entry) => entry.foodBeverageActual)),
    foodBeverageTarget: sum(entries.map((entry) => entry.foodBeverageTarget)),
  });
  const buildTargetPosition = (key, entries) => {
    const totals = aggregateTargets(entries);
    return {
      key,
      ...totals,
      roomVariance: totals.roomActual - totals.roomTarget,
      roomAttainmentPercentage: safePercentage(totals.roomActual, totals.roomTarget),
      foodBeverageVariance: totals.foodBeverageActual - totals.foodBeverageTarget,
      foodBeverageAttainmentPercentage: safePercentage(
        totals.foodBeverageActual,
        totals.foodBeverageTarget,
      ),
    };
  };
  const weeklyTargetGroups = new Map();
  const monthlyTargetGroups = new Map();
  dailyTargetAnalysis.forEach((entry) => {
    const weekKey = getWeekStartDateKey(entry.operationalDateKey);
    weeklyTargetGroups.set(weekKey, [...(weeklyTargetGroups.get(weekKey) ?? []), entry]);
    const monthKey = entry.operationalDateKey.slice(0, 7);
    monthlyTargetGroups.set(monthKey, [...(monthlyTargetGroups.get(monthKey) ?? []), entry]);
  });
  const weeklyTargetAnalysis = [...weeklyTargetGroups.entries()].map(([key, entries]) =>
    buildTargetPosition(key, entries),
  );
  const monthlyTargetAnalysis = [...monthlyTargetGroups.entries()].map(([key, entries]) =>
    buildTargetPosition(key, entries),
  );
  const selectedPeriodTargetAnalysis = buildTargetPosition("selected-period", dailyTargetAnalysis);
  const latestMonthKey = (expectedDateKeys.at(-1) ??
    orderedReports.at(-1)?.operationalDateKey ?? "").slice(0, 7);
  const monthToDateTargetAnalysis = monthlyTargetAnalysis.find(
    (entry) => entry.key === latestMonthKey,
  ) ?? buildTargetPosition(latestMonthKey, []);

  const totalAvailableRoomNights = sum(dailyOccupancy.map((day) => day.availableRooms));
  const roomRevenueTotal = sum(dailyIncome.map((day) => day.roomRevenue));
  const hospitalityAccounting = {
    averageDailyRoomRate: totalInHouse > 0 ? roomRevenueTotal / totalInHouse : 0,
    revPar: totalAvailableRoomNights > 0 ? roomRevenueTotal / totalAvailableRoomNights : 0,
    trevPar: totalAvailableRoomNights > 0 ? actualRevenueTotal / totalAvailableRoomNights : 0,
    foodBeverageRevenuePerOccupiedRoom:
      totalInHouse > 0 ? foodBeverageTotals.combined / totalInHouse : 0,
    averageDailyActualRevenue:
      orderedReports.length > 0 ? actualRevenueTotal / orderedReports.length : 0,
    roomRevenueSharePercentage:
      actualRevenueTotal > 0 ? (roomRevenueTotal / actualRevenueTotal) * 100 : 0,
    foodBeverageRevenueSharePercentage:
      actualRevenueTotal > 0
        ? (sum(dailyDepartmentRevenue.map((day) => day.foodBeverageRevenue)) /
          actualRevenueTotal) * 100
        : 0,
    reportCoveragePercentage:
      expectedDateKeys.length > 0 ? (orderedReports.length / expectedDateKeys.length) * 100 : 0,
    occupiedRoomNights: totalInHouse,
  };

  return {
    reportCount: orderedReports.length,
    selectedDayCount: expectedDateKeys.length,
    missingDateKeys,
    occupancyReportCount: occupancyReports.length,
    frontOfficeOccupancyReportCount: frontOfficeOccupancyReports.length,
    nightDutyFallbackCount: nightDutyFallbackReports.length,
    missingOccupancyDateKeys,
    totalInHouse,
    hotelRoomCapacity: guestRoomCount,
    latestOutOfOrderDateKey,
    latestOutOfOrderRoomNumbers,
    latestOutOfOrderRooms,
    rangeAvailableRooms,
    targetOccupancyPercentage: TARGET_OCCUPANCY_PERCENTAGE,
    targetOccupiedRooms,
    targetOccupiedRoomNights: sum(dailyOccupancy.map((day) => day.targetOccupiedRooms)),
    occupancyTargetVarianceRoomNights:
      totalInHouse - sum(dailyOccupancy.map((day) => day.targetOccupiedRooms)),
    unavailableRoomNights: sum(expectedDateKeys.map(
      (dateKey) => getOutOfOrderPosition(dateKey)?.roomNumbers?.length ?? 0,
    )),
    totalInventoryRoomNights: guestRoomCount * expectedDateKeys.length,
    availableRoomNights: sum(expectedDateKeys.map((dateKey) =>
      Math.max(guestRoomCount - (getOutOfOrderPosition(dateKey)?.roomNumbers?.length ?? 0), 0),
    )),
    dailyOccupancy,
    averageOccupancy: occupancyReports.length > 0
      ? totalInHouse / occupancyReports.length
      : 0,
    averageOccupancyPercentage: dailyOccupancy.length > 0
      ? sum(dailyOccupancy.map((day) => day.occupancyPercentage)) / dailyOccupancy.length
      : 0,
    availableRooms: rangeAvailableRooms,
    totalOutOfOrderRoomNights: sum(expectedDateKeys.map(
      (dateKey) => getOutOfOrderPosition(dateKey)?.roomNumbers?.length ?? 0,
    )),
    highestOccupancy: occupancyTotals.length > 0 ? Math.max(...occupancyTotals) : 0,
    lowestOccupancy: occupancyTotals.length > 0 ? Math.min(...occupancyTotals) : 0,
    occupancyByFloor,
    incomeByOutlet: incomeByOutletWithShare,
    dailyIncome,
    revenueSources,
    dailyRevenueSources,
    foodBeverageTotals,
    foodBeverageSummary: {
      ...foodBeverageTotals,
      reportedDays: foodBeverageReportedDays.length,
      averagePerReportedDay: foodBeverageReportedDays.length > 0
        ? foodBeverageTotals.combined / foodBeverageReportedDays.length
        : 0,
      bestDay: bestFoodBeverageDay,
      foodSharePercentage: foodBeverageTotals.combined > 0
        ? (foodBeverageTotals.food / foodBeverageTotals.combined) * 100
        : 0,
      beverageSharePercentage: foodBeverageTotals.combined > 0
        ? (foodBeverageTotals.beverage / foodBeverageTotals.combined) * 100
        : 0,
    },
    dailyFoodBeverage,
    dailyDepartmentRevenue,
    dailyTargetAnalysis,
    weeklyTargetAnalysis,
    monthlyTargetAnalysis,
    selectedPeriodTargetAnalysis,
    monthToDateTargetAnalysis,
    hasRevenueTargets: [...new Set(targetDateKeys.map((dateKey) => dateKey.slice(0, 7)))]
      .some((monthKey) => {
        const target = monthlyTargets?.[monthKey];
        return Number(target?.roomRevenueTarget) > 0 ||
          Number(target?.foodBeverageRevenueTarget) > 0;
      }),
    hospitalityAccounting,
    dailyBrunch,
    totalBrunchRevenue: sum(dailyBrunch.map((day) => day.revenue)),
    brunchAttendanceTarget: BRUNCH_ATTENDANCE_TARGET,
    brunchReportDays: dailyBrunch.length,
    brunchTargetAttendees,
    brunchAttendeeVariance: totalBrunchAttendees - brunchTargetAttendees,
    brunchTargetDaysMet: dailyBrunch.filter((day) => day.targetReached).length,
    averageBrunchAttendees: dailyBrunch.length > 0
      ? totalBrunchAttendees / dailyBrunch.length
      : null,
    dailyGuestRefunds,
    guestRefundsTotal: sum(dailyGuestRefunds.map((day) => day.amount)),
    dailyOccupancyGuestMix,
    guestMixTotals: {
      walkInGuests: totalWalkInGuests,
      corporateGuests: totalCorporateGuests,
      totalGuests: totalCategorizedGuests,
      walkInPercentage: totalCategorizedGuests > 0
        ? (totalWalkInGuests / totalCategorizedGuests) * 100
        : 0,
      corporatePercentage: totalCategorizedGuests > 0
        ? (totalCorporateGuests / totalCategorizedGuests) * 100
        : 0,
    },
    grandRevenueTotal,
    actualRevenueTotal,
    departmentalNotes,
    gasAverages,
    averageHotWaterTemperature: hotWater.average,
    hotWaterRecordedDays: hotWater.recordedDays,
    totalWaterSupplied: sum(orderedReports.map((report) => report.waterSupplyCount)),
    latestGeneratorServiceReading,
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
    totalBrunchAttendees,
  };
}
