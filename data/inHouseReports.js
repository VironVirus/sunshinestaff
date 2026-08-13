import {
  configuredHotelRoomCount,
  normalizeOccupiedRooms,
  roomGroups,
} from "@/data/hotelRooms";
import { getNightDutyReportDateKey } from "@/data/nightDuty";

function normalizeDateKey(value, fallback = getNightDutyReportDateKey()) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value : fallback;
}

export function buildInHouseReport(
  occupiedRooms = [],
  operationalDateKey,
  outOfOrderRoomNumbers = [],
) {
  const dateKey = normalizeDateKey(operationalDateKey);
  const normalizedRooms = normalizeOccupiedRooms(occupiedRooms, dateKey);
  const occupiedRoomNumbers = normalizedRooms.map((room) => room.roomNumber);
  const occupiedRoomSet = new Set(occupiedRoomNumbers);
  const normalizedOutOfOrderRooms = [...new Set(
    (Array.isArray(outOfOrderRoomNumbers) ? outOfOrderRoomNumbers : [])
      .map((roomNumber) => String(roomNumber ?? "").trim())
      .filter(Boolean),
  )].slice(0, configuredHotelRoomCount);

  return {
    operationalDateKey: dateKey,
    occupiedRooms: normalizedRooms,
    occupiedRoomNumbers,
    occupancyByFloor: roomGroups.map((group) => ({
      floorKey: group.key,
      floorLabel: group.label,
      occupiedRooms: group.rooms.filter((roomNumber) => occupiedRoomSet.has(roomNumber)).length,
    })),
    inHouse: normalizedRooms.length,
    outOfOrderRoomNumbers: normalizedOutOfOrderRooms,
    availableRooms: Math.max(configuredHotelRoomCount - normalizedOutOfOrderRooms.length, 0),
    breakfastEntitled: normalizedRooms.reduce(
      (total, room) => total + (room.breakfastIncluded ? room.breakfastCount : 0),
      0,
    ),
  };
}

export function normalizeStoredInHouseReport(payload = {}, fallbackDateKey) {
  const normalized = buildInHouseReport(
    payload.occupiedRooms ?? payload.occupiedRoomNumbers ?? [],
    normalizeDateKey(payload.operationalDateKey, fallbackDateKey),
    payload.outOfOrderRoomNumbers ?? [],
  );

  return {
    ...normalized,
    availableRooms: Array.isArray(payload.outOfOrderRoomNumbers)
      ? normalized.availableRooms
      : Math.min(Math.max(Number(payload.availableRooms) || 0, 0), configuredHotelRoomCount),
    updatedAt: payload.updatedAt ?? null,
    updatedAtIso: typeof payload.updatedAtIso === "string" ? payload.updatedAtIso : "",
    updatedByUid: typeof payload.updatedByUid === "string" ? payload.updatedByUid : "",
    updatedByName: typeof payload.updatedByName === "string" ? payload.updatedByName : "",
    updatedByDepartment: typeof payload.updatedByDepartment === "string"
      ? payload.updatedByDepartment
      : "",
  };
}
