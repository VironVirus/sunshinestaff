"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildDefaultNightDutyData,
  cookingGasOptions,
  gasLevelOptions,
  getFrontOfficeRoomRevenue,
  getGasLevelLabel,
  getGrandIncomeTotal,
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
import { formatDateKey, getOperationalDateKey, isWithinOperationalDate } from "@/lib/hotelTime";
import { downloadTextPdf } from "@/lib/pdf";
import { getNightDutyAccess } from "@/lib/roles";

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
  const lines = [
    "Sunshine Hotel Night Duty Report",
    `Operational day: ${formatDateKey(reportData.operationalDateKey)}`,
    `Generated: ${formatFriendlyDate(reportData.generatedAt)}`,
    "",
    "Occupancy totals by floor",
    "Floor | Night Duty total | Front Office reference",
  ];

  reportData.occupancyByFloor.forEach((floor) => {
    const frontOfficeFloor = reportData.frontOfficeOccupancyByFloor?.find(
      (entry) => entry.floorKey === floor.floorKey,
    );
    lines.push(
      `${floor.floorLabel} | ${floor.occupiedRooms} | ${frontOfficeFloor?.occupiedRooms ?? 0}`,
    );
  });
  lines.push(`Total occupancy: ${reportData.occupancyTotal}`);
  lines.push(
    `Discrepancy query: ${reportData.occupancyQuery?.hasDiscrepancy ? "Yes" : "No"}`,
  );
  lines.push(reportData.occupancyQuery?.note || "Nil");
  lines.push("");

  lines.push("Income dashboard");
  reportData.incomeSections.forEach((outlet) => {
    lines.push(outlet.label);
    outlet.fields.forEach((field) => {
      const suffix = field.excludeFromRevenue ? " (not included in revenue total)" : "";
      lines.push(`- ${field.label}: ${formatAmount(reportData.income?.[outlet.key]?.[field.key])}${suffix}`);
    });
    lines.push(`- Revenue total: ${formatAmount(outlet.revenueTotal)}`);
  });
  lines.push(`Grand revenue total: ${formatAmount(reportData.grandIncomeTotal)}`);
  lines.push("");

  lines.push("Staff on duty and departmental notes");
  if (reportData.groupedStaff.length === 0) {
    lines.push("Nil");
  } else {
    reportData.groupedStaff.forEach((department) => {
      lines.push(`${department.label}: ${department.staff.map((entry) => entry.staffName).join(", ") || "Nil"}`);
      lines.push(`Note: ${department.note || "Nil"}`);
    });
  }
  lines.push("");

  lines.push("Utilities");
  cookingGasOptions.forEach((gas) => {
    lines.push(`${gas.label}: ${getGasLevelLabel(reportData.gasLevels?.[gas.value])}`);
  });
  lines.push(`Hot water temperature: ${reportData.hotWaterTemperature ?? "Not set"}°C`);
  lines.push(`Water supplied: ${reportData.waterSupplyCount ?? 0} time(s)`);
  if ((reportData.powerSupplies ?? []).length === 0) {
    lines.push("Power supplies: Nil");
  } else {
    reportData.powerSupplies.forEach((entry) => {
      lines.push(`${entry.name}: ${entry.durationHours} hour(s)`);
    });
  }
  propertyUtilityFields.forEach((field) => {
    lines.push(`${field.label}: ${getUtilityLabel(field.key, reportData.utilitiesSnapshot?.[field.key])}`);
  });
  lines.push("");

  lines.push(...buildIncidentLines("Guest incident", reportData.guestIncident));
  lines.push("");
  lines.push(...buildIncidentLines("Employee incident", reportData.employeeIncident));
  lines.push("");
  lines.push("Events");
  if ((reportData.eventsSnapshot ?? []).length === 0) {
    lines.push("Nil");
  } else {
    reportData.eventsSnapshot.forEach((entry, index) => {
      lines.push(
        `${index + 1}. ${entry.eventType || "Event"} | ${entry.venue || "Venue not stated"} | ${entry.expectedGuests || 0} guest(s)`,
      );
    });
  }
  lines.push("");
  lines.push("Guest complaints");
  if ((reportData.complaintsSnapshot ?? []).length === 0) {
    lines.push("Nil");
  } else {
    reportData.complaintsSnapshot.forEach((entry, index) => {
      lines.push(
        `${index + 1}. Room ${entry.roomNumber || "Not stated"} | ${getRoomComplaintLabel(entry.complaintType)} | ${entry.complaintNote || "No note"}`,
      );
    });
  }
  lines.push("");
  lines.push(
    `Housekeeping supervisor signature: ${reportData.housekeepingSupervisorSignature || "Not signed"}`,
  );

  return lines;
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
    ? reportData.powerSupplies.map((entry) => `<tr><td>${escapeHtml(entry.name)}</td><td>${entry.durationHours} hour(s)</td></tr>`).join("")
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
        h2 { color: #162338; font-size: 17px; margin: 24px 0 8px; }
        h3 { color: #334155; font-size: 14px; margin: 16px 0 7px; }
        p { font-size: 11px; line-height: 1.5; }
        table { border-collapse: collapse; font-size: 10px; width: 100%; }
        th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; vertical-align: top; }
        th { background: #f8f3e6; }
        section { break-inside: avoid; }
        .meta { color: #64748b; }
        .signature { border-top: 1px solid #475569; margin-top: 38px; padding-top: 7px; width: 48%; }
      </style>
    </head><body>
      <h1>Sunshine Hotel Night Duty Report</h1>
      <p class="meta">Operational day: ${escapeHtml(formatDateKey(reportData.operationalDateKey))}<br>Generated: ${escapeHtml(formatFriendlyDate(reportData.generatedAt))}</p>

      <h2>Occupancy totals by floor</h2>
      <table><thead><tr><th>Floor</th><th>Night Duty total</th><th>Front Office reference</th></tr></thead><tbody>${occupancyRows}<tr><th>Total</th><th>${reportData.occupancyTotal}</th><th></th></tr></tbody></table>
      <p><strong>Discrepancy query:</strong> ${reportData.occupancyQuery?.hasDiscrepancy ? "Yes" : "No"}<br>${escapeHtml(reportData.occupancyQuery?.note || "Nil")}</p>

      <h2>Income dashboard</h2>${incomeHtml}
      <p><strong>Grand revenue total:</strong> ${escapeHtml(formatAmount(reportData.grandIncomeTotal))}</p>

      <h2>Staff on duty and departmental notes</h2>
      <table><thead><tr><th>Department</th><th>Staff</th><th>Night Duty note</th></tr></thead><tbody>${staffHtml}</tbody></table>

      <h2>Utilities</h2>
      <table><tbody>${gasRows}<tr><td>Hot water temperature</td><td>${reportData.hotWaterTemperature ?? "Not set"}°C</td></tr><tr><td>Water supplied</td><td>${reportData.waterSupplyCount ?? 0} time(s)</td></tr>${utilityRows}</tbody></table>
      <h3>Power supply usage</h3><table><thead><tr><th>Power supply</th><th>Duration</th></tr></thead><tbody>${powerRows}</tbody></table>

      <h2>Incidents</h2>
      ${incidentHtml("Guest incident", reportData.guestIncident)}
      ${incidentHtml("Employee incident", reportData.employeeIncident)}

      <h2>Events</h2>
      <table><thead><tr><th>Event</th><th>Venue</th><th>Expected guests</th></tr></thead><tbody>${eventRows}</tbody></table>

      <h2>Guest complaints</h2>
      <table><thead><tr><th>Room</th><th>Type</th><th>Note</th></tr></thead><tbody>${complaintRows}</tbody></table>
      <div class="signature">Housekeeping supervisor: ${escapeHtml(reportData.housekeepingSupervisorSignature || "Not signed")}</div>
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
  const [waterSupplyCount, setWaterSupplyCount] = useState(0);
  const [powerSupplies, setPowerSupplies] = useState([]);
  const [powerDraft, setPowerDraft] = useState({ name: "", durationHours: "" });
  const [utilitiesForm, setUtilitiesForm] = useState(defaultUtilities);
  const [guestIncident, setGuestIncident] = useState(buildDefaultNightDutyData().guestIncident);
  const [employeeIncident, setEmployeeIncident] = useState(buildDefaultNightDutyData().employeeIncident);
  const [housekeepingSupervisorSignature, setHousekeepingSupervisorSignature] = useState("");
  const [selectedReportDate, setSelectedReportDate] = useState(getOperationalDateKey());
  const [loadedSelectedReport, setLoadedSelectedReport] = useState(null);
  const [loadingSelectedReport, setLoadingSelectedReport] = useState(false);
  const [selectedHistoryDate, setSelectedHistoryDate] = useState("");
  const [loadedHistoryReport, setLoadedHistoryReport] = useState(null);
  const [loadingHistoryReport, setLoadingHistoryReport] = useState(false);
  const [savingSection, setSavingSection] = useState("");
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const selectedLoadRequest = useRef(0);
  const historyLoadRequest = useRef(0);
  const currentOperationalDateKey = operations?.operationalDateKey ?? getOperationalDateKey();
  const currentFrontOfficeOccupancyByFloor = useMemo(
    () => buildOccupancyByFloor(operations),
    [operations],
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
    if (hasSavedSelectedReport) {
      return editableReport.frontOfficeOccupancyByFloor;
    }

    return selectedReportDate === currentOperationalDateKey
      ? currentFrontOfficeOccupancyByFloor
      : buildDefaultNightDutyData(selectedReportDate).frontOfficeOccupancyByFloor;
  }, [
    currentFrontOfficeOccupancyByFloor,
    currentOperationalDateKey,
    editableReport,
    hasSavedSelectedReport,
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
    setWaterSupplyCount(report.waterSupplyCount);
    setPowerSupplies(report.powerSupplies);
    setGuestIncident(report.guestIncident);
    setEmployeeIncident(report.employeeIncident);
    setHousekeepingSupervisorSignature(report.housekeepingSupervisorSignature);
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
    powerSupplies,
    waterSupplyCount,
    guestIncident,
    employeeIncident,
    housekeepingSupervisorSignature,
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
    guestIncident,
    housekeepingSupervisorSignature,
    hotWaterTemperature,
    incomeForm,
    occupancyByFloor,
    occupancyQuery,
    onDutyStaff,
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

  async function saveCurrentReport(sectionName, saveSharedUtilities = false) {
    setSavingSection(sectionName);
    setFeedback({ type: "", message: "" });

    try {
      const saves = [onSaveNightDuty(currentRecord)];
      if (saveSharedUtilities) saves.push(onSaveUtilities({ utilities: utilitiesForm }));
      await Promise.all(saves);
      setLoadedSelectedReport({
        ...currentRecord,
        updatedAtIso: new Date().toISOString(),
      });
      setFeedback({ type: "success", message: `${sectionName} saved and added to the ${formatDateKey(selectedReportDate)} report.` });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
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
    if (!powerDraft.name.trim() || powerDraft.durationHours === "") return;
    setPowerSupplies((current) => [...current, {
      id: `power-${Date.now()}`,
      name: powerDraft.name.trim(),
      durationHours: powerDraft.durationHours,
    }]);
    setPowerDraft({ name: "", durationHours: "" });
  }

  function handleDownload(report = reportData) {
    downloadTextPdf({
      filename: `sunshine-night-duty-report-${report.operationalDateKey}.pdf`,
      title: "Sunshine Hotel Night Duty Report",
      lines: buildNightDutyReportLines(report),
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
            Record Night Duty observations independently, query occupancy differences and keep one editable report for every operational day.
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
            <span>Report date</span>
            <input
              type="date"
              value={selectedReportDate}
              max={getOperationalDateKey()}
              onChange={(event) => selectReportDate(event.target.value)}
              disabled={Boolean(savingSection)}
            />
          </label>
          <button
            type="button"
            className="button-secondary"
            onClick={() => selectReportDate(currentOperationalDateKey)}
            disabled={Boolean(savingSection) || selectedReportDate === currentOperationalDateKey}
          >
            Use current operational date
          </button>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          {loadingSelectedReport
            ? "Loading the report for this date..."
            : hasSavedSelectedReport
              ? `Saved report loaded for ${formatDateKey(selectedReportDate)}. You can continue editing it.`
              : `No saved report exists for ${formatDateKey(selectedReportDate)}. Saving any section will create it.`}
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
        <div className={`mt-5 rounded-2xl px-4 py-3 text-sm ${feedback.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{feedback.message}</div>
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
            <div className="subpanel"><p className="metric-label">Cooking gas levels</p><div className="mt-4 grid gap-4 sm:grid-cols-2">{cookingGasOptions.map((gas) => <label key={gas.value} className="field"><span>{gas.label}</span><select value={gasLevels[gas.value] ?? ""} onChange={(event) => setGasLevels((current) => ({ ...current, [gas.value]: event.target.value }))} disabled={readOnly || savingSection}><option value="">Select level</option>{gasLevelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>)}</div></div>
            <div className="subpanel"><p className="metric-label">Water and temperature</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="field"><span>Hot water temperature (°C)</span><input type="number" min="0" max="120" step="0.1" value={hotWaterTemperature} onChange={(event) => setHotWaterTemperature(event.target.value)} disabled={readOnly || savingSection} /></label><label className="field"><span>Number of times water was supplied</span><input type="number" min="0" max="1000" value={waterSupplyCount} onChange={(event) => setWaterSupplyCount(event.target.value)} disabled={readOnly || savingSection} /></label></div></div>
          </div>
          <div className="subpanel"><p className="metric-label">Power supply usage</p><div className="mt-4 grid gap-4 sm:grid-cols-[1fr_12rem_auto]"><label className="field"><span>Power supply name</span><input value={powerDraft.name} onChange={(event) => setPowerDraft((current) => ({ ...current, name: event.target.value }))} disabled={readOnly || savingSection} placeholder="Generator 1, EEDC, inverter..." /></label><label className="field"><span>Hours used</span><input type="number" min="0" max="72" step="0.1" value={powerDraft.durationHours} onChange={(event) => setPowerDraft((current) => ({ ...current, durationHours: event.target.value }))} disabled={readOnly || savingSection} /></label><button type="button" onClick={addPowerSupply} className="button-secondary self-end" disabled={readOnly || savingSection || !powerDraft.name.trim() || powerDraft.durationHours === ""}>Add power supply</button></div><div className="mt-4 space-y-3">{powerSupplies.length > 0 ? powerSupplies.map((entry) => <div key={entry.id} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_12rem_auto]"><input aria-label="Power supply name" value={entry.name} onChange={(event) => setPowerSupplies((current) => current.map((item) => item.id === entry.id ? { ...item, name: event.target.value } : item))} disabled={readOnly || savingSection} /><input aria-label={`${entry.name} hours used`} type="number" min="0" max="72" step="0.1" value={entry.durationHours} onChange={(event) => setPowerSupplies((current) => current.map((item) => item.id === entry.id ? { ...item, durationHours: event.target.value } : item))} disabled={readOnly || savingSection} /><ActionButton label="Remove" tone="danger" onClick={() => setPowerSupplies((current) => current.filter((item) => item.id !== entry.id))} /></div>) : <p className="text-sm text-slate-500">No power supply added.</p>}</div></div>
          <div className="subpanel"><p className="metric-label">Other utility readings</p><div className="mt-4 grid gap-4 sm:grid-cols-2">{propertyUtilityFields.map((field) => <label key={field.key} className="field"><span>{field.label}</span>{field.inputType === "number" ? <input type="number" min="0" value={utilitiesForm[field.key] ?? ""} onChange={(event) => setUtilitiesForm((current) => ({ ...current, [field.key]: event.target.value }))} disabled={readOnly || savingSection} /> : <select value={utilitiesForm[field.key] ?? ""} onChange={(event) => setUtilitiesForm((current) => ({ ...current, [field.key]: event.target.value }))} disabled={readOnly || savingSection}><option value="">Select level</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}</label>)}</div></div>
          <button type="submit" className="button-primary w-full" disabled={readOnly || savingSection}>{savingSection === "Utilities" ? "Saving..." : "Save utilities"}</button>
        </form>
      ) : null}

      {activeSection === "incidents" ? (
        <form onSubmit={(event) => { event.preventDefault(); saveCurrentReport("Incidents and sign-off"); }} className="mt-6 space-y-6 no-print">
          <div className="grid gap-6 xl:grid-cols-2"><IncidentEditor label="Guest incident" value={guestIncident} onChange={setGuestIncident} disabled={readOnly || Boolean(savingSection)} /><IncidentEditor label="Employee incident" value={employeeIncident} onChange={setEmployeeIncident} disabled={readOnly || Boolean(savingSection)} /></div>
          <label className="field subpanel"><span>Housekeeping supervisor signature name</span><input value={housekeepingSupervisorSignature} onChange={(event) => setHousekeepingSupervisorSignature(event.target.value)} disabled={readOnly || savingSection} maxLength={120} placeholder="Enter the housekeeping supervisor's full name" /></label>
          <button type="submit" className="button-primary w-full" disabled={readOnly || savingSection}>{savingSection === "Incidents and sign-off" ? "Saving..." : "Save incidents and sign-off"}</button>
        </form>
      ) : null}

      {activeSection === "archive" ? (
        <div className="mt-6 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2"><div className="subpanel"><p className="metric-label">Last 7 days room revenue</p><p className="mt-3 text-3xl font-semibold text-[#162338]">{formatAmount(weeklyRoomRevenue)}</p><p className="mt-2 text-xs text-slate-500">Room revenue only; advance payments are excluded.</p></div><div className="subpanel"><p className="metric-label">{formatDateKey(`${currentMonth}-01`, { month: "long", year: "numeric" })} room revenue</p><p className="mt-3 text-3xl font-semibold text-[#162338]">{formatAmount(monthlyRoomRevenue)}</p><p className="mt-2 text-xs text-slate-500">Room revenue only; advance payments are excluded.</p></div></div>
          <div className="subpanel">
            <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end"><label className="field"><span>Stored report date</span><input type="date" value={selectedHistoryDate} max={getOperationalDateKey()} onChange={(event) => selectHistoryDate(event.target.value)} /></label><button type="button" className="button-secondary" disabled={!selectedHistoryReportData || loadingHistoryReport} onClick={() => selectedHistoryReportData && printNightDutyReport(selectedHistoryReportData)}>Print selected report</button><button type="button" className="button-secondary" disabled={!selectedHistoryReportData || loadingHistoryReport} onClick={() => selectedHistoryReportData && handleDownload(selectedHistoryReportData)}>Download selected PDF</button></div>
            {loadingHistoryReport ? <p className="mt-5 text-sm text-slate-500">Loading the selected date...</p> : selectedHistoryReportData ? <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-xl bg-slate-50 p-4 text-sm">Occupancy<br /><strong className="text-xl text-[#162338]">{selectedHistoryReportData.occupancyTotal}</strong></div><div className="rounded-xl bg-slate-50 p-4 text-sm">Room revenue<br /><strong className="text-xl text-[#162338]">{formatAmount(getFrontOfficeRoomRevenue(selectedHistoryReportData.income))}</strong></div><div className="rounded-xl bg-slate-50 p-4 text-sm">Guest incident<br /><strong className="text-xl text-[#162338]">{getIncidentSummary(selectedHistoryReportData.guestIncident)}</strong></div><div className="rounded-xl bg-slate-50 p-4 text-sm">Employee incident<br /><strong className="text-xl text-[#162338]">{getIncidentSummary(selectedHistoryReportData.employeeIncident)}</strong></div></div> : <p className="mt-5 text-sm text-slate-500">No stored Night Duty report exists for the selected date.</p>}
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
