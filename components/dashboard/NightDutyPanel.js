"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildDefaultNightDutyData,
  cookingGasOptions,
  getActualRevenueTotal,
  getFrontOfficeRoomRevenue,
  getGasLevelLabel,
  getGrandIncomeTotal,
  getGuestMix,
  getGuestRefundTotal,
  getNightDutyReportDateKey,
  getOutletTotal,
  groupOnDutyStaff,
  nightDutyDepartmentOptions,
  nightDutyOutletConfig,
} from "@/data/nightDuty";
import { roomGroups } from "@/data/hotelRooms";
import { buildNightDutyRangeAnalytics } from "@/data/nightDutyAnalytics";
import {
  defaultUtilities,
  getRoomComplaintLabel,
  getUtilityLabel,
  propertyUtilityFields,
} from "@/data/propertyStatus";
import { formatFriendlyDate } from "@/lib/format";
import { hasCloudflareArchiveConfig } from "@/lib/cloudflareArchive";
import {
  addDaysToDateKey,
  formatDateKey,
  getOperationalDateKey,
  isWithinOperationalDate,
  listDateKeysInRange,
} from "@/lib/hotelTime";
import { downloadTextPdf } from "@/lib/pdf";
import { downloadNightDutyRangeDocx } from "@/lib/nightDutyDocx";
import { getNightDutyAccess } from "@/lib/roles";

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatIncomeFieldValue(field, value) {
  if (field?.nonFinancial) {
    return Math.max(Math.trunc(Number(value) || 0), 0).toLocaleString("en-US");
  }

  return formatAmount(value);
}

function getRevenueTreatment(field) {
  if (field?.nonFinancial) return "Attendance count";
  if (field?.separateAccount) return "Separate refund account; excluded from all revenue";
  return field?.excludeFromRevenue ? "Excluded from actual revenue" : "Included";
}

function formatDuration(hours, minutes) {
  const safeHours = Math.max(Math.trunc(Number(hours) || 0), 0);
  const safeMinutes = Math.min(Math.max(Math.trunc(Number(minutes) || 0), 0), 59);
  const parts = [];
  if (safeHours > 0) parts.push(`${safeHours} hour${safeHours === 1 ? "" : "s"}`);
  if (safeMinutes > 0) parts.push(`${safeMinutes} minute${safeMinutes === 1 ? "" : "s"}`);
  return parts.join(" ") || "0 minutes";
}

function formatTotalMinutes(totalMinutes) {
  const minutes = Math.max(Math.trunc(Number(totalMinutes) || 0), 0);
  return formatDuration(Math.floor(minutes / 60), minutes % 60);
}

function formatAverage(value, suffix = "") {
  return value === null || value === undefined
    ? "Not recorded"
    : `${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}${suffix}`;
}

function formatPercentage(value) {
  return `${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function SectionButton({ active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-3 text-sm font-semibold transition ${
        active
          ? "bg-[#162338] text-white"
          : "border border-slate-200 bg-white text-slate-600 hover:text-[#162338]"
      }`}
    >
      {label}
    </button>
  );
}

function ActionButton({ label, onClick, tone = "default" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
        tone === "danger"
          ? "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
          : "border border-slate-200 bg-white text-slate-600 hover:text-[#162338]"
      }`}
    >
      {label}
    </button>
  );
}

function RangeBarChart({ title, items, formatValue = (value) => String(value), showShare = true }) {
  const maximum = Math.max(...items.map((item) => Number(item.value) || 0), 1);
  const total = items.reduce((sum, item) => sum + Math.max(Number(item.value) || 0, 0), 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h4 className="text-sm font-semibold text-[#162338]">{title}</h4>
      <div className="mt-4 space-y-3">
        {items.map((item) => {
          const value = Math.max(Number(item.value) || 0, 0);
          const width = value > 0 ? Math.max((value / maximum) * 100, 1) : 0;
          const percentage = item.percentage ?? (total > 0 ? (value / total) * 100 : 0);

          return (
            <div key={item.key ?? item.label} className="grid grid-cols-[7rem_1fr] gap-3 text-xs sm:grid-cols-[9rem_1fr_6rem] sm:items-center">
              <span className="truncate font-medium text-slate-600" title={item.label}>{item.label}</span>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${item.label}: ${formatValue(value)}`}>
                <div className="h-full rounded-full bg-[#a67c2e]" style={{ width: `${width}%` }} />
              </div>
              <strong className="col-span-2 text-right text-[#162338] sm:col-span-1">
                {formatValue(value)}{showShare ? ` · ${formatPercentage(percentage)}` : ""}
              </strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CHART_COLORS = ["#a67c2e", "#162338", "#0f766e", "#b45309", "#7c3aed"];

function RangeLineChart({ title, labels, series, valueSuffix = "" }) {
  const width = 760;
  const height = 250;
  const padding = { left: 58, right: 22, top: 24, bottom: 42 };
  const values = series.flatMap((entry) => entry.values.map((value) => Number(value) || 0));
  const maximum = Math.max(...values, 1);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const pointX = (index) => padding.left + (labels.length <= 1 ? plotWidth / 2 : (index / (labels.length - 1)) * plotWidth);
  const pointY = (value) => padding.top + plotHeight - ((Number(value) || 0) / maximum) * plotHeight;
  const labelStep = Math.max(Math.ceil(labels.length / 6), 1);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h4 className="text-sm font-semibold text-[#162338]">{title}</h4>
      <div className="mt-3 overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[620px] w-full" role="img" aria-label={title}>
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = padding.top + plotHeight - ratio * plotHeight;
            return <g key={ratio}><line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#dbe3ec" strokeWidth="1" /><text x={padding.left - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#64748b">{`${Math.round(maximum * ratio)}${valueSuffix}`}</text></g>;
          })}
          {labels.map((label, index) => index % labelStep === 0 || index === labels.length - 1 ? <text key={`${label}-${index}`} x={pointX(index)} y={height - 13} textAnchor="middle" fontSize="9" fill="#64748b">{label.slice(5)}</text> : null)}
          {series.map((entry, seriesIndex) => {
            const color = entry.color ?? CHART_COLORS[seriesIndex % CHART_COLORS.length];
            const points = entry.values.map((value, index) => `${pointX(index)},${pointY(value)}`).join(" ");
            return <g key={entry.key ?? entry.label}><polyline points={points} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />{entry.values.map((value, index) => <circle key={`${entry.key}-${index}`} cx={pointX(index)} cy={pointY(value)} r="3.5" fill={color}><title>{`${labels[index]} · ${entry.label}: ${value}${valueSuffix}`}</title></circle>)}</g>;
          })}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">{series.map((entry, index) => <span key={entry.key ?? entry.label} className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color ?? CHART_COLORS[index % CHART_COLORS.length] }} />{entry.label}</span>)}</div>
    </div>
  );
}

function buildOccupancyByFloor(operations = {}) {
  const occupiedRoomSet = new Set(operations.occupiedRoomNumbers ?? []);

  return roomGroups.map((group) => ({
    floorKey: group.key,
    floorLabel: group.label,
    occupiedRooms: group.rooms.filter((roomNumber) => occupiedRoomSet.has(roomNumber)).length,
  }));
}

function getOperationsSnapshotForDate(operations = {}, dateKey) {
  if (operations?.operationalDateKey === dateKey) return operations;

  const historyEntry = (operations?.reportHistory ?? []).find(
    (entry) => entry?.dateKey === dateKey,
  );

  if (!historyEntry) return null;

  return {
    ...operations,
    ...historyEntry,
    operationalDateKey: dateKey,
    occupiedRoomNumbers: historyEntry.occupiedRoomNumbers ?? [],
  };
}

function buildIncidentSnapshot(incident = {}) {
  return {
    hasIncident: Boolean(incident.hasIncident),
    who: incident.hasIncident ? incident.who ?? "" : "",
    how: incident.hasIncident ? incident.how ?? "" : "",
    when: incident.hasIncident ? incident.when ?? "" : "",
    description: incident.hasIncident ? incident.description ?? "" : "",
  };
}

function buildEventSnapshots(eventsBookings, operationalDateKey) {
  return (eventsBookings?.events ?? [])
    .filter((entry) => entry.eventDate === operationalDateKey)
    .map((entry) => ({
      id: entry.id ?? "",
      eventType: entry.eventType ?? "Event",
      venue: entry.venue ?? "",
      expectedGuests: Number(entry.expectedGuests) || 0,
    }));
}

function buildComplaintSnapshots(propertyStatus, operationalDateKey) {
  return (propertyStatus?.roomComplaints ?? [])
    .filter((entry) => isWithinOperationalDate(entry.reportedAt, operationalDateKey))
    .map((entry) => ({
      id: entry.id ?? "",
      roomNumber: entry.roomNumber ?? "",
      complaintType: entry.complaintType ?? "other",
      complaintNote: entry.complaintNote ?? "",
    }));
}

function getIncidentSummary(incident) {
  return incident?.hasIncident ? "Yes" : "Nil";
}

function buildNightDutyReportData(record = {}) {
  const occupancyTotal = (record.occupancyByFloor ?? []).reduce(
    (total, floor) => total + Number(floor.occupiedRooms || 0),
    0,
  );
  const groupedStaff = groupOnDutyStaff(record.onDutyStaff, record.departmentNotes);
  const incomeSections = nightDutyOutletConfig.map((outlet) => ({
    ...outlet,
    actualRevenueTotal: getOutletTotal(record.income, outlet.key),
    grandRevenueTotal: getOutletTotal(
      record.income,
      outlet.key,
      { includeNonRevenue: true },
    ),
  }));
  const guestMix = getGuestMix(record);
  const foodTotal = nightDutyOutletConfig.reduce(
    (total, outlet) => total + (Number(record.income?.[outlet.key]?.food) || 0),
    0,
  );
  const beverageTotal = nightDutyOutletConfig.reduce(
    (total, outlet) => total + (Number(record.income?.[outlet.key]?.beverage) || 0),
    0,
  );

  return {
    ...record,
    generatedAt: new Date(),
    occupancyTotal,
    groupedStaff,
    incomeSections,
    guestMix,
    guestRefunds: getGuestRefundTotal(record.income),
    foodBeverageTotals: {
      food: foodTotal,
      beverage: beverageTotal,
      combined: foodTotal + beverageTotal,
    },
    brunchReport: {
      revenue: Number(record.income?.restaurant?.brunchRevenue) || 0,
      attendees: Number(record.income?.restaurant?.brunchAttendees) || 0,
    },
    grandIncomeTotal: getGrandIncomeTotal(record.income),
    actualRevenueTotal: getActualRevenueTotal(record.income),
  };
}

function buildIncidentLines(label, incident) {
  if (!incident?.hasIncident) return [`${label}: Nil`];

  return [
    `${label}: Yes`,
    `Who: ${incident.who || "Not stated"}`,
    `How: ${incident.how || "Not stated"}`,
    `When: ${incident.when || "Not stated"}`,
    `Description: ${incident.description || "Not stated"}`,
  ];
}

function buildNightDutyReportLines(reportData) {
  const sectionHeading = (text) => ({
    text,
    bold: true,
    fontSize: 13,
    dividerBefore: true,
    dividerAfter: true,
    spaceBefore: 7,
    spaceAfter: 4,
    keepWithNext: true,
  });
  const subsectionHeading = (text) => ({
    text,
    bold: true,
    fontSize: 11,
    spaceBefore: 4,
    keepWithNext: true,
  });
  const lines = [
    { text: `Activity date: ${formatDateKey(reportData.operationalDateKey)}`, bold: true },
    `Generated: ${formatFriendlyDate(reportData.generatedAt)}`,
    sectionHeading("Occupancy totals by floor"),
    { text: "Floor | Night Duty total | Front Office reference", bold: true },
  ];

  reportData.occupancyByFloor.forEach((floor) => {
    const frontOfficeFloor = reportData.frontOfficeOccupancyByFloor?.find(
      (entry) => entry.floorKey === floor.floorKey,
    );
    lines.push(
      `${floor.floorLabel} | ${floor.occupiedRooms} | ${frontOfficeFloor?.occupiedRooms ?? 0}`,
    );
  });
  lines.push({ text: `Total occupancy: ${reportData.occupancyTotal}`, bold: true });
  lines.push(subsectionHeading("Room occupancy guest source"));
  lines.push(`Walk-in guests occupying rooms: ${reportData.guestMix.walkInGuests}`);
  lines.push(`Corporate guests occupying rooms: ${reportData.guestMix.corporateGuests}`);
  lines.push(
    `Discrepancy query: ${reportData.occupancyQuery?.hasDiscrepancy ? "Yes" : "No"}`,
  );
  lines.push(reportData.occupancyQuery?.note || "Nil");
  lines.push(sectionHeading("Income dashboard"));
  reportData.incomeSections.forEach((outlet) => {
    lines.push(subsectionHeading(outlet.label));
    outlet.fields.forEach((field) => {
      const suffix = field.nonFinancial
        ? " (attendance count; not revenue)"
        : field.separateAccount
          ? " (separate refund account; excluded from Grand and Actual Revenue)"
        : field.excludeFromRevenue
          ? " (included in Grand Revenue; excluded from Actual Revenue)"
          : "";
      lines.push(`- ${field.label}: ${formatIncomeFieldValue(field, reportData.income?.[outlet.key]?.[field.key])}${suffix}`);
    });
    lines.push(`- Grand Revenue: ${formatAmount(outlet.grandRevenueTotal)}`);
    lines.push(`- Actual Revenue: ${formatAmount(outlet.actualRevenueTotal)}`);
  });
  lines.push(subsectionHeading("Food and beverage report"));
  lines.push(`- Food total: ${formatAmount(reportData.foodBeverageTotals.food)}`);
  lines.push(`- Beverage total: ${formatAmount(reportData.foodBeverageTotals.beverage)}`);
  lines.push(`- Combined food and beverage: ${formatAmount(reportData.foodBeverageTotals.combined)}`);
  lines.push(subsectionHeading("Brunch report"));
  lines.push(`- Brunch revenue: ${formatAmount(reportData.brunchReport.revenue)}`);
  lines.push(`- Brunch attendees: ${reportData.brunchReport.attendees}`);
  lines.push(subsectionHeading("Guest refund account"));
  lines.push(`- Guest refunds: ${formatAmount(reportData.guestRefunds)} (excluded from all revenue totals)`);
  lines.push({
    text: `GRAND REVENUE TOTAL: ${formatAmount(reportData.grandIncomeTotal)}`,
    bold: true,
    fontSize: 15,
    dividerBefore: true,
    dividerAfter: true,
    spaceBefore: 7,
    spaceAfter: 5,
  });
  lines.push({
    text: `ACTUAL REVENUE TOTAL: ${formatAmount(reportData.actualRevenueTotal)}`,
    bold: true,
    fontSize: 14,
    dividerAfter: true,
    spaceAfter: 5,
  });

  lines.push(sectionHeading("Staff on duty and departmental notes"));
  if (reportData.groupedStaff.length === 0) {
    lines.push("Nil");
  } else {
    reportData.groupedStaff.forEach((department) => {
      lines.push(`${department.label}: ${department.staff.map((entry) => entry.staffName).join(", ") || "Nil"}`);
      lines.push(`Note: ${department.note || "Nil"}`);
    });
  }
  lines.push(sectionHeading("Utilities"));
  cookingGasOptions.forEach((gas) => {
    lines.push(`${gas.label}: ${getGasLevelLabel(reportData.gasLevels?.[gas.value])}`);
  });
  lines.push(`Hot water temperature: ${reportData.hotWaterTemperature ?? "Not set"}°C`);
  lines.push(subsectionHeading("Generator service hours"));
  if ((reportData.generatorServices ?? []).length === 0) {
    lines.push("Nil");
  } else {
    reportData.generatorServices.forEach((entry) => {
      lines.push(`${entry.name}: ${formatDuration(entry.serviceHours, entry.serviceMinutes)}`);
    });
  }
  lines.push(`Water supplied: ${reportData.waterSupplyCount ?? 0} time(s)`);
  if ((reportData.powerSupplies ?? []).length === 0) {
    lines.push("Power supplies: Nil");
  } else {
    reportData.powerSupplies.forEach((entry) => {
      lines.push(`${entry.name}: ${formatDuration(entry.durationHours, entry.durationMinutes)}`);
    });
  }
  propertyUtilityFields.forEach((field) => {
    lines.push(`${field.label}: ${getUtilityLabel(field.key, reportData.utilitiesSnapshot?.[field.key])}`);
  });
  lines.push(sectionHeading("Incidents"));
  lines.push(subsectionHeading("Guest incident"));
  lines.push(...buildIncidentLines("Guest incident", reportData.guestIncident));
  lines.push(subsectionHeading("Employee incident"));
  lines.push(...buildIncidentLines("Employee incident", reportData.employeeIncident));
  lines.push(sectionHeading("Events"));
  if ((reportData.eventsSnapshot ?? []).length === 0) {
    lines.push("Nil");
  } else {
    reportData.eventsSnapshot.forEach((entry, index) => {
      lines.push(
        `${index + 1}. ${entry.eventType || "Event"} | ${entry.venue || "Venue not stated"} | ${entry.expectedGuests || 0} guest(s)`,
      );
    });
  }
  lines.push(sectionHeading("Guest complaints"));
  if ((reportData.complaintsSnapshot ?? []).length === 0) {
    lines.push("Nil");
  } else {
    reportData.complaintsSnapshot.forEach((entry, index) => {
      lines.push(
        `${index + 1}. Room ${entry.roomNumber || "Not stated"} | ${getRoomComplaintLabel(entry.complaintType)} | ${entry.complaintNote || "No note"}`,
      );
    });
  }
  lines.push({
    text: `Night Duty Supervisor signature: ${reportData.nightDutySupervisorSignature || "Not signed"}`,
    bold: true,
    dividerBefore: true,
    spaceBefore: 12,
  });

  return lines;
}

