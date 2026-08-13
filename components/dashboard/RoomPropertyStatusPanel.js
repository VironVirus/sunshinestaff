"use client";

import { useEffect, useMemo, useState } from "react";
import { getRoomOptionsForFloor, getRoomRecord, roomFloorOptions } from "@/data/hotelRooms";
import {
  buildRoomPropertyStatusRecord,
  isRoomPropertyStatusEventSpace,
  roomPropertyStatusOptions,
  roomSellabilityStatusOptions,
} from "@/data/roomPropertyStatus";
import { formatFriendlyDate } from "@/lib/format";
import { getRoomPropertyStatusAccess } from "@/lib/roles";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getStatusLabel(status) {
  return roomPropertyStatusOptions.find((option) => option.value === status)?.label ?? "Not selected";
}

function getSellabilityStatusLabel(status) {
  return roomSellabilityStatusOptions.find((option) => option.value === status)?.label ?? "Not selected";
}

function hasSignedReport(report) {
  return Boolean(report?.signedAtIso || report?.updatedAtIso);
}

function getReportStateLabel(report) {
  return hasSignedReport(report) ? "Signed" : "Default report";
}

function getReportStatusCounts(report) {
  return roomPropertyStatusOptions.reduce((counts, option) => ({
    ...counts,
    [option.value]: report.items.filter((item) => item.status === option.value).length,
  }), {});
}

function getReportAttentionCount(report) {
  const counts = getReportStatusCounts(report);

  return (counts.needs_attention ?? 0) +
    (counts.damaged ?? 0) +
    (counts.needs_replacement ?? 0);
}

function getPortfolioSummary(reports) {
  const sellabilityCounts = roomSellabilityStatusOptions.reduce((counts, option) => ({
    ...counts,
    [option.value]: reports.filter((report) => report.sellabilityStatus === option.value).length,
  }), {});
  const roomsNeedingAttention = reports.filter((report) => report.items.some((item) => [
    "needs_attention",
    "damaged",
    "needs_replacement",
  ].includes(item.status))).length;

  return {
    totalRooms: reports.length,
    completedReports: reports.filter(hasSignedReport).length,
    roomsNeedingAttention,
    sellabilityCounts,
  };
}

