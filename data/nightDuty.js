import { departmentsByKey } from "@/data/departments";
import { roomGroups } from "@/data/hotelRooms";
import { getOperationalDateKey } from "@/lib/hotelTime";

export const nightDutyOutletConfig = [
  {
    key: "kennysBar",
    label: "Kenny's Bar",
    fields: [
      { key: "food", label: "Food" },
      { key: "beverage", label: "Beverage" },
    ],
  },
  {
    key: "tropicsBar",
    label: "Tropics Bar",
    fields: [
      { key: "food", label: "Food" },
      { key: "beverage", label: "Beverage" },
    ],
  },
  {
    key: "restaurant",
    label: "Restaurant",
    fields: [
      { key: "food", label: "Food" },
      { key: "beverage", label: "Beverage" },
      { key: "trayCharge", label: "Tray charge" },
    ],
  },
  {
    key: "frontOffice",
    label: "Front Office",
    fields: [
      { key: "roomRevenue", label: "Room revenue", monthlyRoomRevenue: true },
      { key: "advancePayment", label: "Advance payment", excludeFromRevenue: true },
      { key: "deposits", label: "Other deposits", excludeFromRevenue: true },
      { key: "hallHire", label: "Hall hire" },
      { key: "swimming", label: "Swimming" },
      { key: "photoshoot", label: "Photoshoot" },
      { key: "sundry", label: "Sundry" },
      { key: "laundry", label: "Laundry" },
    ],
  },
];

export const nightDutyDepartmentOptions = [
  { value: "front_office", label: "Front Office" },
  { value: "food_beverages", label: "Food and Beverages" },
  { value: "housekeeping", label: "Housekeeping" },
  { value: "kitchen", label: "Kitchen" },
  { value: "maintainance", label: "Maintenance" },
  { value: "it", label: "IT" },
  { value: "security", label: "Security" },
  { value: "police", label: "Police" },
];

export const cookingGasOptions = [
  { value: "gas_a", label: "Gas A" },
  { value: "gas_b", label: "Gas B" },
  { value: "gas_c", label: "Gas C" },
  { value: "gas_d", label: "Gas D" },
];

export const gasLevelOptions = [
  { value: "empty", label: "Empty" },
  { value: "low", label: "Low" },
  { value: "half", label: "Half" },
  { value: "three_quarter", label: "Three quarter" },
  { value: "full", label: "Full" },
];

function buildDefaultIncome() {
  return Object.fromEntries(
    nightDutyOutletConfig.map((outlet) => [
      outlet.key,
      Object.fromEntries(outlet.fields.map((field) => [field.key, 0])),
    ]),
  );
}

function buildDefaultOccupancyByFloor() {
  return roomGroups.map((group) => ({
    floorKey: group.key,
    floorLabel: group.label,
    occupiedRooms: 0,
  }));
}

function buildDefaultDepartmentNotes() {
  return Object.fromEntries(
    nightDutyDepartmentOptions.map((department) => [department.value, ""]),
  );
}

function buildDefaultGasLevels() {
  return Object.fromEntries(cookingGasOptions.map((gas) => [gas.value, ""]));
}

function buildDefaultIncident() {
  return {
    hasIncident: false,
    who: "",
    how: "",
    when: "",
    description: "",
  };
}

export function buildDefaultNightDutyData(operationalDateKey = getOperationalDateKey()) {
  return {
    operationalDateKey,
    occupancyByFloor: buildDefaultOccupancyByFloor(),
    frontOfficeOccupancyByFloor: buildDefaultOccupancyByFloor(),
    occupancyQuery: { hasDiscrepancy: false, note: "" },
    income: buildDefaultIncome(),
    onDutyStaff: [],
    departmentNotes: buildDefaultDepartmentNotes(),
    gasLevels: buildDefaultGasLevels(),
    hotWaterTemperature: null,
    powerSupplies: [],
    waterSupplyCount: 0,
    guestIncident: buildDefaultIncident(),
    employeeIncident: buildDefaultIncident(),
    housekeepingSupervisorSignature: "",
    utilitiesSnapshot: {},
    eventsSnapshot: [],
    complaintsSnapshot: [],
    updatedAt: null,
    updatedByName: "",
    updatedByDepartment: "",
  };
}