function buildNightDutyRangeReportLines(reports, rangeStart, rangeEnd) {
  const expectedDateKeys = listDateKeysInRange(rangeStart, rangeEnd);
  const analysis = buildNightDutyRangeAnalytics(reports, expectedDateKeys);
  const sectionHeading = (text, pageBreakBefore = false) => ({
    text,
    bold: true,
    sectionHeading: true,
    fontSize: 13,
    dividerBefore: true,
    dividerAfter: true,
    spaceBefore: 8,
    spaceAfter: 5,
    keepWithNext: true,
    pageBreakBefore,
  });
  const lines = [
    {
      text: `NIGHT DUTY RANGE ANALYSIS: ${formatDateKey(rangeStart)} TO ${formatDateKey(rangeEnd)}`,
      bold: true,
      fontSize: 15,
      dividerAfter: true,
      spaceAfter: 6,
    },
    { text: `Coverage: ${analysis.reportCount} stored report(s) from ${analysis.selectedDayCount} selected day(s)`, bold: true },
    { text: `Missing report dates: ${analysis.missingDateKeys.length > 0 ? analysis.missingDateKeys.join(", ") : "None"}` },
    { text: `Total In-house (occupant-nights): ${analysis.totalInHouse}`, bold: true },
    { text: `Average nightly occupancy: ${formatAverage(analysis.averageOccupancy)} of ${analysis.hotelRoomCapacity} rooms (${formatPercentage(analysis.averageOccupancyPercentage)})`, bold: true },
    { text: `Highest / lowest occupancy: ${analysis.highestOccupancy} / ${analysis.lowestOccupancy}` },
    { text: `GRAND REVENUE: ${formatAmount(analysis.grandRevenueTotal)}`, bold: true, fontSize: 14 },
    { text: `ACTUAL REVENUE: ${formatAmount(analysis.actualRevenueTotal)}`, bold: true, fontSize: 14 },
  ];

  if (reports.length === 0) {
    lines.push("No stored Night Duty reports were found in this date range.");
    return lines;
  }

  lines.push(sectionHeading("Occupancy analysis by floor"));
  lines.push({
    type: "table",
    title: "Floor totals across the selected period",
    headers: ["Floor", "Total occupants", "Nightly average", "Highest night"],
    widths: [2.2, 1.2, 1.2, 1.1],
    rows: analysis.occupancyByFloor.map((floor) => [
      floor.floorLabel,
      String(floor.totalOccupants),
      formatAverage(floor.averageOccupants),
      String(floor.highestOccupancy),
    ]),
    fontSize: 8,
  });
  lines.push({
    type: "barChart",
    title: "Total occupants by floor",
    items: analysis.occupancyByFloor.map((floor) => ({
      label: floor.floorLabel,
      value: floor.totalOccupants,
      percentage: analysis.totalInHouse > 0 ? (floor.totalOccupants / analysis.totalInHouse) * 100 : 0,
      displayValue: `${floor.totalOccupants} (${formatPercentage(analysis.totalInHouse > 0 ? (floor.totalOccupants / analysis.totalInHouse) * 100 : 0)})`,
    })),
    spaceBefore: 8,
    spaceAfter: 8,
  });
  lines.push({
    type: "lineChart",
    title: "Daily occupancy trend",
    labels: analysis.dailyOccupancy.map((day) => day.operationalDateKey),
    series: [
      {
        key: "occupancyPercentage",
        label: "Occupancy rate",
        values: analysis.dailyOccupancy.map((day) => day.occupancyPercentage),
        displayValues: analysis.dailyOccupancy.map((day) => formatPercentage(day.occupancyPercentage)),
      },
    ],
    valueSuffix: "%",
    spaceBefore: 8,
    spaceAfter: 8,
  });
  lines.push({
    type: "table",
    title: "Room occupancy by guest source",
    headers: ["Occupancy source", "Guest total", "Share"],
    widths: [2.2, 1.2, 1.2],
    rows: [
      ["Walk-in guests occupying rooms", String(analysis.guestMixTotals.walkInGuests), formatPercentage(analysis.guestMixTotals.walkInPercentage)],
      ["Corporate guests occupying rooms", String(analysis.guestMixTotals.corporateGuests), formatPercentage(analysis.guestMixTotals.corporatePercentage)],
    ],
  });
  lines.push({
    type: "barChart",
    title: "Walk-in versus corporate room occupancy",
    items: [
      { label: "Walk-in", value: analysis.guestMixTotals.walkInGuests, percentage: analysis.guestMixTotals.walkInPercentage },
      { label: "Corporate", value: analysis.guestMixTotals.corporateGuests, percentage: analysis.guestMixTotals.corporatePercentage },
    ],
    spaceBefore: 8,
    spaceAfter: 8,
  });
  lines.push({
    type: "lineChart",
    title: "Daily room occupancy guest source",
    labels: analysis.dailyOccupancyGuestMix.map((day) => day.operationalDateKey),
    series: [
      { key: "walkInGuests", label: "Walk-in", values: analysis.dailyOccupancyGuestMix.map((day) => day.walkInGuests) },
      { key: "corporateGuests", label: "Corporate", values: analysis.dailyOccupancyGuestMix.map((day) => day.corporateGuests) },
    ],
    spaceBefore: 8,
    spaceAfter: 8,
  });
  lines.push({
    type: "table",
    title: "Daily room occupancy by guest source",
    headers: ["Date", "Walk-in occupants", "Corporate occupants", "Categorized occupants"],
    widths: [1.4, 1.2, 1.3, 1.4],
    rows: analysis.dailyOccupancyGuestMix.map((day) => [
      day.operationalDateKey,
      String(day.walkInGuests),
      String(day.corporateGuests),
      String(day.totalGuests),
    ]),
    chunkSize: 22,
  });

  lines.push(sectionHeading("Income totals by section", true));
  lines.push({
    type: "table",
    title: "Section revenue totals",
    headers: ["Revenue section", "Grand Revenue", "Actual Revenue"],
    widths: [2, 1.4, 1.4],
    rows: analysis.incomeByOutlet.map((outlet) => [
      outlet.label,
      formatAmount(outlet.grandRevenueTotal),
      formatAmount(outlet.actualRevenueTotal),
    ]),
    fontSize: 8,
  });
  lines.push({
    type: "barChart",
    title: "Grand Revenue by section",
    items: analysis.incomeByOutlet.map((outlet) => ({
      label: outlet.label,
      value: outlet.grandRevenueTotal,
      percentage: outlet.revenueSharePercentage,
      displayValue: `${formatAmount(outlet.grandRevenueTotal)} (${formatPercentage(outlet.revenueSharePercentage)})`,
    })),
    spaceBefore: 8,
    spaceAfter: 8,
  });
  lines.push({
    type: "lineChart",
    title: "Daily revenue analysis",
    labels: analysis.dailyIncome.map((day) => day.operationalDateKey),
    series: [
      {
        key: "grandRevenue",
        label: "Grand Revenue",
        values: analysis.dailyIncome.map((day) => day.grandRevenueTotal),
        displayValues: analysis.dailyIncome.map((day) => formatAmount(day.grandRevenueTotal)),
      },
      {
        key: "actualRevenue",
        label: "Actual Revenue",
        values: analysis.dailyIncome.map((day) => day.actualRevenueTotal),
        displayValues: analysis.dailyIncome.map((day) => formatAmount(day.actualRevenueTotal)),
      },
      {
        key: "roomRevenue",
        label: "Room Revenue",
        values: analysis.dailyIncome.map((day) => day.roomRevenue),
        displayValues: analysis.dailyIncome.map((day) => formatAmount(day.roomRevenue)),
      },
    ],
    spaceBefore: 8,
    spaceAfter: 8,
  });
  lines.push({
    type: "lineChart",
    title: "Daily outlet revenue trends",
    labels: analysis.dailyIncome.map((day) => day.operationalDateKey),
    series: nightDutyOutletConfig.map((outlet) => ({
      key: outlet.key,
      label: outlet.label,
      values: analysis.dailyIncome.map((day) => day.outlets[outlet.key]),
      displayValues: analysis.dailyIncome.map((day) => formatAmount(day.outlets[outlet.key])),
    })),
    spaceBefore: 8,
    spaceAfter: 8,
  });
  lines.push({
    type: "table",
    title: "Detailed income totals",
    headers: ["Section", "Revenue item", "Period total", "Treatment"],
    widths: [1.3, 1.6, 1.1, 1.5],
    rows: analysis.incomeByOutlet.flatMap((outlet) => outlet.fields.map((field) => [
      outlet.label,
      field.label,
      formatIncomeFieldValue(field, field.total),
      getRevenueTreatment(field),
    ])),
    fontSize: 7,
    chunkSize: 18,
  });

  lines.push(sectionHeading("Food, beverage, brunch and refund accounts", true));
  lines.push({
    type: "table",
    title: "Food and beverage totals",
    headers: ["Account", "Period total"],
    widths: [2, 1.3],
    rows: [
      ["Food", formatAmount(analysis.foodBeverageTotals.food)],
      ["Beverage", formatAmount(analysis.foodBeverageTotals.beverage)],
      ["Combined food and beverage", formatAmount(analysis.foodBeverageTotals.combined)],
    ],
    boldLastRow: true,
  });
  lines.push({
    type: "table",
    title: "Brunch report",
    headers: ["Date", "Brunch revenue", "Attendees"],
    widths: [1.4, 1.4, 1],
    rows: [
      ["Range total", formatAmount(analysis.totalBrunchRevenue), String(analysis.totalBrunchAttendees)],
      ...analysis.dailyBrunch.map((day) => [
        day.operationalDateKey,
        formatAmount(day.revenue),
        String(day.attendees),
      ]),
    ],
    chunkSize: 22,
  });
  lines.push({
    type: "table",
    title: "Guest refund account",
    headers: ["Account", "Period total", "Treatment"],
    widths: [1.8, 1.2, 2.1],
    rows: [
      ["Guest refunds", formatAmount(analysis.guestRefundsTotal), "Separate account; excluded from all revenue totals"],
    ],
  });
  lines.push({
    type: "table",
    title: "Total of every revenue source",
    headers: ["Section", "Revenue source", "Period total", "Treatment"],
    widths: [1.3, 1.7, 1.2, 1.5],
    rows: analysis.revenueSources.map((source) => [
      source.outletLabel,
      source.fieldLabel,
      formatAmount(source.total),
      source.treatment,
    ]),
    chunkSize: 20,
  });

  lines.push(sectionHeading("Day-by-day income analysis", true));
  lines.push({
    type: "table",
    title: "Daily Grand Revenue by section",
    headers: ["Date", "Kenny's", "Tropics", "Restaurant", "Front Office", "Grand", "Actual"],
    widths: [1.15, 0.9, 0.9, 1, 1.1, 1, 1],
    rows: analysis.dailyIncome.map((day) => [
      day.operationalDateKey,
      formatAmount(day.outlets.kennysBar),
      formatAmount(day.outlets.tropicsBar),
      formatAmount(day.outlets.restaurant),
      formatAmount(day.outlets.frontOffice),
      formatAmount(day.grandRevenueTotal),
      formatAmount(day.actualRevenueTotal),
    ]),
    fontSize: 6,
    chunkSize: 22,
  });
  lines.push({
    type: "table",
    title: "Daily food and beverage report",
    headers: ["Date", "Food", "Beverage", "Combined"],
    widths: [1.4, 1.2, 1.2, 1.2],
    rows: analysis.dailyFoodBeverage.map((day) => [
      day.operationalDateKey,
      formatAmount(day.food),
      formatAmount(day.beverage),
      formatAmount(day.combined),
    ]),
    chunkSize: 22,
  });
  lines.push({
    type: "table",
    title: "Daily guest refund account",
    headers: ["Date", "Guest refunds", "Treatment"],
    widths: [1.4, 1.3, 2.2],
    rows: analysis.dailyGuestRefunds.map((day) => [
      day.operationalDateKey,
      formatAmount(day.amount),
      "Excluded from all revenue totals",
    ]),
    chunkSize: 22,
  });
  nightDutyOutletConfig.forEach((outlet) => {
    const sources = analysis.revenueSources.filter((source) => source.outletKey === outlet.key);
    for (let index = 0; index < sources.length; index += 6) {
      const sourceChunk = sources.slice(index, index + 6);
      lines.push({
        type: "table",
        title: `${outlet.label} daily revenue sources${sources.length > 6 ? ` (part ${Math.floor(index / 6) + 1})` : ""}`,
        headers: ["Date", ...sourceChunk.map((source) => source.fieldLabel)],
        widths: [1.3, ...sourceChunk.map(() => 1)],
        rows: analysis.dailyRevenueSources.map((day) => [
          day.operationalDateKey,
          ...sourceChunk.map((source) => formatAmount(day.values[source.sourceKey])),
        ]),
        fontSize: 6,
        chunkSize: 22,
      });
    }
  });

  lines.push(sectionHeading("Departmental notes", true));
  if (analysis.departmentalNotes.length === 0) {
    lines.push("Nil");
  } else {
    analysis.departmentalNotes.forEach((entry, index) => {
      lines.push(`${index + 1}. ${entry.operationalDateKey} | ${entry.departmentLabel}: ${entry.note}`);
    });
  }

  lines.push(sectionHeading("Utilities and operational totals"));
  analysis.gasAverages.forEach((gas) => {
    lines.push(`${gas.label} average: ${formatAverage(gas.average)} (${gas.recordedDays} recorded day(s))`);
  });
  lines.push(`Average hot water temperature: ${formatAverage(analysis.averageHotWaterTemperature, " degrees C")} (${analysis.hotWaterRecordedDays} recorded day(s))`);
  lines.push(`Total water supplied: ${analysis.totalWaterSupplied} time(s)`);
  lines.push(`Latest generator service reading${analysis.latestGeneratorServiceReading ? ` (${formatDateKey(analysis.latestGeneratorServiceReading.operationalDateKey)})` : ""}:`);
  if (!analysis.latestGeneratorServiceReading) lines.push("- Nil");
  analysis.latestGeneratorServiceReading?.entries.forEach((entry) => {
    lines.push(`- ${entry.name}: ${formatDuration(entry.serviceHours, entry.serviceMinutes)}`);
  });
  lines.push("Power supply totals:");
  if (analysis.powerSupplyTotals.length === 0) lines.push("- Nil");
  analysis.powerSupplyTotals.forEach((entry) => {
    lines.push(`- ${entry.name}: ${formatTotalMinutes(entry.totalMinutes)} across ${entry.entries} entry/entries`);
  });

  lines.push(sectionHeading("Other management indicators"));
  lines.push(`Guest incident days: ${analysis.guestIncidentDays}`);
  lines.push(`Employee incident days: ${analysis.employeeIncidentDays}`);
  lines.push(`Events recorded: ${analysis.totalEvents}`);
  lines.push(`Guest complaints recorded: ${analysis.totalComplaints}`);
  lines.push(`Brunch attendees: ${analysis.totalBrunchAttendees}`);

  reports.forEach((report, index) => {
    lines.push({
      text: `DAILY REPORT APPENDIX ${index + 1}: ${formatDateKey(report.operationalDateKey)}`,
      bold: true,
      fontSize: 15,
      dividerBefore: true,
      dividerAfter: true,
      spaceBefore: 14,
      spaceAfter: 6,
      keepWithNext: true,
      pageBreakBefore: true,
    });
    lines.push(...buildNightDutyReportLines(report));
  });

  return lines;
}

