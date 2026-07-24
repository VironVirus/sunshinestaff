import { getOperationalDateKey } from "@/lib/hotelTime";

export const roomPropertyStatusItems = [
  "Duvet Covers",
  "Flat Sheets",
  "Pillow Cases",
  "Bath Towel",
  "Floor Towel",
  "Face Towel",
  "Hand Towel",
  "Tea Cup",
  "Tea Tray",
  "Tea Box",
  "Saucer",
  "Tea Spoons",
  "Electric Jug",
  "Whisky Glass Cups",
  "Bathroom Amenities Tray",
  "Toilet Brush",
  "Waste Bin",
  "Mini Fridge",
  "Scales",
  "Big Fridge",
  "Linen Throw Bag",
  "TV Remote",
  "A/C Remote",
  "Bathrobe",
  "Mattress",
  "Luggage Rack",
  "Bedside Lamp",
  "Bed Frame / Bed Head",
  "Doors",
  "Shower Mixer",
  "WC",
  "Wash Hand Basin / Tap",
  "Shower Area Tiles",
  "Cubicle",
  "Towel Hanger",
  "Switches",
  "Socket",
  "Bulb / LED",
  "A/C",
  "Wall",
  "Painting",
  "Mould",
  "Curtain",
  "Sofa",
  "Tables / Drawers",
  "Arm Chairs",
  "Artwork",
  "Mirror",
  "Toilet Ceiling / POP",
  "Room Ceiling / POP",
  "Toilet Glass",
  "Tissue Holder",
  "TV",
].map((name, index) => ({
  id: `item-${index + 1}`,
  number: index + 1,
  name,
}));

export const roomPropertyStatusOptions = [
  { value: "perfect", label: "Perfect" },
  { value: "good", label: "Good" },
  { value: "average", label: "Average" },
  { value: "needs_attention", label: "Needs attention" },
  { value: "damaged", label: "Damaged" },
  { value: "needs_replacement", label: "Needs replacement" },
];

export const roomSellabilityStatusOptions = [
  { value: "sellable", label: "Sellable" },
  { value: "sellable_80_percent", label: "Sellable at 80% occupancy" },
  { value: "sellable_last_resort", label: "Sellable as last resort" },
  { value: "not_sellable", label: "Not sellable" },
];

const allowedStatusValues = new Set(
  roomPropertyStatusOptions.map((option) => option.value),
);
const allowedSellabilityStatusValues = new Set(
  roomSellabilityStatusOptions.map((option) => option.value),
);

function normalizeQuantity(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  const quantity = Number(value);

  if (!Number.isFinite(quantity)) {
    return null;
  }

  return Math.min(Math.max(Math.trunc(quantity), 0), 999);
}

export function buildRoomPropertyStatusItems(savedItems = []) {
  const savedItemMap = new Map(
    (Array.isArray(savedItems) ? savedItems : []).map((item) => [item?.id, item]),
  );

  return roomPropertyStatusItems.map((definition) => {
    const savedItem = savedItemMap.get(definition.id) ?? {};
    const migratedStatus = savedItem.status === "replace" || savedItem.status === "missing"
      ? "needs_replacement"
      : savedItem.status;

    return {
      ...definition,
      quantity: normalizeQuantity(savedItem.quantity),
      status: allowedStatusValues.has(migratedStatus) ? migratedStatus : "",
      remark: typeof savedItem.remark === "string"
        ? savedItem.remark.trim().slice(0, 300)
        : "",
    };
  });
}

export function buildRoomPropertyStatusRecord(record = {}, room = {}) {
  return {
    roomNumber: room.label ?? record.roomNumber ?? "",
    floorKey: room.groupKey ?? record.floorKey ?? "",
    floorLabel: room.groupLabel ?? record.floorLabel ?? "",
    inspectionDate: typeof record.inspectionDate === "string" && record.inspectionDate
      ? record.inspectionDate.slice(0, 10)
      : getOperationalDateKey(),
    sellabilityStatus: allowedSellabilityStatusValues.has(record.sellabilityStatus)
      ? record.sellabilityStatus
      : "",
    items: buildRoomPropertyStatusItems(record.items),
    otherDamages: typeof record.otherDamages === "string"
      ? record.otherDamages.trim().slice(0, 2000)
      : "",
    updatedAtIso: typeof record.updatedAtIso === "string" ? record.updatedAtIso : "",
    updatedByName: typeof record.updatedByName === "string" ? record.updatedByName : "",
    updatedByDepartment: typeof record.updatedByDepartment === "string"
      ? record.updatedByDepartment
      : "",
    signedByName: typeof record.signedByName === "string"
      ? record.signedByName
      : (typeof record.updatedByName === "string" ? record.updatedByName : ""),
    signedByTitle: typeof record.signedByTitle === "string"
      ? record.signedByTitle
      : "",
    signedAtIso: typeof record.signedAtIso === "string"
      ? record.signedAtIso
      : (typeof record.updatedAtIso === "string" ? record.updatedAtIso : ""),
  };
}

export function getRoomPropertyStatusDocumentId(roomNumber = "") {
  return encodeURIComponent(String(roomNumber).trim());
}
