import { getOperationalDateKey } from "@/lib/hotelTime";

const mainFloorRoomPattern = [
  "01",
  "02",
  "03",
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

export const statedHotelRoomCount = 94;
export const eventSpaceRoomNumbers = ["105"];
export const linkedRoomPairs = Array.from({ length: 6 }, (_, index) => {
  const floorNumber = index + 1;
  return {
    combinedLabel: `${floorNumber}01/${floorNumber}03`,
    roomNumbers: [`${floorNumber}01`, `${floorNumber}03`],
  };
});

const linkedRoomPairMap = new Map(
  linkedRoomPairs.map((pair) => [pair.combinedLabel, pair.roomNumbers]),
);

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

const eventSpaceRoomSet = new Set(eventSpaceRoomNumbers);

export const guestRoomGroups = roomGroups.map((group) => ({
  ...group,
  rooms: group.rooms.filter((roomLabel) => !eventSpaceRoomSet.has(roomLabel)),
}));

export const guestRooms = hotelRooms.filter(
  (room) => !eventSpaceRoomSet.has(room.label),
);
export const guestRoomCount = guestRooms.length;

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

linkedRoomPairs.forEach((pair) => {
  const firstRoom = roomMap.get(pair.roomNumbers[0]);
  if (firstRoom) {
    roomMap.set(pair.combinedLabel, {
      ...firstRoom,
      id: pair.combinedLabel,
      label: pair.combinedLabel,
      linkedRoomNumbers: pair.roomNumbers,
      legacyCombinedRoom: true,
    });
  }
});

export function expandLinkedRoomNumbers(roomLabel) {
  if (typeof roomLabel !== "string") return [];
  return linkedRoomPairMap.get(roomLabel) ?? [roomLabel];
}

export function normalizeRoomNumbers(roomNumbers = []) {
  return [...new Set(
    (Array.isArray(roomNumbers) ? roomNumbers : [])
      .filter(Boolean)
      .flatMap(expandLinkedRoomNumbers),
  )]
    .filter((roomLabel) => roomOrderMap.has(roomLabel) && !eventSpaceRoomSet.has(roomLabel))
    .sort((left, right) => roomOrderMap.get(left) - roomOrderMap.get(right));
}

function normalizeTextEntries(entries = []) {
  return [...new Set(
    (Array.isArray(entries) ? entries : [])
      .map((entry) => (typeof entry === "string" ? entry.trim().slice(0, 120) : ""))
      .filter(Boolean),
  )].slice(0, 40);
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
  const normalizedRooms = (Array.isArray(occupiedRooms) ? occupiedRooms : [])
    .flatMap((roomEntry) => {
      const roomNumber = roomEntry?.roomNumber ?? roomEntry?.label ?? roomEntry;
      const expandedRoomNumbers = expandLinkedRoomNumbers(roomNumber);

      const bookedDays = Math.min(Math.max(
        Number(
          roomEntry?.bookedDays ??
            roomEntry?.stayDays ??
            roomEntry?.remainingDays ??
            1,
        ) || 1,
        1,
      ), 365);
      const bookedOnDateKey =
        roomEntry?.bookedOnDateKey ??
        roomEntry?.bookingDateKey ??
        operationalDateKey;

      return expandedRoomNumbers.map((expandedRoomNumber) => {
        const roomRecord = getRoomRecord(expandedRoomNumber);

        if (!roomRecord || eventSpaceRoomSet.has(roomRecord.label)) {
          return null;
        }

        return {
          roomNumber: roomRecord.label,
          floorKey: roomRecord.groupKey,
          floorLabel: roomRecord.groupLabel,
          breakfastIncluded: Boolean(roomEntry?.breakfastIncluded),
          breakfastCount: Boolean(roomEntry?.breakfastIncluded)
            ? Math.min(Math.max(Number(roomEntry?.breakfastCount) || 0, 0), 20)
            : 0,
          bookedDays,
          bookedOnDateKey,
          remainingDays: bookedDays,
          guestType: ["walk_in", "corporate"].includes(roomEntry?.guestType)
            ? roomEntry.guestType
            : "walk_in",
          checkInCategory: typeof roomEntry?.checkInCategory === "string"
            ? roomEntry.checkInCategory.slice(0, 40)
            : "normal_check_in",
          lastCheckoutCategory: typeof roomEntry?.lastCheckoutCategory === "string"
            ? roomEntry.lastCheckoutCategory.slice(0, 40)
            : "",
        };
      });
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        roomOrderMap.get(left.roomNumber) - roomOrderMap.get(right.roomNumber),
    );

  return normalizedRooms.filter(
    (roomEntry, index, current) =>
      current.findIndex((candidate) => candidate.roomNumber === roomEntry.roomNumber) === index,
  ).slice(0, guestRoomCount);
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
  const otherCleanedAreas = Array.isArray(rawOperations.otherCleanedAreas)
    ? cleanedRoomDayKey === operationalDateKey
      ? normalizeTextEntries(rawOperations.otherCleanedAreas)
      : []
    : [];

  const inHouse = occupiedRooms.length;
  const availableRooms = guestRoomCount;
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
    otherCleanedAreas,
    inHouse,
    availableRooms,
    breakfastEntitled,
    cleanedRooms,
  };
}