function printNightDutyRangeReport(reports, rangeStart, rangeEnd) {
  if (typeof window === "undefined") return;
  const reportWindow = window.open("", "_blank", "width=1080,height=860");
  if (!reportWindow) return;

  const analysis = buildNightDutyRangeAnalytics(
    reports,
    listDateKeysInRange(rangeStart, rangeEnd),
  );
  const occupancyRows = analysis.occupancyByFloor.map((floor) => `
    <tr><td>${escapeHtml(floor.floorLabel)}</td><td>${floor.totalOccupants}</td><td>${escapeHtml(formatAverage(floor.averageOccupants))}</td><td>${floor.highestOccupancy}</td></tr>
  `).join("");
  const sectionRevenueRows = analysis.incomeByOutlet.map((outlet) => `
    <tr><td>${escapeHtml(outlet.label)}</td><td>${escapeHtml(formatAmount(outlet.grandRevenueTotal))}</td><td>${escapeHtml(formatAmount(outlet.actualRevenueTotal))}</td></tr>
  `).join("");
  const dailyIncomeRows = analysis.dailyIncome.map((day) => `
    <tr><td>${escapeHtml(day.operationalDateKey)}</td><td>${escapeHtml(formatAmount(day.outlets.kennysBar))}</td><td>${escapeHtml(formatAmount(day.outlets.tropicsBar))}</td><td>${escapeHtml(formatAmount(day.outlets.restaurant))}</td><td>${escapeHtml(formatAmount(day.outlets.frontOffice))}</td><td><strong>${escapeHtml(formatAmount(day.grandRevenueTotal))}</strong></td><td>${escapeHtml(formatAmount(day.actualRevenueTotal))}</td></tr>
  `).join("");
  const revenueSourceTotalRows = analysis.revenueSources.map((source) => `
    <tr><td>${escapeHtml(source.outletLabel)}</td><td>${escapeHtml(source.fieldLabel)}</td><td>${escapeHtml(formatAmount(source.total))}</td><td>${escapeHtml(source.treatment)}</td></tr>
  `).join("");
  const dailyFoodBeverageRows = analysis.dailyFoodBeverage.map((day) => `
    <tr><td>${escapeHtml(day.operationalDateKey)}</td><td>${escapeHtml(formatAmount(day.food))}</td><td>${escapeHtml(formatAmount(day.beverage))}</td><td>${escapeHtml(formatAmount(day.combined))}</td></tr>
  `).join("");
  const dailyBrunchRows = analysis.dailyBrunch.map((day) => `
    <tr><td>${escapeHtml(day.operationalDateKey)}</td><td>${escapeHtml(formatAmount(day.revenue))}</td><td>${day.attendees}</td></tr>
  `).join("");
  const dailyOccupancyGuestMixRows = analysis.dailyOccupancyGuestMix.map((day) => `
    <tr><td>${escapeHtml(day.operationalDateKey)}</td><td>${day.walkInGuests}</td><td>${day.corporateGuests}</td><td>${day.totalGuests}</td></tr>
  `).join("");
  const dailyGuestRefundRows = analysis.dailyGuestRefunds.map((day) => `
    <tr><td>${escapeHtml(day.operationalDateKey)}</td><td>${escapeHtml(formatAmount(day.amount))}</td><td>Excluded from all revenue totals</td></tr>
  `).join("");
  const dailyRevenueSourceTables = nightDutyOutletConfig.map((outlet) => {
    const sources = analysis.revenueSources.filter((source) => source.outletKey === outlet.key);
    return Array.from({ length: Math.ceil(sources.length / 6) }, (_, chunkIndex) => {
      const sourceChunk = sources.slice(chunkIndex * 6, chunkIndex * 6 + 6);
      const rows = analysis.dailyRevenueSources.map((day) => `<tr><td>${escapeHtml(day.operationalDateKey)}</td>${sourceChunk.map((source) => `<td>${escapeHtml(formatAmount(day.values[source.sourceKey]))}</td>`).join("")}</tr>`).join("");
      return `<h3>${escapeHtml(outlet.label)}${sources.length > 6 ? ` — part ${chunkIndex + 1}` : ""}</h3><table><thead><tr><th>Date</th>${sourceChunk.map((source) => `<th>${escapeHtml(source.fieldLabel)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
    }).join("");
  }).join("");
  const notesMarkup = analysis.departmentalNotes.length > 0
    ? `<ol>${analysis.departmentalNotes.map((entry) => `<li><strong>${escapeHtml(entry.operationalDateKey)} - ${escapeHtml(entry.departmentLabel)}:</strong> ${escapeHtml(entry.note)}</li>`).join("")}</ol>`
    : "<p>Nil</p>";
  const latestGeneratorReading = analysis.latestGeneratorServiceReading
    ? `<strong>Reading date: ${escapeHtml(formatDateKey(analysis.latestGeneratorServiceReading.operationalDateKey))}</strong><br>${analysis.latestGeneratorServiceReading.entries.map((entry) => `${escapeHtml(entry.name)}: ${escapeHtml(formatDuration(entry.serviceHours, entry.serviceMinutes))}`).join("<br>")}`
    : "Nil";
  const powerTotals = analysis.powerSupplyTotals.length > 0
    ? analysis.powerSupplyTotals.map((entry) => `${escapeHtml(entry.name)}: ${escapeHtml(formatTotalMinutes(entry.totalMinutes))}`).join("<br>")
    : "Nil";
  const chartMarkup = (title, items, formatter) => {
    const maximum = Math.max(...items.map((item) => Number(item.value) || 0), 1);
    const total = items.reduce((sum, item) => sum + Math.max(Number(item.value) || 0, 0), 0);
    return `<section class="chart"><h3>${escapeHtml(title)}</h3>${items.map((item, index) => { const percentage = item.percentage ?? (total > 0 ? ((Number(item.value) || 0) / total) * 100 : 0); return `<div class="bar-row"><span>${escapeHtml(item.label)}</span><div class="bar-track"><i class="bar-${index % 4}" style="width:${Math.max(((Number(item.value) || 0) / maximum) * 100, Number(item.value) > 0 ? 1 : 0)}%"></i></div><strong>${escapeHtml(formatter(item.value))}<small>${escapeHtml(formatPercentage(percentage))}</small></strong></div>`; }).join("")}</section>`;
  };
  const lineChartMarkup = (title, labels, series, formatter) => {
    const width = 720;
    const height = 220;
    const left = 48;
    const top = 18;
    const plotWidth = 650;
    const plotHeight = 160;
    const values = series.flatMap((entry) => entry.values.map((value) => Number(value) || 0));
    const maximum = Math.max(...values, 1);
    const x = (index) => left + (labels.length <= 1 ? plotWidth / 2 : (index / (labels.length - 1)) * plotWidth);
    const y = (value) => top + plotHeight - ((Number(value) || 0) / maximum) * plotHeight;
    const colors = ["#a67c2e", "#162338", "#0f766e", "#7c3aed"];
    const grid = [0, 0.25, 0.5, 0.75, 1].map((ratio) => `<line x1="${left}" y1="${top + plotHeight - ratio * plotHeight}" x2="${left + plotWidth}" y2="${top + plotHeight - ratio * plotHeight}" stroke="#dbe3ec" stroke-width="1" />`).join("");
    const paths = series.map((entry, seriesIndex) => `<polyline points="${entry.values.map((value, index) => `${x(index)},${y(value)}`).join(" ")}" fill="none" stroke="${colors[seriesIndex % colors.length]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />${entry.values.map((value, index) => `<circle cx="${x(index)}" cy="${y(value)}" r="3" fill="${colors[seriesIndex % colors.length]}" />`).join("")}`).join("");
    const step = Math.max(Math.ceil(labels.length / 6), 1);
    const axisLabels = labels.map((label, index) => index % step === 0 || index === labels.length - 1 ? `<text x="${x(index)}" y="205" text-anchor="middle" font-size="9" fill="#64748b">${escapeHtml(label.slice(5))}</text>` : "").join("");
    const legend = series.map((entry, index) => `<span><i style="background:${colors[index % colors.length]}"></i>${escapeHtml(entry.label)} (${escapeHtml(formatter(entry.values[entry.values.length - 1] ?? 0))} latest)</span>`).join("");
    return `<section class="chart line-chart"><h3>${escapeHtml(title)}</h3><svg viewBox="0 0 ${width} ${height}">${grid}${paths}${axisLabels}</svg><div class="legend">${legend}</div></section>`;
  };
  const dailyReports = reports.map((report) => {
    const lineMarkup = buildNightDutyReportLines(report).map((line) => {
      const entry = typeof line === "string" ? { text: line } : line;
      const classes = [
        entry.bold ? "bold" : "",
        entry.dividerBefore ? "divider-before" : "",
        entry.dividerAfter ? "divider-after" : "",
        String(entry.text ?? "").startsWith("GRAND REVENUE TOTAL") ? "grand-total" : "",
        String(entry.text ?? "").startsWith("ACTUAL REVENUE TOTAL") ? "actual-total" : "",
      ].filter(Boolean).join(" ");
      return `<div class="${classes}">${escapeHtml(entry.text || " ")}</div>`;
    }).join("");

    return `<article><h2>${escapeHtml(formatDateKey(report.operationalDateKey))}</h2>${lineMarkup}</article>`;
  }).join("");

  reportWindow.document.open();
  reportWindow.document.write(`
    <!doctype html><html><head><title>Sunshine Hotel Night Duty Report ${escapeHtml(rangeStart)} to ${escapeHtml(rangeEnd)}</title>
      <style>
        @page { size: A4; margin: 12mm; }
        body { color: #1f2937; font-family: Arial, sans-serif; margin: 0; }
        h1 { border-bottom: 4px solid #a67c2e; color: #162338; font-size: 24px; margin: 0 0 8px; padding-bottom: 9px; }
        h2 { background: #e8eef5; border-bottom: 2px solid #a67c2e; border-top: 1px solid #a67c2e; color: #162338; font-size: 18px; margin: 24px 0 10px; padding: 7px 9px; }
        h3 { color: #162338; font-size: 13px; margin: 12px 0 8px; }
        .summary { background: #f8f3e6; border: 1px solid #a67c2e; border-left: 5px solid #a67c2e; margin: 12px 0 20px; padding: 12px; }
        .analysis-section { break-inside: avoid; margin: 16px 0; }
        table { border-collapse: collapse; font-size: 9px; margin: 8px 0 16px; width: 100%; }
        th { background: #162338; color: white; text-align: left; }
        th, td { border: 1px solid #9fb0c2; padding: 6px; }
        tbody tr:nth-child(even) td { background: #f4f7fa; }
        .chart { break-inside: avoid; margin: 16px 0; }
        .bar-row { align-items: center; display: grid; font-size: 9px; gap: 7px; grid-template-columns: 110px 1fr 85px; margin: 6px 0; }
        .bar-track { background: #e2e8f0; height: 10px; }
        .bar-track i { background: #a67c2e; display: block; height: 100%; }
        .bar-track i.bar-1 { background: #162338; } .bar-track i.bar-2 { background: #0f766e; } .bar-track i.bar-3 { background: #7c3aed; }
        .bar-row strong small { color: #64748b; display: block; font-size: 8px; font-weight: 600; }
        .line-chart svg { display: block; height: auto; width: 100%; }
        .legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 9px; }
        .legend span { align-items: center; display: inline-flex; gap: 5px; }
        .legend i { display: inline-block; height: 8px; width: 8px; }
        ol { font-size: 10px; line-height: 1.5; padding-left: 20px; }
        article { break-before: page; }
        article:first-of-type { break-before: auto; }
        article div { font-size: 10.5px; line-height: 1.55; white-space: pre-wrap; }
        .bold { font-weight: 800; }
        .divider-before { border-top: 1px solid #94a3b8; margin-top: 9px; padding-top: 6px; }
        .divider-after { border-bottom: 1px solid #94a3b8; margin-bottom: 6px; padding-bottom: 6px; }
        .grand-total { border-bottom: 3px double #8a6923; border-top: 3px double #8a6923; color: #162338; font-size: 14px; font-weight: 900; margin: 10px 0; padding: 8px 0; }
        .actual-total { color: #162338; font-size: 13px; font-weight: 800; margin-bottom: 10px; padding: 4px 0 8px; }
      </style>
    </head><body>
      <h1>Sunshine Hotel Full Night Duty Report</h1>
      <div class="summary"><strong>Date range:</strong> ${escapeHtml(formatDateKey(rangeStart))} to ${escapeHtml(formatDateKey(rangeEnd))}<br><strong>Coverage:</strong> ${analysis.reportCount} report(s) from ${analysis.selectedDayCount} selected day(s)<br><strong>Total In-house (occupant-nights):</strong> ${analysis.totalInHouse}<br><strong>Average occupancy:</strong> ${escapeHtml(formatAverage(analysis.averageOccupancy))} of ${analysis.hotelRoomCapacity} rooms (${escapeHtml(formatPercentage(analysis.averageOccupancyPercentage))})<br><strong>Grand Revenue:</strong> ${escapeHtml(formatAmount(analysis.grandRevenueTotal))}<br><strong>Actual Revenue:</strong> ${escapeHtml(formatAmount(analysis.actualRevenueTotal))}</div>
      <section class="analysis-section"><h2>Occupancy analysis by floor</h2><table><thead><tr><th>Floor</th><th>Total occupants</th><th>Nightly average</th><th>Highest night</th></tr></thead><tbody>${occupancyRows}</tbody></table>${chartMarkup("Total occupants by floor", analysis.occupancyByFloor.map((floor) => ({ label: floor.floorLabel, value: floor.totalOccupants })), (value) => String(value))}${lineChartMarkup("Daily occupancy rate", analysis.dailyOccupancy.map((day) => day.operationalDateKey), [{ label: "Occupancy rate", values: analysis.dailyOccupancy.map((day) => day.occupancyPercentage) }], formatPercentage)}<h3>Room occupancy by guest source</h3><div class="summary"><strong>Walk-in guests occupying rooms:</strong> ${analysis.guestMixTotals.walkInGuests} (${escapeHtml(formatPercentage(analysis.guestMixTotals.walkInPercentage))})<br><strong>Corporate guests occupying rooms:</strong> ${analysis.guestMixTotals.corporateGuests} (${escapeHtml(formatPercentage(analysis.guestMixTotals.corporatePercentage))})</div>${chartMarkup("Walk-in versus corporate room occupancy", [{ label: "Walk-in", value: analysis.guestMixTotals.walkInGuests, percentage: analysis.guestMixTotals.walkInPercentage }, { label: "Corporate", value: analysis.guestMixTotals.corporateGuests, percentage: analysis.guestMixTotals.corporatePercentage }], (value) => String(value))}${lineChartMarkup("Daily room occupancy guest source", analysis.dailyOccupancyGuestMix.map((day) => day.operationalDateKey), [{ label: "Walk-in", values: analysis.dailyOccupancyGuestMix.map((day) => day.walkInGuests) }, { label: "Corporate", values: analysis.dailyOccupancyGuestMix.map((day) => day.corporateGuests) }], (value) => String(value))}<table><thead><tr><th>Date</th><th>Walk-in occupants</th><th>Corporate occupants</th><th>Categorized occupants</th></tr></thead><tbody>${dailyOccupancyGuestMixRows}</tbody></table></section>
      <section class="analysis-section"><h2>Income totals by section</h2><table><thead><tr><th>Revenue section</th><th>Grand Revenue</th><th>Actual Revenue</th></tr></thead><tbody>${sectionRevenueRows}</tbody></table>${chartMarkup("Grand Revenue by section", analysis.incomeByOutlet.map((outlet) => ({ label: outlet.label, value: outlet.grandRevenueTotal, percentage: outlet.revenueSharePercentage })), formatAmount)}${lineChartMarkup("Daily revenue trends", analysis.dailyIncome.map((day) => day.operationalDateKey), [{ label: "Grand Revenue", values: analysis.dailyIncome.map((day) => day.grandRevenueTotal) }, { label: "Actual Revenue", values: analysis.dailyIncome.map((day) => day.actualRevenueTotal) }, { label: "Room Revenue", values: analysis.dailyIncome.map((day) => day.roomRevenue) }], formatAmount)}${lineChartMarkup("Daily outlet revenue trends", analysis.dailyIncome.map((day) => day.operationalDateKey), nightDutyOutletConfig.map((outlet) => ({ label: outlet.label, values: analysis.dailyIncome.map((day) => day.outlets[outlet.key]) })), formatAmount)}</section>
      <section><h2>Food and beverage analysis</h2><table><thead><tr><th>Account</th><th>Range total</th></tr></thead><tbody><tr><td>Food</td><td>${escapeHtml(formatAmount(analysis.foodBeverageTotals.food))}</td></tr><tr><td>Beverage</td><td>${escapeHtml(formatAmount(analysis.foodBeverageTotals.beverage))}</td></tr><tr><th>Combined</th><th>${escapeHtml(formatAmount(analysis.foodBeverageTotals.combined))}</th></tr></tbody></table>${lineChartMarkup("Daily food and beverage trend", analysis.dailyFoodBeverage.map((day) => day.operationalDateKey), [{ label: "Food", values: analysis.dailyFoodBeverage.map((day) => day.food) }, { label: "Beverage", values: analysis.dailyFoodBeverage.map((day) => day.beverage) }], formatAmount)}<table><thead><tr><th>Date</th><th>Food</th><th>Beverage</th><th>Combined</th></tr></thead><tbody>${dailyFoodBeverageRows}</tbody></table></section>
      <section><h2>Brunch report</h2><div class="summary"><strong>Total brunch revenue:</strong> ${escapeHtml(formatAmount(analysis.totalBrunchRevenue))}<br><strong>Total attendees:</strong> ${analysis.totalBrunchAttendees}</div><table><thead><tr><th>Date</th><th>Brunch revenue</th><th>Attendees</th></tr></thead><tbody>${dailyBrunchRows}</tbody></table></section>
      <section><h2>Guest refund account</h2><div class="summary"><strong>Guest refunds:</strong> ${escapeHtml(formatAmount(analysis.guestRefundsTotal))} — separate account, excluded from all revenue totals.</div><table><thead><tr><th>Date</th><th>Guest refunds</th><th>Treatment</th></tr></thead><tbody>${dailyGuestRefundRows}</tbody></table></section>
      <section><h2>Total of every revenue source</h2><table><thead><tr><th>Section</th><th>Revenue source</th><th>Range total</th><th>Treatment</th></tr></thead><tbody>${revenueSourceTotalRows}</tbody></table></section>
      <section><h2>Day-by-day income analysis</h2><table><thead><tr><th>Date</th><th>Kenny's</th><th>Tropics</th><th>Restaurant</th><th>Front Office</th><th>Grand</th><th>Actual</th></tr></thead><tbody>${dailyIncomeRows}</tbody></table>${dailyRevenueSourceTables}</section>
      <section><h2>Departmental notes</h2>${notesMarkup}</section>
      <section><h2>Utilities and other indicators</h2><table><tbody>${analysis.gasAverages.map((gas) => `<tr><th>${escapeHtml(gas.label)} average</th><td>${escapeHtml(formatAverage(gas.average))} (${gas.recordedDays} recorded day(s))</td></tr>`).join("")}<tr><th>Average hot water temperature</th><td>${escapeHtml(formatAverage(analysis.averageHotWaterTemperature, " degrees C"))}</td></tr><tr><th>Total water supplied</th><td>${analysis.totalWaterSupplied} time(s)</td></tr><tr><th>Latest generator service reading</th><td>${latestGeneratorReading}</td></tr><tr><th>Power supply totals</th><td>${powerTotals}</td></tr><tr><th>Guest / employee incident days</th><td>${analysis.guestIncidentDays} / ${analysis.employeeIncidentDays}</td></tr><tr><th>Events / complaints</th><td>${analysis.totalEvents} / ${analysis.totalComplaints}</td></tr><tr><th>Brunch attendees</th><td>${analysis.totalBrunchAttendees}</td></tr></tbody></table></section>
      <h2>Complete daily report appendix</h2>
      ${dailyReports || "<p>No stored Night Duty reports were found in this date range.</p>"}
    </body></html>
  `);
  reportWindow.document.close();
  reportWindow.focus();
  reportWindow.print();
}

function incidentHtml(label, incident) {
  if (!incident?.hasIncident) {
    return `<section><h3>${escapeHtml(label)}</h3><p>Nil</p></section>`;
  }

  return `
    <section>
      <h3>${escapeHtml(label)} — Yes</h3>
      <table>
        <tbody>
          <tr><th>Who</th><td>${escapeHtml(incident.who || "Not stated")}</td></tr>
          <tr><th>How</th><td>${escapeHtml(incident.how || "Not stated")}</td></tr>
          <tr><th>When</th><td>${escapeHtml(incident.when || "Not stated")}</td></tr>
          <tr><th>Description</th><td>${escapeHtml(incident.description || "Not stated")}</td></tr>
        </tbody>
      </table>
    </section>
  `;
}

function printNightDutyReport(reportData) {
  if (typeof window === "undefined") return;

  const reportWindow = window.open("", "_blank", "width=1080,height=860");
  if (!reportWindow) return;

  const occupancyRows = reportData.occupancyByFloor.map((floor) => {
    const reference = reportData.frontOfficeOccupancyByFloor?.find(
      (entry) => entry.floorKey === floor.floorKey,
    );
    return `<tr><td>${escapeHtml(floor.floorLabel)}</td><td>${floor.occupiedRooms}</td><td>${reference?.occupiedRooms ?? 0}</td></tr>`;
  }).join("");
  const incomeHtml = reportData.incomeSections.map((outlet) => `
    <section>
      <h3>${escapeHtml(outlet.label)}</h3>
      <table><thead><tr><th>Source</th><th>Amount</th><th>Revenue treatment</th></tr></thead>
        <tbody>
          ${outlet.fields.map((field) => `<tr><td>${escapeHtml(field.label)}</td><td>${escapeHtml(formatIncomeFieldValue(field, reportData.income?.[outlet.key]?.[field.key]))}</td><td>${escapeHtml(getRevenueTreatment(field))}</td></tr>`).join("")}
          <tr><th>Grand Revenue</th><th>${escapeHtml(formatAmount(outlet.grandRevenueTotal))}</th><th>Revenue and deposit entries; refunds excluded</th></tr>
          <tr><th>Actual Revenue</th><th>${escapeHtml(formatAmount(outlet.actualRevenueTotal))}</th><th>Included revenue only</th></tr>
        </tbody>
      </table>
    </section>
  `).join("");
  const staffHtml = reportData.groupedStaff.length > 0
    ? reportData.groupedStaff.map((department) => `
        <tr><td>${escapeHtml(department.label)}</td><td>${escapeHtml(department.staff.map((entry) => entry.staffName).join(", ") || "Nil")}</td><td>${escapeHtml(department.note || "Nil")}</td></tr>
      `).join("")
    : "<tr><td colspan='3'>Nil</td></tr>";
  const gasRows = cookingGasOptions.map((gas) => `
    <tr><td>${escapeHtml(gas.label)}</td><td>${escapeHtml(getGasLevelLabel(reportData.gasLevels?.[gas.value]))}</td></tr>
  `).join("");
  const utilityRows = propertyUtilityFields.map((field) => `
    <tr><td>${escapeHtml(field.label)}</td><td>${escapeHtml(getUtilityLabel(field.key, reportData.utilitiesSnapshot?.[field.key]))}</td></tr>
  `).join("");
  const powerRows = (reportData.powerSupplies ?? []).length > 0
    ? reportData.powerSupplies.map((entry) => `<tr><td>${escapeHtml(entry.name)}</td><td>${escapeHtml(formatDuration(entry.durationHours, entry.durationMinutes))}</td></tr>`).join("")
    : "<tr><td colspan='2'>Nil</td></tr>";
  const generatorServiceRows = (reportData.generatorServices ?? []).length > 0
    ? reportData.generatorServices.map((entry) => `<tr><td>${escapeHtml(entry.name)}</td><td>${escapeHtml(formatDuration(entry.serviceHours, entry.serviceMinutes))}</td></tr>`).join("")
    : "<tr><td colspan='2'>Nil</td></tr>";
  const eventRows = (reportData.eventsSnapshot ?? []).length > 0
    ? reportData.eventsSnapshot.map((entry) => `<tr><td>${escapeHtml(entry.eventType || "Event")}</td><td>${escapeHtml(entry.venue || "Not stated")}</td><td>${Number(entry.expectedGuests) || 0}</td></tr>`).join("")
    : "<tr><td colspan='3'>Nil</td></tr>";
  const complaintRows = (reportData.complaintsSnapshot ?? []).length > 0
    ? reportData.complaintsSnapshot.map((entry) => `<tr><td>${escapeHtml(entry.roomNumber || "Not stated")}</td><td>${escapeHtml(getRoomComplaintLabel(entry.complaintType))}</td><td>${escapeHtml(entry.complaintNote || "No note")}</td></tr>`).join("")
    : "<tr><td colspan='3'>Nil</td></tr>";

  reportWindow.document.open();
  reportWindow.document.write(`
    <!doctype html><html><head><title>Sunshine Hotel Night Duty Report ${escapeHtml(reportData.operationalDateKey)}</title>
      <style>
        @page { size: A4; margin: 12mm; }
        * { box-sizing: border-box; }
        body { color: #1f2937; font-family: Arial, sans-serif; margin: 0; }
        h1 { color: #8a6923; font-size: 22px; margin: 0 0 8px; }
        h2 { border-bottom: 2px solid #cbd5e1; border-top: 1px solid #cbd5e1; color: #162338; font-size: 17px; font-weight: 800; margin: 24px 0 8px; padding: 7px 0; }
        h3 { color: #334155; font-size: 14px; font-weight: 700; margin: 16px 0 7px; }
        p { font-size: 11px; line-height: 1.5; }
        table { border-collapse: collapse; font-size: 10px; width: 100%; }
        th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; vertical-align: top; }
        th { background: #f8f3e6; }
        section { break-inside: avoid; }
        .meta { color: #64748b; }
        .grand-total { border-bottom: 3px double #8a6923; border-top: 3px double #8a6923; color: #162338; font-size: 16px; font-weight: 900; margin-top: 16px; padding: 10px 0; }
        .actual-total { border-bottom: 1px solid #94a3b8; color: #162338; font-size: 14px; font-weight: 800; margin: 0 0 16px; padding: 8px 0; }
        .signature { border-top: 1px solid #475569; margin-top: 38px; padding-top: 7px; width: 48%; }
      </style>
    </head><body>
      <h1>Sunshine Hotel Night Duty Report</h1>
      <p class="meta"><strong>Activity date:</strong> ${escapeHtml(formatDateKey(reportData.operationalDateKey))}<br>Generated: ${escapeHtml(formatFriendlyDate(reportData.generatedAt))}</p>

      <h2>Occupancy totals by floor</h2>
      <table><thead><tr><th>Floor</th><th>Night Duty total</th><th>Front Office reference</th></tr></thead><tbody>${occupancyRows}<tr><th>Total</th><th>${reportData.occupancyTotal}</th><th></th></tr></tbody></table>
      <h3>Room occupancy by guest source</h3><table><tbody><tr><td>Walk-in guests occupying rooms</td><td>${reportData.guestMix.walkInGuests}</td></tr><tr><td>Corporate guests occupying rooms</td><td>${reportData.guestMix.corporateGuests}</td></tr></tbody></table>
      <p><strong>Discrepancy query:</strong> ${reportData.occupancyQuery?.hasDiscrepancy ? "Yes" : "No"}<br>${escapeHtml(reportData.occupancyQuery?.note || "Nil")}</p>

      <h2>Income dashboard</h2>${incomeHtml}
      <h3>Food and beverage report</h3><table><tbody><tr><td>Food total</td><td>${escapeHtml(formatAmount(reportData.foodBeverageTotals.food))}</td></tr><tr><td>Beverage total</td><td>${escapeHtml(formatAmount(reportData.foodBeverageTotals.beverage))}</td></tr><tr><th>Combined</th><th>${escapeHtml(formatAmount(reportData.foodBeverageTotals.combined))}</th></tr></tbody></table>
      <h3>Brunch report</h3><table><tbody><tr><td>Brunch revenue</td><td>${escapeHtml(formatAmount(reportData.brunchReport.revenue))}</td></tr><tr><td>Brunch attendees</td><td>${reportData.brunchReport.attendees}</td></tr></tbody></table>
      <h3>Separate guest refund account</h3><table><tbody><tr><td>Guest refunds</td><td>${escapeHtml(formatAmount(reportData.guestRefunds))}</td></tr><tr><th colspan="2">Guest refunds are excluded from Grand Revenue and Actual Revenue.</th></tr></tbody></table>
      <p class="grand-total">GRAND REVENUE TOTAL: ${escapeHtml(formatAmount(reportData.grandIncomeTotal))}</p>
      <p class="actual-total">ACTUAL REVENUE TOTAL: ${escapeHtml(formatAmount(reportData.actualRevenueTotal))}</p>

      <h2>Staff on duty and departmental notes</h2>
      <table><thead><tr><th>Department</th><th>Staff</th><th>Night Duty note</th></tr></thead><tbody>${staffHtml}</tbody></table>

      <h2>Utilities</h2>
      <table><tbody>${gasRows}<tr><td>Hot water temperature</td><td>${reportData.hotWaterTemperature ?? "Not set"}°C</td></tr><tr><td>Water supplied</td><td>${reportData.waterSupplyCount ?? 0} time(s)</td></tr>${utilityRows}</tbody></table>
      <h3>Generator service hours</h3><table><thead><tr><th>Generator</th><th>Service time</th></tr></thead><tbody>${generatorServiceRows}</tbody></table>
      <h3>Power supply usage</h3><table><thead><tr><th>Power supply</th><th>Duration</th></tr></thead><tbody>${powerRows}</tbody></table>

      <h2>Incidents</h2>
      ${incidentHtml("Guest incident", reportData.guestIncident)}
      ${incidentHtml("Employee incident", reportData.employeeIncident)}

      <h2>Events</h2>
      <table><thead><tr><th>Event</th><th>Venue</th><th>Expected guests</th></tr></thead><tbody>${eventRows}</tbody></table>

      <h2>Guest complaints</h2>
      <table><thead><tr><th>Room</th><th>Type</th><th>Note</th></tr></thead><tbody>${complaintRows}</tbody></table>
      <div class="signature">Night Duty Supervisor: ${escapeHtml(reportData.nightDutySupervisorSignature || "Not signed")}</div>
    </body></html>
  `);
  reportWindow.document.close();
  reportWindow.focus();
  reportWindow.print();
}

function IncidentEditor({ label, value, onChange, disabled }) {
  function update(field, fieldValue) {
    onChange({ ...value, [field]: fieldValue });
  }

  return (
    <div className="subpanel">
      <div className="flex items-center justify-between gap-3">
        <p className="metric-label">{label}</p>
        <span className="badge">{getIncidentSummary(value)}</span>
      </div>
      <div className="mt-4 flex gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="radio" checked={!value.hasIncident} onChange={() => onChange(buildIncidentSnapshot({ hasIncident: false }))} disabled={disabled} />
          No
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="radio" checked={value.hasIncident} onChange={() => update("hasIncident", true)} disabled={disabled} />
          Yes
        </label>
      </div>
      {value.hasIncident ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="field"><span>Who</span><input value={value.who} onChange={(event) => update("who", event.target.value)} disabled={disabled} maxLength={200} required /></label>
          <label className="field"><span>When</span><input type="datetime-local" value={value.when} onChange={(event) => update("when", event.target.value)} disabled={disabled} required /></label>
          <label className="field sm:col-span-2"><span>How</span><input value={value.how} onChange={(event) => update("how", event.target.value)} disabled={disabled} maxLength={500} required /></label>
          <label className="field sm:col-span-2"><span>Description</span><textarea rows={4} value={value.description} onChange={(event) => update("description", event.target.value)} disabled={disabled} maxLength={1500} required /></label>
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">Nil</p>
      )}
    </div>
  );
}

