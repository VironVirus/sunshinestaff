"use client";

import { useEffect, useMemo, useState } from "react";
import { defaultUtilities, getRoomComplaintLabel, getUtilityLabel, propertyUtilityFields } from "@/data/propertyStatus";
import {
  buildDefaultNightDutyData,
  cookingGasOptions,
  getCookingGasLabel,
  getGrandIncomeTotal,
  getOutletTotal,
  groupOnDutyStaff,
  nightDutyDepartmentOptions,
  nightDutyOutletConfig,
} from "@/data/nightDuty";
import { roomGroups } from "@/data/hotelRooms";
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
    .replaceAll(">", "&gt;");
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

function buildRoomSections(operations = {}) {
  const occupiedMap = new Map((operations.occupiedRooms ?? []).map((room) => [room.roomNumber, room]));
  const outOfOrderSet = new Set(operations.outOfOrderRoomNumbers ?? []);

  return roomGroups.map((group) => {
    const occupied = group.rooms
      .filter((roomNumber) => occupiedMap.has(roomNumber))
      .map((roomNumber, index) => {
        const room = occupiedMap.get(roomNumber);

        return {
          serialNumber: index + 1,
          roomNumber,
          breakfastCount: room?.breakfastIncluded ? room.breakfastCount ?? 0 : 0,
        };
      });

    const unoccupied = group.rooms
      .filter((roomNumber) => !occupiedMap.has(roomNumber))
      .map((roomNumber, index) => ({
        serialNumber: index + 1,
        roomNumber,
        outOfOrder: outOfOrderSet.has(roomNumber),
      }));

    return {
      key: group.key,
      label: group.label,
      occupied,
      unoccupied,
      occupiedBreakfastTotal: occupied.reduce((total, room) => total + room.breakfastCount, 0),
      availableCount: unoccupied.filter((room) => !room.outOfOrder).length,
      outOfOrderCount: unoccupied.filter((room) => room.outOfOrder).length,
    };
  });
}

function buildNightDutyReportData({
  operations,
  eventsBookings,
  propertyStatus,
  income,
  onDutyStaff,
  cookingGas,
  utilities,
}) {
  const operationalDateKey = operations?.operationalDateKey ?? getOperationalDateKey();
  const roomSections = buildRoomSections(operations);
  const occupiedSections = roomSections.filter((section) => section.occupied.length > 0);
  const unoccupiedSections = roomSections.filter((section) => section.unoccupied.length > 0);
  const todaysEvents = (eventsBookings?.events ?? []).filter(
    (eventEntry) => eventEntry.eventDate === operationalDateKey,
  );
  const todaysComplaints = (propertyStatus?.roomComplaints ?? []).filter((complaint) =>
    isWithinOperationalDate(complaint.reportedAt, operationalDateKey),
  );
  const groupedStaff = groupOnDutyStaff(onDutyStaff);
  const incomeSections = nightDutyOutletConfig.map((outlet) => ({
    ...outlet,
    total: getOutletTotal(income, outlet.key),
  }));

  return {
    operationalDateKey,
    generatedAt: new Date(),
    roomSections,
    occupiedSections,
    unoccupiedSections,
    todaysEvents,
    todaysComplaints,
    groupedStaff,
    incomeSections,
    income,
    grandIncomeTotal: getGrandIncomeTotal(income),
    cookingGas,
    utilities,
    occupiedSummary: {
      totalRooms: operations?.inHouse ?? 0,
      breakfastTotal: operations?.breakfastEntitled ?? 0,
    },
    unoccupiedSummary: {
      totalRooms: unoccupiedSections.reduce((total, section) => total + section.unoccupied.length, 0),
      availableRooms: unoccupiedSections.reduce((total, section) => total + section.availableCount, 0),
      outOfOrderRooms: operations?.outOfOrderRoomNumbers?.length ?? 0,
    },
  };
}

