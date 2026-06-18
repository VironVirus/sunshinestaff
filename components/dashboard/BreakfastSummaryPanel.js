"use client";

import { useMemo } from "react";
import { formatFriendlyDate } from "@/lib/format";
import { formatDateKey, getOperationalDateKey } from "@/lib/hotelTime";
import { downloadTextPdf } from "@/lib/pdf";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function printTextReport(title, lines) {
  if (typeof window === "undefined") {
    return;
  }

  const reportWindow = window.open("", "_blank", "width=900,height=720");

  if (!reportWindow) {
    return;
  }

  const lineMarkup = lines
    .map((line) => {
      const text = escapeHtml(line) || "&nbsp;";

      return `<div style="white-space:pre-wrap; line-height:1.8; font-size:14px;">${text}</div>`;
    })
    .join("");

  reportWindow.document.write(`
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #1f2937; margin: 32px; }
          h1 { color: #162338; margin-bottom: 12px; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        ${lineMarkup}
      </body>
    </html>
  `);

  reportWindow.document.close();
  reportWindow.focus();
  reportWindow.print();
}

function buildBreakfastSummaryLines(operations) {
  const operationalDateKey = operations?.operationalDateKey ?? getOperationalDateKey();
  const occupiedRooms = operations?.occupiedRooms ?? [];
  const lines = [
    "Sunshine Hotel F&B Breakfast Summary",
    `Operational day: ${formatDateKey(operationalDateKey)}`,
    `Generated: ${formatFriendlyDate(new Date(), {
      dateStyle: "full",
      timeStyle: "short",
    })}`,
    "",
    `Summary: ${operations?.inHouse ?? 0} occupied room(s), ${operations?.breakfastEntitled ?? 0} people entitled to breakfast`,
    "",
    "S/N | Room | Breakfast",
  ];

  if (occupiedRooms.length === 0) {
    lines.push("No occupied rooms.");
    return lines;
  }

  occupiedRooms.forEach((room, index) => {
    lines.push(`${index + 1} | ${room.roomNumber} | ${room.breakfastCount ?? 0}`);
  });

  return lines;
}

export default function BreakfastSummaryPanel({ operations }) {
  const occupiedRooms = useMemo(
    () => operations?.occupiedRooms ?? [],
    [operations?.occupiedRooms],
  );
  const reportLines = useMemo(
    () => buildBreakfastSummaryLines(operations),
    [operations],
  );

  return (
    <section className="panel p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="section-title">Breakfast List</h2>
        <span className="badge">
          {operations?.inHouse ?? 0} rooms / {operations?.breakfastEntitled ?? 0} breakfast
        </span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="subpanel">
          <span className="metric-label">Occupied rooms</span>
          <span className="metric-value">{operations?.inHouse ?? 0}</span>
        </div>
        <div className="subpanel">
          <span className="metric-label">Breakfast total</span>
          <span className="metric-value">{operations?.breakfastEntitled ?? 0}</span>
        </div>
      </div>

      <div className="subpanel mt-6 no-print">
        <p className="metric-label">Breakfast report actions</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => printTextReport("Sunshine Hotel F&B Breakfast Summary", reportLines)}
            className="button-secondary"
          >
            Print breakfast list
          </button>
          <button
            type="button"
            onClick={() =>
              downloadTextPdf({
                filename: "sunshine-f-and-b-breakfast-summary.pdf",
                title: "Sunshine Hotel F&B Breakfast Summary",
                lines: reportLines,
              })
            }
            className="button-secondary"
          >
            Download PDF
          </button>
        </div>
      </div>

      <div className="subpanel mt-6">
        <p className="metric-label">Room and breakfast list</p>

        {occupiedRooms.length > 0 ? (
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/80">
            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3 border-b border-slate-200 bg-slate-100 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-600">
              <span>Room</span>
              <span className="text-right">Breakfast</span>
            </div>

            <div className="max-h-[34rem] divide-y divide-slate-200 overflow-y-auto">
              {occupiedRooms.map((room) => (
                <div
                  key={room.roomNumber}
                  className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-3 px-4 py-2.5 text-sm"
                >
                  <span className="truncate font-semibold text-[#162338]">{room.roomNumber}</span>
                  <span className="text-right font-semibold text-slate-700">
                    {room.breakfastCount ?? 0}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-500">
            No occupied rooms right now.
          </div>
        )}
      </div>
    </section>
  );
}
