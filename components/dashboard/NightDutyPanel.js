"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildDefaultNightDutyData,
  cookingGasOptions,
  getFrontOfficeRoomRevenue,
  getGasLevelLabel,
  getGrandIncomeTotal,
  getNightDutyReportDateKey,
  getOutletTotal,
  groupOnDutyStaff,
  nightDutyDepartmentOptions,
  nightDutyOutletConfig,
} from "@/data/nightDuty";
import { roomGroups } from "@/data/hotelRooms";
import {
  defaultUtilities,
  getRoomComplaintLabel,
  getUtilityLabel,
  propertyUtilityFields,
} from "@/data/propertyStatus";
import { formatFriendlyDate } from "@/lib/format";
import {
  addDaysToDateKey,
  formatDateKey,
  getOperationalDateKey,
  isWithinOperationalDate,
  listDateKeysInRange,
} from "@/lib/hotelTime";
import { downloadTextPdf } from "@/lib/pdf";
import { getNightDutyAccess } from "@/lib/roles";

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDuration(hours, minutes) {
  const safeHours = Math.max(Math.trunc(Number(hours) || 0), 0);
  const safeMinutes = Math.min(Math.max(Math.trunc(Number(minutes) || 0), 0), 59);
  const parts = [];
  if (safeHours > 0) parts.push(`${safeHours} hour${safeHours === 1 ? "" : "s"}`);
  if (safeMinutes > 0) parts.push(`${safeMinutes} minute${safeMinutes === 1 ? "" : "s"}`);
  return parts.join(" ") || "0 minutes";
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
    revenueTotal: getOutletTotal(record.income, outlet.key),
    recordedTotal: getOutletTotal(record.income, outlet.key, { includeNonRevenue: true }),
  }));

  return {
    ...record,
    generatedAt: new Date(),
    occupancyTotal,
    groupedStaff,
    incomeSections,
    grandIncomeTotal: getGrandIncomeTotal(record.income),
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
  lines.push(
    `Discrepancy query: ${reportData.occupancyQuery?.hasDiscrepancy ? "Yes" : "No"}`,
  );
  lines.push(reportData.occupancyQuery?.note || "Nil");
  lines.push(sectionHeading("Income dashboard"));
  reportData.incomeSections.forEach((outlet) => {
    lines.push(subsectionHeading(outlet.label));
    outlet.fields.forEach((field) => {
      const suffix = field.excludeFromRevenue ? " (not included in revenue total)" : "";
      lines.push(`- ${field.label}: ${formatAmount(reportData.income?.[outlet.key]?.[field.key])}${suffix}`);
    });
    lines.push(`- Revenue total: ${formatAmount(outlet.revenueTotal)}`);
  });
  lines.push({
    text: `GRAND REVENUE TOTAL: ${formatAmount(reportData.grandIncomeTotal)}`,
    bold: true,
    fontSize: 15,
    dividerBefore: true,
    dividerAfter: true,
    spaceBefore: 7,
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
  const grandRevenue = reports.reduce(
    (total, report) => total + Number(report.grandIncomeTotal || 0),
    0,
  );
  const lines = [
    {
      text: `FULL NIGHT DUTY REPORT: ${formatDateKey(rangeStart)} TO ${formatDateKey(rangeEnd)}`,
      bold: true,
      fontSize: 15,
      dividerAfter: true,
      spaceAfter: 6,
    },
    { text: `Stored daily reports found: ${reports.length}`, bold: true },
    { text: `Combined revenue total: ${formatAmount(grandRevenue)}`, bold: true },
  ];

  if (reports.length === 0) {
    lines.push("No stored Night Duty reports were found in this date range.");
    return lines;
  }

  reports.forEach((report, index) => {
    lines.push({
      text: `DAILY REPORT ${index + 1}: ${formatDateKey(report.operationalDateKey)}`,
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

  const combinedRevenue = reports.reduce(
    (total, report) => total + Number(report.grandIncomeTotal || 0),
    0,
  );
  const dailyReports = reports.map((report) => {
    const lineMarkup = buildNightDutyReportLines(report).map((line) => {
      const entry = typeof line === "string" ? { text: line } : line;
      const classes = [
        entry.bold ? "bold" : "",
        entry.dividerBefore ? "divider-before" : "",
        entry.dividerAfter ? "divider-after" : "",
        String(entry.text ?? "").startsWith("GRAND REVENUE TOTAL") ? "grand-total" : "",
      ].filter(Boolean).join(" ");
      return `<div class="${classes}">${escapeHtml(entry.text || " ")}</div>`;
    }).join("");

    return `<article><h2>${escapeHtml(formatDateKey(report.operationalDateKey))}</h2>${lineMarkup}</article>`;
  }).join("");

  reportWindow.document.open();
  reportWindow.document.write(`
    <!doctype html><html><head><title>Sunshine Hotel Full Night Duty Report</title>
      <style>
        @page { size: A4; margin: 12mm; }
        body { color: #1f2937; font-family: Arial, sans-serif; margin: 0; }
        h1 { color: #8a6923; font-size: 22px; margin: 0 0 8px; }
        h2 { border-bottom: 2px solid #cbd5e1; color: #162338; font-size: 18px; margin: 24px 0 10px; padding-bottom: 7px; }
        .summary { border: 1px solid #cbd5e1; margin: 12px 0 20px; padding: 10px; }
        article { break-before: page; }
        article:first-of-type { break-before: auto; }
        article div { font-size: 10.5px; line-height: 1.55; white-space: pre-wrap; }
        .bold { font-weight: 800; }
        .divider-before { border-top: 1px solid #94a3b8; margin-top: 9px; padding-top: 6px; }
        .divider-after { border-bottom: 1px solid #94a3b8; margin-bottom: 6px; padding-bottom: 6px; }
        .grand-total { border-bottom: 3px double #8a6923; border-top: 3px double #8a6923; color: #162338; font-size: 14px; font-weight: 900; margin: 10px 0; padding: 8px 0; }
      </style>
    </head><body>
      <h1>Sunshine Hotel Full Night Duty Report</h1>
      <div class="summary"><strong>Date range:</strong> ${escapeHtml(formatDateKey(rangeStart))} to ${escapeHtml(formatDateKey(rangeEnd))}<br><strong>Stored daily reports:</strong> ${reports.length}<br><strong>Combined revenue:</strong> ${escapeHtml(formatAmount(combinedRevenue))}</div>
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
          ${outlet.fields.map((field) => `<tr><td>${escapeHtml(field.label)}</td><td>${escapeHtml(formatAmount(reportData.income?.[outlet.key]?.[field.key]))}</td><td>${field.excludeFromRevenue ? "Excluded" : "Included"}</td></tr>`).join("")}
          <tr><th>Revenue total</th><th>${escapeHtml(formatAmount(outlet.revenueTotal))}</th><th></th></tr>
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
    <!doctype html><html><head><title>Sunshine Hotel Night Duty Report</title>
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
        .signature { border-top: 1px solid #475569; margin-top: 38px; padding-top: 7px; width: 48%; }
      </style>
    </head><body>
      <h1>Sunshine Hotel Night Duty Report</h1>
      <p class="meta"><strong>Activity date:</strong> ${escapeHtml(formatDateKey(reportData.operationalDateKey))}<br>Generated: ${escapeHtml(formatFriendlyDate(reportData.generatedAt))}</p>

      <h2>Occupancy totals by floor</h2>
      <table><thead><tr><th>Floor</th><th>Night Duty total</th><th>Front Office reference</th></tr></thead><tbody>${occupancyRows}<tr><th>Total</th><th>${reportData.occupancyTotal}</th><th></th></tr></tbody></table>
      <p><strong>Discrepancy query:</strong> ${reportData.occupancyQuery?.hasDiscrepancy ? "Yes" : "No"}<br>${escapeHtml(reportData.occupancyQuery?.note || "Nil")}</p>

      <h2>Income dashboard</h2>${incomeHtml}
      <p class="grand-total">GRAND REVENUE TOTAL: ${escapeHtml(formatAmount(reportData.grandIncomeTotal))}</p>

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
  onLoadInHouseReport,
  onSaveNightDuty,
  onSaveUtilities,
}) {
  const access = getNightDutyAccess(profile);
  const [activeSection, setActiveSection] = useState("report");
  const [occupancyByFloor, setOccupancyByFloor] = useState([]);
  const [occupancyQuery, setOccupancyQuery] = useState({ hasDiscrepancy: false, note: "" });
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
  const [rangeStartDate, setRangeStartDate] = useState(
    addDaysToDateKey(getNightDutyReportDateKey(), -6),
  );
  const [rangeEndDate, setRangeEndDate] = useState(getNightDutyReportDateKey());
  const [rangeReports, setRangeReports] = useState([]);
  const [loadingRangeReports, setLoadingRangeReports] = useState(false);
  const [rangeReportLoaded, setRangeReportLoaded] = useState(false);
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
    () => reportHistory.find((entry) => entry.operationalDateKey === selectedReportDate) ?? null,
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
      setSelectedHistoryDate(reportHistory[0].operationalDateKey);
    }
  }, [reportHistory, selectedHistoryDate]);

  const currentRecord = useMemo(() => ({
    operationalDateKey: selectedReportDate,
    occupancyByFloor,
    frontOfficeOccupancyByFloor,
    occupancyQuery,
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
    occupancyQuery,
    onDutyStaff,
    nightDutySupervisorSignature,
    selectedReportDate,
    powerSupplies,
    utilitiesForm,
    waterSupplyCount,
  ]);
  const reportData = useMemo(() => buildNightDutyReportData(currentRecord), [currentRecord]);
  const groupedStaff = useMemo(
    () => groupOnDutyStaff(onDutyStaff, departmentNotes),
    [departmentNotes, onDutyStaff],
  );
  const selectedHistoryReport = reportHistory.find(
    (entry) => entry.operationalDateKey === selectedHistoryDate,
  ) ?? (loadedHistoryReport?.operationalDateKey === selectedHistoryDate
    ? loadedHistoryReport
    : null);
  const selectedHistoryReportData = selectedHistoryReport
    ? buildNightDutyReportData(selectedHistoryReport)
    : null;
  const rangeReportData = useMemo(
    () => rangeReports.map((report) => buildNightDutyReportData(report)),
    [rangeReports],
  );
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
      (entry) => entry.operationalDateKey === dateKey,
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
    setLoadingHistoryReport(false);

    if (!dateKey) return;
    if (reportHistory.some((entry) => entry.operationalDateKey === dateKey)) return;
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

  async function loadReportRange() {
    const dateKeys = listDateKeysInRange(rangeStartDate, rangeEndDate);
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
          <button type="button" onClick={() => printNightDutyReport(reportData)} className="button-secondary" disabled={loadingSelectedReport}>Print selected date</button>
          <button type="button" onClick={() => handleDownload(reportData)} className="button-secondary" disabled={loadingSelectedReport}>Download selected PDF</button>
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
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          ["archive", "Report Archive"],
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
                <div className="flex flex-wrap items-center justify-between gap-3"><p className="metric-label">{outlet.label}</p><span className="badge">Revenue {formatAmount(getOutletTotal(incomeForm, outlet.key))}</span></div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {outlet.fields.map((field) => (
                    <label key={field.key} className="field"><span>{field.label}{field.excludeFromRevenue ? " — excluded from revenue" : ""}</span><input type="number" min="0" step="0.01" value={incomeForm?.[outlet.key]?.[field.key] ?? 0} onChange={(event) => updateIncome(outlet.key, field.key, event.target.value)} disabled={readOnly || savingSection} /></label>
                  ))}
                </div>
                {outlet.key === "frontOffice" ? <p className="mt-3 text-xs leading-5 text-slate-500">Advance payments and deposits are stored but excluded from revenue totals. Weekly and monthly room-revenue analysis uses Room revenue only.</p> : null}
              </div>
            ))}
          </div>
          <div className="subpanel"><p className="metric-label">Grand revenue total</p><p className="mt-4 text-3xl font-semibold text-[#162338]">{formatAmount(getGrandIncomeTotal(incomeForm))}</p></div>
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
            <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end"><label className="field"><span>Stored activity date</span><input type="date" value={selectedHistoryDate} max={latestNightDutyReportDateKey} onChange={(event) => selectHistoryDate(event.target.value)} /></label><button type="button" className="button-secondary" disabled={!selectedHistoryReportData || loadingHistoryReport} onClick={() => selectedHistoryReportData && printNightDutyReport(selectedHistoryReportData)}>Print selected report</button><button type="button" className="button-secondary" disabled={!selectedHistoryReportData || loadingHistoryReport} onClick={() => selectedHistoryReportData && handleDownload(selectedHistoryReportData)}>Download selected PDF</button></div>
            {loadingHistoryReport ? <p className="mt-5 text-sm text-slate-500">Loading the selected date...</p> : selectedHistoryReportData ? <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-xl bg-slate-50 p-4 text-sm">Occupancy<br /><strong className="text-xl text-[#162338]">{selectedHistoryReportData.occupancyTotal}</strong></div><div className="rounded-xl bg-slate-50 p-4 text-sm">Room revenue<br /><strong className="text-xl text-[#162338]">{formatAmount(getFrontOfficeRoomRevenue(selectedHistoryReportData.income))}</strong></div><div className="rounded-xl bg-slate-50 p-4 text-sm">Guest incident<br /><strong className="text-xl text-[#162338]">{getIncidentSummary(selectedHistoryReportData.guestIncident)}</strong></div><div className="rounded-xl bg-slate-50 p-4 text-sm">Employee incident<br /><strong className="text-xl text-[#162338]">{getIncidentSummary(selectedHistoryReportData.employeeIncident)}</strong></div></div> : <p className="mt-5 text-sm text-slate-500">No stored Night Duty report exists for the selected date.</p>}
          </div>
          <div className="subpanel">
            <div>
              <p className="metric-label">Full report by date range</p>
              <p className="mt-2 text-sm text-slate-500">
                Choose up to 120 activity dates. The app retrieves every stored Night Duty report in the range and combines all daily details into one printable or downloadable report.
              </p>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_auto] xl:items-end">
              <label className="field"><span>Start date</span><input type="date" value={rangeStartDate} max={latestNightDutyReportDateKey} onChange={(event) => { setRangeStartDate(event.target.value); setRangeReportLoaded(false); }} /></label>
              <label className="field"><span>End date</span><input type="date" value={rangeEndDate} max={latestNightDutyReportDateKey} onChange={(event) => { setRangeEndDate(event.target.value); setRangeReportLoaded(false); }} /></label>
              <button type="button" className="button-primary" onClick={loadReportRange} disabled={loadingRangeReports}>{loadingRangeReports ? "Loading full report..." : "Pull full report"}</button>
            </div>
            {rangeReportLoaded ? (
              <div className="mt-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-slate-50 p-4 text-sm">Reports found<br /><strong className="text-xl text-[#162338]">{rangeReportData.length}</strong></div>
                  <div className="rounded-xl bg-slate-50 p-4 text-sm">Combined occupancy<br /><strong className="text-xl text-[#162338]">{rangeReportData.reduce((total, report) => total + report.occupancyTotal, 0)}</strong></div>
                  <div className="rounded-xl bg-slate-50 p-4 text-sm">Combined revenue<br /><strong className="text-xl text-[#162338]">{formatAmount(rangeReportData.reduce((total, report) => total + report.grandIncomeTotal, 0))}</strong></div>
                </div>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <button type="button" className="button-secondary flex-1" disabled={rangeReportData.length === 0} onClick={() => {
                    const dates = listDateKeysInRange(rangeStartDate, rangeEndDate);
                    if (dates.length > 0) printNightDutyRangeReport(rangeReportData, dates[0], dates[dates.length - 1]);
                  }}>Print full date-range report</button>
                  <button type="button" className="button-secondary flex-1" disabled={rangeReportData.length === 0} onClick={handleRangeDownload}>Download full date-range PDF</button>
                </div>
                {rangeReportData.length > 0 ? (
                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full text-sm"><thead><tr className="text-left text-slate-500"><th className="px-3 py-2">Activity date</th><th className="px-3 py-2">Occupancy</th><th className="px-3 py-2">Revenue</th><th className="px-3 py-2">Signed by</th></tr></thead><tbody>{rangeReportData.map((report) => <tr key={report.operationalDateKey} className="border-t border-slate-100"><td className="px-3 py-2 font-semibold">{formatDateKey(report.operationalDateKey)}</td><td className="px-3 py-2">{report.occupancyTotal}</td><td className="px-3 py-2">{formatAmount(report.grandIncomeTotal)}</td><td className="px-3 py-2">{report.nightDutySupervisorSignature || "Not signed"}</td></tr>)}</tbody></table>
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
