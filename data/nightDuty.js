import { departmentsByKey } from "@/data/departments";
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
      { key: "deposits", label: "Deposits" },
      { key: "inHouse", label: "In-house" },
      { key: "hallHire", label: "Hall hire" },
      { key: "swimming", label: "Swimming" },
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
];

function buildDefaultIncome() {
  return Object.fromEntries(
    nightDutyOutletConfig.map((outlet) => [
      outlet.key,
      Object.fromEntries(outlet.fields.map((field) => [field.key, 0])),
    ]),
  );
}

export function buildDefaultNightDutyData(operationalDateKey = getOperationalDateKey()) {
  return {
    operationalDateKey,
    income: buildDefaultIncome(),
    onDutyStaff: [],
    cookingGas: "",
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

function normalizeIncome(income = {}) {
  return Object.fromEntries(
    nightDutyOutletConfig.map((outlet) => [
      outlet.key,
      Object.fromEntries(
        outlet.fields.map((field) => [field.key, normalizeAmount(income?.[outlet.key]?.[field.key])]),
      ),
    ]),
  );
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
      const departmentKey = typeof entry?.departmentKey === "string"
        ? entry.departmentKey.trim().slice(0, 40)
        : "";
      const staffName = typeof entry?.staffName === "string"
        ? entry.staffName.trim().slice(0, 120)
        : "";

      if (!departmentKey || !staffName) {
        return null;
      }

      return {
        id: entry.id ?? `${departmentKey}-${staffName.toLowerCase().replace(/\s+/g, "-")}`,
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

export function getOutletTotal(income = {}, outletKey) {
  const outlet = nightDutyOutletConfig.find((item) => item.key === outletKey);

  if (!outlet) {
    return 0;
  }

  return outlet.fields.reduce(
    (total, field) => total + normalizeAmount(income?.[outlet.key]?.[field.key]),
    0,
  );
}

export function getGrandIncomeTotal(income = {}) {
  return nightDutyOutletConfig.reduce(
    (total, outlet) => total + getOutletTotal(income, outlet.key),
    0,
  );
}

export function getCookingGasLabel(value) {
  return cookingGasOptions.find((option) => option.value === value)?.label ?? (value || "Not set");
}

export function groupOnDutyStaff(entries = []) {
  return nightDutyDepartmentOptions
    .map((department) => ({
      ...department,
      staff: entries.filter((entry) => entry.departmentKey === department.value),
    }))
    .filter((department) => department.staff.length > 0);
}

export function mergeNightDutyData(payload = {}) {
  const operationalDateKey = getOperationalDateKey();
  const source = payload.operationalDateKey === operationalDateKey ? payload : {};
  const base = buildDefaultNightDutyData(operationalDateKey);

  return {
    ...base,
    ...source,
    operationalDateKey,
    income: normalizeIncome(source.income),
    onDutyStaff: normalizeOnDutyStaff(source.onDutyStaff ?? []),
    cookingGas: source.cookingGas ?? "",
  };
}
