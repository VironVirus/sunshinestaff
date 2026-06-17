"use client";

import { useEffect, useMemo, useState } from "react";
import { getRoomOptionsForFloor, roomFloorOptions } from "@/data/hotelRooms";
import {
  buildHousekeepingReportSections,
  buildHousekeepingStatusSummary,
  getHousekeepingEntriesForPeriod,
  housekeepingReportPeriods,
  housekeepingStatusOptions,
} from "@/data/housekeepingReports";
import { formatFriendlyDate } from "@/lib/format";
import { formatDateKey } from "@/lib/hotelTime";
import { downloadTextPdf } from "@/lib/pdf";
import { getHousekeepingReportAccess } from "@/lib/roles";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function printReport(title, reportLines) {
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
        <pre>${escapeHtml(reportLines.join("\n"))}</pre>
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

function buildReportLines({ periodLabel, operationalDateKey, sections, summary }) {
  const lines = [
    "House Keeping Inhouse Report",
    `Report: ${periodLabel}`,
    `Operational day: ${formatDateKey(operationalDateKey)}`,
    `Generated: ${formatFriendlyDate(new Date(), {
      dateStyle: "full",
      timeStyle: "short",
    })}`,
    "",
    `Summary: ${summary.totalReported} room(s) reported`,
    `Occupied: ${summary.occupied}`,
    `Vacant and Cleaned: ${summary.vacantCleaned}`,
    `Out of order: ${summary.outOfOrder}`,
    `Vacant and uncleaned: ${summary.vacantUncleaned}`,
    "",
  ];

  sections.forEach((section) => {
    lines.push(section.label);
    lines.push("S/N | Room number | Status");

    if (section.rooms.length === 0) {
      lines.push("None");
    } else {
      section.rooms.forEach((room) => {
        lines.push(`${room.serialNumber} | ${room.roomNumber} | ${room.statusLabel}`);
      });
    }

    lines.push(
      `Summary: ${section.summary.totalReported} reported, ${section.summary.occupied} occupied, ${section.summary.vacantCleaned} vacant and cleaned, ${section.summary.outOfOrder} out of order, ${section.summary.vacantUncleaned} vacant and uncleaned`,
    );
    lines.push("");
  });

  return lines;
}

function buildCheckedOutRoomsLines(operations, operationalDateKey) {
  const checkedOutEntries = (operations?.activityEntries ?? []).filter(
    (entry) =>
      entry?.actionType === "check_out" && entry?.operationalDateKey === operationalDateKey,
  );

  if (checkedOutEntries.length === 0) {
    return ["None"];
  }

  return checkedOutEntries.map((entry, index) => {
    const suffix =
      entry.checkoutCategory === "late_check_out" ? " - Late check out" : "";

    return `${index + 1}. ${entry.roomNumber}${suffix}`;
  });
}

function buildOpenRoomIssuesLines(propertyStatus) {
  const roomIssues = propertyStatus?.roomIssues ?? [];

  if (roomIssues.length === 0) {
    return ["None"];
  }

  return roomIssues.map((roomIssue, index) => {
    const details = [
      `${index + 1}. ${roomIssue.roomNumber}`,
      roomIssue.issueNote,
      roomIssue.updatedByName ? `Updated by ${roomIssue.updatedByName}` : "",
    ].filter(Boolean);

    return details.join(" - ");
  });
}

function getStatusBadgeClass(status) {
  switch (status) {
    case "occupied":
      return "border-slate-900 bg-slate-900 text-white";
    case "vacant_cleaned":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "out_of_order":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "vacant_uncleaned":
      return "border-sky-200 bg-sky-50 text-sky-700";
    default:
      return "border-slate-200 bg-white text-slate-700";
  }
}

function getStatusCardClass(status, selected) {
  if (selected) {
    switch (status) {
      case "occupied":
        return "border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-300/40";
      case "vacant_cleaned":
        return "border-emerald-500 bg-emerald-600 text-white shadow-lg shadow-emerald-200/50";
      case "out_of_order":
        return "border-rose-500 bg-rose-600 text-white shadow-lg shadow-rose-200/50";
      case "vacant_uncleaned":
        return "border-sky-500 bg-sky-600 text-white shadow-lg shadow-sky-200/50";
      default:
        return "border-[#162338] bg-[#162338] text-white shadow-lg shadow-slate-300/40";
    }
  }

  switch (status) {
    case "occupied":
      return "border-slate-200 bg-slate-50 text-slate-900 hover:border-slate-500";
    case "vacant_cleaned":
      return "border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-400";
    case "out_of_order":
      return "border-rose-200 bg-rose-50 text-rose-800 hover:border-rose-400";
    case "vacant_uncleaned":
      return "border-sky-200 bg-sky-50 text-sky-800 hover:border-sky-400";
    default:
      return "border-slate-200 bg-white text-slate-800 hover:border-[#c59d40]";
  }
}

function FloorBoardTab({ active, label, count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mobile-section-tab ${
        active ? "mobile-section-tab-active" : ""
      }`}
    >
      {label} ({count})
    </button>
  );
}

function StatusBadge({ status, statusLabel }) {
  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs font-semibold ${getStatusBadgeClass(
        status,
      )}`}
    >
      {statusLabel}
    </span>
  );
}