function buildNightDutyReportLines(reportData) {
  const lines = [
    "Sunshine Hotel Night Duty Report",
    `Operational day: ${formatDateKey(reportData.operationalDateKey)}`,
    `Generated: ${formatFriendlyDate(reportData.generatedAt, {
      dateStyle: "full",
      timeStyle: "short",
    })}`,
    "",
    "Occupied rooms floor by floor",
    `Summary: ${reportData.occupiedSummary.totalRooms} occupied room(s), ${reportData.occupiedSummary.breakfastTotal} breakfast entitlement`,
    "",
  ];

  reportData.roomSections.forEach((section) => {
    lines.push(section.label);
    lines.push("S/N | Room number | Breakfast");

    if (section.occupied.length === 0) {
      lines.push("None");
    } else {
      section.occupied.forEach((room) => {
        lines.push(`${room.serialNumber} | ${room.roomNumber} | ${room.breakfastCount}`);
      });
    }

    lines.push(
      `Summary: ${section.occupied.length} occupied, ${section.occupiedBreakfastTotal} breakfast entitlement`,
    );
    lines.push("");
  });

  lines.push("Unoccupied rooms floor by floor");
  lines.push(
    `Summary: ${reportData.unoccupiedSummary.totalRooms} unoccupied room(s), ${reportData.unoccupiedSummary.availableRooms} available, ${reportData.unoccupiedSummary.outOfOrderRooms} out of order`,
  );
  lines.push("");

  reportData.roomSections.forEach((section) => {
    lines.push(section.label);

    if (section.unoccupied.length === 0) {
      lines.push("None");
    } else {
      lines.push(
        section.unoccupied
          .map((room) => `${room.roomNumber}${room.outOfOrder ? " (Out of order)" : ""}`)
          .join(", "),
      );
    }

    lines.push(
      `Summary: ${section.unoccupied.length} unoccupied, ${section.availableCount} available, ${section.outOfOrderCount} out of order`,
    );
    lines.push("");
  });

  lines.push("Events");
  lines.push(`Summary: ${reportData.todaysEvents.length} event(s)`);
  if (reportData.todaysEvents.length === 0) {
    lines.push("None");
  } else {
    reportData.todaysEvents.forEach((eventEntry, index) => {
      lines.push(
        `${index + 1}. ${eventEntry.eventType} - ${eventEntry.venue} - ${eventEntry.expectedGuests || 0} guest(s)`,
      );
    });
  }
  lines.push("");

  lines.push("Complaints");
  lines.push(`Summary: ${reportData.todaysComplaints.length} complaint(s)`);
  if (reportData.todaysComplaints.length === 0) {
    lines.push("None");
  } else {
    reportData.todaysComplaints.forEach((complaint, index) => {
      lines.push(
        `${index + 1}. ${complaint.roomNumber} - ${getRoomComplaintLabel(complaint.complaintType)} - ${complaint.complaintNote || "No note"}`,
      );
    });
  }
  lines.push("");

  lines.push("Income dashboard");
  reportData.incomeSections.forEach((outlet) => {
    lines.push(outlet.label);
    outlet.fields.forEach((field) => {
      lines.push(`- ${field.label}: ${formatAmount(reportData.income?.[outlet.key]?.[field.key])}`);
    });
    lines.push(`- Total: ${formatAmount(outlet.total)}`);
    lines.push("");
  });
  lines.push(`Grand total: ${formatAmount(reportData.grandIncomeTotal)}`);
  lines.push("");

  lines.push("Staff on duty");
  if (reportData.groupedStaff.length === 0) {
    lines.push("None");
  } else {
    reportData.groupedStaff.forEach((department) => {
      lines.push(
        `${department.label}: ${department.staff.map((entry) => entry.staffName).join(", ")}`,
      );
    });
  }
  lines.push("");

  lines.push("Cooking gas");
  lines.push(getCookingGasLabel(reportData.cookingGas));
  lines.push("");

  lines.push("Utilities");
  propertyUtilityFields.forEach((field) => {
    lines.push(`${field.label}: ${getUtilityLabel(field.key, reportData.utilities?.[field.key])}`);
  });

  return lines;
}

