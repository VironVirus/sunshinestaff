import { getRoomRecord, roomGroups } from "@/data/hotelRooms";
import { getOperationalDateKey } from "@/lib/hotelTime";

export const housekeepingStatusOptions = [
  { value: "occupied", label: "Occupied" },
  { value: "vacant_cleaned", label: "Vacant and Cleaned" },
  { value: "out_of_order", label: "Out of order" },
  { value: "vacant_uncleaned", label: "Vacant and uncleaned" },
];

export const housekeepingReportPeriods = [
  { value: "morning", label: "Morning report" },
  { value: "afternoon", label: "Afternoon report" },
];

const statusValues = new Set(housekeepingStatusOptions.map((option) => option.value));

export function getHousekeepingStatusLabel(value) {
  return housekeepingStatusOptions.find((option) => option.value === value)?.label ?? value;
}

export function buildDefaultHousekeepingReports(operationalDateKey = getOperationalDateKey()) {
  return {
    operationalDateKey,
    morningRooms: [],
    afternoonRooms: [],
    morningUpdatedByName: "",
    morningUpdatedByDepartment: "",
    afternoonUpdatedByName: "",
    afternoonUpdatedByDepartment: "",
  };
}

function normalizeReportEntries(entries = []) {
  const entryMap = new Map();

  (Array.isArray(entries) ? entries : []).slice(0, 176).forEach((entry) => {
    const roomNumber = entry?.roomNumber ?? entry?.label ?? "";
    const roomRecord = getRoomRecord(roomNumber);
    const status = entry?.status ?? "";

    if (!roomRecord || !statusValues.has(status)) {
      return;
    }

    entryMap.set(roomRecord.label, {
      roomNumber: roomRecord.label,
      floorKey: roomRecord.groupKey,
      floorLabel: roomRecord.groupLabel,
      status,
      statusLabel: getHousekeepingStatusLabel(status),
      updatedAt: entry?.updatedAt ?? "",
      updatedByName: entry?.updatedByName ?? "",
      updatedByDepartment: entry?.updatedByDepartment ?? "",
      sortOrder: roomRecord.sortOrder,
    });
  });

  return [...entryMap.values()]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map(({ sortOrder, ...entry }) => entry);
}

export function mergeHousekeepingReports(payload = {}) {
  const operationalDateKey = getOperationalDateKey();
  const storedOperationalDateKey = payload.operationalDateKey ?? operationalDateKey;
  const isCurrentOperationalDay = storedOperationalDateKey === operationalDateKey;

  return {
    ...buildDefaultHousekeepingReports(operationalDateKey),
    ...payload,
    operationalDateKey,
    morningRooms: isCurrentOperationalDay
      ? normalizeReportEntries(payload.morningRooms ?? [])
      : [],
    afternoonRooms: isCurrentOperationalDay
      ? normalizeReportEntries(payload.afternoonRooms ?? [])
      : [],
  };
}

export function getHousekeepingEntriesForPeriod(
  housekeepingReports = buildDefaultHousekeepingReports(),
  period = "morning",
) {
  return period === "afternoon"
    ? housekeepingReports.afternoonRooms ?? []
    : housekeepingReports.morningRooms ?? [];
}

export function buildHousekeepingStatusSummary(entries = []) {
  return entries.reduce(
    (summary, entry) => ({
      totalReported: summary.totalReported + 1,
      occupied: summary.occupied + (entry.status === "occupied" ? 1 : 0),
      vacantCleaned: summary.vacantCleaned + (entry.status === "vacant_cleaned" ? 1 : 0),
      outOfOrder: summary.outOfOrder + (entry.status === "out_of_order" ? 1 : 0),
      vacantUncleaned:
        summary.vacantUncleaned + (entry.status === "vacant_uncleaned" ? 1 : 0),
    }),
    {
      totalReported: 0,
      occupied: 0,
      vacantCleaned: 0,
      outOfOrder: 0,
      vacantUncleaned: 0,
    },
  );
}

export function buildHousekeepingReportSections(entries = []) {
  const entryMap = new Map(entries.map((entry) => [entry.roomNumber, entry]));

  return roomGroups.map((group) => {
    const rooms = group.rooms
      .filter((roomNumber) => entryMap.has(roomNumber))
      .map((roomNumber, index) => ({
        serialNumber: index + 1,
        ...entryMap.get(roomNumber),
      }));

    return {
      key: group.key,
      label: group.label,
      rooms,
      summary: buildHousekeepingStatusSummary(rooms),
    };
  });
}