export default function HousekeepingStatusPanel({
  profile,
  housekeepingReports,
  propertyStatus,
  operations,
  onSaveHousekeepingReports,
}) {
  const access = getHousekeepingReportAccess(profile);
  const [activePeriod, setActivePeriod] = useState("morning");
  const [selectedFloor, setSelectedFloor] = useState("");
  const [selectedRoom, setSelectedRoom] = useState("");
  const [selectedStatus, setSelectedStatus] = useState(housekeepingStatusOptions[0]?.value ?? "");
  const [saving, setSaving] = useState(false);
  const [clearingRoom, setClearingRoom] = useState("");
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [activeBoardFloor, setActiveBoardFloor] = useState("");
  const [activeBoardRoom, setActiveBoardRoom] = useState("");

  const reportEntries = useMemo(
    () => getHousekeepingEntriesForPeriod(housekeepingReports, activePeriod),
    [activePeriod, housekeepingReports],
  );
  const roomOptions = useMemo(
    () => getRoomOptionsForFloor(selectedFloor),
    [selectedFloor],
  );
  const sections = useMemo(
    () => buildHousekeepingReportSections(reportEntries),
    [reportEntries],
  );
  const summary = useMemo(
    () => buildHousekeepingStatusSummary(reportEntries),
    [reportEntries],
  );
  const reportedSections = useMemo(
    () => sections.filter((section) => section.rooms.length > 0),
    [sections],
  );
  const activeSection = useMemo(
    () =>
      reportedSections.find((section) => section.key === activeBoardFloor) ??
      reportedSections[0] ??
      null,
    [activeBoardFloor, reportedSections],
  );
  const activeRoom = useMemo(
    () =>
      activeSection?.rooms.find((room) => room.roomNumber === activeBoardRoom) ??
      activeSection?.rooms[0] ??
      null,
    [activeBoardRoom, activeSection],
  );
  const reportLabel =
    housekeepingReportPeriods.find((period) => period.value === activePeriod)?.label ??
    "Morning report";
  const reportLines = useMemo(
    () =>
      buildReportLines({
        periodLabel: reportLabel,
        operationalDateKey: housekeepingReports?.operationalDateKey,
        sections,
        summary,
      }).concat([
        "Checked out rooms:",
        ...buildCheckedOutRoomsLines(operations, housekeepingReports?.operationalDateKey),
        "",
        "Open room issues:",
        ...buildOpenRoomIssuesLines(propertyStatus),
      ]),
    [
      housekeepingReports?.operationalDateKey,
      operations,
      propertyStatus,
      reportLabel,
      sections,
      summary,
    ],
  );

  useEffect(() => {
    if (selectedRoom && !roomOptions.some((room) => room.value === selectedRoom)) {
      setSelectedRoom("");
    }
  }, [roomOptions, selectedRoom]);

  useEffect(() => {
    if (reportedSections.length === 0) {
      setActiveBoardFloor("");
      setActiveBoardRoom("");
      return;
    }

    if (!reportedSections.some((section) => section.key === activeBoardFloor)) {
      setActiveBoardFloor(reportedSections[0].key);
    }
  }, [activeBoardFloor, reportedSections]);

  useEffect(() => {
    if (!activeSection) {
      setActiveBoardRoom("");
      return;
    }

    if (!activeSection.rooms.some((room) => room.roomNumber === activeBoardRoom)) {
      setActiveBoardRoom(activeSection.rooms[0]?.roomNumber ?? "");
    }
  }, [activeBoardRoom, activeSection]);

  if (!access.canViewPanel) {
    return null;
  }

  async function savePeriodEntries(nextEntries, message) {
    setSaving(true);
    setFeedback({ type: "", message: "" });

    try {
      await onSaveHousekeepingReports({
        [`${activePeriod}Rooms`]: nextEntries,
        [`${activePeriod}UpdatedByName`]: profile?.fullName ?? "",
        [`${activePeriod}UpdatedByDepartment`]: profile?.departmentName ?? "",
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

    if (!selectedFloor || !selectedRoom || !selectedStatus) {
      return;
    }

    const nextEntries = [
      ...reportEntries.filter((entry) => entry.roomNumber !== selectedRoom),
      {
        roomNumber: selectedRoom,
        status: selectedStatus,
        updatedAt: new Date().toISOString(),
        updatedByName: profile?.fullName ?? "",
        updatedByDepartment: profile?.departmentName ?? "",
      },
    ];

    await savePeriodEntries(nextEntries, `${selectedRoom} updated for ${reportLabel.toLowerCase()}.`);
    setSelectedRoom("");
  }

  async function handleClearRoom(roomNumber) {
    setClearingRoom(roomNumber);
    setFeedback({ type: "", message: "" });

    try {
      await onSaveHousekeepingReports({
        [`${activePeriod}Rooms`]: reportEntries.filter((entry) => entry.roomNumber !== roomNumber),
        [`${activePeriod}UpdatedByName`]: profile?.fullName ?? "",
        [`${activePeriod}UpdatedByDepartment`]: profile?.departmentName ?? "",
      });
      setFeedback({ type: "success", message: `${roomNumber} cleared from ${reportLabel.toLowerCase()}.` });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setClearingRoom("");
    }
  }

  function handleDownloadReport() {
    downloadTextPdf({
      filename: "house-keeping-inhouse-report.pdf",
      title: "House Keeping Inhouse Report",
      lines: reportLines,
    });
  }

  return (
    <section className="panel p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="section-title">HouseKeeping Reports</h2>
          <p className="mt-2 text-sm text-slate-500">
            Morning and afternoon room checks for internal housekeeping updates.
          </p>
        </div>

        <div className="flex flex-wrap gap-3 no-print">
          <button type="button" onClick={() => printReport("House Keeping Inhouse Report", reportLines)} className="button-secondary">
            Print report
          </button>
          <button type="button" onClick={handleDownloadReport} className="button-secondary">
            Download report
          </button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3 no-print">
        {housekeepingReportPeriods.map((period) => (
          <SectionButton
            key={period.value}
            active={activePeriod === period.value}
            label={period.label}
            onClick={() => setActivePeriod(period.value)}
          />
        ))}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <div className="subpanel">
          <span className="metric-label">Reported rooms</span>
          <span className="metric-value">{summary.totalReported}</span>
        </div>
        <div className="subpanel">
          <span className="metric-label">Occupied</span>
          <span className="metric-value">{summary.occupied}</span>
        </div>
        <div className="subpanel">
          <span className="metric-label">Vacant and Cleaned</span>
          <span className="metric-value">{summary.vacantCleaned}</span>
        </div>
        <div className="subpanel">
          <span className="metric-label">Out of order</span>
          <span className="metric-value">{summary.outOfOrder}</span>
        </div>
        <div className="subpanel">
          <span className="metric-label">Vacant and uncleaned</span>
          <span className="metric-value">{summary.vacantUncleaned}</span>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <form onSubmit={handleSubmit} className="subpanel no-print">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="field">
              <span>Floor</span>
              <select
                value={selectedFloor}
                onChange={(event) => {
                  setSelectedFloor(event.target.value);
                  setSelectedRoom("");
                }}
                disabled={saving}
              >
                <option value="">Select floor</option>
                {roomFloorOptions.map((floor) => (
                  <option key={floor.value} value={floor.value}>
                    {floor.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Room</span>
              <select
                value={selectedRoom}
                onChange={(event) => setSelectedRoom(event.target.value)}
                disabled={saving || !selectedFloor}
              >
                <option value="">Select room</option>
                {roomOptions.map((room) => (
                  <option key={room.value} value={room.value}>
                    {room.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field mt-4">
            <span>Status</span>
            <select
              value={selectedStatus}
              onChange={(event) => setSelectedStatus(event.target.value)}
              disabled={saving}
            >
              {housekeepingStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

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

          <button
            type="submit"
            disabled={saving || !selectedFloor || !selectedRoom || !selectedStatus}
            className="button-primary mt-5 w-full"
          >
            {saving ? "Saving..." : `Save ${reportLabel.toLowerCase()}`}
          </button>
        </form>

        <div className="subpanel">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="metric-label">Reported rooms board</p>
              <p className="mt-2 text-sm text-slate-500">
                Switch floors to review room updates without a long running list.
              </p>
            </div>
            {activeSection ? <span className="badge">{activeSection.label}</span> : null}
          </div>

          {reportedSections.length > 0 ? (
            <>
              <div className="mobile-section-tabs mt-4 no-print">
                {reportedSections.map((section) => (
                  <FloorBoardTab
                    key={section.key}
                    active={activeSection?.key === section.key}
                    label={section.label}
                    count={section.summary.totalReported}
                    onClick={() => {
                      setActiveBoardFloor(section.key);
                      setActiveBoardRoom(section.rooms[0]?.roomNumber ?? "");
                    }}
                  />
                ))}
              </div>

              {activeSection ? (
                <>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                      <p className="metric-label">Reported</p>
                      <p className="mt-2 font-display text-2xl text-[#162338]">
                        {activeSection.summary.totalReported}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                      <p className="metric-label">Occupied</p>
                      <p className="mt-2 font-display text-2xl text-[#162338]">
                        {activeSection.summary.occupied}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                      <p className="metric-label">Vacant and Cleaned</p>
                      <p className="mt-2 font-display text-2xl text-[#162338]">
                        {activeSection.summary.vacantCleaned}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                      <p className="metric-label">Needs attention</p>
                      <p className="mt-2 font-display text-2xl text-[#162338]">
                        {activeSection.summary.outOfOrder + activeSection.summary.vacantUncleaned}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                    {activeSection.rooms.map((room) => {
                      const selected = activeRoom?.roomNumber === room.roomNumber;

                      return (
                        <button
                          key={room.roomNumber}
                          type="button"
                          onClick={() => setActiveBoardRoom(room.roomNumber)}
                          className={`rounded-2xl border px-3 py-2 text-left transition ${getStatusCardClass(
                            room.status,
                            selected,
                          )}`}
                        >
                          <div className="flex flex-col gap-2">
                            <p className="text-sm font-semibold">{room.roomNumber}</p>
                            <span
                              className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${
                                selected
                                  ? "border-white/30 bg-white/10 text-white"
                                  : getStatusBadgeClass(room.status)
                              }`}
                            >
                              {room.statusLabel}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {activeRoom ? (
                    <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50/80 p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="metric-label">Selected room</p>
                          <h3 className="mt-2 font-display text-3xl text-[#162338]">
                            {activeRoom.roomNumber}
                          </h3>
                          <p className="mt-2 text-sm text-slate-500">
                            Updated by {activeRoom.updatedByName || "HouseKeeping"}{" "}
                            {activeRoom.updatedAt
                              ? `on ${formatFriendlyDate(new Date(activeRoom.updatedAt), {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                })}`
                              : ""}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <StatusBadge
                            status={activeRoom.status}
                            statusLabel={activeRoom.statusLabel}
                          />
                          <button
                            type="button"
                            onClick={() => handleClearRoom(activeRoom.roomNumber)}
                            disabled={saving || clearingRoom === activeRoom.roomNumber}
                            className="button-secondary no-print"
                          >
                            {clearingRoom === activeRoom.roomNumber ? "Clearing..." : "Clear room"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
              No rooms added yet for this report.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