function buildTableRows(rows, columns) {
  return rows
    .map(
      (row) =>
        `<tr>${columns
          .map((column) => `<td>${escapeHtml(column.render(row))}</td>`)
          .join("")}</tr>`,
    )
    .join("");
}

function printNightDutyReport(reportData) {
  if (typeof window === "undefined") {
    return;
  }

  const reportWindow = window.open("", "_blank", "width=1080,height=860");

  if (!reportWindow) {
    return;
  }

  const occupiedHtml = reportData.roomSections
    .map((section) => {
      const body =
        section.occupied.length > 0
          ? `<table>
              <thead>
                <tr>
                  <th>S/N</th>
                  <th>Room number</th>
                  <th>Breakfast</th>
                </tr>
              </thead>
              <tbody>
                ${buildTableRows(section.occupied, [
                  { render: (row) => String(row.serialNumber) },
                  { render: (row) => row.roomNumber },
                  { render: (row) => String(row.breakfastCount) },
                ])}
              </tbody>
            </table>`
          : "<p>None</p>";

      return `
        <section>
          <h3>${escapeHtml(section.label)}</h3>
          ${body}
          <p class="summary">Summary: ${section.occupied.length} occupied, ${section.occupiedBreakfastTotal} breakfast entitlement</p>
        </section>
      `;
    })
    .join("");

  const unoccupiedHtml = reportData.roomSections
    .map(
      (section) => `
        <section>
          <h3>${escapeHtml(section.label)}</h3>
          <p>${
            section.unoccupied.length > 0
              ? escapeHtml(
                  section.unoccupied
                    .map((room) => `${room.roomNumber}${room.outOfOrder ? " (Out of order)" : ""}`)
                    .join(", "),
                )
              : "None"
          }</p>
          <p class="summary">Summary: ${section.unoccupied.length} unoccupied, ${section.availableCount} available, ${section.outOfOrderCount} out of order</p>
        </section>
      `,
    )
    .join("");

  const eventsHtml =
    reportData.todaysEvents.length > 0
      ? `<ul>${reportData.todaysEvents
          .map(
            (eventEntry) =>
              `<li>${escapeHtml(
                `${eventEntry.eventType} - ${eventEntry.venue} - ${eventEntry.expectedGuests || 0} guest(s)`,
              )}</li>`,
          )
          .join("")}</ul>`
      : "<p>None</p>";

  const complaintsHtml =
    reportData.todaysComplaints.length > 0
      ? `<ul>${reportData.todaysComplaints
          .map(
            (complaint) =>
              `<li>${escapeHtml(
                `${complaint.roomNumber} - ${getRoomComplaintLabel(complaint.complaintType)} - ${complaint.complaintNote || "No note"}`,
              )}</li>`,
          )
          .join("")}</ul>`
      : "<p>None</p>";

  const incomeHtml = reportData.incomeSections
    .map(
      (outlet) => `
        <section>
          <h3>${escapeHtml(outlet.label)}</h3>
          <table>
            <thead>
              <tr>
                <th>Heading</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              ${outlet.fields
                .map(
                  (field) => `
                    <tr>
                      <td>${escapeHtml(field.label)}</td>
                      <td>${escapeHtml(formatAmount(reportData.income?.[outlet.key]?.[field.key]))}</td>
                    </tr>
                  `,
                )
                .join("")}
              <tr>
                <td><strong>Total</strong></td>
                <td><strong>${escapeHtml(formatAmount(outlet.total))}</strong></td>
              </tr>
            </tbody>
          </table>
        </section>
      `,
    )
    .join("");

  const staffHtml =
    reportData.groupedStaff.length > 0
      ? reportData.groupedStaff
          .map(
            (department) => `
              <section>
                <h3>${escapeHtml(department.label)}</h3>
                <p>${escapeHtml(department.staff.map((entry) => entry.staffName).join(", "))}</p>
              </section>
            `,
          )
          .join("")
      : "<p>None</p>";

  const utilitiesHtml = propertyUtilityFields
    .map(
      (field) => `
        <tr>
          <td>${escapeHtml(field.label)}</td>
          <td>${escapeHtml(getUtilityLabel(field.key, reportData.utilities?.[field.key]))}</td>
        </tr>
      `,
    )
    .join("");

  reportWindow.document.write(`
    <html>
      <head>
        <title>Sunshine Hotel Night Duty Report</title>
        <style>
          body { font-family: Arial, sans-serif; color: #1f2937; margin: 28px; }
          h1 { color: #8a6923; margin-bottom: 8px; }
          h2 { color: #162338; margin-top: 28px; }
          h3 { color: #334155; margin-top: 20px; margin-bottom: 10px; }
          p, li { line-height: 1.6; }
          table { border-collapse: collapse; width: 100%; margin-top: 12px; }
          th, td { border: 1px solid #d6d3d1; padding: 10px; text-align: left; }
          th { background: #f8f3e6; }
          .meta { margin-bottom: 20px; color: #475569; }
          .summary { font-weight: 600; color: #475569; }
          section { margin-bottom: 18px; }
        </style>
      </head>
      <body>
        <h1>Sunshine Hotel Night Duty Report</h1>
        <p class="meta">
          Operational day: ${escapeHtml(formatDateKey(reportData.operationalDateKey))}<br />
          Generated: ${escapeHtml(
            formatFriendlyDate(reportData.generatedAt, {
              dateStyle: "full",
              timeStyle: "short",
            }),
          )}
        </p>

        <h2>Occupied Rooms</h2>
        <p class="summary">Summary: ${reportData.occupiedSummary.totalRooms} occupied room(s), ${reportData.occupiedSummary.breakfastTotal} breakfast entitlement</p>
        ${occupiedHtml}

        <h2>Unoccupied Rooms</h2>
        <p class="summary">Summary: ${reportData.unoccupiedSummary.totalRooms} unoccupied room(s), ${reportData.unoccupiedSummary.availableRooms} available, ${reportData.unoccupiedSummary.outOfOrderRooms} out of order</p>
        ${unoccupiedHtml}

        <h2>Events</h2>
        <p class="summary">Summary: ${reportData.todaysEvents.length} event(s)</p>
        ${eventsHtml}

        <h2>Complaints</h2>
        <p class="summary">Summary: ${reportData.todaysComplaints.length} complaint(s)</p>
        ${complaintsHtml}

        <h2>Income Dashboard</h2>
        ${incomeHtml}
        <p class="summary">Grand total: ${escapeHtml(formatAmount(reportData.grandIncomeTotal))}</p>

        <h2>Staff On Duty</h2>
        ${staffHtml}

        <h2>Cooking Gas</h2>
        <p>${escapeHtml(getCookingGasLabel(reportData.cookingGas))}</p>

        <h2>Utilities</h2>
        <table>
          <thead>
            <tr>
              <th>Utility</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${utilitiesHtml}
          </tbody>
        </table>
      </body>
    </html>
  `);

  reportWindow.document.close();
  reportWindow.focus();
  reportWindow.print();
}

