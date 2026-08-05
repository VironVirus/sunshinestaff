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
  "AC",
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

export const roomPropertyStatusEventSpaceRoom = "105";

export const eventSpacePropertyStatusItems = [
  "Chairs",
  "Chair Type",
  "Chair Covers",
  "A/C",
  "TV",
  "Table",
  "Painting",
  "Artworks",
  "Door Keys",
  "Curtain",
  "Lounge Area",
  "Lights",
].map((name, index) => ({
  id: `event-item-${index + 1}`,
  number: index + 1,
  name,
}));

export function isRoomPropertyStatusEventSpace(roomNumber = "") {
  return String(roomNumber).trim() === roomPropertyStatusEventSpaceRoom;
}

function getRoomPropertyStatusItemDefinitions(roomNumber = "") {
  return isRoomPropertyStatusEventSpace(roomNumber)
    ? eventSpacePropertyStatusItems
    : roomPropertyStatusItems;
}

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

// Starter values transcribed from the supplied ROOMS UPDATE report. These are
// kept locally so every room can open with an editable report without creating
// 88 Firestore documents. A saved room report always replaces these values.
const defaultRoomPropertyStatusValues = {
  "Duvet Covers": { quantity: "1", status: "average", remark: "Worn out" },
  "Flat Sheets": { quantity: "1", status: "average", remark: "Worn out" },
  "Pillow Cases": { quantity: "1", status: "average", remark: "Worn out" },
  "Bath Towel": { quantity: "1", status: "average", remark: "Worn out" },
  "Floor Towel": { quantity: "1", status: "average", remark: "Worn out" },
  "Face Towel": { quantity: "nil" },
  "Hand Towel": { quantity: "nil" },
  "Tea Cup": { quantity: "2" },
  "Tea Tray": { quantity: "2" },
  Saucer: { quantity: "1", status: "good" },
  "Tea Spoons": { quantity: "2", status: "good" },
  "Electric Jug": { quantity: "1", status: "good" },
  "Whisky Glass Cups": { quantity: "1", status: "good" },
  "Bathroom Amenities Tray": {
    remark: "Dental kit, shower cap and shaving stick",
  },
  "Toilet Brush": { quantity: "1", status: "average" },
  "Waste Bin": { quantity: "2", status: "average" },
  "Mini Fridge": { quantity: "1", status: "good" },
  Scales: { quantity: "nil" },
  "Linen Throw Bag": { quantity: "nil" },
  "TV Remote": { quantity: "1", status: "good" },
  "A/C Remote": { quantity: "1", status: "good" },
  Bathrobe: { quantity: "1", status: "average" },
  Mattress: { quantity: "1", status: "good" },
  "Bedside Lamp": { quantity: "2", status: "average" },
  "Bed Frame / Bed Head": { quantity: "1/1", status: "average" },
  Doors: { remark: "No door issue" },
  "Shower Mixer": { quantity: "1", status: "good" },
  WC: { quantity: "1", status: "good" },
  "Wash Hand Basin / Tap": { quantity: "1/1", status: "good" },
  "Shower Area Tiles": { remark: "Requires deep cleaning" },
  Cubicle: { quantity: "1", status: "good" },
  "Towel Hanger": { quantity: "1", status: "good" },
  Switches: { quantity: "3", status: "average" },
  Socket: { quantity: "4", status: "average" },
  "A/C": { quantity: "1", status: "average" },
  Wall: { remark: "No significant wall issues" },
  Painting: { remark: "Needs retouching or repainting" },
  Mould: { quantity: "nil" },
  Curtain: { quantity: "2", status: "average" },
  Sofa: {
    quantity: "2",
    status: "average",
    remark: "One double and one single; both look worn",
  },
  "Tables / Drawers": { status: "average" },
  Artwork: { quantity: "1" },
  Mirror: { quantity: "1", status: "good" },
  "Toilet Ceiling / POP": { status: "average" },
  "Room Ceiling / POP": { status: "average" },
  "Toilet Glass": { quantity: "1", remark: "The glass is stuck" },
  "Tissue Holder": { remark: "No tissue holder" },
};

function normalizeQuantity(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.min(Math.max(Math.trunc(value), 0), 999));
  }

  const quantity = String(value).trim().toLowerCase();

  if (quantity === "nil") {
    return "nil";
  }

  if (!/^\d{1,3}(?:\s*\/\s*\d{1,3})?$/.test(quantity)) {
    return null;
  }

  return quantity.replace(/\s+/g, "");
}

export function buildRoomPropertyStatusItems(savedItems = [], roomNumber = "") {
  const hasSavedItems = Array.isArray(savedItems) && savedItems.length > 0;
  const savedItemMap = new Map(
    (Array.isArray(savedItems) ? savedItems : []).map((item) => [item?.id, item]),
  );
  const itemDefinitions = getRoomPropertyStatusItemDefinitions(roomNumber);

  return itemDefinitions.map((definition) => {
    const savedItem = hasSavedItems
      ? savedItemMap.get(definition.id) ?? {}
      : isRoomPropertyStatusEventSpace(roomNumber)
        ? {}
        : defaultRoomPropertyStatusValues[definition.name] ?? {};
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
  const roomNumber = room.label ?? record.roomNumber ?? "";
  const isLegacyEventSpaceReport = isRoomPropertyStatusEventSpace(roomNumber) &&
    Array.isArray(record.items) &&
    record.items.length > 0 &&
    !record.items.some((item) => String(item?.id ?? "").startsWith("event-item-"));
  const savedRecord = isLegacyEventSpaceReport ? {} : record;

  return {
    roomNumber,
    floorKey: room.groupKey ?? savedRecord.floorKey ?? "",
    floorLabel: room.groupLabel ?? savedRecord.floorLabel ?? "",
    inspectionDate: typeof savedRecord.inspectionDate === "string" && savedRecord.inspectionDate
      ? savedRecord.inspectionDate.slice(0, 10)
      : getOperationalDateKey(),
    sellabilityStatus: allowedSellabilityStatusValues.has(savedRecord.sellabilityStatus)
      ? savedRecord.sellabilityStatus
      : "",
    items: buildRoomPropertyStatusItems(savedRecord.items, roomNumber),
    otherDamages: typeof savedRecord.otherDamages === "string"
      ? savedRecord.otherDamages.trim().slice(0, 2000)
      : "",
    updatedAtIso: typeof savedRecord.updatedAtIso === "string" ? savedRecord.updatedAtIso : "",
    updatedByName: typeof savedRecord.updatedByName === "string" ? savedRecord.updatedByName : "",
    updatedByDepartment: typeof savedRecord.updatedByDepartment === "string"
      ? savedRecord.updatedByDepartment
      : "",
    signedByName: typeof savedRecord.signedByName === "string"
      ? savedRecord.signedByName
      : (typeof savedRecord.updatedByName === "string" ? savedRecord.updatedByName : ""),
    signedByTitle: typeof savedRecord.signedByTitle === "string"
      ? savedRecord.signedByTitle
      : "",
    signedAtIso: typeof savedRecord.signedAtIso === "string"
      ? savedRecord.signedAtIso
      : (typeof savedRecord.updatedAtIso === "string" ? savedRecord.updatedAtIso : ""),
  };
}

export function getRoomPropertyStatusDocumentId(roomNumber = "") {
  return encodeURIComponent(String(roomNumber).trim());
}