export default function NightDutyPanel({
  profile,
  operations,
  eventsBookings,
  propertyStatus,
  nightDutyData,
  reportHistory = [],
  onLoadNightDutyReport,
  onLoadNightDutyReportsInRange,
  onBackupNightDutyReportsInRange,
  onLoadNightDutyReportRevisions,
  onLoadInHouseReport,
  onSaveNightDuty,
  onSaveUtilities,
}) {
  const access = getNightDutyAccess(profile);
  const [activeSection, setActiveSection] = useState("report");
  const [occupancyByFloor, setOccupancyByFloor] = useState([]);
  const [occupancyQuery, setOccupancyQuery] = useState({ hasDiscrepancy: false, note: "" });
  const [occupancyGuestMix, setOccupancyGuestMix] = useState(
    buildDefaultNightDutyData().occupancyGuestMix,
  );
  const [incomeForm, setIncomeForm] = useState(buildDefaultNightDutyData().income);
  const [onDutyStaff, setOnDutyStaff] = useState([]);
  const [departmentNotes, setDepartmentNotes] = useState({});
  const [staffDraft, setStaffDraft] = useState({
    departmentKey: nightDutyDepartmentOptions[0]?.value ?? "front_office",
    staffName: "",
  });
  const [gasLevels, setGasLevels] = useState(buildDefaultNightDutyData().gasLevels);
  const [hotWaterTemperature, setHotWaterTemperature] = useState("");
  const [generatorServices, setGeneratorServices] = useState([]);
  const [generatorServiceDraft, setGeneratorServiceDraft] = useState({
    name: "",
    serviceHours: "",
    serviceMinutes: "",
  });
  const [waterSupplyCount, setWaterSupplyCount] = useState(0);
  const [powerSupplies, setPowerSupplies] = useState([]);
  const [powerDraft, setPowerDraft] = useState({
    name: "",
    durationHours: "",
    durationMinutes: "",
  });
  const [utilitiesForm, setUtilitiesForm] = useState(defaultUtilities);
  const [guestIncident, setGuestIncident] = useState(buildDefaultNightDutyData().guestIncident);
  const [employeeIncident, setEmployeeIncident] = useState(buildDefaultNightDutyData().employeeIncident);
  const [nightDutySupervisorSignature, setNightDutySupervisorSignature] = useState("");
  const [selectedReportDate, setSelectedReportDate] = useState(getNightDutyReportDateKey());
  const [loadedSelectedReport, setLoadedSelectedReport] = useState(null);
  const [loadingSelectedReport, setLoadingSelectedReport] = useState(false);
  const [loadedInHouseReport, setLoadedInHouseReport] = useState(null);
  const [loadingInHouseReport, setLoadingInHouseReport] = useState(false);
  const [selectedHistoryDate, setSelectedHistoryDate] = useState("");
  const [loadedHistoryReport, setLoadedHistoryReport] = useState(null);
  const [loadingHistoryReport, setLoadingHistoryReport] = useState(false);
  const [archiveRevisions, setArchiveRevisions] = useState([]);
  const [loadingArchiveRevisions, setLoadingArchiveRevisions] = useState(false);
  const [rangeStartDate, setRangeStartDate] = useState(
    addDaysToDateKey(getNightDutyReportDateKey(), -6),
  );
  const [rangeEndDate, setRangeEndDate] = useState(getNightDutyReportDateKey());
  const [rangeReports, setRangeReports] = useState([]);
  const [loadingRangeReports, setLoadingRangeReports] = useState(false);
  const [backingUpRange, setBackingUpRange] = useState(false);
  const [rangeReportLoaded, setRangeReportLoaded] = useState(false);
  const [exportingRangeDocx, setExportingRangeDocx] = useState(false);
  const [rangeIncomeTab, setRangeIncomeTab] = useState("totals");
  const [selectedRevenueSourceKey, setSelectedRevenueSourceKey] = useState("frontOffice.roomRevenue");
  const [savingSection, setSavingSection] = useState("");
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const selectedLoadRequest = useRef(0);
  const inHouseLoadRequest = useRef(0);
  const historyLoadRequest = useRef(0);
  const currentOperationalDateKey = operations?.operationalDateKey ?? getOperationalDateKey();
  const latestNightDutyReportDateKey = getNightDutyReportDateKey();
  const selectedOperationsSnapshot = useMemo(() => {
    if (loadedInHouseReport?.operationalDateKey === selectedReportDate) {
      return loadedInHouseReport;
    }

    return getOperationsSnapshotForDate(operations, selectedReportDate);
  }, [loadedInHouseReport, operations, selectedReportDate]);
  const selectedFrontOfficeOccupancyByFloor = useMemo(
    () => buildOccupancyByFloor(selectedOperationsSnapshot ?? {}),
    [selectedOperationsSnapshot],
  );
  const cachedSelectedReport = useMemo(
    () => reportHistory.find((entry) =>
      entry.operationalDateKey === selectedReportDate && entry.storageMode !== "d1-full",
    ) ?? null,
    [reportHistory, selectedReportDate],
  );
  const liveSelectedReport = nightDutyData?.operationalDateKey === selectedReportDate
    ? nightDutyData
    : null;
  const editableReport = cachedSelectedReport ?? loadedSelectedReport ?? liveSelectedReport;
  const hasSavedSelectedReport = Boolean(
    editableReport?.updatedAt || editableReport?.updatedAtIso,
  );
  const frontOfficeOccupancyByFloor = useMemo(() => {
    if (selectedOperationsSnapshot) {
      return selectedFrontOfficeOccupancyByFloor;
    }

    if (hasSavedSelectedReport) {
      return editableReport.frontOfficeOccupancyByFloor;
    }

    return selectedReportDate === currentOperationalDateKey
      ? buildOccupancyByFloor(operations)
      : selectedFrontOfficeOccupancyByFloor;
  }, [
    currentOperationalDateKey,
    editableReport,
    hasSavedSelectedReport,
    operations,
    selectedOperationsSnapshot,
    selectedFrontOfficeOccupancyByFloor,
    selectedReportDate,
  ]);
  const eventsSnapshot = useMemo(
    () => hasSavedSelectedReport
      ? editableReport.eventsSnapshot
      : buildEventSnapshots(eventsBookings, selectedReportDate),
    [editableReport, eventsBookings, hasSavedSelectedReport, selectedReportDate],
  );
  const complaintsSnapshot = useMemo(
    () => hasSavedSelectedReport
      ? editableReport.complaintsSnapshot
      : buildComplaintSnapshots(propertyStatus, selectedReportDate),
    [editableReport, hasSavedSelectedReport, propertyStatus, selectedReportDate],
  );

  useEffect(() => {
    const requestId = inHouseLoadRequest.current + 1;
    inHouseLoadRequest.current = requestId;
    setLoadedInHouseReport(null);

    if (!onLoadInHouseReport) {
      setLoadingInHouseReport(false);
      return;
    }

    setLoadingInHouseReport(true);
    onLoadInHouseReport(selectedReportDate)
      .then((storedReport) => {
        if (inHouseLoadRequest.current === requestId) {
          setLoadedInHouseReport(storedReport);
        }
      })
      .catch((error) => {
        if (inHouseLoadRequest.current === requestId) {
          setFeedback({ type: "error", message: error.message });
        }
      })
      .finally(() => {
        if (inHouseLoadRequest.current === requestId) {
          setLoadingInHouseReport(false);
        }
      });
  }, [onLoadInHouseReport, selectedReportDate]);

  useEffect(() => {
    const defaultReport = buildDefaultNightDutyData(selectedReportDate);
    const report = hasSavedSelectedReport ? editableReport : defaultReport;
    setOccupancyByFloor(
      hasSavedSelectedReport ? report.occupancyByFloor : frontOfficeOccupancyByFloor,
    );
    setOccupancyQuery(report.occupancyQuery);
    setOccupancyGuestMix(report.occupancyGuestMix);
    setIncomeForm(report.income);
    setOnDutyStaff(report.onDutyStaff);
    setDepartmentNotes(report.departmentNotes);
    setGasLevels(report.gasLevels);
    setHotWaterTemperature(report.hotWaterTemperature ?? "");
    setGeneratorServices(report.generatorServices ?? []);
    setWaterSupplyCount(report.waterSupplyCount);
    setPowerSupplies(report.powerSupplies);
    setGuestIncident(report.guestIncident);
    setEmployeeIncident(report.employeeIncident);
    setNightDutySupervisorSignature(report.nightDutySupervisorSignature);
    setUtilitiesForm(
      hasSavedSelectedReport && Object.keys(report.utilitiesSnapshot ?? {}).length > 0
        ? report.utilitiesSnapshot
        : selectedReportDate === currentOperationalDateKey
          ? propertyStatus?.utilities ?? defaultUtilities
          : defaultUtilities,
    );
  }, [
    currentOperationalDateKey,
    editableReport,
    frontOfficeOccupancyByFloor,
    hasSavedSelectedReport,
    propertyStatus?.utilities,
    selectedReportDate,
  ]);

  useEffect(() => {
    if (!selectedHistoryDate && reportHistory.length > 0) {
      const firstReport = reportHistory[0];
      setSelectedHistoryDate(firstReport.operationalDateKey);

      if (firstReport.storageMode === "d1-full" && onLoadNightDutyReport) {
        const requestId = historyLoadRequest.current + 1;
        historyLoadRequest.current = requestId;
        setLoadingHistoryReport(true);
        onLoadNightDutyReport(firstReport.operationalDateKey)
          .then((storedReport) => {
            if (historyLoadRequest.current === requestId) setLoadedHistoryReport(storedReport);
          })
          .catch((error) => {
            if (historyLoadRequest.current === requestId) {
              setFeedback({ type: "error", message: error.message });
            }
          })
          .finally(() => {
            if (historyLoadRequest.current === requestId) setLoadingHistoryReport(false);
          });
      }
    }
  }, [onLoadNightDutyReport, reportHistory, selectedHistoryDate]);

  const currentRecord = useMemo(() => ({
    operationalDateKey: selectedReportDate,
    occupancyByFloor,
    frontOfficeOccupancyByFloor,
    occupancyQuery,
    occupancyGuestMix,
    income: incomeForm,
    onDutyStaff,
    departmentNotes,
    gasLevels,
    hotWaterTemperature: hotWaterTemperature === "" ? null : hotWaterTemperature,
    generatorServices,
    powerSupplies,
    waterSupplyCount,
    guestIncident,
    employeeIncident,
    nightDutySupervisorSignature,
    utilitiesSnapshot: utilitiesForm,
    eventsSnapshot,
    complaintsSnapshot,
  }), [
    complaintsSnapshot,
    departmentNotes,
    employeeIncident,
    eventsSnapshot,
    frontOfficeOccupancyByFloor,
    gasLevels,
    generatorServices,
    guestIncident,
    hotWaterTemperature,
    incomeForm,
    occupancyByFloor,
    occupancyGuestMix,
    occupancyQuery,
    onDutyStaff,
    nightDutySupervisorSignature,
    selectedReportDate,
    powerSupplies,
    utilitiesForm,
    waterSupplyCount,
  ]);
  const reportData = useMemo(() => buildNightDutyReportData(currentRecord), [currentRecord]);
  const latestNightDutyReportData = useMemo(
    () => buildNightDutyReportData(nightDutyData ?? buildDefaultNightDutyData()),
    [nightDutyData],
  );
  const groupedStaff = useMemo(
    () => groupOnDutyStaff(onDutyStaff, departmentNotes),
    [departmentNotes, onDutyStaff],
  );
  const selectedHistoryReport = (loadedHistoryReport?.operationalDateKey === selectedHistoryDate
    ? loadedHistoryReport
    : null) ?? reportHistory.find(
    (entry) => entry.operationalDateKey === selectedHistoryDate && entry.storageMode !== "d1-full",
  ) ?? null;
  const selectedHistoryReportData = selectedHistoryReport
    ? buildNightDutyReportData(selectedHistoryReport)
    : null;
  const rangeReportData = useMemo(
    () => rangeReports.map((report) => buildNightDutyReportData(report)),
    [rangeReports],
  );
  const rangeDateKeys = useMemo(
    () => listDateKeysInRange(rangeStartDate, rangeEndDate),
    [rangeEndDate, rangeStartDate],
  );
  const rangeAnalytics = useMemo(
    () => buildNightDutyRangeAnalytics(rangeReportData, rangeDateKeys),
    [rangeDateKeys, rangeReportData],
  );
  const selectedRevenueSource = rangeAnalytics.revenueSources.find(
    (source) => source.sourceKey === selectedRevenueSourceKey,
  ) ?? rangeAnalytics.revenueSources[0] ?? null;
  const currentMonth = selectedReportDate.slice(0, 7);
  const currentDate = new Date(`${selectedReportDate}T12:00:00Z`);
  const weekStart = new Date(currentDate);
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);
  const weekStartKey = weekStart.toISOString().slice(0, 10);
  const weeklyRoomRevenue = reportHistory
    .filter((entry) => entry.operationalDateKey >= weekStartKey && entry.operationalDateKey <= selectedReportDate)
    .reduce((total, entry) => total + getFrontOfficeRoomRevenue(entry.income), 0);
  const monthlyRoomRevenue = reportHistory
    .filter((entry) => entry.operationalDateKey.startsWith(currentMonth))
    .reduce((total, entry) => total + getFrontOfficeRoomRevenue(entry.income), 0);
  const readOnly = !access.canEditPanel || loadingSelectedReport;

  if (!access.canViewPanel) return null;

  async function selectReportDate(dateKey) {
    if (!dateKey) return;

    const requestId = selectedLoadRequest.current + 1;
    selectedLoadRequest.current = requestId;
    setSelectedReportDate(dateKey);
    setLoadedSelectedReport(null);
    setFeedback({ type: "", message: "" });

    const cachedReport = reportHistory.find(
      (entry) => entry.operationalDateKey === dateKey && entry.storageMode !== "d1-full",
    );
    const liveReport = nightDutyData?.operationalDateKey === dateKey
      ? nightDutyData
      : null;

    if (cachedReport || liveReport || !onLoadNightDutyReport) {
      setLoadingSelectedReport(false);
      return;
    }

    setLoadingSelectedReport(true);
    try {
      const storedReport = await onLoadNightDutyReport(dateKey);
      if (selectedLoadRequest.current === requestId) {
        setLoadedSelectedReport(storedReport);
      }
    } catch (error) {
      if (selectedLoadRequest.current === requestId) {
        setFeedback({ type: "error", message: error.message });
      }
    } finally {
      if (selectedLoadRequest.current === requestId) {
        setLoadingSelectedReport(false);
      }
    }
  }

  async function selectHistoryDate(dateKey) {
    const requestId = historyLoadRequest.current + 1;
    historyLoadRequest.current = requestId;
    setSelectedHistoryDate(dateKey);
    setLoadedHistoryReport(null);
    setArchiveRevisions([]);
    setLoadingHistoryReport(false);

    if (!dateKey) return;
    if (reportHistory.some((entry) =>
      entry.operationalDateKey === dateKey && entry.storageMode !== "d1-full",
    )) return;
    if (!onLoadNightDutyReport) return;

    setLoadingHistoryReport(true);
    try {
      const storedReport = await onLoadNightDutyReport(dateKey);
      if (historyLoadRequest.current === requestId) {
        setLoadedHistoryReport(storedReport);
      }
    } catch (error) {
      if (historyLoadRequest.current === requestId) {
        setFeedback({ type: "error", message: error.message });
      }
    } finally {
      if (historyLoadRequest.current === requestId) {
        setLoadingHistoryReport(false);
      }
    }
  }

  async function loadRevisionHistory() {
    if (!selectedHistoryDate || !onLoadNightDutyReportRevisions) return;
    setLoadingArchiveRevisions(true);
    setFeedback({ type: "", message: "" });

    try {
      const revisions = await onLoadNightDutyReportRevisions(selectedHistoryDate);
      setArchiveRevisions(revisions);
      setFeedback({
        type: "success",
        message: revisions.length > 0
          ? `${revisions.length} D1 revision(s) found for ${formatDateKey(selectedHistoryDate)}.`
          : "No Cloudflare D1 revisions exist for this date yet.",
      });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setLoadingArchiveRevisions(false);
    }
  }

  async function loadReportRange({ startDate = rangeStartDate, endDate = rangeEndDate } = {}) {
    const dateKeys = listDateKeysInRange(startDate, endDate);
    if (dateKeys.length === 0) {
      setFeedback({ type: "error", message: "Select a valid start and end date." });
      return;
    }
    if (dateKeys.length > 120) {
      setFeedback({
        type: "error",
        message: "Choose a range of 120 days or fewer to keep the report fast and economical.",
      });
      return;
    }

    const rangeStart = dateKeys[0];
    const rangeEnd = dateKeys[dateKeys.length - 1];
    setLoadingRangeReports(true);
    setRangeReportLoaded(false);
    setFeedback({ type: "", message: "" });

    try {
      const reports = onLoadNightDutyReportsInRange
        ? await onLoadNightDutyReportsInRange(rangeStart, rangeEnd)
        : reportHistory.filter((entry) =>
            entry.operationalDateKey >= rangeStart &&
            entry.operationalDateKey <= rangeEnd,
          );
      setRangeReports([...reports].sort((left, right) =>
        left.operationalDateKey.localeCompare(right.operationalDateKey),
      ));
      setRangeReportLoaded(true);
    } catch (error) {
      setRangeReports([]);
      setFeedback({ type: "error", message: error.message });
    } finally {
      setLoadingRangeReports(false);
    }
  }

  async function loadMonthToDateAnalysis() {
    const endDate = rangeEndDate || latestNightDutyReportDateKey;
    const startDate = `${endDate.slice(0, 7)}-01`;
    setRangeStartDate(startDate);
    setRangeEndDate(endDate);
    await loadReportRange({ startDate, endDate });
  }

  async function backupReportRange() {
    const dateKeys = listDateKeysInRange(rangeStartDate, rangeEndDate);
    if (dateKeys.length === 0 || dateKeys.length > 120) {
      setFeedback({ type: "error", message: "Choose a valid range of 120 days or fewer." });
      return;
    }
    if (!onBackupNightDutyReportsInRange) {
      setFeedback({ type: "error", message: "The Cloudflare D1 backup service is not available." });
      return;
    }

    setBackingUpRange(true);
    setFeedback({ type: "", message: "" });
    try {
      const result = await onBackupNightDutyReportsInRange(
        dateKeys[0],
        dateKeys[dateKeys.length - 1],
      );
      await loadReportRange();
      setFeedback({
        type: "success",
        message: `${result.archivedRecords} Night Duty report(s) backed up in Cloudflare D1. ${result.coveredDates} selected date(s) are marked as checked, and ${result.compactedFirebaseRecords ?? 0} older Firebase report(s) were reduced to compact summaries.`,
      });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setBackingUpRange(false);
    }
  }

  async function saveCurrentReport(sectionName, saveSharedUtilities = false) {
    setSavingSection(sectionName);
    setFeedback({ type: "", message: "" });

    try {
      const saves = [onSaveNightDuty(currentRecord)];
      if (saveSharedUtilities) saves.push(onSaveUtilities({ utilities: utilitiesForm }));
      const [nightDutySaveResult] = await Promise.all(saves);
      setLoadedSelectedReport({
        ...currentRecord,
        updatedAtIso: new Date().toISOString(),
      });
      const savedMessage = `${sectionName} saved and added to the ${formatDateKey(selectedReportDate)} report.`;
      setFeedback({
        type: nightDutySaveResult?.warning ? "warning" : "success",
        message: nightDutySaveResult?.warning
          ? `${savedMessage} ${nightDutySaveResult.warning}`
          : savedMessage,
      });
    } catch (error) {
      const permissionMessage = error?.code === "permission-denied" ||
        error?.code === "firestore/permission-denied"
        ? error.message || "Firestore rejected this save. Publish the latest firestore.rules and confirm the staff profile permissions."
        : error.message;
      setFeedback({ type: "error", message: permissionMessage });
    } finally {
      setSavingSection("");
    }
  }

  function updateIncome(outletKey, fieldKey, value) {
    setIncomeForm((current) => ({
      ...current,
      [outletKey]: { ...current[outletKey], [fieldKey]: value },
    }));
  }

  function updateOccupancy(floorKey, value) {
    setOccupancyByFloor((current) => current.map((floor) =>
      floor.floorKey === floorKey ? { ...floor, occupiedRooms: value } : floor,
    ));
  }

  function addStaff() {
    if (!staffDraft.staffName.trim()) return;
    setOnDutyStaff((current) => [...current, {
      id: `duty-${Date.now()}`,
      departmentKey: staffDraft.departmentKey,
      staffName: staffDraft.staffName.trim(),
    }]);
    setStaffDraft((current) => ({ ...current, staffName: "" }));
  }

  function updateStaff(entryId, field, value) {
    setOnDutyStaff((current) => current.map((entry) =>
      entry.id === entryId ? { ...entry, [field]: value } : entry,
    ));
  }

  function addPowerSupply() {
    if (
      !powerDraft.name.trim() ||
      (powerDraft.durationHours === "" && powerDraft.durationMinutes === "")
    ) return;
    setPowerSupplies((current) => [...current, {
      id: `power-${Date.now()}`,
      name: powerDraft.name.trim(),
      durationHours: powerDraft.durationHours || 0,
      durationMinutes: powerDraft.durationMinutes || 0,
    }]);
    setPowerDraft({ name: "", durationHours: "", durationMinutes: "" });
  }

  function addGeneratorService() {
    if (
      !generatorServiceDraft.name.trim() ||
      (generatorServiceDraft.serviceHours === "" &&
        generatorServiceDraft.serviceMinutes === "")
    ) return;

    setGeneratorServices((current) => [...current, {
      id: `generator-service-${Date.now()}`,
      name: generatorServiceDraft.name.trim(),
      serviceHours: generatorServiceDraft.serviceHours || 0,
      serviceMinutes: generatorServiceDraft.serviceMinutes || 0,
    }]);
    setGeneratorServiceDraft({ name: "", serviceHours: "", serviceMinutes: "" });
  }

  function handleDownload(report = reportData) {
    downloadTextPdf({
      filename: `sunshine-night-duty-report-${report.operationalDateKey}.pdf`,
      title: "Sunshine Hotel Night Duty Report",
      lines: buildNightDutyReportLines(report),
    });
  }

  function handleRangeDownload() {
    const dateKeys = listDateKeysInRange(rangeStartDate, rangeEndDate);
    if (dateKeys.length === 0) return;
    const rangeStart = dateKeys[0];
    const rangeEnd = dateKeys[dateKeys.length - 1];

    downloadTextPdf({
      filename: `sunshine-night-duty-full-report-${rangeStart}-to-${rangeEnd}.pdf`,
      title: "Sunshine Hotel Full Night Duty Report",
      lines: buildNightDutyRangeReportLines(rangeReportData, rangeStart, rangeEnd),
    });
  }

  async function handleRangeDocxDownload() {
    const dateKeys = listDateKeysInRange(rangeStartDate, rangeEndDate);
    if (dateKeys.length === 0 || rangeReportData.length === 0) return;
    const rangeStart = dateKeys[0];
    const rangeEnd = dateKeys[dateKeys.length - 1];
    setExportingRangeDocx(true);

    try {
      await downloadNightDutyRangeDocx({
        filename: `sunshine-night-duty-analysis-${rangeStart}-to-${rangeEnd}.docx`,
        title: "Sunshine Hotel Night Duty Range Analysis",
        rangeLabel: `${formatDateKey(rangeStart)} to ${formatDateKey(rangeEnd)}`,
        lines: buildNightDutyRangeReportLines(rangeReportData, rangeStart, rangeEnd),
      });
    } catch (error) {
      setFeedback({ type: "error", message: `Word export could not be created. ${error.message}` });
    } finally {
      setExportingRangeDocx(false);
    }
  }

  const summaryCards = [
    { label: "Night Duty occupancy", value: reportData.occupancyTotal },
    {
      label: "Front Office occupancy",
      value: frontOfficeOccupancyByFloor.reduce(
        (total, floor) => total + Number(floor.occupiedRooms || 0),
        0,
      ),
    },
    { label: "Grand revenue", value: formatAmount(reportData.grandIncomeTotal) },
    { label: "Actual revenue", value: formatAmount(reportData.actualRevenueTotal) },
    { label: "Archived reports", value: reportHistory.length },
  ];

  return (
    <section className="panel p-4 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="section-title">Night Duty</h2>
          <p className="section-copy max-w-3xl">
            Select any past activity date. The dated Front Office In-house report for that same date is loaded automatically, keeping both reports synchronized.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 no-print">
          <button type="button" onClick={() => printNightDutyReport(latestNightDutyReportData)} className="button-secondary">Print latest report ({formatDateKey(latestNightDutyReportData.operationalDateKey)})</button>
          <button type="button" onClick={() => handleDownload(latestNightDutyReportData)} className="button-secondary">Download latest PDF</button>
        </div>
      </div>

      <div className="subpanel mt-6 no-print">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="field">
            <span>Activity date covered by this report</span>
            <input
              type="date"
              value={selectedReportDate}
              max={latestNightDutyReportDateKey}
              onChange={(event) => selectReportDate(event.target.value)}
              disabled={Boolean(savingSection)}
            />
          </label>
          <button
            type="button"
            className="button-secondary"
            onClick={() => selectReportDate(latestNightDutyReportDateKey)}
            disabled={Boolean(savingSection) || selectedReportDate === latestNightDutyReportDateKey}
          >
            Use yesterday
          </button>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          {loadingSelectedReport || loadingInHouseReport
            ? "Loading the Night Duty report and dated In-house reference..."
            : hasSavedSelectedReport
              ? `Saved Night Duty report loaded for ${formatDateKey(selectedReportDate)}. ${loadedInHouseReport ? "Its Front Office reference is synchronized with the dated In-house report." : "You can continue editing it."}`
              : selectedOperationsSnapshot
                ? `No saved Night Duty report exists for ${formatDateKey(selectedReportDate)}. The matching dated Front Office In-house occupancy has been loaded.`
                : `No saved report exists for ${formatDateKey(selectedReportDate)}, and no Front Office archive was found for that date. Occupancy starts at zero and can be entered manually.`}
        </p>
        <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Every input and save button below applies only to {formatDateKey(selectedReportDate)}.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => printNightDutyReport(reportData)} className="button-secondary" disabled={loadingSelectedReport || loadingInHouseReport}>Print Night Duty for {formatDateKey(selectedReportDate)}</button>
          <button type="button" onClick={() => handleDownload(reportData)} className="button-secondary" disabled={loadingSelectedReport || loadingInHouseReport}>Download Night Duty PDF for selected date</button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {summaryCards.map((card) => (
          <div key={card.label} className="subpanel"><span className="metric-label">{card.label}</span><span className="metric-value">{card.value}</span></div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-3 no-print">
        {[
          ["report", "Occupancy"],
          ["income", "Income"],
          ["duty", "On Duty"],
          ["utilities", "Utilities"],
          ["incidents", "Incidents & Sign-off"],
          ["archive", "Reports by Date / Range"],
        ].map(([key, label]) => (
          <SectionButton key={key} label={label} active={activeSection === key} onClick={() => setActiveSection(key)} />
        ))}
      </div>

      {feedback.message ? (
        <div className={`mt-5 rounded-2xl px-4 py-3 text-sm ${feedback.type === "success" ? "bg-emerald-50 text-emerald-700" : feedback.type === "warning" ? "bg-amber-50 text-amber-800" : "bg-rose-50 text-rose-700"}`}>{feedback.message}</div>
      ) : null}

      {activeSection === "report" ? (
        <form onSubmit={(event) => { event.preventDefault(); saveCurrentReport("Occupancy report"); }} className="mt-6 space-y-6 no-print">
          <div className="subpanel">
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="metric-label">Total occupancy by floor</p><span className="badge">Night Duty figures do not change Front Office data</span></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {occupancyByFloor.map((floor) => {
                const official = frontOfficeOccupancyByFloor.find((entry) => entry.floorKey === floor.floorKey)?.occupiedRooms ?? 0;
                return (
                  <label key={floor.floorKey} className="field rounded-2xl border border-slate-200 bg-white p-4">
                    <span>{floor.floorLabel}</span>
                    <input type="number" min="0" max={roomGroups.find((group) => group.key === floor.floorKey)?.rooms.length ?? 88} value={floor.occupiedRooms} onChange={(event) => updateOccupancy(floor.floorKey, event.target.value)} disabled={readOnly || savingSection} />
                    <small className="text-xs text-slate-500">Front Office reference: {official}</small>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="subpanel">
            <p className="metric-label">Room occupancy by guest source</p>
            <p className="mt-2 text-sm text-slate-500">Record guests occupying rooms as walk-in or corporate. These are occupancy counts and are never treated as income or brunch attendance.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="field"><span>Walk-in guests occupying rooms</span><input type="number" min="0" step="1" value={occupancyGuestMix.walkInGuests} onChange={(event) => setOccupancyGuestMix((current) => ({ ...current, walkInGuests: event.target.value }))} disabled={readOnly || savingSection} /></label>
              <label className="field"><span>Corporate guests occupying rooms</span><input type="number" min="0" step="1" value={occupancyGuestMix.corporateGuests} onChange={(event) => setOccupancyGuestMix((current) => ({ ...current, corporateGuests: event.target.value }))} disabled={readOnly || savingSection} /></label>
            </div>
          </div>
          <div className="subpanel">
            <p className="metric-label">Occupancy discrepancy query</p>
            <div className="mt-4 flex gap-4">
              <label className="flex items-center gap-2 text-sm"><input type="radio" checked={!occupancyQuery.hasDiscrepancy} onChange={() => setOccupancyQuery({ hasDiscrepancy: false, note: "" })} disabled={readOnly || savingSection} />No discrepancy</label>
              <label className="flex items-center gap-2 text-sm"><input type="radio" checked={occupancyQuery.hasDiscrepancy} onChange={() => setOccupancyQuery((current) => ({ ...current, hasDiscrepancy: true }))} disabled={readOnly || savingSection} />Raise query</label>
            </div>
            {occupancyQuery.hasDiscrepancy ? <label className="field mt-4"><span>Discrepancy details</span><textarea rows={4} value={occupancyQuery.note} onChange={(event) => setOccupancyQuery((current) => ({ ...current, note: event.target.value }))} disabled={readOnly || savingSection} maxLength={1500} required /></label> : <p className="mt-4 text-sm text-slate-500">Nil</p>}
          </div>
          <button type="submit" className="button-primary w-full" disabled={readOnly || savingSection}>{savingSection === "Occupancy report" ? "Saving..." : "Save occupancy report"}</button>
        </form>
      ) : null}

      {activeSection === "income" ? (
        <form onSubmit={(event) => { event.preventDefault(); saveCurrentReport("Income dashboard"); }} className="mt-6 space-y-6 no-print">
          <div className="grid gap-4 xl:grid-cols-2">
            {nightDutyOutletConfig.map((outlet) => (
              <div key={outlet.key} className="subpanel">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="metric-label">{outlet.label}</p>
                  <div className="flex flex-wrap gap-2">
                    <span className="badge">Grand {formatAmount(getOutletTotal(incomeForm, outlet.key, { includeNonRevenue: true }))}</span>
                    <span className="badge">Actual {formatAmount(getOutletTotal(incomeForm, outlet.key))}</span>
                  </div>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {outlet.fields.map((field) => (
                    <label key={field.key} className="field">
                      <span>{field.label}{field.nonFinancial ? " — attendance count" : field.separateAccount ? " — separate refund account" : field.excludeFromRevenue ? " — Grand Revenue only" : ""}</span>
                      <input type="number" min="0" max={field.nonFinancial ? "1000000" : undefined} step={field.nonFinancial ? "1" : "0.01"} value={incomeForm?.[outlet.key]?.[field.key] ?? 0} onChange={(event) => updateIncome(outlet.key, field.key, event.target.value)} disabled={readOnly || savingSection} />
                    </label>
                  ))}
                </div>
                {outlet.key === "restaurant" ? <p className="mt-3 text-xs leading-5 text-slate-500">Brunch revenue is included in both totals. Brunch attendees is a head count and is never added as money.</p> : null}
                {outlet.key === "frontOffice" ? <p className="mt-3 text-xs leading-5 text-slate-500">Guest refunds are kept as a separate account and are excluded from both Grand Revenue and Actual Revenue. Advance payments and deposits are included in Grand Revenue but excluded from Actual Revenue.</p> : null}
              </div>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="subpanel"><p className="metric-label">Grand Revenue — revenue and deposits</p><p className="mt-4 text-3xl font-semibold text-[#162338]">{formatAmount(getGrandIncomeTotal(incomeForm))}</p><p className="mt-2 text-xs text-slate-500">Guest refunds excluded</p></div>
            <div className="subpanel"><p className="metric-label">Actual Revenue — included revenue only</p><p className="mt-4 text-3xl font-semibold text-[#162338]">{formatAmount(getActualRevenueTotal(incomeForm))}</p></div>
            <div className="subpanel border-rose-200 bg-rose-50"><p className="metric-label">Guest refunds — separate account</p><p className="mt-4 text-3xl font-semibold text-rose-800">{formatAmount(getGuestRefundTotal(incomeForm))}</p><p className="mt-2 text-xs text-rose-700">Not included in either revenue total</p></div>
          </div>
          <button type="submit" className="button-primary w-full" disabled={readOnly || savingSection}>{savingSection === "Income dashboard" ? "Saving..." : "Save income dashboard"}</button>
        </form>
      ) : null}

      {activeSection === "duty" ? (
        <form onSubmit={(event) => { event.preventDefault(); saveCurrentReport("Staff on duty"); }} className="mt-6 space-y-6 no-print">
          <div className="subpanel">
            <div className="grid gap-4 sm:grid-cols-2"><label className="field"><span>Department</span><select value={staffDraft.departmentKey} onChange={(event) => setStaffDraft((current) => ({ ...current, departmentKey: event.target.value }))} disabled={readOnly || savingSection}>{nightDutyDepartmentOptions.map((department) => <option key={department.value} value={department.value}>{department.label}</option>)}</select></label><label className="field"><span>Staff name</span><input value={staffDraft.staffName} onChange={(event) => setStaffDraft((current) => ({ ...current, staffName: event.target.value }))} disabled={readOnly || savingSection} maxLength={120} /></label></div>
            <button type="button" onClick={addStaff} disabled={readOnly || savingSection || !staffDraft.staffName.trim()} className="button-secondary mt-4 w-full">Add staff on duty</button>
          </div>
          <div className="space-y-4">
            {nightDutyDepartmentOptions.map((department) => {
              const staff = onDutyStaff.filter((entry) => entry.departmentKey === department.value);
              return (
                <div key={department.value} className="subpanel">
                  <div className="flex items-center justify-between"><p className="metric-label">{department.label}</p><span className="badge">{staff.length} staff</span></div>
                  <div className="mt-4 space-y-3">
                    {staff.length > 0 ? staff.map((entry) => <div key={entry.id} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_12rem_auto]"><input aria-label={`${department.label} staff name`} value={entry.staffName} onChange={(event) => updateStaff(entry.id, "staffName", event.target.value)} disabled={readOnly || savingSection} maxLength={120} /><select aria-label={`${entry.staffName} department`} value={entry.departmentKey} onChange={(event) => updateStaff(entry.id, "departmentKey", event.target.value)} disabled={readOnly || savingSection}>{nightDutyDepartmentOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ActionButton label="Remove" tone="danger" onClick={() => setOnDutyStaff((current) => current.filter((item) => item.id !== entry.id))} /></div>) : <p className="text-sm text-slate-500">No staff listed.</p>}
                  </div>
                  <label className="field mt-4"><span>Night Duty notes for {department.label}</span><textarea rows={3} value={departmentNotes[department.value] ?? ""} onChange={(event) => setDepartmentNotes((current) => ({ ...current, [department.value]: event.target.value }))} disabled={readOnly || savingSection} maxLength={1000} placeholder="Add observations or handover notes for this department." /></label>
                </div>
              );
            })}
          </div>
          <button type="submit" className="button-primary w-full" disabled={readOnly || savingSection}>{savingSection === "Staff on duty" ? "Saving..." : "Save staff and departmental notes"}</button>
        </form>
      ) : null}

      {activeSection === "utilities" ? (
        <form onSubmit={(event) => { event.preventDefault(); saveCurrentReport("Utilities", selectedReportDate === currentOperationalDateKey); }} className="mt-6 space-y-6 no-print">
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="subpanel">
              <p className="metric-label">Cooking gas quantities</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {cookingGasOptions.map((gas) => (
                  <label key={gas.value} className="field">
                    <span>{gas.label}</span>
                    <input type="number" min="0" max="1000000" step="0.01" value={gasLevels[gas.value] ?? ""} onChange={(event) => setGasLevels((current) => ({ ...current, [gas.value]: event.target.value }))} disabled={readOnly || savingSection} placeholder="Enter quantity" />
                  </label>
                ))}
              </div>
            </div>
            <div className="subpanel">
              <p className="metric-label">Water and temperature</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="field"><span>Hot water temperature (°C)</span><input type="number" min="0" max="120" step="0.01" value={hotWaterTemperature} onChange={(event) => setHotWaterTemperature(event.target.value)} disabled={readOnly || savingSection} /></label>
                <label className="field"><span>Number of times water was supplied</span><input type="number" min="0" max="1000" step="1" value={waterSupplyCount} onChange={(event) => setWaterSupplyCount(event.target.value)} disabled={readOnly || savingSection} /></label>
              </div>
            </div>
          </div>
          <div className="subpanel">
            <p className="metric-label">Generator service hours</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_auto]">
              <label className="field"><span>Generator name</span><input value={generatorServiceDraft.name} onChange={(event) => setGeneratorServiceDraft((current) => ({ ...current, name: event.target.value }))} disabled={readOnly || savingSection} placeholder="Generator 1" maxLength={100} /></label>
              <label className="field"><span>Hours</span><input type="number" min="0" max="100000" step="1" value={generatorServiceDraft.serviceHours} onChange={(event) => setGeneratorServiceDraft((current) => ({ ...current, serviceHours: event.target.value }))} disabled={readOnly || savingSection} /></label>
              <label className="field"><span>Minutes</span><input type="number" min="0" max="59" step="1" value={generatorServiceDraft.serviceMinutes} onChange={(event) => setGeneratorServiceDraft((current) => ({ ...current, serviceMinutes: event.target.value }))} disabled={readOnly || savingSection} /></label>
              <button type="button" onClick={addGeneratorService} className="button-secondary self-end" disabled={readOnly || savingSection || !generatorServiceDraft.name.trim() || (generatorServiceDraft.serviceHours === "" && generatorServiceDraft.serviceMinutes === "")}>Add generator service hour</button>
            </div>
            <div className="mt-4 space-y-3">
              {generatorServices.length > 0 ? generatorServices.map((entry) => (
                <div key={entry.id} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_auto]">
                  <input aria-label="Generator name" value={entry.name} onChange={(event) => setGeneratorServices((current) => current.map((item) => item.id === entry.id ? { ...item, name: event.target.value } : item))} disabled={readOnly || savingSection} maxLength={100} />
                  <input aria-label={`${entry.name} service hours`} type="number" min="0" max="100000" step="1" value={entry.serviceHours} onChange={(event) => setGeneratorServices((current) => current.map((item) => item.id === entry.id ? { ...item, serviceHours: event.target.value } : item))} disabled={readOnly || savingSection} />
                  <input aria-label={`${entry.name} service minutes`} type="number" min="0" max="59" step="1" value={entry.serviceMinutes} onChange={(event) => setGeneratorServices((current) => current.map((item) => item.id === entry.id ? { ...item, serviceMinutes: event.target.value } : item))} disabled={readOnly || savingSection} />
                  <ActionButton label="Remove" tone="danger" onClick={() => setGeneratorServices((current) => current.filter((item) => item.id !== entry.id))} />
                </div>
              )) : <p className="text-sm text-slate-500">No generator service hour added.</p>}
            </div>
          </div>
          <div className="subpanel">
            <p className="metric-label">Power supply usage</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_auto]">
              <label className="field"><span>Power supply name</span><input value={powerDraft.name} onChange={(event) => setPowerDraft((current) => ({ ...current, name: event.target.value }))} disabled={readOnly || savingSection} placeholder="Generator 1, EEDC, inverter..." /></label>
              <label className="field"><span>Hours</span><input type="number" min="0" max="72" step="1" value={powerDraft.durationHours} onChange={(event) => setPowerDraft((current) => ({ ...current, durationHours: event.target.value }))} disabled={readOnly || savingSection} /></label>
              <label className="field"><span>Minutes</span><input type="number" min="0" max="59" step="1" value={powerDraft.durationMinutes} onChange={(event) => setPowerDraft((current) => ({ ...current, durationMinutes: event.target.value }))} disabled={readOnly || savingSection} /></label>
              <button type="button" onClick={addPowerSupply} className="button-secondary self-end" disabled={readOnly || savingSection || !powerDraft.name.trim() || (powerDraft.durationHours === "" && powerDraft.durationMinutes === "")}>Add power supply</button>
            </div>
            <div className="mt-4 space-y-3">
              {powerSupplies.length > 0 ? powerSupplies.map((entry) => (
                <div key={entry.id} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_auto]">
                  <input aria-label="Power supply name" value={entry.name} onChange={(event) => setPowerSupplies((current) => current.map((item) => item.id === entry.id ? { ...item, name: event.target.value } : item))} disabled={readOnly || savingSection} />
                  <input aria-label={`${entry.name} hours used`} type="number" min="0" max="72" step="1" value={entry.durationHours} onChange={(event) => setPowerSupplies((current) => current.map((item) => item.id === entry.id ? { ...item, durationHours: event.target.value } : item))} disabled={readOnly || savingSection} />
                  <input aria-label={`${entry.name} minutes used`} type="number" min="0" max="59" step="1" value={entry.durationMinutes ?? 0} onChange={(event) => setPowerSupplies((current) => current.map((item) => item.id === entry.id ? { ...item, durationMinutes: event.target.value } : item))} disabled={readOnly || savingSection} />
                  <ActionButton label="Remove" tone="danger" onClick={() => setPowerSupplies((current) => current.filter((item) => item.id !== entry.id))} />
                </div>
              )) : <p className="text-sm text-slate-500">No power supply added.</p>}
            </div>
          </div>
          <div className="subpanel"><p className="metric-label">Other utility readings</p><div className="mt-4 grid gap-4 sm:grid-cols-2">{propertyUtilityFields.map((field) => <label key={field.key} className="field"><span>{field.label}</span>{field.inputType === "number" ? <input type="number" min="0" step="0.01" value={utilitiesForm[field.key] ?? ""} onChange={(event) => setUtilitiesForm((current) => ({ ...current, [field.key]: event.target.value }))} disabled={readOnly || savingSection} /> : <select value={utilitiesForm[field.key] ?? ""} onChange={(event) => setUtilitiesForm((current) => ({ ...current, [field.key]: event.target.value }))} disabled={readOnly || savingSection}><option value="">Select level</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}</label>)}</div></div>
          <button type="submit" className="button-primary w-full" disabled={readOnly || savingSection}>{savingSection === "Utilities" ? "Saving..." : "Save utilities"}</button>
        </form>
      ) : null}

      {activeSection === "incidents" ? (
        <form onSubmit={(event) => { event.preventDefault(); saveCurrentReport("Incidents and sign-off"); }} className="mt-6 space-y-6 no-print">
          <div className="grid gap-6 xl:grid-cols-2"><IncidentEditor label="Guest incident" value={guestIncident} onChange={setGuestIncident} disabled={readOnly || Boolean(savingSection)} /><IncidentEditor label="Employee incident" value={employeeIncident} onChange={setEmployeeIncident} disabled={readOnly || Boolean(savingSection)} /></div>
          <label className="field subpanel"><span>Night Duty Supervisor signature name</span><input value={nightDutySupervisorSignature} onChange={(event) => setNightDutySupervisorSignature(event.target.value)} disabled={readOnly || savingSection} maxLength={120} placeholder="Enter the Night Duty Supervisor's full name" /></label>
          <button type="submit" className="button-primary w-full" disabled={readOnly || savingSection}>{savingSection === "Incidents and sign-off" ? "Saving..." : "Save incidents and sign-off"}</button>
        </form>
      ) : null}

      {activeSection === "archive" ? (
        <div className="mt-6 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2"><div className="subpanel"><p className="metric-label">Last 7 days room revenue</p><p className="mt-3 text-3xl font-semibold text-[#162338]">{formatAmount(weeklyRoomRevenue)}</p><p className="mt-2 text-xs text-slate-500">Room revenue only; advance payments are excluded.</p></div><div className="subpanel"><p className="metric-label">{formatDateKey(`${currentMonth}-01`, { month: "long", year: "numeric" })} room revenue</p><p className="mt-3 text-3xl font-semibold text-[#162338]">{formatAmount(monthlyRoomRevenue)}</p><p className="mt-2 text-xs text-slate-500">Room revenue only; advance payments are excluded.</p></div></div>
          <div className="subpanel">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_auto_auto_auto] xl:items-end"><label className="field"><span>Stored activity date</span><input type="date" value={selectedHistoryDate} max={latestNightDutyReportDateKey} onChange={(event) => selectHistoryDate(event.target.value)} /></label><button type="button" className="button-secondary" disabled={!selectedHistoryReportData || loadingHistoryReport} onClick={() => selectedHistoryReportData && printNightDutyReport(selectedHistoryReportData)}>Print selected report</button><button type="button" className="button-secondary" disabled={!selectedHistoryReportData || loadingHistoryReport} onClick={() => selectedHistoryReportData && handleDownload(selectedHistoryReportData)}>Download selected PDF</button><button type="button" className="button-secondary" disabled={!hasCloudflareArchiveConfig || !selectedHistoryDate || loadingArchiveRevisions} onClick={loadRevisionHistory}>{loadingArchiveRevisions ? "Loading history..." : "View D1 revisions"}</button></div>
            {loadingHistoryReport ? <p className="mt-5 text-sm text-slate-500">Loading the selected date...</p> : selectedHistoryReportData ? <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><div className="rounded-xl bg-slate-50 p-4 text-sm">Occupancy<br /><strong className="text-xl text-[#162338]">{selectedHistoryReportData.occupancyTotal}</strong></div><div className="rounded-xl bg-slate-50 p-4 text-sm">Grand Revenue<br /><strong className="text-xl text-[#162338]">{formatAmount(selectedHistoryReportData.grandIncomeTotal)}</strong></div><div className="rounded-xl bg-slate-50 p-4 text-sm">Actual Revenue<br /><strong className="text-xl text-[#162338]">{formatAmount(selectedHistoryReportData.actualRevenueTotal)}</strong></div><div className="rounded-xl bg-slate-50 p-4 text-sm">Room revenue<br /><strong className="text-xl text-[#162338]">{formatAmount(getFrontOfficeRoomRevenue(selectedHistoryReportData.income))}</strong></div><div className="rounded-xl bg-slate-50 p-4 text-sm">Guest incident<br /><strong className="text-xl text-[#162338]">{getIncidentSummary(selectedHistoryReportData.guestIncident)}</strong></div><div className="rounded-xl bg-slate-50 p-4 text-sm">Employee incident<br /><strong className="text-xl text-[#162338]">{getIncidentSummary(selectedHistoryReportData.employeeIncident)}</strong></div></div> : <p className="mt-5 text-sm text-slate-500">No stored Night Duty report exists for the selected date.</p>}
            {archiveRevisions.length > 0 ? <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4"><h4 className="font-semibold text-[#162338]">Cloudflare D1 revision history</h4><p className="mt-1 text-xs text-slate-500">These are read-only historical copies. Printing or downloading one does not change the live Firebase report.</p><div className="mt-3 space-y-2">{archiveRevisions.map((revision) => { const revisionReport = buildNightDutyReportData(revision.report); return <div key={revision.revisionId} className="flex flex-col gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"><div><strong>Revision {revision.revisionId}</strong><br /><span className="text-xs text-slate-500">Archived {formatFriendlyDate(revision.archivedAt)} by {revision.archivedByName || "Authorized staff"}</span></div><div className="flex gap-2"><button type="button" className="button-secondary" onClick={() => printNightDutyReport(revisionReport)}>Print</button><button type="button" className="button-secondary" onClick={() => handleDownload(revisionReport)}>Download</button></div></div>; })}</div></div> : null}
          </div>
          <div className="subpanel">
            <div>
              <p className="metric-label">Full report by date range</p>
              <p className="mt-2 text-sm text-slate-500">
                Choose up to 120 activity dates. The app retrieves every stored Night Duty report in the range and combines all daily details into one printable or downloadable report.
              </p>
              <p className={`mt-2 text-xs font-semibold ${hasCloudflareArchiveConfig ? "text-emerald-700" : "text-amber-700"}`}>
                {hasCloudflareArchiveConfig
                  ? "Hybrid archive active: D1 serves fully backed-up ranges; Firebase remains the live source and fallback."
                  : "D1 is not connected in this Hostinger build. Add NEXT_PUBLIC_CLOUDFLARE_ARCHIVE_URL in Hostinger and rebuild; Firebase remains available meanwhile."}
              </p>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_auto_auto] xl:items-end">
              <label className="field"><span>Start date</span><input type="date" value={rangeStartDate} max={latestNightDutyReportDateKey} onChange={(event) => { setRangeStartDate(event.target.value); setRangeReportLoaded(false); }} /></label>
              <label className="field"><span>End date</span><input type="date" value={rangeEndDate} max={latestNightDutyReportDateKey} onChange={(event) => { setRangeEndDate(event.target.value); setRangeReportLoaded(false); }} /></label>
              <button type="button" className="button-primary" onClick={loadReportRange} disabled={loadingRangeReports}>{loadingRangeReports ? "Loading full report..." : "Pull full report"}</button>
              <button type="button" className="button-secondary" onClick={loadMonthToDateAnalysis} disabled={loadingRangeReports || !rangeEndDate}>{loadingRangeReports ? "Loading..." : "Get month-to-date analysis"}</button>
            </div>
            {rangeReportLoaded ? (
              <div className="mt-5">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <div className="rounded-xl bg-slate-50 p-4 text-sm">Reports found<br /><strong className="text-xl text-[#162338]">{rangeAnalytics.reportCount} / {rangeAnalytics.selectedDayCount}</strong></div>
                  <div className="rounded-xl bg-slate-50 p-4 text-sm">Total In-house<br /><strong className="text-xl text-[#162338]">{rangeAnalytics.totalInHouse}</strong><br /><span className="text-xs text-slate-500">occupant-nights</span></div>
                  <div className="rounded-xl bg-slate-50 p-4 text-sm">Average occupancy<br /><strong className="text-xl text-[#162338]">{formatAverage(rangeAnalytics.averageOccupancy)}</strong><br /><span className="text-xs text-slate-500">{formatPercentage(rangeAnalytics.averageOccupancyPercentage)} of 88 rooms</span></div>
                  <div className="rounded-xl bg-slate-50 p-4 text-sm">Grand Revenue<br /><strong className="text-xl text-[#162338]">{formatAmount(rangeAnalytics.grandRevenueTotal)}</strong></div>
                  <div className="rounded-xl bg-slate-50 p-4 text-sm">Actual Revenue<br /><strong className="text-xl text-[#162338]">{formatAmount(rangeAnalytics.actualRevenueTotal)}</strong></div>
                </div>
                {rangeAnalytics.missingDateKeys.length > 0 ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">No stored report for: {rangeAnalytics.missingDateKeys.join(", ")}. These dates are excluded from totals and averages.</p> : null}
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <button type="button" className="button-secondary flex-1" disabled={rangeReportData.length === 0} onClick={() => {
                    const dates = listDateKeysInRange(rangeStartDate, rangeEndDate);
                    if (dates.length > 0) printNightDutyRangeReport(rangeReportData, dates[0], dates[dates.length - 1]);
                  }}>Print full date-range report</button>
                  <button type="button" className="button-secondary flex-1" disabled={rangeReportData.length === 0} onClick={handleRangeDownload}>Download full date-range PDF</button>
                  <button type="button" className="button-secondary flex-1" disabled={rangeReportData.length === 0 || exportingRangeDocx} onClick={handleRangeDocxDownload}>{exportingRangeDocx ? "Creating Word file..." : "Download editable Word (.docx)"}</button>
                  {access.canEditPanel ? <button type="button" className="button-secondary flex-1" disabled={!hasCloudflareArchiveConfig || backingUpRange} onClick={backupReportRange}>{backingUpRange ? "Backing up..." : "Back up this range to D1"}</button> : null}
                </div>
                {rangeReportData.length > 0 ? (
                  <div className="mt-6 space-y-6">
                    <div className="grid gap-4 xl:grid-cols-2">
                      <RangeBarChart
                        title="Total occupants by floor"
                        items={rangeAnalytics.occupancyByFloor.map((floor) => ({ key: floor.floorKey, label: floor.floorLabel, value: floor.totalOccupants }))}
                      />
                      <RangeBarChart
                        title="Grand Revenue by section"
                        items={rangeAnalytics.incomeByOutlet.map((outlet) => ({ key: outlet.key, label: outlet.label, value: outlet.grandRevenueTotal, percentage: outlet.revenueSharePercentage }))}
                        formatValue={formatAmount}
                      />
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                      <RangeLineChart
                        title="Daily occupancy rate"
                        labels={rangeAnalytics.dailyOccupancy.map((day) => day.operationalDateKey)}
                        series={[{ key: "occupancy", label: "Occupancy %", color: "#a67c2e", values: rangeAnalytics.dailyOccupancy.map((day) => Number(day.occupancyPercentage.toFixed(2))) }]}
                        valueSuffix="%"
                      />
                      <RangeLineChart
                        title="Daily revenue trends"
                        labels={rangeAnalytics.dailyIncome.map((day) => day.operationalDateKey)}
                        series={[
                          { key: "grand", label: "Grand Revenue", color: "#a67c2e", values: rangeAnalytics.dailyIncome.map((day) => day.grandRevenueTotal) },
                          { key: "actual", label: "Actual Revenue", color: "#162338", values: rangeAnalytics.dailyIncome.map((day) => day.actualRevenueTotal) },
                          { key: "room", label: "Room Revenue", color: "#0f766e", values: rangeAnalytics.dailyIncome.map((day) => day.roomRevenue) },
                        ]}
                      />
                    </div>

                    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
                      <div>
                        <h4 className="font-semibold text-[#162338]">Room occupancy by guest source</h4>
                        <p className="mt-1 text-xs text-slate-500">These figures describe guests occupying rooms. They are not brunch attendance or revenue.</p>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="rounded-xl bg-slate-50 p-4 text-sm">Walk-in guests occupying rooms<br /><strong className="text-xl text-[#162338]">{rangeAnalytics.guestMixTotals.walkInGuests}</strong><br /><span className="text-xs text-slate-500">{formatPercentage(rangeAnalytics.guestMixTotals.walkInPercentage)}</span></div>
                        <div className="rounded-xl bg-slate-50 p-4 text-sm">Corporate guests occupying rooms<br /><strong className="text-xl text-[#162338]">{rangeAnalytics.guestMixTotals.corporateGuests}</strong><br /><span className="text-xs text-slate-500">{formatPercentage(rangeAnalytics.guestMixTotals.corporatePercentage)}</span></div>
                      </div>
                      <div className="grid gap-4 xl:grid-cols-2">
                        <RangeBarChart title="Walk-in versus corporate room occupancy" items={[{ key: "walk-in", label: "Walk-in", value: rangeAnalytics.guestMixTotals.walkInGuests, percentage: rangeAnalytics.guestMixTotals.walkInPercentage }, { key: "corporate", label: "Corporate", value: rangeAnalytics.guestMixTotals.corporateGuests, percentage: rangeAnalytics.guestMixTotals.corporatePercentage }]} />
                        <RangeLineChart title="Daily room occupancy guest source" labels={rangeAnalytics.dailyOccupancyGuestMix.map((day) => day.operationalDateKey)} series={[{ key: "walk-in", label: "Walk-in", color: "#a67c2e", values: rangeAnalytics.dailyOccupancyGuestMix.map((day) => day.walkInGuests) }, { key: "corporate", label: "Corporate", color: "#162338", values: rangeAnalytics.dailyOccupancyGuestMix.map((day) => day.corporateGuests) }]} />
                      </div>
                      <div className="overflow-x-auto rounded-xl border border-slate-200">
                        <table className="min-w-full text-sm"><caption className="p-3 text-left font-semibold text-[#162338]">Daily room occupancy by guest source</caption><thead><tr className="bg-slate-50 text-left text-slate-500"><th className="px-3 py-2">Date</th><th className="px-3 py-2">Walk-in occupants</th><th className="px-3 py-2">Corporate occupants</th><th className="px-3 py-2">Categorized occupants</th></tr></thead><tbody>{rangeAnalytics.dailyOccupancyGuestMix.map((day) => <tr key={day.operationalDateKey} className="border-t border-slate-100"><td className="px-3 py-2 font-semibold">{formatDateKey(day.operationalDateKey)}</td><td className="px-3 py-2">{day.walkInGuests}</td><td className="px-3 py-2">{day.corporateGuests}</td><td className="px-3 py-2">{day.totalGuests}</td></tr>)}</tbody></table>
                      </div>
                    </div>

                    <RangeLineChart
                      title="Daily outlet revenue trends"
                      labels={rangeAnalytics.dailyIncome.map((day) => day.operationalDateKey)}
                      series={nightDutyOutletConfig.map((outlet, index) => ({
                        key: outlet.key,
                        label: outlet.label,
                        color: ["#a67c2e", "#162338", "#0f766e", "#7c3aed"][index % 4],
                        values: rangeAnalytics.dailyIncome.map((day) => day.outlets[outlet.key]),
                      }))}
                    />

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap gap-2">
                        <SectionButton active={rangeIncomeTab === "totals"} label="Total income" onClick={() => setRangeIncomeTab("totals")} />
                        <SectionButton active={rangeIncomeTab === "daily"} label="Daily income" onClick={() => setRangeIncomeTab("daily")} />
                        <SectionButton active={rangeIncomeTab === "brunch-refunds"} label="Brunch and refunds" onClick={() => setRangeIncomeTab("brunch-refunds")} />
                      </div>
                    </div>

                    {rangeIncomeTab === "totals" ? (
                      <div className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-3">
                          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">Food total<br /><strong className="text-xl text-[#162338]">{formatAmount(rangeAnalytics.foodBeverageTotals.food)}</strong></div>
                          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">Beverage total<br /><strong className="text-xl text-[#162338]">{formatAmount(rangeAnalytics.foodBeverageTotals.beverage)}</strong></div>
                          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">Combined F&amp;B<br /><strong className="text-xl text-[#162338]">{formatAmount(rangeAnalytics.foodBeverageTotals.combined)}</strong></div>
                        </div>
                        <RangeBarChart
                          title="Food versus beverage contribution"
                          items={[
                            { key: "food", label: "Food", value: rangeAnalytics.foodBeverageTotals.food },
                            { key: "beverage", label: "Beverage", value: rangeAnalytics.foodBeverageTotals.beverage },
                          ]}
                          formatValue={formatAmount}
                        />
                        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                          <table className="min-w-full text-sm"><caption className="p-3 text-left font-semibold text-[#162338]">Total of every revenue source</caption><thead><tr className="bg-slate-50 text-left text-slate-500"><th className="px-3 py-2">Section</th><th className="px-3 py-2">Revenue source</th><th className="px-3 py-2">Range total</th><th className="px-3 py-2">Treatment</th></tr></thead><tbody>{rangeAnalytics.revenueSources.map((source) => <tr key={source.sourceKey} className="border-t border-slate-100"><td className="px-3 py-2">{source.outletLabel}</td><td className="px-3 py-2 font-semibold">{source.fieldLabel}</td><td className="px-3 py-2">{formatAmount(source.total)}</td><td className="px-3 py-2 text-slate-500">{source.treatment}</td></tr>)}</tbody></table>
                        </div>
                      </div>
                    ) : null}

                    {rangeIncomeTab === "daily" ? (
                      <div className="space-y-4">
                        <label className="field max-w-xl"><span>Revenue source trend</span><select value={selectedRevenueSource?.sourceKey ?? ""} onChange={(event) => setSelectedRevenueSourceKey(event.target.value)}>{rangeAnalytics.revenueSources.map((source) => <option key={source.sourceKey} value={source.sourceKey}>{source.outletLabel} — {source.fieldLabel}</option>)}</select></label>
                        {selectedRevenueSource ? <RangeLineChart title={`${selectedRevenueSource.outletLabel} — ${selectedRevenueSource.fieldLabel} daily trend`} labels={rangeAnalytics.dailyRevenueSources.map((day) => day.operationalDateKey)} series={[{ key: selectedRevenueSource.sourceKey, label: selectedRevenueSource.fieldLabel, color: "#a67c2e", values: rangeAnalytics.dailyRevenueSources.map((day) => day.values[selectedRevenueSource.sourceKey]) }]} /> : null}
                        <RangeLineChart title="Daily food and beverage trend" labels={rangeAnalytics.dailyFoodBeverage.map((day) => day.operationalDateKey)} series={[{ key: "food", label: "Food", color: "#0f766e", values: rangeAnalytics.dailyFoodBeverage.map((day) => day.food) }, { key: "beverage", label: "Beverage", color: "#7c3aed", values: rangeAnalytics.dailyFoodBeverage.map((day) => day.beverage) }]} />
                        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="min-w-max text-xs"><caption className="p-3 text-left text-sm font-semibold text-[#162338]">Day-by-day value of every revenue source</caption><thead><tr className="bg-slate-50 text-left text-slate-500"><th className="sticky left-0 bg-slate-50 px-3 py-2">Date</th>{rangeAnalytics.revenueSources.map((source) => <th key={source.sourceKey} className="min-w-32 px-3 py-2">{source.outletLabel}<br />{source.fieldLabel}</th>)}</tr></thead><tbody>{rangeAnalytics.dailyRevenueSources.map((day) => <tr key={day.operationalDateKey} className="border-t border-slate-100"><td className="sticky left-0 bg-white px-3 py-2 font-semibold">{formatDateKey(day.operationalDateKey, { month: "short", day: "numeric", year: "numeric" })}</td>{rangeAnalytics.revenueSources.map((source) => <td key={source.sourceKey} className="px-3 py-2">{formatAmount(day.values[source.sourceKey])}</td>)}</tr>)}</tbody></table></div>
                      </div>
                    ) : null}

                    {rangeIncomeTab === "brunch-refunds" ? (
                      <div className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">Brunch<br /><strong className="text-xl text-[#162338]">{formatAmount(rangeAnalytics.totalBrunchRevenue)}</strong><br /><span className="text-xs text-slate-500">{rangeAnalytics.totalBrunchAttendees} attendees</span></div>
                          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm">Guest refunds<br /><strong className="text-xl text-rose-800">{formatAmount(rangeAnalytics.guestRefundsTotal)}</strong><br /><span className="text-xs text-rose-700">Excluded from all revenue totals</span></div>
                        </div>
                        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="min-w-full text-sm"><caption className="p-3 text-left font-semibold text-[#162338]">Daily brunch and separate guest refund account</caption><thead><tr className="bg-slate-50 text-left text-slate-500"><th className="px-3 py-2">Date</th><th className="px-3 py-2">Brunch revenue</th><th className="px-3 py-2">Brunch attendees</th><th className="px-3 py-2">Guest refunds</th></tr></thead><tbody>{rangeAnalytics.dailyBrunch.map((day, index) => <tr key={day.operationalDateKey} className="border-t border-slate-100"><td className="px-3 py-2 font-semibold">{formatDateKey(day.operationalDateKey)}</td><td className="px-3 py-2">{formatAmount(day.revenue)}</td><td className="px-3 py-2">{day.attendees}</td><td className="px-3 py-2 text-rose-700">{formatAmount(rangeAnalytics.dailyGuestRefunds[index]?.amount)}</td></tr>)}</tbody></table></div>
                      </div>
                    ) : null}

                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="min-w-full text-sm"><caption className="p-3 text-left font-semibold text-[#162338]">Floor-by-floor occupancy across the period</caption><thead><tr className="bg-slate-50 text-left text-slate-500"><th className="px-3 py-2">Floor</th><th className="px-3 py-2">Total occupants</th><th className="px-3 py-2">Nightly average</th><th className="px-3 py-2">Highest night</th></tr></thead><tbody>{rangeAnalytics.occupancyByFloor.map((floor) => <tr key={floor.floorKey} className="border-t border-slate-100"><td className="px-3 py-2 font-semibold">{floor.floorLabel}</td><td className="px-3 py-2">{floor.totalOccupants}</td><td className="px-3 py-2">{formatAverage(floor.averageOccupants)}</td><td className="px-3 py-2">{floor.highestOccupancy}</td></tr>)}</tbody></table>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="min-w-full text-sm"><caption className="p-3 text-left font-semibold text-[#162338]">Income totals by section</caption><thead><tr className="bg-slate-50 text-left text-slate-500"><th className="px-3 py-2">Revenue section</th><th className="px-3 py-2">Grand Revenue</th><th className="px-3 py-2">Actual Revenue</th></tr></thead><tbody>{rangeAnalytics.incomeByOutlet.map((outlet) => <tr key={outlet.key} className="border-t border-slate-100"><td className="px-3 py-2 font-semibold">{outlet.label}</td><td className="px-3 py-2">{formatAmount(outlet.grandRevenueTotal)}</td><td className="px-3 py-2">{formatAmount(outlet.actualRevenueTotal)}</td></tr>)}</tbody></table>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="min-w-[900px] text-sm"><caption className="p-3 text-left font-semibold text-[#162338]">Day-by-day income analysis (Grand Revenue by section)</caption><thead><tr className="bg-slate-50 text-left text-slate-500"><th className="px-3 py-2">Date</th>{nightDutyOutletConfig.map((outlet) => <th key={outlet.key} className="px-3 py-2">{outlet.label}</th>)}<th className="px-3 py-2">Grand Revenue</th><th className="px-3 py-2">Actual Revenue</th></tr></thead><tbody>{rangeAnalytics.dailyIncome.map((day) => <tr key={day.operationalDateKey} className="border-t border-slate-100"><td className="px-3 py-2 font-semibold">{formatDateKey(day.operationalDateKey, { month: "short", day: "numeric", year: "numeric" })}</td>{nightDutyOutletConfig.map((outlet) => <td key={outlet.key} className="px-3 py-2">{formatAmount(day.outlets[outlet.key])}</td>)}<td className="px-3 py-2 font-semibold">{formatAmount(day.grandRevenueTotal)}</td><td className="px-3 py-2">{formatAmount(day.actualRevenueTotal)}</td></tr>)}</tbody></table>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-white p-4"><h4 className="font-semibold text-[#162338]">Utilities summary</h4><dl className="mt-3 space-y-2 text-sm">{rangeAnalytics.gasAverages.map((gas) => <div key={gas.value} className="flex justify-between gap-4 border-b border-slate-100 pb-2"><dt>{gas.label} average</dt><dd className="text-right font-semibold">{formatAverage(gas.average)} <span className="font-normal text-slate-400">({gas.recordedDays} days)</span></dd></div>)}<div className="flex justify-between gap-4 border-b border-slate-100 pb-2"><dt>Average hot water</dt><dd className="text-right font-semibold">{formatAverage(rangeAnalytics.averageHotWaterTemperature, "°C")}</dd></div><div className="flex justify-between gap-4 border-b border-slate-100 pb-2"><dt>Total water supplied</dt><dd className="font-semibold">{rangeAnalytics.totalWaterSupplied} time(s)</dd></div><div className="border-b border-slate-100 pb-2"><dt>Latest generator service reading</dt><dd className="mt-1 font-semibold">{rangeAnalytics.latestGeneratorServiceReading ? <><span className="mb-1 block text-xs font-normal text-slate-500">From {formatDateKey(rangeAnalytics.latestGeneratorServiceReading.operationalDateKey)}</span>{rangeAnalytics.latestGeneratorServiceReading.entries.map((entry) => <span key={`${entry.name}-${entry.serviceHours}-${entry.serviceMinutes}`} className="block">{entry.name}: {formatDuration(entry.serviceHours, entry.serviceMinutes)}</span>)}</> : "Nil"}</dd></div><div><dt>Power supply totals</dt><dd className="mt-1 font-semibold">{rangeAnalytics.powerSupplyTotals.length > 0 ? rangeAnalytics.powerSupplyTotals.map((entry) => <span key={entry.name} className="block">{entry.name}: {formatTotalMinutes(entry.totalMinutes)}</span>) : "Nil"}</dd></div></dl></div>
                      <div className="rounded-xl border border-slate-200 bg-white p-4"><h4 className="font-semibold text-[#162338]">Other indicators</h4><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div className="rounded-lg bg-slate-50 p-3">Guest incident days<br /><strong className="text-lg">{rangeAnalytics.guestIncidentDays}</strong></div><div className="rounded-lg bg-slate-50 p-3">Employee incident days<br /><strong className="text-lg">{rangeAnalytics.employeeIncidentDays}</strong></div><div className="rounded-lg bg-slate-50 p-3">Events<br /><strong className="text-lg">{rangeAnalytics.totalEvents}</strong></div><div className="rounded-lg bg-slate-50 p-3">Complaints<br /><strong className="text-lg">{rangeAnalytics.totalComplaints}</strong></div><div className="rounded-lg bg-slate-50 p-3">Brunch attendees<br /><strong className="text-lg">{rangeAnalytics.totalBrunchAttendees}</strong></div></dl></div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4"><h4 className="font-semibold text-[#162338]">Departmental notes</h4>{rangeAnalytics.departmentalNotes.length > 0 ? <ol className="mt-3 space-y-3 text-sm">{rangeAnalytics.departmentalNotes.map((entry, index) => <li key={`${entry.operationalDateKey}-${entry.departmentKey}-${index}`} className="rounded-lg bg-slate-50 p-3"><strong>{formatDateKey(entry.operationalDateKey, { month: "short", day: "numeric", year: "numeric" })} - {entry.departmentLabel}</strong><p className="mt-1 text-slate-600">{entry.note}</p></li>)}</ol> : <p className="mt-3 text-sm text-slate-500">Nil</p>}</div>

                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="min-w-full text-sm"><caption className="p-3 text-left font-semibold text-[#162338]">Stored daily reports</caption><thead><tr className="bg-slate-50 text-left text-slate-500"><th className="px-3 py-2">Activity date</th><th className="px-3 py-2">Occupancy</th><th className="px-3 py-2">Grand Revenue</th><th className="px-3 py-2">Actual Revenue</th><th className="px-3 py-2">Signed by</th></tr></thead><tbody>{rangeReportData.map((report) => <tr key={report.operationalDateKey} className="border-t border-slate-100"><td className="px-3 py-2 font-semibold">{formatDateKey(report.operationalDateKey)}</td><td className="px-3 py-2">{report.occupancyTotal}</td><td className="px-3 py-2">{formatAmount(report.grandIncomeTotal)}</td><td className="px-3 py-2">{formatAmount(report.actualRevenueTotal)}</td><td className="px-3 py-2">{report.nightDutySupervisorSignature || "Not signed"}</td></tr>)}</tbody></table>
                    </div>
                  </div>
                ) : <p className="mt-4 text-sm text-slate-500">No stored Night Duty reports were found in the selected range.</p>}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {activeSection === "report" ? (
        <div className="mt-6 subpanel">
          <p className="metric-label">Current report preview</p>
          <div className="mt-4 overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="text-left text-slate-500"><th className="px-3 py-2">Floor</th><th className="px-3 py-2">Night Duty occupancy</th><th className="px-3 py-2">Front Office reference</th></tr></thead><tbody>{reportData.occupancyByFloor.map((floor) => <tr key={floor.floorKey} className="border-t border-slate-100"><td className="px-3 py-2 font-semibold">{floor.floorLabel}</td><td className="px-3 py-2">{floor.occupiedRooms}</td><td className="px-3 py-2">{reportData.frontOfficeOccupancyByFloor.find((entry) => entry.floorKey === floor.floorKey)?.occupiedRooms ?? 0}</td></tr>)}</tbody></table></div>
          <p className="mt-4 text-sm text-slate-600">Discrepancy query: <strong>{occupancyQuery.hasDiscrepancy ? occupancyQuery.note || "Yes" : "Nil"}</strong></p>
          <p className="mt-2 text-sm text-slate-600">Guest incident: <strong>{getIncidentSummary(guestIncident)}</strong> · Employee incident: <strong>{getIncidentSummary(employeeIncident)}</strong></p>
        </div>
      ) : null}
    </section>
  );
}
