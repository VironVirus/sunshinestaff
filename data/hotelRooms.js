import {
  getDaysBetweenDateKeys,
  getOperationalDateKey,
} from "@/lib/hotelTime";

const mainFloorRoomPattern = [
  "01/03",
  "02",
  "04",
  "05",
  "06",
  "07",
  "08",
  "09",
  "10",
  "11",
  "12",
  "13",
];

const ordinalFloorLabels = [
  "First",
  "Second",
  "Third",
  "Fourth",
  "Fifth",
  "Sixth",
];

function buildMainFloorLabel(floorNumber, suffix) {
  if (suffix === "01/03") {
    return `${floorNumber}01/${floorNumber}03`;
  }

  return `${floorNumber}${suffix}`;
}

function buildMainFloorGroup(floorNumber) {
  return {
    key: `floor-${floorNumber}`,
    label: `${ordinalFloorLabels[floorNumber - 1]} Floor`,
    rooms: mainFloorRoomPattern.map((suffix) => buildMainFloorLabel(floorNumber, suffix)),
  };
}

function buildAnnexGroup(floorNumber) {
  const prefix = `${floorNumber}0`;
  const rooms = Array.from({ length: 8 }, (_, index) => `${prefix}${index + 1}A`);

  return {
    key: `annex-${floorNumber}`,
    label: `${ordinalFloorLabels[floorNumber - 1]} Floor Annex`,
    rooms,
  };
}

export const statedHotelRoomCount = 93;

export const roomGroups = [
  ...Array.from({ length: 6 }, (_, index) => buildMainFloorGroup(index + 1)),
  buildAnnexGroup(1),
  buildAnnexGroup(2),
];

export const hotelRooms = roomGroups.flatMap((group, groupIndex) =>
  group.rooms.map((roomLabel, roomIndex) => ({
    id: roomLabel,
    label: roomLabel,
    groupKey: group.key,
    groupLabel: group.label,
    sortOrder: groupIndex * 100 + roomIndex,
  })),
);

export const configuredHotelRoomCount = hotelRooms.length;
export const unlistedRoomCount = Math.max(statedHotelRoomCount - configuredHotelRoomCount, 0);

export const roomGroupOptions = roomGroups.map((group) => ({
  value: group.key,
  label: group.label,
  options: group.rooms.map((roomLabel) => ({
    value: roomLabel,
    label: roomLabel,
  })),
}));

export const roomFloorOptions = roomGroups.map((group) => ({
  value: group.key,
  label: group.label,
}));

const roomOrderMap = new Map(
  hotelRooms.map((room) => [room.label, room.sortOrder]),
);
const roomMap = new Map(
  hotelRooms.map((room) => [room.label, room]),
);

export function normalizeRoomNumbers(roomNumbers = []) {
  return [...new Set(roomNumbers.filter(Boolean))]
    .filter((roomLabel) => roomOrderMap.has(roomLabel))
    .sort((left, right) => roomOrderMap.get(left) - roomOrderMap.get(right));
}

export function filterRoomGroupOptions(excludedRooms = []) {
  const excludedRoomSet = new Set(excludedRooms);

  return roomGroupOptions
    .map((group) => ({
      ...group,
      options: group.options.filter((option) => !excludedRoomSet.has(option.value)),
    }))
    .filter((group) => group.options.length > 0);
}

export function getRoomOptionsForFloor(groupKey, excludedRooms = []) {
  const targetGroup = roomGroupOptions.find((group) => group.value === groupKey);

  if (!targetGroup) {
    return [];
  }

  const excludedRoomSet = new Set(excludedRooms);

  return targetGroup.options.filter((option) => !excludedRoomSet.has(option.value));
}

export function getRoomRecord(roomLabel) {
  return roomMap.get(roomLabel) ?? null;
}

export function normalizeOccupiedRooms(
  occupiedRooms = [],
  operationalDateKey = getOperationalDateKey(),
) {
  const normalizedRooms = occupiedRooms
    .map((roomEntry) => {
      const roomNumber = roomEntry?.roomNumber ?? roomEntry?.label ?? roomEntry;
      const roomRecord = getRoomRecord(roomNumber);

      if (!roomRecord) {
        return null;
      }

      const bookedDays = Math.max(
        Number(
          roomEntry?.bookedDays ??
            roomEntry?.stayDays ??
            roomEntry?.remainingDays ??
            1,
        ) || 1,
        1,
      );
      const bookedOnDateKey =
        roomEntry?.bookedOnDateKey ??
        roomEntry?.bookingDateKey ??
        operationalDateKey;
      const elapsedDays = Math.max(
        getDaysBetweenDateKeys(bookedOnDateKey, operationalDateKey),
        0,
      );
      const remainingDays = bookedDays - elapsedDays;

      if (remainingDays <= 0) {
        return null;
      }

      return {
        roomNumber: roomRecord.label,
        floorKey: roomRecord.groupKey,
        floorLabel: roomRecord.groupLabel,
        breakfastIncluded: Boolean(roomEntry?.breakfastIncluded),
        breakfastCount: Boolean(roomEntry?.breakfastIncluded)
          ? Math.max(Number(roomEntry?.breakfastCount) || 0, 0)
          : 0,
        bookedDays,
        bookedOnDateKey,
        remainingDays,
      };
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        roomOrderMap.get(left.roomNumber) - roomOrderMap.get(right.roomNumber),
    );

  return normalizedRooms.filter(
    (roomEntry, index, current) =>
      current.findIndex((candidate) => candidate.roomNumber === roomEntry.roomNumber) === index,
  );
}

export function deriveOperationsSnapshot(rawOperations = {}) {
  const operationalDateKey = getOperationalDateKey();
  const occupiedRooms = Array.isArray(rawOperations.occupiedRooms)
    ? normalizeOccupiedRooms(rawOperations.occupiedRooms, operationalDateKey)
    : Array.isArray(rawOperations.occupiedRoomNumbers)
      ? normalizeOccupiedRooms(rawOperations.occupiedRoomNumbers, operationalDateKey)
      : [];
  const occupiedRoomNumbers = occupiedRooms.map((roomEntry) => roomEntry.roomNumber);
  const occupiedRoomSet = new Set(occupiedRoomNumbers);
  const cleanedRoomDayKey = rawOperations.housekeepingUpdatedAt
    ? getOperationalDateKey(rawOperations.housekeepingUpdatedAt)
    : operationalDateKey;
  const cleanedRoomNumbers = Array.isArray(rawOperations.cleanedRoomNumbers)
    ? cleanedRoomDayKey === operationalDateKey
      ? normalizeRoomNumbers(rawOperations.cleanedRoomNumbers)
        .filter((roomNumber) => !occupiedRoomSet.has(roomNumber))
      : []
    : null;

  const inHouse = occupiedRooms.length;
  const availableRooms = configuredHotelRoomCount - occupiedRooms.length;
  const cleanedRooms = cleanedRoomNumbers
    ? cleanedRoomNumbers.length
    : 0;
  const breakfastEntitled = occupiedRooms.reduce(
    (total, roomEntry) => total + (roomEntry.breakfastIncluded ? roomEntry.breakfastCount : 0),
    0,
  );

  return {
    ...rawOperations,
    operationalDateKey,
    occupiedRooms,
    occupiedRoomNumbers,
    cleanedRoomNumbers: cleanedRoomNumbers ?? [],
    inHouse,
    availableRooms,
    breakfastEntitled,
    cleanedRooms,
  };
}
