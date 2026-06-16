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

function StatusBadge({ statusLabel }) {
  return (
    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
      {statusLabel}
    </span>
  );
}

export default function HousekeepingStatusPanel({
  profile,
  housekeepingReports,
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
      }),
    [housekeepingReports?.operationalDateKey, reportLabel, sections, summary],
  );

  useEffect(() => {
    if (selectedRoom && !roomOptions.some((room) => room.value === selectedRoom)) {
      setSelectedRoom("");
    }
  }, [roomOptions, selectedRoom]);

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

        <div className="space-y-4">
          {sections.some((section) => section.rooms.length > 0) ? (
            sections.map((section) =>
              section.rooms.length > 0 ? (
                <div key={section.key} className="subpanel">
                  <div className="flex items-center justify-between gap-3">
                    <p className="metric-label">{section.label}</p>
                    <span className="badge">{section.summary.totalReported}</span>
                  </div>

                  <div className="mt-4 space-y-3">
                    {section.rooms.map((room) => (
                      <div
                        key={room.roomNumber}
                        className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <p className="font-semibold text-[#162338]">{room.roomNumber}</p>
                          <p className="mt-1 text-sm text-slate-500">{section.label}</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <StatusBadge statusLabel={room.statusLabel} />
                          <button
                            type="button"
                            onClick={() => handleClearRoom(room.roomNumber)}
                            disabled={saving || clearingRoom === room.roomNumber}
                            className="button-secondary no-print"
                          >
                            {clearingRoom === room.roomNumber ? "Clearing..." : "Clear"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null,
            )
          ) : (
            <div className="subpanel">
              <p className="text-sm text-slate-500">No rooms added yet for this report.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
