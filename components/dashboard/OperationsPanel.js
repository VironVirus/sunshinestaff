"use client";

import { useEffect, useMemo, useState } from "react";
import {
  configuredHotelRoomCount,
  getRoomOptionsForFloor,
  roomFloorOptions,
  roomGroups,
  statedHotelRoomCount,
  unlistedRoomCount,
} from "@/data/hotelRooms";
import { getRoomComplaintLabel } from "@/data/propertyStatus";
import { formatFriendlyDate } from "@/lib/format";
import {
  compareDateKeys,
  formatDateKey,
  getHotelHour,
  getOperationalDateKey,
  listDateKeysInRange,
} from "@/lib/hotelTime";
import { downloadTextPdf } from "@/lib/pdf";
import { getOperationsAccess, operationsMetricConfig } from "@/lib/roles";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function createReportLine(text = "", options = {}) {
  return {
    text,
    bold: Boolean(options.bold),
  };
}

function getReportLineText(line) {
  return typeof line === "string" ? line : line?.text ?? "";
}

function printTextReport(title, reportLines) {
  if (typeof window === "undefined") {
    return;
  }

  const reportWindow = window.open("", "_blank", "width=900,height=720");

  if (!reportWindow) {
    return;
  }

  const lineMarkup = reportLines
    .map((line) => {
      const text = escapeHtml(getReportLineText(line)) || "&nbsp;";
      const fontWeight = typeof line === "string" || !line?.bold ? "400" : "700";

      return `<div style="font-weight:${fontWeight}; white-space:pre-wrap; line-height:1.8; font-size:14px;">${text}</div>`;
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

function downloadPdf(filename, title, lines) {
  downloadTextPdf({
    filename,
    title,
    lines,
  });
}

function getOperationsActivitiesForDate(operations, targetDateKey, actionType) {
  return (operations?.activityEntries ?? []).filter(
    (entry) => entry?.operationalDateKey === targetDateKey && entry?.actionType === actionType,
  );
}

function getReportDateBounds(startDateKey, endDateKey) {
  return compareDateKeys(startDateKey, endDateKey) <= 0
    ? [startDateKey, endDateKey]
    : [endDateKey, startDateKey];
}

function getOperationsSnapshotForDate(operations, targetDateKey) {
  if (!targetDateKey) {
    return null;
  }

  if (targetDateKey === operations?.operationalDateKey) {
    return {
      dateKey: targetDateKey,
      inHouse: operations?.inHouse ?? 0,
      availableRooms: operations?.availableRooms ?? 0,
      breakfastEntitled: operations?.breakfastEntitled ?? 0,
      cleanedRooms: operations?.cleanedRooms ?? 0,
    };
  }

  return (operations?.reportHistory ?? []).find(
    (reportEntry) => reportEntry.dateKey === targetDateKey,
  ) ?? null;
}

function buildEventReportLines(eventsBookings, targetDateKey) {
  const todaysEvents = (eventsBookings?.events ?? []).filter(
    (eventEntry) => eventEntry.eventDate === targetDateKey,
  );

  if (todaysEvents.length === 0) {
    return [createReportLine("None")];
  }

  return todaysEvents.map((eventEntry, index) => {
    const details = [
      `${index + 1}. ${eventEntry.eventType}`,
      eventEntry.venue,
      eventEntry.expectedGuests > 0 ? `${eventEntry.expectedGuests} guests` : "",
    ].filter(Boolean);

    return createReportLine(details.join(" - "));
  });
}

function getComplaintStatusForDate(complaint, targetDateKey) {
  if (!targetDateKey) {
    return null;
  }

  const reportedDateKey = complaint?.reportedAt
    ? getOperationalDateKey(complaint.reportedAt)
    : "";

  if (!reportedDateKey || compareDateKeys(reportedDateKey, targetDateKey) > 0) {
    return null;
  }

  if (!complaint?.resolvedAt) {
    return "Open";
  }

  const resolvedDateKey = getOperationalDateKey(complaint.resolvedAt);
  const dateComparison = compareDateKeys(targetDateKey, resolvedDateKey);

  if (dateComparison > 0) {
    return null;
  }

  return dateComparison === 0 ? "Fixed" : "Open";
}

function getComplaintsForDate(propertyStatus, targetDateKey) {
  return (propertyStatus?.roomComplaints ?? [])
    .map((complaint) => {
      const complaintStatus = getComplaintStatusForDate(complaint, targetDateKey);

      if (!complaintStatus) {
        return null;
      }

      return {
        ...complaint,
        complaintStatus,
      };
    })
    .filter(Boolean);
}

function buildComplaintReportLines(propertyStatus, targetDateKey) {
  const todaysComplaints = getComplaintsForDate(propertyStatus, targetDateKey);

  if (todaysComplaints.length === 0) {
    return [createReportLine("None")];
  }

  return todaysComplaints.map((complaint, index) => {
    const details = [
      `${index + 1}. ${complaint.roomNumber}`,
      getRoomComplaintLabel(complaint.complaintType),
      complaint.complaintNote,
      complaint.complaintStatus,
    ].filter(Boolean);

    return createReportLine(details.join(" - "));
  });
}

function buildRoomMoveReportLines(operations, targetDateKey) {
  const roomMoves = getOperationsActivitiesForDate(operations, targetDateKey, "room_move");

  if (roomMoves.length === 0) {
    return [createReportLine("None")];
  }

  return roomMoves.map((roomMove, index) => {
    const details = [
      `${index + 1}. ${roomMove.fromRoomNumber} to ${roomMove.toRoomNumber}`,
      roomMove.destinationCondition
        ? `Destination ${roomMove.destinationCondition}`
        : "",
      roomMove.actorName ?? roomMove.movedByName,
      roomMove.createdAt
        ? formatFriendlyDate(new Date(roomMove.createdAt), {
            dateStyle: "medium",
            timeStyle: "short",
          })
        : "",
    ].filter(Boolean);

    return createReportLine(details.join(" - "));
  });
}

function buildCheckInReportLines(operations, targetDateKey) {
  const checkIns = getOperationsActivitiesForDate(operations, targetDateKey, "check_in");

  if (checkIns.length === 0) {
    return [createReportLine("None")];
  }

  return checkIns.map((entry, index) =>
    createReportLine(
      [
        `${index + 1}. ${entry.roomNumber}`,
        entry.checkInCategory === "early_check_in" ? "EARLY CHECK IN" : "Check in",
        entry.guestType === "corporate" ? "Corporate" : "Walk in",
        `${entry.breakfastCount ?? 0} breakfast`,
        `${entry.bookedDays ?? 1} day(s)`,
      ].join(" - "),
      {
        bold: entry.checkInCategory === "early_check_in",
      },
    ),
  );
}

function buildCheckOutReportLines(operations, targetDateKey) {
  const checkOuts = getOperationsActivitiesForDate(operations, targetDateKey, "check_out");

  if (checkOuts.length === 0) {
    return [createReportLine("None")];
  }

  return checkOuts.map((entry, index) =>
    createReportLine(
      [
        `${index + 1}. ${entry.roomNumber}`,
        entry.checkoutCategory === "late_check_out" ? "LATE CHECK OUT" : "Check out",
      ].join(" - "),
      {
        bold: entry.checkoutCategory === "late_check_out",
      },
    ),
  );
}

function buildOccupiedRoomSections(occupiedRooms = []) {
  const occupiedMap = new Map(occupiedRooms.map((room) => [room.roomNumber, room]));

  return roomGroups.map((group) => {
    const rooms = group.rooms
      .filter((roomNumber) => occupiedMap.has(roomNumber))
      .map((roomNumber, index) => {
        const room = occupiedMap.get(roomNumber);

        return {
          serialNumber: index + 1,
          roomNumber,
          breakfastCount: room?.breakfastIncluded ? room.breakfastCount ?? 0 : 0,
          remainingDays: room?.remainingDays ?? room?.bookedDays ?? 1,
        };
      });

    return {
      key: group.key,
      label: group.label,
      rooms,
      breakfastTotal: rooms.reduce((total, room) => total + room.breakfastCount, 0),
    };
  });
}

function buildRoomNumberSections(roomNumbers = []) {
  const roomSet = new Set(roomNumbers);

  return roomGroups.map((group) => ({
    key: group.key,
    label: group.label,
    rooms: group.rooms.filter((roomNumber) => roomSet.has(roomNumber)),
  }));
}

function buildDailyReportSectionLines({
  operations,
  eventsBookings,
  propertyStatus,
  targetDateKey,
}) {
  const snapshot = getOperationsSnapshotForDate(operations, targetDateKey);
  const lines = [
    createReportLine(`Operational day: ${formatDateKey(targetDateKey)}`),
    createReportLine(""),
  ];

  if (snapshot) {
    lines.push(createReportLine(`In-house rooms: ${snapshot.inHouse ?? 0}`));
    lines.push(createReportLine(`Available rooms: ${snapshot.availableRooms ?? 0}`));
    lines.push(createReportLine(`Breakfast entitlement: ${snapshot.breakfastEntitled ?? 0}`));
    lines.push(createReportLine(`Cleaned rooms: ${snapshot.cleanedRooms ?? 0}`));
  } else {
    lines.push(createReportLine("No front office snapshot recorded for this day."));
  }

  lines.push(createReportLine(""));
  lines.push(createReportLine("Check-ins:"));
  lines.push(...buildCheckInReportLines(operations, targetDateKey));
  lines.push(createReportLine(""));
  lines.push(createReportLine("Check-outs:"));
  lines.push(...buildCheckOutReportLines(operations, targetDateKey));
  lines.push(createReportLine(""));
  lines.push(createReportLine("Events:"));
  lines.push(...buildEventReportLines(eventsBookings, targetDateKey));
  lines.push(createReportLine(""));
  lines.push(createReportLine("Room moves:"));
  lines.push(...buildRoomMoveReportLines(operations, targetDateKey));
  lines.push(createReportLine(""));
  lines.push(createReportLine("Complaint follow-up:"));
  lines.push(...buildComplaintReportLines(propertyStatus, targetDateKey));

  return lines;
}

function buildDailyReportLines({
  operations,
  eventsBookings,
  propertyStatus,
  targetDateKey = operations?.operationalDateKey ?? getOperationalDateKey(),
}) {
  const operationalDateKey = targetDateKey;

  return [
    createReportLine(`Generated: ${formatFriendlyDate(new Date(), {
      dateStyle: "full",
      timeStyle: "short",
    })}`),
    createReportLine(""),
    ...buildDailyReportSectionLines({
      operations,
      eventsBookings,
      propertyStatus,
      targetDateKey: operationalDateKey,
    }),
  ];
}

function buildRangeReportLines({
  operations,
  eventsBookings,
  propertyStatus,
  startDateKey,
  endDateKey,
}) {
  const [rangeStart, rangeEnd] = getReportDateBounds(startDateKey, endDateKey);
  const dateKeys = listDateKeysInRange(rangeStart, rangeEnd);
  const lines = [
    createReportLine(`Report range: ${formatDateKey(rangeStart)} to ${formatDateKey(rangeEnd)}`),
    createReportLine(`Generated: ${formatFriendlyDate(new Date(), {
      dateStyle: "full",
      timeStyle: "short",
    })}`),
    createReportLine(""),
  ];

  if (dateKeys.length === 0) {
    lines.push(createReportLine("No report dates selected."));
    return lines;
  }

  dateKeys.forEach((dateKey, index) => {
    lines.push(
      ...buildDailyReportSectionLines({
        operations,
        eventsBookings,
        propertyStatus,
        targetDateKey: dateKey,
      }),
    );

    if (index < dateKeys.length - 1) {
      lines.push(createReportLine(""));
      lines.push(createReportLine("----------------------------------------"));
      lines.push(createReportLine(""));
    }
  });

  return lines;
}

function buildInHouseReportLines(operations) {
  const operationalDateKey = operations?.operationalDateKey ?? getOperationalDateKey();
  const sections = buildOccupiedRoomSections(operations?.occupiedRooms ?? []);
  const occupiedSections = sections.filter((section) => section.rooms.length > 0);
  const lines = [
    "Sunshine Hotel In House Report",
    `Operational day: ${formatDateKey(operationalDateKey)}`,
    `Generated: ${formatFriendlyDate(new Date(), {
      dateStyle: "full",
      timeStyle: "short",
    })}`,
    "",
    `Summary: ${operations?.inHouse ?? 0} occupied room(s), ${operations?.breakfastEntitled ?? 0} breakfast entitlement`,
    "",
  ];

  if (occupiedSections.length === 0) {
    lines.push("No occupied rooms.");
    return lines;
  }

  occupiedSections.forEach((section) => {
    lines.push(section.label);
    lines.push("S/N | Room number | Breakfast");
    section.rooms.forEach((room) => {
      lines.push(`${room.serialNumber} | ${room.roomNumber} | ${room.breakfastCount}`);
    });
    lines.push(
      `Summary: ${section.rooms.length} occupied room(s), ${section.breakfastTotal} breakfast entitlement`,
    );
    lines.push("");
  });

  return lines;
}

function buildCleanedRoomsReportLines(operations) {
  const operationalDateKey = operations?.operationalDateKey ?? getOperationalDateKey();
  const sections = buildRoomNumberSections(operations?.cleanedRoomNumbers ?? []);
  const cleanedSections = sections.filter((section) => section.rooms.length > 0);
  const lines = [
    "Sunshine Hotel Cleaned Rooms Report",
    `Operational day: ${formatDateKey(operationalDateKey)}`,
    `Generated: ${formatFriendlyDate(new Date(), {
      dateStyle: "full",
      timeStyle: "short",
    })}`,
    "",
    `Summary: ${operations?.cleanedRooms ?? 0} cleaned room(s)`,
    "",
  ];

  if (cleanedSections.length === 0) {
    lines.push("No cleaned rooms reported.");
    return lines;
  }

  cleanedSections.forEach((section) => {
    lines.push(section.label);
    lines.push(section.rooms.join(", "));
    lines.push(`Summary: ${section.rooms.length} cleaned room(s)`);
    lines.push("");
  });

  return lines;
}

function buildBreakfastSummaryLines(operations) {
  const operationalDateKey = operations?.operationalDateKey ?? getOperationalDateKey();
  const sections = buildOccupiedRoomSections(operations?.occupiedRooms ?? []);
  const occupiedSections = sections.filter((section) => section.rooms.length > 0);
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
  ];

  if (occupiedSections.length === 0) {
    lines.push("No occupied rooms.");
    return lines;
  }

  occupiedSections.forEach((section) => {
    lines.push(section.label);
    lines.push("S/N | Room | Breakfast");
    section.rooms.forEach((room) => {
      lines.push(`${room.serialNumber} | ${room.roomNumber} | ${room.breakfastCount}`);
    });
    lines.push(
      `Summary: ${section.rooms.length} occupied room(s), ${section.breakfastTotal} people entitled to breakfast`,
    );
    lines.push("");
  });

  return lines;
}

function MetricTile({ metricKey, operations }) {
  const metric = operationsMetricConfig[metricKey];

  if (!metric) {
    return null;
  }

  return (
    <div className="subpanel">
      <span className="metric-label">{metric.shortLabel}</span>
      <span className="metric-value">
        {Number(operations?.[metricKey] ?? 0).toLocaleString()}
      </span>
    </div>
  );
}

function FloorSelect({ label, value, onChange, floors, disabled }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={onChange} disabled={disabled}>
        <option value="">Select floor</option>
        {floors.map((floor) => (
          <option key={floor.value} value={floor.value}>
            {floor.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function RoomSelect({ label, value, onChange, rooms, disabled }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={onChange} disabled={disabled}>
        <option value="">Select room</option>
        {rooms.map((room) => (
          <option key={room.value} value={room.value}>
            {room.label}
          </option>
        ))}
      </select>
    </label>
  );
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

function ReportActionGroup({ title, actions }) {
  return (
    <div className="subpanel no-print">
      <p className="metric-label">{title}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            className="button-secondary"
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ReportRangeActionGroup({
  title,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  actions,
}) {
  return (
    <div className="subpanel no-print">
      <p className="metric-label">{title}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="field">
          <span>From</span>
          <input type="date" value={startDate} onChange={onStartDateChange} />
        </label>

        <label className="field">
          <span>To</span>
          <input type="date" value={endDate} onChange={onEndDateChange} />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            className="button-secondary"
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function OccupiedRoomsOverview({ sections }) {
  const visibleSections = sections.filter((section) => section.rooms.length > 0);

  return (
    <div className="subpanel">
      <div className="flex items-center justify-between gap-3">
        <p className="metric-label">Occupied rooms</p>
        <span className="badge">
          {visibleSections.reduce((total, section) => total + section.rooms.length, 0)}
        </span>
      </div>

      {visibleSections.length > 0 ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {visibleSections.map((section) => (
            <div
              key={section.key}
              className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-[#162338]">{section.label}</p>
                <span className="text-xs font-semibold text-slate-500">
                  {section.rooms.length} room(s)
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {section.rooms.map((room) => (
                  <div
                    key={room.roomNumber}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3"
                  >
                    <div>
                      <p className="font-semibold text-[#162338]">{room.roomNumber}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Booked for {room.bookedDays ?? room.remainingDays ?? 1} day(s)
                      </p>
                    </div>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                      Breakfast: {room.breakfastCount}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">No occupied rooms.</p>
      )}
    </div>
  );
}

function CleanedRoomsOverview({ sections, canRemove, onRemove }) {
  const visibleSections = sections.filter((section) => section.rooms.length > 0);
  const [activeSectionKey, setActiveSectionKey] = useState("");
  const [activeRoomNumber, setActiveRoomNumber] = useState("");
  const activeSection = useMemo(
    () =>
      visibleSections.find((section) => section.key === activeSectionKey) ??
      visibleSections[0] ??
      null,
    [activeSectionKey, visibleSections],
  );
  const activeRoom = useMemo(
    () =>
      activeSection?.rooms.find((roomNumber) => roomNumber === activeRoomNumber) ??
      activeSection?.rooms[0] ??
      "",
    [activeRoomNumber, activeSection],
  );

  useEffect(() => {
    if (visibleSections.length === 0) {
      setActiveSectionKey("");
      setActiveRoomNumber("");
      return;
    }

    if (!visibleSections.some((section) => section.key === activeSectionKey)) {
      setActiveSectionKey(visibleSections[0].key);
    }
  }, [activeSectionKey, visibleSections]);

  useEffect(() => {
    if (!activeSection) {
      setActiveRoomNumber("");
      return;
    }

    if (!activeSection.rooms.some((roomNumber) => roomNumber === activeRoomNumber)) {
      setActiveRoomNumber(activeSection.rooms[0] ?? "");
    }
  }, [activeRoomNumber, activeSection]);

  return (
    <div className="subpanel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="metric-label">Freshly cleaned rooms</p>
          <p className="mt-2 text-sm text-slate-500">
            HouseKeeping-posted rooms are grouped floor by floor to keep the board compact.
          </p>
        </div>
        <span className="badge">
          {visibleSections.reduce((total, section) => total + section.rooms.length, 0)}
        </span>
      </div>

      {visibleSections.length > 0 ? (
        <>
          <div className="mobile-section-tabs mt-4 no-print">
            {visibleSections.map((section) => (
              <FloorBoardTab
                key={section.key}
                active={activeSection?.key === section.key}
                label={section.label}
                count={section.rooms.length}
                onClick={() => {
                  setActiveSectionKey(section.key);
                  setActiveRoomNumber(section.rooms[0] ?? "");
                }}
              />
            ))}
          </div>

          {activeSection ? (
            <>
              <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50/80 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="metric-label">Active floor</p>
                    <h3 className="mt-2 font-display text-3xl text-[#162338]">
                      {activeSection.label}
                    </h3>
                  </div>
                  <span className="badge">{activeSection.rooms.length} room(s)</span>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {activeSection.rooms.map((roomNumber) => {
                    const selected = activeRoom === roomNumber;

                    return (
                      <button
                        key={roomNumber}
                        type="button"
                        onClick={() => setActiveRoomNumber(roomNumber)}
                        className={`rounded-2xl border px-3 py-2 text-left transition ${
                          selected
                            ? "border-emerald-500 bg-emerald-600 text-white shadow-lg shadow-emerald-200/50"
                            : "border-slate-200 bg-white text-slate-800 hover:border-emerald-300"
                        }`}
                      >
                        <p className="text-sm font-semibold">{roomNumber}</p>
                        <p
                          className={`mt-1 text-xs ${
                            selected ? "text-emerald-50" : "text-emerald-700"
                          }`}
                        >
                          Freshly cleaned
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {activeRoom ? (
                <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="metric-label">Selected cleaned room</p>
                      <h3 className="mt-2 font-display text-3xl text-[#162338]">
                        {activeRoom}
                      </h3>
                      <p className="mt-2 text-sm text-slate-500">
                        Ready for front office to assign.
                      </p>
                    </div>

                    {canRemove ? (
                      <button
                        type="button"
                        onClick={() => onRemove(activeRoom)}
                        className="button-secondary no-print"
                      >
                        Clear room
                      </button>
                    ) : (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                        Freshly cleaned
                      </span>
                    )}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-sm text-slate-500">No cleaned rooms reported.</p>
      )}
    </div>
  );
}

function BreakfastSummaryBoard({ sections, breakfastTotal, inHouse }) {
  const visibleSections = sections.filter((section) => section.rooms.length > 0);

  return (
    <div className="subpanel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="metric-label">F&B Breakfast Summary</p>
          <p className="mt-2 text-sm text-slate-500">
            Room-by-room breakfast entitlement for occupied rooms.
          </p>
        </div>
        <span className="badge">
          {inHouse} rooms / {breakfastTotal} breakfast
        </span>
      </div>

      {visibleSections.length > 0 ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {visibleSections.map((section) => (
            <div
              key={section.key}
              className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-[#162338]">{section.label}</p>
                <span className="text-xs font-semibold text-slate-500">
                  {section.breakfastTotal} breakfast
                </span>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {section.rooms.map((room) => (
                  <div
                    key={room.roomNumber}
                    className="rounded-2xl border border-slate-200 bg-white px-3 py-3"
                  >
                    <p className="text-sm font-semibold text-[#162338]">{room.roomNumber}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Breakfast: {room.breakfastCount}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">No occupied rooms right now.</p>
      )}
    </div>
  );
}

function getFloorsWithAvailableRooms(excludedRooms = []) {
  return roomFloorOptions.filter(
    (floor) => getRoomOptionsForFloor(floor.value, excludedRooms).length > 0,
  );
}

export default function OperationsPanel({
  profile,
  operations,
  propertyStatus,
  eventsBookings,
  onSaveFrontOffice,
  onSaveHousekeeping,
}) {
  const access = getOperationsAccess(profile);
  const operationalDateKey = operations?.operationalDateKey ?? getOperationalDateKey();
  const occupiedRooms = useMemo(() => operations?.occupiedRooms ?? [], [operations?.occupiedRooms]);
  const occupiedRoomNumbers = useMemo(
    () => occupiedRooms.map((room) => room.roomNumber),
    [occupiedRooms],
  );
  const outOfOrderRoomNumbers = useMemo(
    () => operations?.outOfOrderRoomNumbers ?? [],
    [operations?.outOfOrderRoomNumbers],
  );
  const cleanedRoomNumbers = useMemo(
    () => operations?.cleanedRoomNumbers ?? [],
    [operations?.cleanedRoomNumbers],
  );
  const canViewCleanedRooms = access.canEditFrontOffice || access.canEditHousekeeping;
  const canViewBreakfastBoard =
    profile?.departmentKey === "food_beverages" || profile?.isSuperAdmin;
  const [frontOfficeSaving, setFrontOfficeSaving] = useState(false);
  const [housekeepingSaving, setHousekeepingSaving] = useState(false);
  const [breakfastIncluded, setBreakfastIncluded] = useState(false);
  const [breakfastCount, setBreakfastCount] = useState("1");
  const [stayDuration, setStayDuration] = useState("1");
  const [guestType, setGuestType] = useState("walk_in");
  const [selectedOccupiedFloor, setSelectedOccupiedFloor] = useState("");
  const [selectedOccupiedRoom, setSelectedOccupiedRoom] = useState("");
  const [selectedCheckoutFloor, setSelectedCheckoutFloor] = useState("");
  const [selectedCheckoutRoom, setSelectedCheckoutRoom] = useState("");
  const [checkoutType, setCheckoutType] = useState("normal_check_out");
  const [selectedMoveFromFloor, setSelectedMoveFromFloor] = useState("");
  const [selectedMoveFromRoom, setSelectedMoveFromRoom] = useState("");
  const [selectedMoveToFloor, setSelectedMoveToFloor] = useState("");
  const [selectedMoveToRoom, setSelectedMoveToRoom] = useState("");
  const [moveDestinationCondition, setMoveDestinationCondition] = useState("clean");
  const [selectedCleanedFloor, setSelectedCleanedFloor] = useState("");
  const [selectedCleanedRoom, setSelectedCleanedRoom] = useState("");
  const [reportStartDate, setReportStartDate] = useState(operationalDateKey);
  const [reportEndDate, setReportEndDate] = useState(operationalDateKey);
  const [feedback, setFeedback] = useState({
    frontOffice: { type: "", message: "" },
    housekeeping: { type: "", message: "" },
  });

  const occupiedSections = useMemo(
    () => buildOccupiedRoomSections(occupiedRooms),
    [occupiedRooms],
  );
  const cleanedSections = useMemo(
    () => buildRoomNumberSections(cleanedRoomNumbers),
    [cleanedRoomNumbers],
  );
  const cleanedRoomSet = useMemo(
    () => new Set(cleanedRoomNumbers),
    [cleanedRoomNumbers],
  );
  const frontOfficeFloorOptions = useMemo(
    () => getFloorsWithAvailableRooms([...occupiedRoomNumbers, ...outOfOrderRoomNumbers]),
    [occupiedRoomNumbers, outOfOrderRoomNumbers],
  );
  const checkoutFloorOptions = useMemo(
    () =>
      roomFloorOptions.filter((floor) =>
        occupiedRooms.some((room) => room.floorKey === floor.value),
      ),
    [occupiedRooms],
  );
  const housekeepingFloorOptions = useMemo(
    () =>
      getFloorsWithAvailableRooms([
        ...occupiedRoomNumbers,
        ...cleanedRoomNumbers,
        ...outOfOrderRoomNumbers,
      ]),
    [cleanedRoomNumbers, occupiedRoomNumbers, outOfOrderRoomNumbers],
  );
  const availableFrontOfficeRooms = useMemo(
    () => {
      const rooms = getRoomOptionsForFloor(selectedOccupiedFloor, [
        ...occupiedRoomNumbers,
        ...outOfOrderRoomNumbers,
      ]).map((room, index) => ({
        ...room,
        isFreshlyCleaned: cleanedRoomSet.has(room.value),
        sortIndex: index,
      }));

      return rooms
        .sort(
          (left, right) =>
            Number(right.isFreshlyCleaned) - Number(left.isFreshlyCleaned) ||
            left.sortIndex - right.sortIndex,
        )
        .map(({ isFreshlyCleaned, sortIndex, ...room }) => ({
          ...room,
          label: isFreshlyCleaned ? `${room.label} - freshly cleaned` : room.label,
        }));
    },
    [cleanedRoomSet, occupiedRoomNumbers, outOfOrderRoomNumbers, selectedOccupiedFloor],
  );
  const availableCheckoutRooms = useMemo(
    () =>
      occupiedRooms
        .filter((room) => room.floorKey === selectedCheckoutFloor)
        .map((room) => ({
          value: room.roomNumber,
          label: `${room.roomNumber} - booked for ${room.bookedDays ?? room.remainingDays ?? 1} day(s)`,
        })),
    [occupiedRooms, selectedCheckoutFloor],
  );
  const availableMoveFromRooms = useMemo(
    () =>
      occupiedRooms
        .filter((room) => room.floorKey === selectedMoveFromFloor)
        .map((room) => ({
          value: room.roomNumber,
          label: `${room.roomNumber} - booked for ${room.bookedDays ?? room.remainingDays ?? 1} day(s)`,
        })),
    [occupiedRooms, selectedMoveFromFloor],
  );
  const availableMoveToRooms = useMemo(() => {
    const rooms = getRoomOptionsForFloor(selectedMoveToFloor, [
      ...occupiedRoomNumbers,
      ...outOfOrderRoomNumbers,
    ]).map((room, index) => ({
      ...room,
      isFreshlyCleaned: cleanedRoomSet.has(room.value),
      sortIndex: index,
    }));

    return rooms
      .sort(
        (left, right) =>
          Number(right.isFreshlyCleaned) - Number(left.isFreshlyCleaned) ||
          left.sortIndex - right.sortIndex,
      )
      .map(({ isFreshlyCleaned, sortIndex, ...room }) => ({
        ...room,
        label: isFreshlyCleaned ? `${room.label} - freshly cleaned` : room.label,
      }));
  }, [
    cleanedRoomSet,
    occupiedRoomNumbers,
    outOfOrderRoomNumbers,
    selectedMoveToFloor,
  ]);
  const availableCleanRooms = useMemo(
    () =>
      getRoomOptionsForFloor(selectedCleanedFloor, [
        ...occupiedRoomNumbers,
        ...cleanedRoomNumbers,
        ...outOfOrderRoomNumbers,
      ]),
    [cleanedRoomNumbers, occupiedRoomNumbers, outOfOrderRoomNumbers, selectedCleanedFloor],
  );
  const dailyReportLines = useMemo(
    () => buildDailyReportLines({ operations, eventsBookings, propertyStatus }),
    [eventsBookings, operations, propertyStatus],
  );
  const rangeReportLines = useMemo(
    () =>
      buildRangeReportLines({
        operations,
        eventsBookings,
        propertyStatus,
        startDateKey: reportStartDate,
        endDateKey: reportEndDate,
      }),
    [eventsBookings, operations, propertyStatus, reportEndDate, reportStartDate],
  );
  const rangeReportTitle = useMemo(() => {
    const [rangeStart, rangeEnd] = getReportDateBounds(
      reportStartDate || operationalDateKey,
      reportEndDate || operationalDateKey,
    );

    return rangeStart === rangeEnd
      ? `Sunshine Hotel Daily Operations Report - ${formatDateKey(rangeStart)}`
      : `Sunshine Hotel Daily Operations Range Report - ${formatDateKey(rangeStart)} to ${formatDateKey(rangeEnd)}`;
  }, [operationalDateKey, reportEndDate, reportStartDate]);
  const inHouseReportLines = useMemo(
    () => buildInHouseReportLines(operations),
    [operations],
  );
  const cleanedReportLines = useMemo(
    () => buildCleanedRoomsReportLines(operations),
    [operations],
  );
  const breakfastSummaryLines = useMemo(
    () => buildBreakfastSummaryLines(operations),
    [operations],
  );

  useEffect(() => {
    if (
      selectedOccupiedFloor &&
      !frontOfficeFloorOptions.some((floor) => floor.value === selectedOccupiedFloor)
    ) {
      setSelectedOccupiedFloor("");
      setSelectedOccupiedRoom("");
    }
  }, [frontOfficeFloorOptions, selectedOccupiedFloor]);

  useEffect(() => {
    if (
      selectedCheckoutFloor &&
      !checkoutFloorOptions.some((floor) => floor.value === selectedCheckoutFloor)
    ) {
      setSelectedCheckoutFloor("");
      setSelectedCheckoutRoom("");
    }
  }, [checkoutFloorOptions, selectedCheckoutFloor]);

  useEffect(() => {
    if (
      selectedMoveFromFloor &&
      !checkoutFloorOptions.some((floor) => floor.value === selectedMoveFromFloor)
    ) {
      setSelectedMoveFromFloor("");
      setSelectedMoveFromRoom("");
    }
  }, [checkoutFloorOptions, selectedMoveFromFloor]);

  useEffect(() => {
    if (
      selectedMoveToFloor &&
      !frontOfficeFloorOptions.some((floor) => floor.value === selectedMoveToFloor)
    ) {
      setSelectedMoveToFloor("");
      setSelectedMoveToRoom("");
    }
  }, [frontOfficeFloorOptions, selectedMoveToFloor]);

  useEffect(() => {
    if (
      selectedCleanedFloor &&
      !housekeepingFloorOptions.some((floor) => floor.value === selectedCleanedFloor)
    ) {
      setSelectedCleanedFloor("");
      setSelectedCleanedRoom("");
    }
  }, [housekeepingFloorOptions, selectedCleanedFloor]);

  useEffect(() => {
    if (
      selectedOccupiedRoom &&
      !availableFrontOfficeRooms.some((room) => room.value === selectedOccupiedRoom)
    ) {
      setSelectedOccupiedRoom("");
    }
  }, [availableFrontOfficeRooms, selectedOccupiedRoom]);

  useEffect(() => {
    if (
      selectedCheckoutRoom &&
      !availableCheckoutRooms.some((room) => room.value === selectedCheckoutRoom)
    ) {
      setSelectedCheckoutRoom("");
    }
  }, [availableCheckoutRooms, selectedCheckoutRoom]);

  useEffect(() => {
    if (
      selectedMoveFromRoom &&
      !availableMoveFromRooms.some((room) => room.value === selectedMoveFromRoom)
    ) {
      setSelectedMoveFromRoom("");
    }
  }, [availableMoveFromRooms, selectedMoveFromRoom]);

  useEffect(() => {
    if (
      selectedMoveToRoom &&
      !availableMoveToRooms.some((room) => room.value === selectedMoveToRoom)
    ) {
      setSelectedMoveToRoom("");
    }
  }, [availableMoveToRooms, selectedMoveToRoom]);

  useEffect(() => {
    if (
      selectedCleanedRoom &&
      !availableCleanRooms.some((room) => room.value === selectedCleanedRoom)
    ) {
      setSelectedCleanedRoom("");
    }
  }, [availableCleanRooms, selectedCleanedRoom]);

  useEffect(() => {
    if (!reportStartDate) {
      setReportStartDate(operationalDateKey);
    }

    if (!reportEndDate) {
      setReportEndDate(operationalDateKey);
    }
  }, [operationalDateKey, reportEndDate, reportStartDate]);

  if (!access.canViewPanel) {
    return null;
  }

  async function saveFrontOffice(payload, message) {
    setFrontOfficeSaving(true);
    setFeedback((current) => ({
      ...current,
      frontOffice: { type: "", message: "" },
    }));

    try {
      await onSaveFrontOffice(payload);
      setSelectedOccupiedRoom("");
      setSelectedCheckoutRoom("");
      setSelectedMoveFromRoom("");
      setSelectedMoveToRoom("");
      setBreakfastIncluded(false);
      setBreakfastCount("1");
      setStayDuration("1");
      setGuestType("walk_in");
      setCheckoutType("normal_check_out");
      setMoveDestinationCondition("clean");
      setFeedback((current) => ({
        ...current,
        frontOffice: { type: "success", message },
      }));
      setSelectedMoveFromFloor("");
      setSelectedMoveToFloor("");
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        frontOffice: { type: "error", message: error.message },
      }));
    } finally {
      setFrontOfficeSaving(false);
    }
  }

  async function saveHousekeeping(payload, message) {
    setHousekeepingSaving(true);
    setFeedback((current) => ({
      ...current,
      housekeeping: { type: "", message: "" },
    }));

    try {
      await onSaveHousekeeping(payload);
      setSelectedCleanedRoom("");
      setFeedback((current) => ({
        ...current,
        housekeeping: { type: "success", message },
      }));
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        housekeeping: { type: "error", message: error.message },
      }));
    } finally {
      setHousekeepingSaving(false);
    }
  }

  async function handleAssignRoom(event) {
    event.preventDefault();

    if (!selectedOccupiedFloor || !selectedOccupiedRoom) {
      return;
    }

    const nextBreakfastCount = breakfastIncluded
      ? Math.max(Number(breakfastCount) || 0, 1)
      : 0;
    const nextStayDuration = Math.max(Number(stayDuration) || 1, 1);
    const hotelHour = getHotelHour(new Date());
    const checkInCategory = hotelHour >= 5 && hotelHour < 9
      ? "early_check_in"
      : "normal_check_in";
    const activityCreatedAt = new Date().toISOString();

    const nextOccupiedRooms = [
      ...occupiedRooms.filter((room) => room.roomNumber !== selectedOccupiedRoom),
      {
        roomNumber: selectedOccupiedRoom,
        breakfastIncluded,
        breakfastCount: nextBreakfastCount,
        bookedDays: nextStayDuration,
        bookedOnDateKey: operations?.operationalDateKey ?? getOperationalDateKey(),
        guestType,
        checkInCategory,
      },
    ];

    await saveFrontOffice(
      {
        occupiedRooms: nextOccupiedRooms,
        cleanedRoomNumbers: cleanedRoomNumbers.filter(
          (roomNumber) => roomNumber !== selectedOccupiedRoom,
        ),
        activityEntries: [
          {
            id: `activity-${Date.now()}`,
            actionType: "check_in",
            operationalDateKey,
            createdAt: activityCreatedAt,
            roomNumber: selectedOccupiedRoom,
            breakfastCount: nextBreakfastCount,
            bookedDays: nextStayDuration,
            guestType,
            checkInCategory,
            actorName: profile?.fullName ?? "",
            actorDepartment: profile?.departmentName ?? "",
          },
          ...(operations?.activityEntries ?? []),
        ],
        activityEntry: {
          area: "front_office",
          actionType: "check_in",
          message: `${selectedOccupiedRoom} checked in as ${guestType === "corporate" ? "Corporate" : "Walk in"}${checkInCategory === "early_check_in" ? " (early check in)" : ""}.`,
          targetRoomNumber: selectedOccupiedRoom,
          metadata: {
            breakfastCount: nextBreakfastCount,
            bookedDays: nextStayDuration,
            guestType,
            checkInCategory,
          },
        },
        notificationEntry: {
          audienceTag: "operations",
          title: "Front Office update",
          message: `${selectedOccupiedRoom} was checked in${checkInCategory === "early_check_in" ? " as an early check in" : ""}.`,
          relatedRoomNumber: selectedOccupiedRoom,
        },
      },
      `${selectedOccupiedRoom} checked in.`,
    );
  }

  async function handleCheckoutRoom(event) {
    event.preventDefault();

    if (!selectedCheckoutFloor || !selectedCheckoutRoom) {
      return;
    }

    const activityCreatedAt = new Date().toISOString();

    await saveFrontOffice(
      {
        occupiedRooms: occupiedRooms.filter((room) => room.roomNumber !== selectedCheckoutRoom),
        activityEntries: [
          {
            id: `activity-${Date.now()}`,
            actionType: "check_out",
            operationalDateKey,
            createdAt: activityCreatedAt,
            roomNumber: selectedCheckoutRoom,
            checkoutCategory: checkoutType,
            actorName: profile?.fullName ?? "",
            actorDepartment: profile?.departmentName ?? "",
          },
          ...(operations?.activityEntries ?? []),
        ],
        activityEntry: {
          area: "front_office",
          actionType: "check_out",
          message: `${selectedCheckoutRoom} checked out${checkoutType === "late_check_out" ? " (late check out)" : ""}.`,
          targetRoomNumber: selectedCheckoutRoom,
          metadata: {
            checkoutType,
          },
        },
        notificationEntry: {
          audienceTag: "operations",
          title: "Front Office update",
          message: `${selectedCheckoutRoom} was checked out${checkoutType === "late_check_out" ? " as a late check out" : ""}.`,
          relatedRoomNumber: selectedCheckoutRoom,
        },
      },
      `${selectedCheckoutRoom} checked out.`,
    );
  }

  async function handleMoveRoom(event) {
    event.preventDefault();

    if (
      !selectedMoveFromFloor ||
      !selectedMoveFromRoom ||
      !selectedMoveToFloor ||
      !selectedMoveToRoom ||
      selectedMoveFromRoom === selectedMoveToRoom
    ) {
      return;
    }

    const sourceRoom = occupiedRooms.find(
      (room) => room.roomNumber === selectedMoveFromRoom,
    );

    if (!sourceRoom) {
      return;
    }

    const movedAt = new Date().toISOString();
    const nextRoomMoves = [
      {
        id: `move-${Date.now()}`,
        operationalDateKey,
        fromRoomNumber: selectedMoveFromRoom,
        toRoomNumber: selectedMoveToRoom,
        movedAt,
        createdAt: movedAt,
        movedByName: profile?.fullName ?? "",
        movedByDepartment: profile?.departmentName ?? "",
        destinationCondition: moveDestinationCondition,
      },
      ...(operations?.roomMoves ?? []),
    ];

    const nextOccupiedRooms = [
      ...occupiedRooms.filter((room) => room.roomNumber !== selectedMoveFromRoom),
      {
        roomNumber: selectedMoveToRoom,
        breakfastIncluded: sourceRoom.breakfastIncluded,
        breakfastCount: sourceRoom.breakfastCount ?? 0,
        bookedDays: sourceRoom.bookedDays ?? sourceRoom.remainingDays ?? 1,
        bookedOnDateKey: sourceRoom.bookedOnDateKey ?? operationalDateKey,
        guestType: sourceRoom.guestType ?? "walk_in",
        checkInCategory: sourceRoom.checkInCategory ?? "normal_check_in",
      },
    ];

    await saveFrontOffice(
      {
        occupiedRooms: nextOccupiedRooms,
        cleanedRoomNumbers: cleanedRoomNumbers.filter(
          (roomNumber) => roomNumber !== selectedMoveToRoom,
        ),
        roomMoves: nextRoomMoves,
        activityEntries: [
          {
            id: `activity-${Date.now()}`,
            actionType: "room_move",
            operationalDateKey,
            createdAt: movedAt,
            fromRoomNumber: selectedMoveFromRoom,
            toRoomNumber: selectedMoveToRoom,
            destinationCondition: moveDestinationCondition,
            actorName: profile?.fullName ?? "",
            actorDepartment: profile?.departmentName ?? "",
          },
          ...(operations?.activityEntries ?? []),
        ],
        activityEntry: {
          area: "front_office",
          actionType: "room_move",
          message: `${selectedMoveFromRoom} moved to ${selectedMoveToRoom} (${moveDestinationCondition}).`,
          targetRoomNumber: selectedMoveToRoom,
          metadata: {
            fromRoomNumber: selectedMoveFromRoom,
            toRoomNumber: selectedMoveToRoom,
            destinationCondition: moveDestinationCondition,
          },
        },
        notificationEntry: {
          audienceTag: "operations",
          title: "Room move",
          message: `${selectedMoveFromRoom} was moved to ${selectedMoveToRoom} (${moveDestinationCondition}).`,
          relatedRoomNumber: selectedMoveToRoom,
        },
      },
      `${selectedMoveFromRoom} moved to ${selectedMoveToRoom}.`,
    );
  }

  async function handleMarkCleaned(event) {
    event.preventDefault();

    if (!selectedCleanedFloor || !selectedCleanedRoom) {
      return;
    }

    await saveHousekeeping(
      {
        cleanedRoomNumbers: [...cleanedRoomNumbers, selectedCleanedRoom],
        activityEntry: {
          area: "housekeeping",
          actionType: "cleaned_room_publish",
          message: `${selectedCleanedRoom} was published as freshly cleaned.`,
          targetRoomNumber: selectedCleanedRoom,
        },
        notificationEntry: {
          audienceTag: "operations",
          title: "Freshly cleaned room",
          message: `${selectedCleanedRoom} was published as freshly cleaned.`,
          relatedRoomNumber: selectedCleanedRoom,
        },
      },
      `${selectedCleanedRoom} marked as cleaned.`,
    );
  }

  async function handleRemoveCleaned(roomNumber) {
    await saveHousekeeping(
      {
        cleanedRoomNumbers: cleanedRoomNumbers.filter((item) => item !== roomNumber),
        activityEntry: {
          area: "housekeeping",
          actionType: "cleaned_room_clear",
          message: `${roomNumber} was removed from freshly cleaned rooms.`,
          targetRoomNumber: roomNumber,
        },
      },
      `${roomNumber} removed from cleaned rooms.`,
    );
  }

  return (
    <section className="panel p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="section-title">Rooms</h2>
          <p className="mt-2 text-sm text-slate-500">
            Live room check-in, check-out, cleaning, and handover reports.
          </p>
        </div>
      </div>

      {unlistedRoomCount > 0 ? (
        <div className="mt-4 rounded-2xl border border-[#d7e4ef] bg-[#eef6fb] px-4 py-3 text-sm text-slate-700">
          {configuredHotelRoomCount} of {statedHotelRoomCount} rooms configured.{" "}
          {unlistedRoomCount} still missing.
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {access.visibleMetrics.map((metricKey) => (
          <MetricTile key={metricKey} metricKey={metricKey} operations={operations} />
        ))}
      </div>

      {access.canPrint ? (
        <div className="mt-6 grid gap-4 xl:grid-cols-2 2xl:grid-cols-4">
          <ReportActionGroup
            title="In House Report"
            actions={[
              {
                label: "Print in-house report",
                onClick: () => printTextReport("Sunshine Hotel In House Report", inHouseReportLines),
              },
              {
                label: "Download PDF",
                onClick: () =>
                  downloadPdf(
                    "sunshine-in-house-report.pdf",
                    "Sunshine Hotel In House Report",
                    inHouseReportLines,
                  ),
              },
            ]}
          />

          {canViewCleanedRooms ? (
            <ReportActionGroup
              title="HouseKeeping Cleaned Rooms Report"
              actions={[
                {
                  label: "Print cleaned rooms",
                  onClick: () =>
                    printTextReport("Sunshine Hotel Cleaned Rooms Report", cleanedReportLines),
                },
                {
                  label: "Download PDF",
                  onClick: () =>
                    downloadPdf(
                      "sunshine-cleaned-rooms-report.pdf",
                      "Sunshine Hotel Cleaned Rooms Report",
                      cleanedReportLines,
                    ),
                },
              ]}
            />
          ) : null}

          {canViewBreakfastBoard ? (
            <ReportActionGroup
              title="F&B Breakfast Summary"
              actions={[
                {
                  label: "Print breakfast summary",
                  onClick: () =>
                    printTextReport(
                      "Sunshine Hotel F&B Breakfast Summary",
                      breakfastSummaryLines,
                    ),
                },
                {
                  label: "Download PDF",
                  onClick: () =>
                    downloadPdf(
                      "sunshine-f-and-b-breakfast-summary.pdf",
                      "Sunshine Hotel F&B Breakfast Summary",
                      breakfastSummaryLines,
                    ),
                },
              ]}
            />
          ) : null}

          {access.canEditFrontOffice ? (
            <>
              <ReportActionGroup
                title="Daily Report"
                actions={[
                  {
                    label: "Print daily report",
                    onClick: () =>
                      printTextReport(
                        "Sunshine Hotel Daily Operations Report",
                        dailyReportLines,
                      ),
                  },
                  {
                    label: "Download PDF",
                    onClick: () =>
                      downloadPdf(
                        "sunshine-daily-operations-report.pdf",
                        "Sunshine Hotel Daily Operations Report",
                        dailyReportLines,
                      ),
                  },
                ]}
              />

              <ReportRangeActionGroup
                title="Date Range Report"
                startDate={reportStartDate}
                endDate={reportEndDate}
                onStartDateChange={(event) => setReportStartDate(event.target.value)}
                onEndDateChange={(event) => setReportEndDate(event.target.value)}
                actions={[
                  {
                    label: "Print range report",
                    onClick: () => printTextReport(rangeReportTitle, rangeReportLines),
                  },
                  {
                    label: "Download PDF",
                    onClick: () =>
                      downloadPdf(
                        "sunshine-daily-operations-range-report.pdf",
                        rangeReportTitle,
                        rangeReportLines,
                      ),
                  },
                ]}
              />
            </>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 space-y-4">
        <OccupiedRoomsOverview sections={occupiedSections} />
        {canViewBreakfastBoard ? (
          <BreakfastSummaryBoard
            sections={occupiedSections}
            breakfastTotal={operations?.breakfastEntitled ?? 0}
            inHouse={operations?.inHouse ?? 0}
          />
        ) : null}
        {canViewCleanedRooms ? (
          <CleanedRoomsOverview
            sections={cleanedSections}
            canRemove={access.canEditHousekeeping}
            onRemove={handleRemoveCleaned}
          />
        ) : null}
      </div>

      {(access.canEditFrontOffice || access.canEditHousekeeping) ? (
        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          {access.canEditFrontOffice ? (
            <div className="space-y-4">
              <form onSubmit={handleAssignRoom} className="subpanel no-print">
                <p className="metric-label">Check in guest</p>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <FloorSelect
                    label="Floor"
                    value={selectedOccupiedFloor}
                    onChange={(event) => {
                      setSelectedOccupiedFloor(event.target.value);
                      setSelectedOccupiedRoom("");
                    }}
                    floors={frontOfficeFloorOptions}
                    disabled={frontOfficeSaving}
                  />
                  <RoomSelect
                    label="Room"
                    value={selectedOccupiedRoom}
                    onChange={(event) => setSelectedOccupiedRoom(event.target.value)}
                    rooms={availableFrontOfficeRooms}
                    disabled={frontOfficeSaving || !selectedOccupiedFloor}
                  />
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <label className="field">
                    <span>Booked for</span>
                    <select
                      value={stayDuration}
                      onChange={(event) => setStayDuration(event.target.value)}
                      disabled={frontOfficeSaving}
                    >
                      {Array.from({ length: 30 }, (_, index) => index + 1).map((dayCount) => (
                        <option key={dayCount} value={String(dayCount)}>
                          {dayCount} day{dayCount === 1 ? "" : "s"}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Guest type</span>
                    <select
                      value={guestType}
                      onChange={(event) => setGuestType(event.target.value)}
                      disabled={frontOfficeSaving}
                    >
                      <option value="walk_in">Walk in</option>
                      <option value="corporate">Corporate</option>
                    </select>
                  </label>

                  <label className="field">
                    <span>Breakfast</span>
                    <select
                      value={breakfastIncluded ? "yes" : "no"}
                      onChange={(event) => {
                        const enabled = event.target.value === "yes";
                        setBreakfastIncluded(enabled);
                        if (!enabled) {
                          setBreakfastCount("0");
                        } else if (!breakfastCount || breakfastCount === "0") {
                          setBreakfastCount("1");
                        }
                      }}
                    >
                      <option value="no">No</option>
                      <option value="yes">Yes</option>
                    </select>
                  </label>

                  <label className="field">
                    <span>Breakfast count</span>
                    <input
                      type="number"
                      min={breakfastIncluded ? "1" : "0"}
                      value={breakfastIncluded ? breakfastCount : "0"}
                      onChange={(event) => setBreakfastCount(event.target.value)}
                      disabled={!breakfastIncluded}
                    />
                  </label>
                </div>

                {feedback.frontOffice.message ? (
                  <div
                    className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
                      feedback.frontOffice.type === "success"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-rose-50 text-rose-700"
                    }`}
                  >
                    {feedback.frontOffice.message}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={frontOfficeSaving || !selectedOccupiedFloor || !selectedOccupiedRoom}
                  className="button-primary mt-5 w-full"
                >
                  {frontOfficeSaving ? "Publishing..." : "Check in room"}
                </button>
              </form>

              <form onSubmit={handleCheckoutRoom} className="subpanel no-print">
                <p className="metric-label">Check out room</p>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <FloorSelect
                    label="Floor"
                    value={selectedCheckoutFloor}
                    onChange={(event) => {
                      setSelectedCheckoutFloor(event.target.value);
                      setSelectedCheckoutRoom("");
                    }}
                    floors={checkoutFloorOptions}
                    disabled={frontOfficeSaving}
                  />
                  <RoomSelect
                    label="Occupied room"
                    value={selectedCheckoutRoom}
                    onChange={(event) => setSelectedCheckoutRoom(event.target.value)}
                    rooms={availableCheckoutRooms}
                    disabled={frontOfficeSaving || !selectedCheckoutFloor}
                  />
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="field">
                    <span>Checkout type</span>
                    <select
                      value={checkoutType}
                      onChange={(event) => setCheckoutType(event.target.value)}
                      disabled={frontOfficeSaving}
                    >
                      <option value="normal_check_out">Normal check out</option>
                      <option value="late_check_out">Late check out</option>
                    </select>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={frontOfficeSaving || !selectedCheckoutFloor || !selectedCheckoutRoom}
                  className="button-primary mt-5 w-full"
                >
                  {frontOfficeSaving ? "Publishing..." : "Mark checked out"}
                </button>
              </form>

              <form onSubmit={handleMoveRoom} className="subpanel no-print">
                <p className="metric-label">Room move</p>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <FloorSelect
                    label="Current floor"
                    value={selectedMoveFromFloor}
                    onChange={(event) => {
                      setSelectedMoveFromFloor(event.target.value);
                      setSelectedMoveFromRoom("");
                    }}
                    floors={checkoutFloorOptions}
                    disabled={frontOfficeSaving}
                  />
                  <RoomSelect
                    label="Occupied room"
                    value={selectedMoveFromRoom}
                    onChange={(event) => setSelectedMoveFromRoom(event.target.value)}
                    rooms={availableMoveFromRooms}
                    disabled={frontOfficeSaving || !selectedMoveFromFloor}
                  />
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <FloorSelect
                    label="New floor"
                    value={selectedMoveToFloor}
                    onChange={(event) => {
                      setSelectedMoveToFloor(event.target.value);
                      setSelectedMoveToRoom("");
                    }}
                    floors={frontOfficeFloorOptions}
                    disabled={frontOfficeSaving}
                  />
                  <RoomSelect
                    label="Unoccupied room"
                    value={selectedMoveToRoom}
                    onChange={(event) => setSelectedMoveToRoom(event.target.value)}
                    rooms={availableMoveToRooms}
                    disabled={frontOfficeSaving || !selectedMoveToFloor}
                  />
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="field">
                    <span>Destination condition</span>
                    <select
                      value={moveDestinationCondition}
                      onChange={(event) => setMoveDestinationCondition(event.target.value)}
                      disabled={frontOfficeSaving}
                    >
                      <option value="clean">Clean</option>
                      <option value="dirty">Dirty</option>
                    </select>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={
                    frontOfficeSaving ||
                    !selectedMoveFromFloor ||
                    !selectedMoveFromRoom ||
                    !selectedMoveToFloor ||
                    !selectedMoveToRoom ||
                    selectedMoveFromRoom === selectedMoveToRoom
                  }
                  className="button-primary mt-5 w-full"
                >
                  {frontOfficeSaving ? "Publishing..." : "Move guest"}
                </button>
              </form>
            </div>
          ) : null}

          {access.canEditHousekeeping ? (
            <form onSubmit={handleMarkCleaned} className="subpanel no-print">
              <p className="metric-label">Mark cleaned room</p>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <FloorSelect
                  label="Floor"
                  value={selectedCleanedFloor}
                  onChange={(event) => {
                    setSelectedCleanedFloor(event.target.value);
                    setSelectedCleanedRoom("");
                  }}
                  floors={housekeepingFloorOptions}
                  disabled={housekeepingSaving}
                />
                <RoomSelect
                  label="Room"
                  value={selectedCleanedRoom}
                  onChange={(event) => setSelectedCleanedRoom(event.target.value)}
                  rooms={availableCleanRooms}
                  disabled={housekeepingSaving || !selectedCleanedFloor}
                />
              </div>

              {feedback.housekeeping.message ? (
                <div
                  className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
                    feedback.housekeeping.type === "success"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-rose-50 text-rose-700"
                  }`}
                >
                  {feedback.housekeeping.message}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={housekeepingSaving || !selectedCleanedFloor || !selectedCleanedRoom}
                className="button-primary mt-5 w-full"
              >
                {housekeepingSaving ? "Publishing..." : "Publish cleaned room"}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
