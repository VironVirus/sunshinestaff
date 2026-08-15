import {
  guestRoomCount,
  guestRoomGroups,
  normalizeRoomNumbers,
  normalizeOccupiedRooms,
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
  const normalizedOutOfOrderRooms = normalizeRoomNumbers(outOfOrderRoomNumbers);
  const outOfOrderRoomSet = new Set(normalizedOutOfOrderRooms);
  const normalizedRooms = normalizeOccupiedRooms(occupiedRooms, dateKey)
    .filter((room) => !outOfOrderRoomSet.has(room.roomNumber));
  const occupiedRoomNumbers = normalizedRooms.map((room) => room.roomNumber);
  const occupiedRoomSet = new Set(occupiedRoomNumbers);

  return {
    operationalDateKey: dateKey,
    occupiedRooms: normalizedRooms,
    occupiedRoomNumbers,
    occupancyByFloor: guestRoomGroups.map((group) => {
      const floorRoomSet = new Set(group.rooms);
      const floorEntries = normalizedRooms.filter((room) =>
        floorRoomSet.has(room.roomNumber),
      );

      return {
        floorKey: group.key,
        floorLabel: group.label,
        occupiedRooms: group.rooms.filter((roomNumber) => occupiedRoomSet.has(roomNumber)).length,
        walkInGuests: floorEntries.filter((room) => room.guestType === "walk_in").length,
        corporateGuests: floorEntries.filter((room) => room.guestType === "corporate").length,
      };
    }),
    inHouse: normalizedRooms.length,
    outOfOrderRoomNumbers: normalizedOutOfOrderRooms,
    availableRooms: Math.max(guestRoomCount - normalizedOutOfOrderRooms.length, 0),
    breakfastEntitled: normalizedRooms.reduce(
      (total, room) => total + (room.breakfastIncluded ? room.breakfastCount : 0),
      0,
    ),
  };
}

export function normalizeStoredInHouseReport(payload = {}, fallbackDateKey) {
  const rawOccupiedRooms = Array.isArray(payload.occupiedRooms)
    ? payload.occupiedRooms
    : [];
  const storedOccupiedRoomNumbers = Array.isArray(payload.occupiedRoomNumbers)
    ? payload.occupiedRoomNumbers
    : [];
  const hasRoomNumberSnapshot = rawOccupiedRooms.length > 0 || storedOccupiedRoomNumbers.length > 0;
  const expectedRoomCount = Number.isFinite(Number(payload.inHouse))
    ? Number(payload.inHouse)
    : Array.isArray(payload.occupiedRoomNumbers)
      ? storedOccupiedRoomNumbers.length
      : rawOccupiedRooms.length;
  const hasCompleteRoomDetails = rawOccupiedRooms.length === expectedRoomCount &&
    rawOccupiedRooms.every((room) =>
      room?.roomNumber && ["walk_in", "corporate"].includes(room?.guestType),
    );
  const normalized = buildInHouseReport(
    hasCompleteRoomDetails
      ? rawOccupiedRooms
      : payload.occupiedRoomNumbers ?? [],
    normalizeDateKey(payload.operationalDateKey, fallbackDateKey),
    payload.outOfOrderRoomNumbers ?? [],
  );
  const storedFloorMap = new Map(
    (Array.isArray(payload.occupancyByFloor) ? payload.occupancyByFloor : [])
      .map((floor) => [floor?.floorKey, floor]),
  );
  const occupancyByFloor = normalized.occupancyByFloor.map((floor) => {
    const storedFloor = storedFloorMap.get(floor.floorKey);
    const hasStoredGuestSource =
      Object.prototype.hasOwnProperty.call(storedFloor ?? {}, "walkInGuests") &&
      Object.prototype.hasOwnProperty.call(storedFloor ?? {}, "corporateGuests");

    return {
      floorKey: floor.floorKey,
      floorLabel: floor.floorLabel,
      occupiedRooms: Math.min(
        Math.max(Number(
          hasRoomNumberSnapshot ? floor.occupiedRooms : storedFloor?.occupiedRooms ?? floor.occupiedRooms,
        ) || 0, 0),
        guestRoomGroups.find((group) => group.key === floor.floorKey)?.rooms.length ?? guestRoomCount,
      ),
      ...(hasCompleteRoomDetails
        ? {
            walkInGuests: floor.walkInGuests,
            corporateGuests: floor.corporateGuests,
          }
        : hasStoredGuestSource
        ? {
            walkInGuests: Math.max(Number(storedFloor.walkInGuests) || 0, 0),
            corporateGuests: Math.max(Number(storedFloor.corporateGuests) || 0, 0),
          }
        : {}),
    };
  });

  return {
    ...normalized,
    occupiedRooms: hasCompleteRoomDetails ? normalized.occupiedRooms : [],
    occupancyByFloor,
    inHouse: hasRoomNumberSnapshot
      ? normalized.inHouse
      : Math.min(Math.max(expectedRoomCount || 0, 0), guestRoomCount),
    breakfastEntitled: Math.min(
      Math.max(Number(payload.breakfastEntitled ?? normalized.breakfastEntitled) || 0, 0),
      1880,
    ),
    availableRooms: Array.isArray(payload.outOfOrderRoomNumbers)
      ? normalized.availableRooms
      : Math.min(Math.max(Number(payload.availableRooms) || 0, 0), guestRoomCount),
    updatedAt: payload.updatedAt ?? null,
    updatedAtIso: typeof payload.updatedAtIso === "string" ? payload.updatedAtIso : "",
    updatedByUid: typeof payload.updatedByUid === "string" ? payload.updatedByUid : "",
    updatedByName: typeof payload.updatedByName === "string" ? payload.updatedByName : "",
    updatedByDepartment: typeof payload.updatedByDepartment === "string"
      ? payload.updatedByDepartment
      : "",
  };
}