export default function NightDutyPanel({
  profile,
  operations,
  eventsBookings,
  propertyStatus,
  nightDutyData,
  onSaveNightDuty,
  onSaveUtilities,
}) {
  const access = getNightDutyAccess(profile);
  const [activeSection, setActiveSection] = useState("report");
  const [incomeForm, setIncomeForm] = useState(buildDefaultNightDutyData().income);
  const [onDutyStaff, setOnDutyStaff] = useState([]);
  const [staffDraft, setStaffDraft] = useState({
    departmentKey: nightDutyDepartmentOptions[0]?.value ?? "front_office",
    staffName: "",
  });
  const [cookingGas, setCookingGas] = useState("");
  const [utilitiesForm, setUtilitiesForm] = useState(defaultUtilities);
  const [saving, setSaving] = useState({
    income: false,
    staff: false,
    utilities: false,
  });
  const [feedback, setFeedback] = useState({
    income: { type: "", message: "" },
    staff: { type: "", message: "" },
    utilities: { type: "", message: "" },
  });

  useEffect(() => {
    setIncomeForm(nightDutyData?.income ?? buildDefaultNightDutyData().income);
    setOnDutyStaff(nightDutyData?.onDutyStaff ?? []);
    setCookingGas(nightDutyData?.cookingGas ?? "");
  }, [nightDutyData]);

  useEffect(() => {
    setUtilitiesForm(propertyStatus?.utilities ?? defaultUtilities);
  }, [propertyStatus?.utilities]);

  const reportData = useMemo(
    () =>
      buildNightDutyReportData({
        operations,
        eventsBookings,
        propertyStatus,
        income: incomeForm,
        onDutyStaff,
        cookingGas,
        utilities: utilitiesForm,
      }),
    [cookingGas, eventsBookings, incomeForm, onDutyStaff, operations, propertyStatus, utilitiesForm],
  );
  const groupedStaff = useMemo(() => groupOnDutyStaff(onDutyStaff), [onDutyStaff]);
  const readOnly = !access.canEditPanel;

  if (!access.canViewPanel) {
    return null;
  }

  function updateIncome(outletKey, fieldKey, value) {
    setIncomeForm((current) => ({
      ...current,
      [outletKey]: {
        ...current[outletKey],
        [fieldKey]: value,
      },
    }));
  }

  function updateUtility(fieldKey, value) {
    setUtilitiesForm((current) => ({
      ...current,
      [fieldKey]: value,
    }));
  }

  function handleDownloadPdf() {
    downloadTextPdf({
      filename: "sunshine-night-duty-report.pdf",
      title: "Sunshine Hotel Night Duty Report",
      lines: buildNightDutyReportLines(reportData),
    });
  }

  async function handleSaveIncome(event) {
    event.preventDefault();
    setSaving((current) => ({ ...current, income: true }));
    setFeedback((current) => ({ ...current, income: { type: "", message: "" } }));

    try {
      await onSaveNightDuty({
        income: incomeForm,
        operationalDateKey: operations?.operationalDateKey ?? getOperationalDateKey(),
      });
      setFeedback((current) => ({
        ...current,
        income: { type: "success", message: "Income dashboard saved." },
      }));
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        income: { type: "error", message: error.message },
      }));
    } finally {
      setSaving((current) => ({ ...current, income: false }));
    }
  }

  function handleAddStaffOnDuty() {
    if (!staffDraft.departmentKey || !staffDraft.staffName.trim()) {
      return;
    }

    setOnDutyStaff((current) => [
      ...current,
      {
        id: `duty-${Date.now()}`,
        departmentKey: staffDraft.departmentKey,
        staffName: staffDraft.staffName.trim(),
      },
    ]);
    setStaffDraft((current) => ({
      ...current,
      staffName: "",
    }));
  }

  function handleRemoveStaffOnDuty(entryId) {
    setOnDutyStaff((current) => current.filter((entry) => entry.id !== entryId));
  }

  async function handleSaveStaffDuty(event) {
    event.preventDefault();
    setSaving((current) => ({ ...current, staff: true }));
    setFeedback((current) => ({ ...current, staff: { type: "", message: "" } }));

    try {
      await onSaveNightDuty({
        onDutyStaff,
        operationalDateKey: operations?.operationalDateKey ?? getOperationalDateKey(),
      });
      setFeedback((current) => ({
        ...current,
        staff: { type: "success", message: "Staff on duty list saved." },
      }));
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        staff: { type: "error", message: error.message },
      }));
    } finally {
      setSaving((current) => ({ ...current, staff: false }));
    }
  }

  async function handleSaveUtilities(event) {
    event.preventDefault();
    setSaving((current) => ({ ...current, utilities: true }));
    setFeedback((current) => ({ ...current, utilities: { type: "", message: "" } }));

    try {
      await Promise.all([
        onSaveNightDuty({
          cookingGas,
          operationalDateKey: operations?.operationalDateKey ?? getOperationalDateKey(),
        }),
        onSaveUtilities({
          utilities: utilitiesForm,
        }),
      ]);
      setFeedback((current) => ({
        ...current,
        utilities: { type: "success", message: "Utilities and cooking gas saved." },
      }));
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        utilities: { type: "error", message: error.message },
      }));
    } finally {
      setSaving((current) => ({ ...current, utilities: false }));
    }
  }

  const summaryCards = [
    { label: "Occupied rooms", value: reportData.occupiedSummary.totalRooms },
    { label: "Breakfast count", value: reportData.occupiedSummary.breakfastTotal },
    { label: "Unoccupied rooms", value: reportData.unoccupiedSummary.totalRooms },
    { label: "Grand income", value: formatAmount(reportData.grandIncomeTotal) },
  ];

  return (
    <section className="panel p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="section-title">Night Duty</h2>
          <p className="section-copy max-w-3xl">
            Prepare the in-house report, capture outlet income, list staff on duty, and log
            cooking gas with utilities for the operational day.
          </p>
        </div>

        <div className="flex flex-wrap gap-3 no-print">
          <button type="button" onClick={() => printNightDutyReport(reportData)} className="button-secondary">
            Print in-house report
          </button>
          <button type="button" onClick={handleDownloadPdf} className="button-secondary">
            Download PDF
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <div key={card.label} className="subpanel">
            <span className="metric-label">{card.label}</span>
            <span className="metric-value">{card.value}</span>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-3 no-print">
        <SectionButton
          label="Report"
          active={activeSection === "report"}
          onClick={() => setActiveSection("report")}
        />
        <SectionButton
          label="Income"
          active={activeSection === "income"}
          onClick={() => setActiveSection("income")}
        />
        <SectionButton
          label="On Duty"
          active={activeSection === "duty"}
          onClick={() => setActiveSection("duty")}
        />
        <SectionButton
          label="Utilities"
          active={activeSection === "utilities"}
          onClick={() => setActiveSection("utilities")}
        />
      </div>

      {activeSection === "report" ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <div className="subpanel">
            <div className="flex items-center justify-between gap-3">
              <p className="metric-label">Occupied rooms floor by floor</p>
              <span className="badge">
                {reportData.occupiedSummary.totalRooms} room(s) | {reportData.occupiedSummary.breakfastTotal} breakfast
              </span>
            </div>

            <div className="mt-4 space-y-4">
              {reportData.roomSections.map((section) => (
                <div key={section.key} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-[#162338]">{section.label}</p>
                    <span className="text-xs font-semibold text-slate-500">
                      {section.occupied.length} occupied
                    </span>
                  </div>

                  {section.occupied.length > 0 ? (
                    <div className="mt-3 overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="text-left text-slate-500">
                            <th className="py-2 pr-4">S/N</th>
                            <th className="py-2 pr-4">Room number</th>
                            <th className="py-2">Breakfast</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.occupied.map((room) => (
                            <tr key={room.roomNumber} className="border-t border-slate-100 text-slate-700">
                              <td className="py-2 pr-4">{room.serialNumber}</td>
                              <td className="py-2 pr-4">{room.roomNumber}</td>
                              <td className="py-2">{room.breakfastCount}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-500">None</p>
                  )}

                  <p className="mt-3 text-sm text-slate-500">
                    Summary: {section.occupied.length} occupied, {section.occupiedBreakfastTotal} breakfast entitlement
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="subpanel">
              <div className="flex items-center justify-between gap-3">
                <p className="metric-label">Unoccupied rooms floor by floor</p>
                <span className="badge">
                  {reportData.unoccupiedSummary.totalRooms} unoccupied | {reportData.unoccupiedSummary.availableRooms} available
                </span>
              </div>

              <div className="mt-4 space-y-4">
                {reportData.roomSections.map((section) => (
                  <div key={section.key} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-[#162338]">{section.label}</p>
                      <span className="text-xs font-semibold text-slate-500">
                        {section.unoccupied.length} unoccupied
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-slate-700">
                      {section.unoccupied.length > 0
                        ? section.unoccupied
                            .map((room) => `${room.roomNumber}${room.outOfOrder ? " (Out of order)" : ""}`)
                            .join(", ")
                        : "None"}
                    </p>
                    <p className="mt-3 text-sm text-slate-500">
                      Summary: {section.unoccupied.length} unoccupied, {section.availableCount} available, {section.outOfOrderCount} out of order
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="subpanel">
              <p className="metric-label">Report summary</p>
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                  Events today: <span className="font-semibold text-[#162338]">{reportData.todaysEvents.length}</span>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                  Complaints today: <span className="font-semibold text-[#162338]">{reportData.todaysComplaints.length}</span>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                  Staff on duty: <span className="font-semibold text-[#162338]">{onDutyStaff.length}</span>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                  Cooking gas: <span className="font-semibold text-[#162338]">{getCookingGasLabel(cookingGas)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeSection === "income" ? (
        <form onSubmit={handleSaveIncome} className="mt-6 space-y-6 no-print">
          <div className="grid gap-4 xl:grid-cols-2">
            {nightDutyOutletConfig.map((outlet) => (
              <div key={outlet.key} className="subpanel">
                <div className="flex items-center justify-between gap-3">
                  <p className="metric-label">{outlet.label}</p>
                  <span className="badge">Total {formatAmount(getOutletTotal(incomeForm, outlet.key))}</span>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {outlet.fields.map((field) => (
                    <label key={field.key} className={`field ${outlet.fields.length % 2 === 1 && field === outlet.fields[outlet.fields.length - 1] ? "sm:col-span-2" : ""}`}>
                      <span>{field.label}</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={incomeForm?.[outlet.key]?.[field.key] ?? 0}
                        onChange={(event) => updateIncome(outlet.key, field.key, event.target.value)}
                        disabled={readOnly || saving.income}
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="subpanel">
            <p className="metric-label">Grand total</p>
            <p className="mt-4 text-3xl font-semibold text-[#162338]">
              {formatAmount(getGrandIncomeTotal(incomeForm))}
            </p>
          </div>

          {feedback.income.message ? (
            <div
              className={`rounded-2xl px-4 py-3 text-sm ${
                feedback.income.type === "success"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-rose-50 text-rose-700"
              }`}
            >
              {feedback.income.message}
            </div>
          ) : null}

          <button type="submit" disabled={readOnly || saving.income} className="button-primary w-full">
            {saving.income ? "Saving..." : "Save income dashboard"}
          </button>
        </form>
      ) : null}

      {activeSection === "duty" ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <form onSubmit={handleSaveStaffDuty} className="subpanel no-print">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field">
                <span>Department</span>
                <select
                  value={staffDraft.departmentKey}
                  onChange={(event) =>
                    setStaffDraft((current) => ({
                      ...current,
                      departmentKey: event.target.value,
                    }))
                  }
                  disabled={readOnly || saving.staff}
                >
                  {nightDutyDepartmentOptions.map((department) => (
                    <option key={department.value} value={department.value}>
                      {department.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Staff name</span>
                <input
                  type="text"
                  value={staffDraft.staffName}
                  onChange={(event) =>
                    setStaffDraft((current) => ({
                      ...current,
                      staffName: event.target.value,
                    }))
                  }
                  disabled={readOnly || saving.staff}
                />
              </label>
            </div>

            <button
              type="button"
              onClick={handleAddStaffOnDuty}
              disabled={readOnly || saving.staff || !staffDraft.staffName.trim()}
              className="button-secondary mt-4 w-full"
            >
              Add staff on duty
            </button>

            {feedback.staff.message ? (
              <div
                className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
                  feedback.staff.type === "success"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-rose-50 text-rose-700"
                }`}
              >
                {feedback.staff.message}
              </div>
            ) : null}

            <button type="submit" disabled={readOnly || saving.staff} className="button-primary mt-5 w-full">
              {saving.staff ? "Saving..." : "Save staff on duty"}
            </button>
          </form>

          <div className="subpanel">
            <div className="flex items-center justify-between gap-3">
              <p className="metric-label">Departments on duty</p>
              <span className="badge">{onDutyStaff.length} staff</span>
            </div>

            <div className="mt-4 space-y-4">
              {groupedStaff.length > 0 ? (
                groupedStaff.map((department) => (
                  <div key={department.value} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                    <p className="font-semibold text-[#162338]">{department.label}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {department.staff.map((entry) => (
                        <div
                          key={entry.id}
                          className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                        >
                          <span>{entry.staffName}</span>
                          {!readOnly ? (
                            <ActionButton
                              label="Remove"
                              tone="danger"
                              onClick={() => handleRemoveStaffOnDuty(entry.id)}
                            />
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">No staff on duty listed yet.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {activeSection === "utilities" ? (
        <form onSubmit={handleSaveUtilities} className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr] no-print">
          <div className="subpanel">
            <label className="field">
              <span>Cooking gas</span>
              <select
                value={cookingGas}
                onChange={(event) => setCookingGas(event.target.value)}
                disabled={readOnly || saving.utilities}
              >
                <option value="">Select gas</option>
                {cookingGasOptions.map((gas) => (
                  <option key={gas.value} value={gas.value}>
                    {gas.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {propertyUtilityFields.map((field) => (
                <label key={field.key} className={`field ${field.inputType === "number" ? "sm:col-span-2" : ""}`}>
                  <span>{field.label}</span>
                  {field.inputType === "number" ? (
                    <input
                      type="number"
                      min="0"
                      value={utilitiesForm[field.key] ?? ""}
                      onChange={(event) => updateUtility(field.key, event.target.value)}
                      disabled={readOnly || saving.utilities}
                    />
                  ) : (
                    <select
                      value={utilitiesForm[field.key] ?? ""}
                      onChange={(event) => updateUtility(field.key, event.target.value)}
                      disabled={readOnly || saving.utilities}
                    >
                      <option value="">Select level</option>
                      {field.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
              ))}
            </div>

            {feedback.utilities.message ? (
              <div
                className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
                  feedback.utilities.type === "success"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-rose-50 text-rose-700"
                }`}
              >
                {feedback.utilities.message}
              </div>
            ) : null}

            <button type="submit" disabled={readOnly || saving.utilities} className="button-primary mt-5 w-full">
              {saving.utilities ? "Saving..." : "Save utilities and gas"}
            </button>
          </div>

          <div className="subpanel">
            <p className="metric-label">Current utility summary</p>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-600">
                Cooking gas: <span className="font-semibold text-[#162338]">{getCookingGasLabel(cookingGas)}</span>
              </div>
              {propertyUtilityFields.map((field) => (
                <div key={field.key} className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-600">
                  {field.label}:{" "}
                  <span className="font-semibold text-[#162338]">
                    {getUtilityLabel(field.key, utilitiesForm[field.key])}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </form>
      ) : null}
    </section>
  );
}
