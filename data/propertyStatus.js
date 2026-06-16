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
  { value: "ac_issue", label: "Air Conditioner Issue" },
  { value: "tv_issue", label: "TV Issue" },
  { value: "internet_issue", label: "Internet Issue" },
  { value: "plumbing_issue", label: "Plumbing Issue" },
  { value: "power_issue", label: "Power Issue" },
  { value: "bathroom_issue", label: "Bathroom Issue" },
  { value: "door_lock_issue", label: "Door Lock Issue" },
  { value: "housekeeping_request", label: "HouseKeeping Request" },
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
  return roomIssues
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
        issueNote: roomIssue?.issueNote?.trim() ?? "",
        updatedByName: roomIssue?.updatedByName ?? "",
        updatedByDepartment: roomIssue?.updatedByDepartment ?? "",
        sortOrder: roomRecord.sortOrder,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map(({ sortOrder, ...roomIssue }) => roomIssue);
}

export function normalizeRoomComplaints(roomComplaints = []) {
  return roomComplaints
    .map((complaintEntry) => {
      const roomNumber = complaintEntry?.roomNumber ?? complaintEntry?.label ?? "";
      const roomRecord = getRoomRecord(roomNumber);

      if (!roomRecord || !complaintEntry?.complaintType) {
        return null;
      }

      return {
        id: complaintEntry?.id ?? `${roomRecord.label}-${complaintEntry.complaintType}`,
        roomNumber: roomRecord.label,
        floorKey: roomRecord.groupKey,
        floorLabel: roomRecord.groupLabel,
        complaintType: complaintEntry.complaintType,
        complaintNote: complaintEntry?.complaintNote?.trim() ?? "",
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
    .filter(
      (complaintEntry, index, current) =>
        current.findIndex((candidate) => candidate.id === complaintEntry.id) === index,
    );
}

export function mergePropertyStatus(payload = {}) {
  return {
    ...defaultPropertyStatus,
    ...payload,
    roomIssues: normalizeRoomIssues(payload.roomIssues ?? []),
    roomComplaints: normalizeRoomComplaints(payload.roomComplaints ?? []),
    utilities: {
      ...defaultUtilities,
      ...(payload.utilities ?? {}),
    },
  };
}