export const defaultNightDutyData = buildDefaultNightDutyData();

function normalizeAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.min(Math.max(amount, 0), 1000000000) : 0;
}

function normalizeCount(value, maximum = 1000000) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.min(Math.max(Math.trunc(count), 0), maximum) : 0;
}

function normalizeShortText(value, maximum = 300) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function normalizeIncome(income = {}) {
  return Object.fromEntries(
    nightDutyOutletConfig.map((outlet) => [
      outlet.key,
      Object.fromEntries(
        outlet.fields.map((field) => {
          const legacyValue = outlet.key === "frontOffice" && field.key === "roomRevenue"
            ? income?.frontOffice?.inHouse
            : undefined;

          return [field.key, normalizeAmount(income?.[outlet.key]?.[field.key] ?? legacyValue)];
        }),
      ),
    ]),
  );
}

function normalizeOccupancyByFloor(entries = []) {
  const entryMap = new Map(
    (Array.isArray(entries) ? entries : []).map((entry) => [entry?.floorKey, entry]),
  );

  return roomGroups.map((group) => ({
    floorKey: group.key,
    floorLabel: group.label,
    occupiedRooms: Math.min(
      normalizeCount(entryMap.get(group.key)?.occupiedRooms, group.rooms.length),
      group.rooms.length,
    ),
  }));
}

function getDepartmentLabel(departmentKey) {
  return (
    nightDutyDepartmentOptions.find((department) => department.value === departmentKey)?.label ??
    departmentsByKey[departmentKey]?.name ??
    departmentKey
  );
}

