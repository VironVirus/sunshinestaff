import { getRoomRecord } from "@/data/hotelRooms";

const tankLevelOptions = [
  { value: "empty", label: "Empty" },
  { value: "low", label: "Low" },
  { value: "half", label: "Half" },
  { value: "three_quarter", label: "Three Quarter" },
  { value: "full", label: "Full" },
];

export const propertyUtilityFields = [
  {
    key: "dieselLevel",
    label: "Diesel level",
    options: tankLevelOptions,
  },
  {
    key: "undergroundTankLevel",
    label: "Underground tank level",
    options: tankLevelOptions,
  },
  {
    key: "surfaceTankLevel",
    label: "Surface tank level",
    options: tankLevelOptions,
  },
  {
    key: "overheadTankLevel",
    label: "Overhead tank level",
    options: tankLevelOptions,
  },
  {
    key: "eedcLevel",
    label: "EEDC units",
    inputType: "number",
  },
];

export const roomComplaintOptions = [
  { value: "out_of_order", label: "Out of Order" },
  { value: "ac_issue", label: "Air Conditioner Issue" },
  { value: "tv_issue", label: "TV Issue" },
  { value: "internet_issue", label: "Internet Issue" },
  { value: "plumbing_issue", label: "Plumbing Issue" },
  { value: "power_issue", label: "Power Issue" },
  { value: "bathroom_issue", label: "Bathroom Issue" },
  { value: "door_lock_issue", label: "Door Lock Issue" },
  { value: "housekeeping_request", label: "Housekeeping Request" },
  { value: "noise_complaint", label: "Noise Complaint" },
  { value: "other", label: "Other" },
];

export const defaultUtilities = Object.fromEntries(
  propertyUtilityFields.map((field) => [field.key, ""]),
);

export const defaultPropertyStatus = {
  roomIssues: [],
  roomComplaints: [],
  utilities: defaultUtilities,
  roomIssuesUpdatedAt: null,
  roomIssuesUpdatedByName: "",
  roomIssuesUpdatedByDepartment: "",
  roomComplaintsUpdatedAt: null,
  roomComplaintsUpdatedByName: "",
  roomComplaintsUpdatedByDepartment: "",
  utilitiesUpdatedAt: null,
  utilitiesUpdatedByName: "",
  utilitiesUpdatedByDepartment: "",
};

export function getUtilityField(fieldKey) {
  return propertyUtilityFields.find((field) => field.key === fieldKey) ?? null;
}

export function getUtilityLabel(fieldKey, value) {
  if (!value) {
    return "Not set";
  }

  const field = getUtilityField(fieldKey);

  if (field?.inputType === "number") {
    return `${value} units`;
  }

  return field?.options.find((option) => option.value === value)?.label ?? value;
}

export function getRoomComplaintLabel(value) {
  return roomComplaintOptions.find((option) => option.value === value)?.label ?? value;
}