function printAllRoomPropertyStatusReports(allReports, preparedWindow = null) {
  if (typeof window === "undefined") {
    return;
  }

  const reports = allReports.filter(hasSignedReport);

  const reportWindow = preparedWindow ?? window.open("", "_blank", "width=1100,height=780");

  if (!reportWindow) {
    return;
  }

  const summary = getPortfolioSummary(reports);
  const summaryRows = reports.map((report) => {
    const counts = getReportStatusCounts(report);

    return `
      <tr>
        <td>${escapeHtml(report.roomNumber)}</td>
        <td>${escapeHtml(report.floorLabel)}</td>
        <td>${escapeHtml(getReportStateLabel(report))}</td>
        <td>${escapeHtml(report.inspectionDate)}</td>
        <td>${escapeHtml(getSellabilityStatusLabel(report.sellabilityStatus))}</td>
        <td class="number">${counts.perfect ?? 0}</td>
        <td class="number">${counts.good ?? 0}</td>
        <td class="number">${counts.average ?? 0}</td>
        <td class="number">${counts.needs_attention ?? 0}</td>
        <td class="number">${counts.damaged ?? 0}</td>
        <td class="number">${counts.needs_replacement ?? 0}</td>
        <td>${escapeHtml(report.signedByName || "-")}</td>
      </tr>
    `;
  }).join("");
  const roomSections = reports.map((report) => {
    const rows = report.items.map((item) => `
      <tr>
        <td class="number">${item.number}</td>
        <td>${escapeHtml(item.name)}</td>
        <td class="number">${escapeHtml(item.quantity ?? "-")}</td>
        <td>${escapeHtml(getStatusLabel(item.status))}</td>
        <td>${escapeHtml(item.remark || "-")}</td>
      </tr>
    `).join("");

    return `
      <section class="room-report">
        <h2>${isRoomPropertyStatusEventSpace(report.roomNumber) ? "Event Space" : "Room"} ${escapeHtml(report.roomNumber)}</h2>
        <div class="meta">
          <span><strong>Floor:</strong> ${escapeHtml(report.floorLabel)}</span>
          <span><strong>Inspection date:</strong> ${escapeHtml(report.inspectionDate)}</span>
          <span><strong>Sellability:</strong> ${escapeHtml(getSellabilityStatusLabel(report.sellabilityStatus))}</span>
          <span><strong>Report status:</strong> ${escapeHtml(getReportStateLabel(report))}</span>
          <span><strong>Signed by:</strong> ${escapeHtml(report.signedByName || "Not signed")}</span>
          <span><strong>Role:</strong> ${escapeHtml(report.signedByTitle || "-")}</span>
          <span><strong>Signed:</strong> ${escapeHtml(report.signedAtIso ? formatFriendlyDate(report.signedAtIso) : "Not signed")}</span>
        </div>
        <table>
          <thead><tr><th>No.</th><th>Item</th><th>Quantity</th><th>Status</th><th>Remark</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="damages"><strong>Other damages</strong><br><br>${escapeHtml(report.otherDamages || "None reported")}</div>
        <div class="signature">
          <div>Housekeeping Manager / Supervisor</div>
          <div>Date / Signature</div>
        </div>
      </section>
    `;
  }).join("");

  reportWindow.document.open();
  reportWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>Signed Room Property Status Reports</title>
        <style>
          @page { size: A4 landscape; margin: 12mm; }
          * { box-sizing: border-box; }
          body { color: #172033; font-family: Arial, sans-serif; margin: 0; }
          h1 { font-size: 22px; margin: 0 0 6px; text-align: center; }
          h2 { font-size: 18px; margin: 0 0 8px; }
          .generated { color: #64748b; font-size: 11px; margin-bottom: 14px; text-align: center; }
          .summary-cards { display: grid; gap: 8px; grid-template-columns: repeat(4, 1fr); margin: 14px 0; }
          .summary-card { border: 1px solid #cbd5e1; padding: 9px; }
          .summary-card span { color: #64748b; display: block; font-size: 9px; text-transform: uppercase; }
          .summary-card strong { display: block; font-size: 18px; margin-top: 4px; }
          .meta { display: flex; flex-wrap: wrap; gap: 8px 24px; font-size: 12px; margin: 14px 0; }
          .meta strong { color: #111827; }
          table { border-collapse: collapse; font-size: 10px; width: 100%; }
          thead { display: table-header-group; }
          th, td { border: 1px solid #94a3b8; padding: 5px 6px; text-align: left; vertical-align: top; }
          th { background: #162338; color: white; }
          tr { break-inside: avoid; }
          .number { text-align: center; }
          .damages { border: 1px solid #94a3b8; margin-top: 12px; min-height: 64px; padding: 10px; white-space: pre-wrap; }
          .signature { display: grid; gap: 40px; grid-template-columns: 1fr 1fr; margin-top: 30px; }
          .signature div { border-top: 1px solid #475569; padding-top: 6px; font-size: 11px; }
          .room-report { break-before: page; }
        </style>
      </head>
      <body>
        <h1>SIGNED ROOM PROPERTY STATUS REPORTS</h1>
        <div class="generated">Generated ${escapeHtml(formatFriendlyDate(new Date()))}</div>
        <div class="summary-cards">
          <div class="summary-card"><span>Signed reports</span><strong>${summary.completedReports}</strong></div>
          <div class="summary-card"><span>Rooms needing attention</span><strong>${summary.roomsNeedingAttention}</strong></div>
          <div class="summary-card"><span>Sellable rooms</span><strong>${summary.sellabilityCounts.sellable ?? 0}</strong></div>
          <div class="summary-card"><span>Not sellable rooms</span><strong>${summary.sellabilityCounts.not_sellable ?? 0}</strong></div>
        </div>
        <table>
          <thead>
            <tr><th>Room</th><th>Floor</th><th>Report status</th><th>Date</th><th>Sellability</th><th>Perfect</th><th>Good</th><th>Average</th><th>Attention</th><th>Damaged</th><th>Replace</th><th>Signed by</th></tr>
          </thead>
          <tbody>${summaryRows}</tbody>
        </table>
        ${roomSections}
      </body>
    </html>
  `);

  reportWindow.document.close();
  reportWindow.focus();
  reportWindow.print();
}

function escapeCsvCell(value = "") {
  const text = String(value ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const safeText = /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;

  return `"${safeText.replaceAll('"', '""')}"`;
}

function downloadAllRoomPropertyStatusSpreadsheet(allReports) {
  if (typeof window === "undefined") {
    return;
  }

  const reports = allReports.filter(hasSignedReport);

  const summary = getPortfolioSummary(reports);
  const rows = [
    ["SIGNED ROOM PROPERTY STATUS REPORTS"],
    ["Generated", formatFriendlyDate(new Date())],
    ["Signed reports", summary.completedReports],
    ["Rooms needing attention", summary.roomsNeedingAttention],
    ["Sellable rooms", summary.sellabilityCounts.sellable ?? 0],
    ["Sellable at 80% occupancy", summary.sellabilityCounts.sellable_80_percent ?? 0],
    ["Sellable as last resort", summary.sellabilityCounts.sellable_last_resort ?? 0],
    ["Not sellable rooms", summary.sellabilityCounts.not_sellable ?? 0],
    [],
    ["ROOM SUMMARY"],
    [
      "Room", "Floor", "Report status", "Inspection date", "Sellability", "Perfect", "Good",
      "Average", "Needs attention", "Damaged", "Needs replacement", "Signed by",
      "Signer role", "Signed at",
    ],
    ...reports.map((report) => {
      const counts = getReportStatusCounts(report);

      return [
        report.roomNumber,
        report.floorLabel,
        getReportStateLabel(report),
        report.inspectionDate,
        getSellabilityStatusLabel(report.sellabilityStatus),
        counts.perfect ?? 0,
        counts.good ?? 0,
        counts.average ?? 0,
        counts.needs_attention ?? 0,
        counts.damaged ?? 0,
        counts.needs_replacement ?? 0,
        report.signedByName || "",
        report.signedByTitle || "",
        formatFriendlyDate(report.signedAtIso),
      ];
    }),
    [],
    ["ROOM DETAILS"],
    [
      "Room", "Floor", "Report status", "Inspection date", "Sellability", "Item no.", "Item",
      "Quantity", "Status", "Remark", "Other damages",
    ],
    ...reports.flatMap((report) => report.items.map((item, itemIndex) => [
      report.roomNumber,
      report.floorLabel,
      getReportStateLabel(report),
      report.inspectionDate,
      getSellabilityStatusLabel(report.sellabilityStatus),
      item.number,
      item.name,
      item.quantity ?? "",
      getStatusLabel(item.status),
      item.remark || "",
      itemIndex === 0 ? report.otherDamages || "" : "",
    ])),
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n")}`;
  const blobUrl = window.URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");

  link.href = blobUrl;
  link.download = "signed-room-property-status-reports.csv";
  link.click();
  window.URL.revokeObjectURL(blobUrl);
}

function StatusSelect({ value, onChange, disabled, ariaLabel }) {
  return (
    <select
      value={value}
      onChange={onChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className="min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
    >
      <option value="">Select status</option>
      {roomPropertyStatusOptions.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

export default function RoomPropertyStatusPanel({
  profile,
  onLoadRoomPropertyStatus,
  onLoadAllRoomPropertyStatuses,
  onSaveRoomPropertyStatus,
}) {
  const access = getRoomPropertyStatusAccess(profile);
  const [selectedFloor, setSelectedFloor] = useState("");
  const [selectedRoom, setSelectedRoom] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState("");
  const [savedReports, setSavedReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const roomOptions = useMemo(
    () => getRoomOptionsForFloor(selectedFloor),
    [selectedFloor],
  );
  const attentionCount = useMemo(
    () => report?.items.filter((item) => [
      "needs_attention",
      "damaged",
      "needs_replacement",
    ].includes(item.status)).length ?? 0,
    [report?.items],
  );
  const portfolioSummary = useMemo(
    () => getPortfolioSummary(savedReports),
    [savedReports],
  );
  const floorReportGroups = useMemo(
    () => roomFloorOptions.map((floor) => {
      const reports = savedReports.filter((savedReport) => savedReport.floorKey === floor.value);

      return {
        ...floor,
        reports,
        signedCount: reports.filter(hasSignedReport).length,
      };
    }).filter((floor) => floor.reports.length > 0),
    [savedReports],
  );

  useEffect(() => {
    let cancelled = false;

    setReportsLoading(true);
    onLoadAllRoomPropertyStatuses()
      .then((reports) => {
        if (!cancelled) {
          setSavedReports(reports);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setFeedback({ type: "error", message: error.message });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setReportsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [onLoadAllRoomPropertyStatuses]);

  useEffect(() => {
    if (!selectedRoom) {
      setReport(null);
      return undefined;
    }

    let cancelled = false;
    const room = getRoomRecord(selectedRoom);

    setLoading(true);
    setFeedback({ type: "", message: "" });

    onLoadRoomPropertyStatus(selectedRoom)
      .then((savedReport) => {
        if (!cancelled) {
          setReport(buildRoomPropertyStatusRecord(savedReport, room));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setReport(buildRoomPropertyStatusRecord({}, room));
          setFeedback({ type: "error", message: error.message });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [onLoadRoomPropertyStatus, selectedRoom]);

  if (!access.canViewPanel) {
    return null;
  }

  function updateItem(itemId, field, value) {
    setReport((current) => ({
      ...current,
      items: current.items.map((item) => (
        item.id === itemId ? { ...item, [field]: value } : item
      )),
    }));
  }

  async function handleSave(event) {
    event.preventDefault();

    if (!access.canEditPanel || !report || !selectedRoom) {
      return;
    }

    setSaving(true);
    setFeedback({ type: "", message: "" });

    try {
      const savedReport = await onSaveRoomPropertyStatus(report);
      setReport(savedReport);
      setSavedReports((current) => [
        ...current.filter((entry) => entry.roomNumber !== savedReport.roomNumber),
        savedReport,
      ].sort((left, right) => (
        (getRoomRecord(left.roomNumber)?.sortOrder ?? Number.MAX_SAFE_INTEGER) -
        (getRoomRecord(right.roomNumber)?.sortOrder ?? Number.MAX_SAFE_INTEGER)
      )));
      setFeedback({
        type: savedReport.archiveWarning ? "warning" : "success",
        message: savedReport.archiveWarning
          ? `Room ${selectedRoom} property status report signed and saved. ${savedReport.archiveWarning}`
          : `Room ${selectedRoom} property status report signed and saved.`,
      });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setSaving(false);
    }
  }

  async function handlePrintAllReports() {
    const preparedWindow = typeof window === "undefined"
      ? null
      : window.open("", "_blank", "width=1100,height=780");

    if (!preparedWindow) {
      setFeedback({ type: "error", message: "Allow pop-ups to print or save the PDF report." });
      return;
    }

    preparedWindow.document.write("<p style='font-family:Arial;padding:24px'>Preparing signed room reports...</p>");
    setExporting("print");
    setFeedback({ type: "", message: "" });

    try {
      const allReports = savedReports.length > 0
        ? savedReports
        : await onLoadAllRoomPropertyStatuses();
      const reports = allReports.filter(hasSignedReport);

      if (reports.length === 0) {
        preparedWindow.close();
        setFeedback({ type: "error", message: "No signed room property reports are available yet." });
        return;
      }

      setSavedReports(allReports);
      printAllRoomPropertyStatusReports(reports, preparedWindow);
    } catch (error) {
      preparedWindow.close();
      setFeedback({ type: "error", message: error.message });
    } finally {
      setExporting("");
    }
  }

  async function handleDownloadAllReports() {
    setExporting("excel");
    setFeedback({ type: "", message: "" });

    try {
      const allReports = savedReports.length > 0
        ? savedReports
        : await onLoadAllRoomPropertyStatuses();
      const reports = allReports.filter(hasSignedReport);

      if (reports.length === 0) {
        setFeedback({ type: "error", message: "No signed room property reports are available yet." });
        return;
      }

      setSavedReports(allReports);
      downloadAllRoomPropertyStatusSpreadsheet(reports);
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setExporting("");
    }
  }

  function openSavedReport(savedReport) {
    const room = getRoomRecord(savedReport.roomNumber);

    if (!room) {
      return;
    }

    setSelectedFloor(room.groupKey);
    setSelectedRoom(room.label);
  }

  return (
    <section className="panel p-4 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="eyebrow">Housekeeping</p>
          <h2 className="section-title">Room Property Status</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            {access.canEditPanel
              ? "Open a floor, select a room and update its report. Print and download include signed reports only."
              : "Open a floor to review a room. Print and download include signed reports only."}
          </p>
        </div>

        <div className="no-print flex flex-wrap items-center gap-2">
          {!access.canEditPanel ? (
            <span className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-sky-700">
              View only
            </span>
          ) : null}
          <button
            type="button"
            onClick={handlePrintAllReports}
            className="button-secondary"
            disabled={Boolean(exporting)}
          >
            {exporting === "print" ? "Preparing reports..." : "Print signed reports"}
          </button>
          <button
            type="button"
            onClick={handleDownloadAllReports}
            className="button-secondary"
            disabled={Boolean(exporting)}
          >
            {exporting === "excel" ? "Preparing sheet..." : "Download signed reports"}
          </button>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold text-[#162338]">Room reports</p>
            <p className="mt-1 text-xs text-slate-500">
              Select any room to review the default report or continue a signed inspection.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full bg-white px-3 py-2 text-slate-700">
              {portfolioSummary.completedReports} signed of {portfolioSummary.totalRooms}
            </span>
            <span className="rounded-full bg-amber-50 px-3 py-2 text-amber-800">
              {portfolioSummary.roomsNeedingAttention} need attention
            </span>
            <span className="rounded-full bg-rose-50 px-3 py-2 text-rose-700">
              {portfolioSummary.sellabilityCounts.not_sellable ?? 0} not sellable
            </span>
          </div>
        </div>

        {reportsLoading ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">Loading room reports...</div>
        ) : floorReportGroups.length > 0 ? (
          <div className="space-y-3 p-3 sm:p-4">
            {floorReportGroups.map((floor, floorIndex) => (
              <details
                key={floor.value}
                className="group overflow-hidden rounded-xl border border-slate-200 bg-white"
                defaultOpen={floorIndex === 0}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-slate-50 px-4 py-3 marker:content-none">
                  <span className="font-bold text-[#162338]">{floor.label}</span>
                  <span className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                    <span>{floor.reports.length} rooms</span>
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">
                      {floor.signedCount} signed
                    </span>
                    <span aria-hidden="true" className="text-base transition-transform group-open:rotate-180">⌄</span>
                  </span>
                </summary>

                <div className="grid grid-cols-2 gap-2 border-t border-slate-200 p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                  {floor.reports.map((savedReport) => {
                    const isSelected = selectedRoom === savedReport.roomNumber;
                    const isSigned = hasSignedReport(savedReport);
                    const attentionItems = getReportAttentionCount(savedReport);
                    const isEventSpace = isRoomPropertyStatusEventSpace(savedReport.roomNumber);

                    return (
                      <button
                        key={savedReport.roomNumber}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => openSavedReport(savedReport)}
                        className={`min-h-20 rounded-xl border px-3 py-2.5 text-left transition ${
                          isSelected
                            ? "border-amber-500 bg-amber-50 ring-2 ring-amber-100"
                            : "border-slate-200 bg-white hover:border-amber-300 hover:bg-amber-50/40"
                        }`}
                      >
                        <span className="flex items-start justify-between gap-2">
                          <strong className="text-base text-[#162338]">{savedReport.roomNumber}</strong>
                          <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                            isSigned ? "bg-emerald-500" : "bg-slate-300"
                          }`} aria-hidden="true" />
                        </span>
                        <span className="mt-1 block text-[11px] font-semibold text-slate-500">
                          {isEventSpace
                            ? `Event space · ${getReportStateLabel(savedReport)}`
                            : getReportStateLabel(savedReport)}
                        </span>
                        {attentionItems > 0 ? (
                          <span className="mt-1 block text-[11px] font-semibold text-amber-700">
                            {attentionItems} need attention
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </details>
            ))}
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-slate-500">No room reports are available.</div>
        )}
      </div>

      <div className="no-print mt-6 grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
        <label className="field">
          <span>Floor</span>
          <select
            value={selectedFloor}
            onChange={(event) => {
              setSelectedFloor(event.target.value);
              setSelectedRoom("");
              setReport(null);
            }}
            disabled={saving}
          >
            <option value="">Select floor</option>
            {roomFloorOptions.map((floor) => (
              <option key={floor.value} value={floor.value}>{floor.label}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Room</span>
          <select
            value={selectedRoom}
            onChange={(event) => setSelectedRoom(event.target.value)}
            disabled={!selectedFloor || saving}
          >
            <option value="">Select room</option>
            {roomOptions.map((room) => (
              <option key={room.value} value={room.value}>{room.label}</option>
            ))}
          </select>
        </label>

        {report ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            {attentionCount} item{attentionCount === 1 ? "" : "s"} need attention
          </div>
        ) : null}
      </div>

      {feedback.message ? (
        <div className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
          feedback.type === "success"
            ? "bg-emerald-50 text-emerald-700"
            : feedback.type === "warning"
              ? "bg-amber-50 text-amber-800"
            : "bg-rose-50 text-rose-700"
        }`}>
          {feedback.message}
        </div>
      ) : null}

      {!selectedRoom ? (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 px-5 py-12 text-center text-sm text-slate-500">
          Select a floor and room to open its property status report.
        </div>
      ) : loading ? (
        <div className="mt-6 rounded-2xl border border-slate-200 px-5 py-12 text-center text-sm text-slate-500">
          Loading room report...
        </div>
      ) : report ? (
        <form onSubmit={handleSave} className="mt-6">
          <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl bg-[#162338] px-4 py-3 text-white">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Room</span>
              <strong className="mt-1 block text-xl">{report.roomNumber}</strong>
              {isRoomPropertyStatusEventSpace(report.roomNumber) ? (
                <span className="mt-2 inline-flex rounded-full bg-amber-400/20 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-200">
                  Event space
                </span>
              ) : null}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Floor</span>
              <strong className="mt-1 block text-slate-900">{report.floorLabel}</strong>
            </div>
            <label className="field rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <span>Inspection date</span>
              <input
                type="date"
                value={report.inspectionDate}
                onChange={(event) => setReport((current) => ({
                  ...current,
                  inspectionDate: event.target.value,
                }))}
                disabled={saving || !access.canEditPanel}
                required
              />
            </label>
            <label className="field rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <span>Room sellability status</span>
              <select
                value={report.sellabilityStatus}
                onChange={(event) => setReport((current) => ({
                  ...current,
                  sellabilityStatus: event.target.value,
                }))}
                disabled={saving || !access.canEditPanel}
                required
              >
                <option value="">Select sellability</option>
                {roomSellabilityStatusOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          {hasSignedReport(report) ? (
            <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <strong>Signed by {report.signedByName}</strong>
              {report.signedByTitle ? ` — ${report.signedByTitle}` : ""}
              {report.signedAtIso ? ` on ${formatFriendlyDate(report.signedAtIso)}` : ""}.
              {access.canEditPanel
                ? " The saved entries are displayed below and can be continued or corrected."
                : " This is the latest signed room report."}
            </div>
          ) : access.canEditPanel ? (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {isRoomPropertyStatusEventSpace(report.roomNumber)
                ? "Room 105 is an event space. Complete its dedicated event-space checklist, choose a sellability status, then sign by saving."
                : "This room is showing the editable starter values from the supplied report. Review them, choose a sellability status, then sign by saving."}
            </div>
          ) : (
            <div className="mb-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
              This is the unsigned default report. A Housekeeping manager or supervisor can review, edit and sign it.
            </div>
          )}

          {access.canEditPanel ? (
            <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-500">
              Use “Mark all as perfect” for a fully checked room, then change only exceptions.
            </p>
            <button
              type="button"
              className="button-secondary"
              disabled={saving}
              onClick={() => setReport((current) => ({
                ...current,
                items: current.items.map((item) => ({ ...item, status: "perfect" })),
              }))}
            >
              Mark all as perfect
            </button>
            </div>
          ) : null}

          <div className="hidden overflow-hidden rounded-2xl border border-slate-200 md:block">
            <table className="w-full table-fixed border-collapse bg-white text-left text-sm">
              <thead className="bg-[#162338] text-white">
                <tr>
                  <th className="w-14 px-3 py-3 text-center">No.</th>
                  <th className="w-[28%] px-3 py-3">Item</th>
                  <th className="w-28 px-3 py-3 text-center">Quantity</th>
                  <th className="w-48 px-3 py-3">Status</th>
                  <th className="px-3 py-3">Remark</th>
                </tr>
              </thead>
              <tbody>
                {report.items.map((item) => (
                  <tr key={item.id} className="border-t border-slate-200 align-top odd:bg-slate-50/70">
                    <td className="px-3 py-2.5 text-center font-semibold text-slate-500">{item.number}</td>
                    <td className="px-3 py-2.5 font-semibold text-slate-800">{item.name}</td>
                    <td className="px-3 py-2.5">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={7}
                        pattern="(?:nil|[0-9]{1,3}(?:/[0-9]{1,3})?)"
                        value={item.quantity ?? ""}
                        onChange={(event) => updateItem(item.id, "quantity", event.target.value)}
                        disabled={saving || !access.canEditPanel}
                        aria-label={`${item.name} quantity`}
                        className="min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-center text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusSelect
                        value={item.status}
                        onChange={(event) => updateItem(item.id, "status", event.target.value)}
                        disabled={saving || !access.canEditPanel}
                        ariaLabel={`${item.name} status`}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <input
                        type="text"
                        maxLength={300}
                        value={item.remark}
                        onChange={(event) => updateItem(item.id, "remark", event.target.value)}
                        disabled={saving || !access.canEditPanel}
                        placeholder="Add remark"
                        aria-label={`${item.name} remark`}
                        className="min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {report.items.map((item) => (
              <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#162338] text-xs font-bold text-white">
                    {item.number}
                  </span>
                  <strong className="pt-1 text-sm text-slate-900">{item.name}</strong>
                </div>
                <div className="mt-4 grid grid-cols-[5.5rem_1fr] gap-3">
                  <label className="field">
                    <span>Quantity</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={7}
                      pattern="(?:nil|[0-9]{1,3}(?:/[0-9]{1,3})?)"
                      value={item.quantity ?? ""}
                      onChange={(event) => updateItem(item.id, "quantity", event.target.value)}
                      disabled={saving || !access.canEditPanel}
                    />
                  </label>
                  <label className="field">
                    <span>Status</span>
                    <StatusSelect
                      value={item.status}
                      onChange={(event) => updateItem(item.id, "status", event.target.value)}
                      disabled={saving || !access.canEditPanel}
                      ariaLabel={`${item.name} status`}
                    />
                  </label>
                </div>
                <label className="field mt-3">
                  <span>Remark</span>
                  <input
                    type="text"
                    maxLength={300}
                    value={item.remark}
                    onChange={(event) => updateItem(item.id, "remark", event.target.value)}
                    disabled={saving || !access.canEditPanel}
                    placeholder="Add remark"
                  />
                </label>
              </div>
            ))}
          </div>

          <label className="field mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <span>Other damages</span>
            <textarea
              rows={5}
              maxLength={2000}
              value={report.otherDamages}
              onChange={(event) => setReport((current) => ({
                ...current,
                otherDamages: event.target.value,
              }))}
              disabled={saving || !access.canEditPanel}
              placeholder="Add any damage or room property not covered in the list above."
            />
          </label>

          {access.canEditPanel ? (
            <div className="no-print sticky bottom-3 z-10 mt-5 flex justify-end">
              <button type="submit" className="button-primary min-w-48 shadow-xl" disabled={saving}>
                {saving ? "Signing report..." : "Sign and save report"}
              </button>
            </div>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
