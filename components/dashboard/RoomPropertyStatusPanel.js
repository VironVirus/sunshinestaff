"use client";

import { useEffect, useMemo, useState } from "react";
import { getRoomOptionsForFloor, getRoomRecord, roomFloorOptions } from "@/data/hotelRooms";
import {
  buildRoomPropertyStatusRecord,
  roomPropertyStatusOptions,
} from "@/data/roomPropertyStatus";
import { formatFriendlyDate } from "@/lib/format";
import { downloadTextPdf } from "@/lib/pdf";
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

function wrapReportText(value, maximumLength = 78) {
  const paragraphs = String(value ?? "").split(/\r?\n/);
  const lines = [];

  paragraphs.forEach((paragraph) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    let currentLine = "";

    if (words.length === 0) {
      lines.push("");
      return;
    }

    words.forEach((word) => {
      const nextLine = currentLine ? `${currentLine} ${word}` : word;

      if (currentLine && nextLine.length > maximumLength) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = nextLine;
      }
    });

    lines.push(currentLine);
  });

  return lines;
}

function buildReportLines(report) {
  const lines = [
    `Room: ${report.roomNumber}`,
    `Floor: ${report.floorLabel}`,
    `Inspection date: ${report.inspectionDate}`,
    `Prepared by: ${report.updatedByName || "Not saved yet"}`,
    `Last updated: ${formatFriendlyDate(report.updatedAtIso)}`,
    "",
  ];

  report.items.forEach((item) => {
    lines.push(`${item.number}. ${item.name}`);
    lines.push(`   Quantity: ${item.quantity ?? "-"} | Status: ${getStatusLabel(item.status)}`);
    wrapReportText(item.remark || "None", 70).forEach((remarkLine, index) => {
      lines.push(`${index === 0 ? "   Remark: " : "           "}${remarkLine}`);
    });
  });

  lines.push("", "Other damages:", ...wrapReportText(report.otherDamages || "None reported"));
  return lines;
}

function printRoomPropertyStatusReport(report) {
  if (typeof window === "undefined") {
    return;
  }

  const reportWindow = window.open("", "_blank", "width=1100,height=780");

  if (!reportWindow) {
    return;
  }

  const rows = report.items.map((item) => `
    <tr>
      <td class="number">${item.number}</td>
      <td>${escapeHtml(item.name)}</td>
      <td class="quantity">${escapeHtml(item.quantity ?? "-")}</td>
      <td>${escapeHtml(getStatusLabel(item.status))}</td>
      <td>${escapeHtml(item.remark || "-")}</td>
    </tr>
  `).join("");

  reportWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>Room Property Status Report - ${escapeHtml(report.roomNumber)}</title>
        <style>
          @page { size: A4 landscape; margin: 12mm; }
          * { box-sizing: border-box; }
          body { color: #172033; font-family: Arial, sans-serif; margin: 0; }
          h1 { font-size: 22px; margin: 0 0 6px; text-align: center; }
          .meta { display: flex; flex-wrap: wrap; gap: 8px 24px; font-size: 12px; margin: 14px 0; }
          .meta strong { color: #111827; }
          table { border-collapse: collapse; font-size: 10px; width: 100%; }
          thead { display: table-header-group; }
          th, td { border: 1px solid #94a3b8; padding: 5px 6px; text-align: left; vertical-align: top; }
          th { background: #162338; color: white; }
          tr { break-inside: avoid; }
          .number, .quantity { text-align: center; width: 46px; }
          .damages { border: 1px solid #94a3b8; margin-top: 12px; min-height: 64px; padding: 10px; white-space: pre-wrap; }
          .signature { display: grid; gap: 40px; grid-template-columns: 1fr 1fr; margin-top: 30px; }
          .signature div { border-top: 1px solid #475569; padding-top: 6px; font-size: 11px; }
        </style>
      </head>
      <body>
        <h1>ROOM PROPERTY STATUS REPORT</h1>
        <div class="meta">
          <span><strong>Room:</strong> ${escapeHtml(report.roomNumber)}</span>
          <span><strong>Floor:</strong> ${escapeHtml(report.floorLabel)}</span>
          <span><strong>Inspection date:</strong> ${escapeHtml(report.inspectionDate)}</span>
          <span><strong>Prepared by:</strong> ${escapeHtml(report.updatedByName || "Not saved yet")}</span>
          <span><strong>Last updated:</strong> ${escapeHtml(formatFriendlyDate(report.updatedAtIso))}</span>
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
      </body>
    </html>
  `);

  reportWindow.document.close();
  reportWindow.focus();
  reportWindow.print();
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
  onSaveRoomPropertyStatus,
}) {
  const access = getRoomPropertyStatusAccess(profile);
  const [selectedFloor, setSelectedFloor] = useState("");
  const [selectedRoom, setSelectedRoom] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
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
      setFeedback({
        type: "success",
        message: `Room ${selectedRoom} property status report saved.`,
      });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setSaving(false);
    }
  }

  function handleDownload() {
    if (!report) {
      return;
    }

    downloadTextPdf({
      filename: `room-${report.roomNumber.replaceAll("/", "-")}-property-status-report.pdf`,
      title: "ROOM PROPERTY STATUS REPORT",
      lines: buildReportLines(report),
    });
  }

  return (
    <section className="panel p-4 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="eyebrow">Housekeeping</p>
          <h2 className="section-title">Room Property Status</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            {access.canEditPanel
              ? "Select a room, record the quantity and condition of each item, then save, print or download the room report."
              : "Select a room to review, print or download its housekeeping property report."}
          </p>
        </div>

        <div className="no-print flex flex-wrap items-center gap-2">
          {!access.canEditPanel ? (
            <span className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-sky-700">
              View only
            </span>
          ) : null}
          {report ? (
            <>
            <button
              type="button"
              onClick={() => printRoomPropertyStatusReport(report)}
              className="button-secondary"
              disabled={loading}
            >
              Print report
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="button-secondary"
              disabled={loading}
            >
              Download PDF
            </button>
            </>
          ) : null}
        </div>
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
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl bg-[#162338] px-4 py-3 text-white">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Room</span>
              <strong className="mt-1 block text-xl">{report.roomNumber}</strong>
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
          </div>

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
                        type="number"
                        min="0"
                        max="999"
                        inputMode="numeric"
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
                      type="number"
                      min="0"
                      max="999"
                      inputMode="numeric"
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

          {feedback.message ? (
            <div className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
              feedback.type === "success"
                ? "bg-emerald-50 text-emerald-700"
                : "bg-rose-50 text-rose-700"
            }`}>
              {feedback.message}
            </div>
          ) : null}

          {access.canEditPanel ? (
            <div className="no-print sticky bottom-3 z-10 mt-5 flex justify-end">
              <button type="submit" className="button-primary min-w-48 shadow-xl" disabled={saving}>
                {saving ? "Saving report..." : "Save room report"}
              </button>
            </div>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