function normalizeOnDutyStaff(onDutyStaff = []) {
  return (Array.isArray(onDutyStaff) ? onDutyStaff : []).slice(0, 200)
    .map((entry) => {
      const departmentKey = normalizeShortText(entry?.departmentKey, 40);
      const staffName = normalizeShortText(entry?.staffName, 120);

      if (!departmentKey || !staffName) {
        return null;
      }

      return {
        id: normalizeShortText(entry?.id, 100) ||
          `${departmentKey}-${staffName.toLowerCase().replace(/\s+/g, "-")}`,
        departmentKey,
        departmentName: getDepartmentLabel(departmentKey),
        staffName,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const departmentIndexLeft = nightDutyDepartmentOptions.findIndex(
        (department) => department.value === left.departmentKey,
      );
      const departmentIndexRight = nightDutyDepartmentOptions.findIndex(
        (department) => department.value === right.departmentKey,
      );

      if (departmentIndexLeft !== departmentIndexRight) {
        return departmentIndexLeft - departmentIndexRight;
      }

      return left.staffName.localeCompare(right.staffName);
    });
}

function normalizeDepartmentNotes(notes = {}) {
  return Object.fromEntries(
    nightDutyDepartmentOptions.map((department) => [
      department.value,
      normalizeShortText(notes?.[department.value], 1000),
    ]),
  );
}

function normalizeGasLevels(levels = {}) {
  return Object.fromEntries(
    cookingGasOptions.map((gas) => {
      const value = levels?.[gas.value];
      return [
        gas.value,
        gasLevelOptions.some((option) => option.value === value) ? value : "",
      ];
    }),
  );
}

function normalizePowerSupplies(entries = []) {
  return (Array.isArray(entries) ? entries : []).slice(0, 20)
    .map((entry, index) => {
      const name = normalizeShortText(entry?.name, 100);

      if (!name) return null;

      return {
        id: normalizeShortText(entry?.id, 100) || `power-${index + 1}`,
        name,
        durationHours: Math.min(normalizeAmount(entry?.durationHours), 72),
      };
    })
    .filter(Boolean);
}

function normalizeIncident(incident = {}) {
  const hasIncident = incident?.hasIncident === true || incident?.hasIncident === "yes";

  return {
    hasIncident,
    who: hasIncident ? normalizeShortText(incident?.who, 200) : "",
    how: hasIncident ? normalizeShortText(incident?.how, 500) : "",
    when: hasIncident ? normalizeShortText(incident?.when, 40) : "",
    description: hasIncident ? normalizeShortText(incident?.description, 1500) : "",
  };
}

function normalizeSnapshotEntries(entries = [], maximum = 100) {
  return (Array.isArray(entries) ? entries : []).slice(0, maximum).map((entry) => ({
    ...entry,
    id: normalizeShortText(entry?.id, 100),
  }));
}

export function getOutletTotal(income = {}, outletKey, { includeNonRevenue = false } = {}) {
  const outlet = nightDutyOutletConfig.find((item) => item.key === outletKey);

  if (!outlet) return 0;

  return outlet.fields.reduce(
    (total, field) => includeNonRevenue || !field.excludeFromRevenue
      ? total + normalizeAmount(income?.[outlet.key]?.[field.key])
      : total,
    0,
  );
}

export function getGrandIncomeTotal(income = {}) {
  return nightDutyOutletConfig.reduce(
    (total, outlet) => total + getOutletTotal(income, outlet.key),
    0,
  );
}

export function getFrontOfficeRoomRevenue(income = {}) {
  return normalizeAmount(income?.frontOffice?.roomRevenue);
}

export function getGasLevelLabel(value) {
  return gasLevelOptions.find((option) => option.value === value)?.label ?? "Not set";
}

export function getCookingGasLabel(value) {
  return cookingGasOptions.find((option) => option.value === value)?.label ?? (value || "Not set");
}

export function groupOnDutyStaff(entries = [], departmentNotes = {}) {
  return nightDutyDepartmentOptions
    .map((department) => ({
      ...department,
      staff: entries.filter((entry) => entry.departmentKey === department.value),
      note: normalizeShortText(departmentNotes?.[department.value], 1000),
    }))
    .filter((department) => department.staff.length > 0 || department.note);
}

export function normalizeStoredNightDutyReport(payload = {}) {
  const operationalDateKey = normalizeShortText(payload.operationalDateKey, 10) ||
    getOperationalDateKey();
  const base = buildDefaultNightDutyData(operationalDateKey);

  return {
    ...base,
    ...payload,
    operationalDateKey,
    occupancyByFloor: normalizeOccupancyByFloor(payload.occupancyByFloor),
    frontOfficeOccupancyByFloor: normalizeOccupancyByFloor(
      payload.frontOfficeOccupancyByFloor,
    ),
    occupancyQuery: {
      hasDiscrepancy: payload?.occupancyQuery?.hasDiscrepancy === true,
      note: normalizeShortText(payload?.occupancyQuery?.note, 1500),
    },
    income: normalizeIncome(payload.income),
    onDutyStaff: normalizeOnDutyStaff(payload.onDutyStaff),
    departmentNotes: normalizeDepartmentNotes(payload.departmentNotes),
    gasLevels: normalizeGasLevels(payload.gasLevels),
    hotWaterTemperature: payload.hotWaterTemperature === "" ||
      payload.hotWaterTemperature === null ||
      payload.hotWaterTemperature === undefined
      ? null
      : Math.min(Math.max(Number(payload.hotWaterTemperature) || 0, 0), 120),
    powerSupplies: normalizePowerSupplies(payload.powerSupplies),
    waterSupplyCount: normalizeCount(payload.waterSupplyCount, 1000),
    guestIncident: normalizeIncident(payload.guestIncident),
    employeeIncident: normalizeIncident(payload.employeeIncident),
    housekeepingSupervisorSignature: normalizeShortText(
      payload.housekeepingSupervisorSignature,
      120,
    ),
    utilitiesSnapshot: payload.utilitiesSnapshot && typeof payload.utilitiesSnapshot === "object"
      ? payload.utilitiesSnapshot
      : {},
    eventsSnapshot: normalizeSnapshotEntries(payload.eventsSnapshot, 100),
    complaintsSnapshot: normalizeSnapshotEntries(payload.complaintsSnapshot, 100),
  };
}

export function mergeNightDutyData(payload = {}) {
  const operationalDateKey = normalizeShortText(payload.operationalDateKey, 10) ||
    getOperationalDateKey();

  return normalizeStoredNightDutyReport({
    ...payload,
    operationalDateKey,
  });
}