export function normalizeRoomIssues(roomIssues = []) {
  return (Array.isArray(roomIssues) ? roomIssues : [])
    .map((roomIssue) => {
      const roomNumber = roomIssue?.roomNumber ?? roomIssue?.label ?? "";
      const roomRecord = getRoomRecord(roomNumber);

      if (!roomRecord || roomIssue?.outOfOrder !== true) {
        return null;
      }

      return {
        roomNumber: roomRecord.label,
        floorKey: roomRecord.groupKey,
        floorLabel: roomRecord.groupLabel,
        outOfOrder: true,
        issueNote: typeof roomIssue?.issueNote === "string" ? roomIssue.issueNote.trim().slice(0, 500) : "",
        updatedByName: roomIssue?.updatedByName ?? "",
        updatedByDepartment: roomIssue?.updatedByDepartment ?? "",
        sortOrder: roomRecord.sortOrder,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map(({ sortOrder, ...roomIssue }) => roomIssue)
    .slice(0, 88);
}

function deriveRoomIssuesFromComplaints(roomComplaints = []) {
  const outOfOrderMap = new Map();

  roomComplaints.forEach((complaintEntry) => {
    if (
      complaintEntry.complaintType !== "out_of_order" ||
      complaintEntry.resolvedAt
    ) {
      return;
    }

    outOfOrderMap.set(complaintEntry.roomNumber, {
      roomNumber: complaintEntry.roomNumber,
      floorKey: complaintEntry.floorKey,
      floorLabel: complaintEntry.floorLabel,
      outOfOrder: true,
      issueNote: complaintEntry.complaintNote,
      updatedByName: complaintEntry.updatedByName,
      updatedByDepartment: complaintEntry.updatedByDepartment,
    });
  });

  return [...outOfOrderMap.values()].sort((left, right) => {
    const leftOrder = getRoomRecord(left.roomNumber)?.sortOrder ?? 0;
    const rightOrder = getRoomRecord(right.roomNumber)?.sortOrder ?? 0;

    return leftOrder - rightOrder;
  });
}

export function normalizeRoomComplaints(roomComplaints = []) {
  const seenIds = new Set();

  return (Array.isArray(roomComplaints) ? roomComplaints : [])
    .map((complaintEntry) => {
      const roomNumber = complaintEntry?.roomNumber ?? complaintEntry?.label ?? "";
      const roomRecord = getRoomRecord(roomNumber);

      if (!roomRecord || !roomComplaintOptions.some((option) => option.value === complaintEntry?.complaintType)) {
        return null;
      }

      return {
        id: complaintEntry?.id ?? `${roomRecord.label}-${complaintEntry.complaintType}`,
        roomNumber: roomRecord.label,
        floorKey: roomRecord.groupKey,
        floorLabel: roomRecord.groupLabel,
        complaintType: complaintEntry.complaintType,
        complaintNote: typeof complaintEntry?.complaintNote === "string"
          ? complaintEntry.complaintNote.trim().slice(0, 500)
          : "",
        reportedAt: complaintEntry?.reportedAt ?? "",
        resolvedAt: complaintEntry?.resolvedAt ?? "",
        updatedByName: complaintEntry?.updatedByName ?? "",
        updatedByDepartment: complaintEntry?.updatedByDepartment ?? "",
        sortOrder: roomRecord.sortOrder,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map(({ sortOrder, ...complaintEntry }) => complaintEntry)
    .filter((complaintEntry) => {
      if (seenIds.has(complaintEntry.id)) return false;
      seenIds.add(complaintEntry.id);
      return true;
    })
    .slice(0, 300);
}

export function mergePropertyStatus(payload = {}) {
  const normalizedComplaints = normalizeRoomComplaints(payload.roomComplaints ?? []);
  const legacyRoomIssues = normalizeRoomIssues(payload.roomIssues ?? []);
  const complaintDerivedRoomIssues = deriveRoomIssuesFromComplaints(normalizedComplaints);
  const mergedRoomIssueMap = new Map(
    legacyRoomIssues.map((roomIssue) => [roomIssue.roomNumber, roomIssue]),
  );

  complaintDerivedRoomIssues.forEach((roomIssue) => {
    mergedRoomIssueMap.set(roomIssue.roomNumber, roomIssue);
  });

  return {
    ...defaultPropertyStatus,
    ...payload,
    roomIssues: [...mergedRoomIssueMap.values()].sort((left, right) => {
      const leftOrder = getRoomRecord(left.roomNumber)?.sortOrder ?? 0;
      const rightOrder = getRoomRecord(right.roomNumber)?.sortOrder ?? 0;

      return leftOrder - rightOrder;
    }),
    roomComplaints: normalizedComplaints,
    utilities: Object.fromEntries(propertyUtilityFields.map((field) => {
      const value = payload?.utilities?.[field.key];
      if (field.inputType === "number") {
        const amount = Number(value);
        return [field.key, Number.isFinite(amount) ? Math.min(Math.max(amount, 0), 1000000) : ""];
      }
      return [field.key, field.options.some((option) => option.value === value) ? value : ""];
    })),
  };
}
