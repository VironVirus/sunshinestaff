"use client";

import { useMemo, useState } from "react";
import { formatFriendlyDate } from "@/lib/format";
import { downloadTextPdf } from "@/lib/pdf";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function printLog(title, lines) {
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
        <pre>${escapeHtml(lines.join("\n"))}</pre>
      </body>
    </html>
  `);

  reportWindow.document.close();
  reportWindow.focus();
  reportWindow.print();
}

function isInRange(entry, startDate, endDate) {
  if (!entry?.createdDateKey) {
    return false;
  }

  if (!startDate && !endDate) {
    return true;
  }

  if (startDate && entry.createdDateKey < startDate) {
    return false;
  }

  if (endDate && entry.createdDateKey > endDate) {
    return false;
  }

  return true;
}

function buildLogLines(entries) {
  const lines = [
    "Sunshine Hotel Time Stamp Log",
    `Generated: ${formatFriendlyDate(new Date(), {
      dateStyle: "full",
      timeStyle: "short",
    })}`,
    "",
  ];

  if (entries.length === 0) {
    lines.push("No activity found for the selected dates.");
    return lines;
  }

  entries.forEach((entry, index) => {
    lines.push(`${index + 1}. ${entry.message}`);
    lines.push(`Area: ${entry.area || "General"}`);
    lines.push(`Action: ${entry.actionType || "update"}`);
    lines.push(`By: ${entry.actorName || "Portal"}${entry.actorDepartment ? ` - ${entry.actorDepartment}` : ""}`);
    lines.push(
      `Time: ${
        entry.createdAt
          ? formatFriendlyDate(new Date(entry.createdAt), {
              dateStyle: "medium",
              timeStyle: "short",
            })
          : "Not set"
      }`,
    );
    if (entry.targetRoomNumber) {
      lines.push(`Room: ${entry.targetRoomNumber}`);
    }
    lines.push("");
  });

  return lines;
}

export default function ActivityLogPanel({ activityLogs }) {
  const todayDateKey = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(todayDateKey);
  const [endDate, setEndDate] = useState(todayDateKey);
  const visibleEntries = useMemo(
    () => (activityLogs ?? []).filter((entry) => isInRange(entry, startDate, endDate)),
    [activityLogs, endDate, startDate],
  );
  const logLines = useMemo(() => buildLogLines(visibleEntries), [visibleEntries]);

  return (
    <section className="panel p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="section-title">Time Stamp Log</h2>
          <p className="mt-2 text-sm text-slate-500">
            Audit trail of staff activities with names and exact times.
          </p>
        </div>

        <div className="flex flex-wrap gap-3 no-print">
          <button
            type="button"
            onClick={() => printLog("Sunshine Hotel Time Stamp Log", logLines)}
            className="button-secondary"
          >
            Print time stamp log
          </button>
          <button
            type="button"
            onClick={() =>
              downloadTextPdf({
                filename: "sunshine-time-stamp-log.pdf",
                title: "Sunshine Hotel Time Stamp Log",
                lines: logLines,
              })
            }
            className="button-secondary"
          >
            Download PDF
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 no-print">
        <label className="field">
          <span>From</span>
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>

        <label className="field">
          <span>To</span>
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>
      </div>

      <div className="mt-5 space-y-3">
        {visibleEntries.length > 0 ? (
          visibleEntries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold text-[#162338]">{entry.message}</p>
                  <p className="mt-2 text-sm text-slate-500">
                    {entry.actorName || "Portal"}
                    {entry.actorDepartment ? ` - ${entry.actorDepartment}` : ""}
                    {entry.area ? ` - ${entry.area}` : ""}
                  </p>
                </div>

                <span className="text-xs font-medium text-slate-500">
                  {entry.createdAt
                    ? formatFriendlyDate(new Date(entry.createdAt), {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : ""}
                </span>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-500">
            No activity found for the selected dates.
          </div>
        )}
      </div>
    </section>
  );
}
