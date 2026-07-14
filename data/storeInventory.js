import { departmentsByKey } from "@/data/departments";

export const lowStockThreshold = 5;

export const defaultStoreInventory = {
  acquisitions: [],
  requisitions: [],
  returns: [],
  adjustments: [],
  updatedAt: null,
  updatedByName: "",
  updatedByDepartment: "",
};

function normalizeText(value, maximum = 120) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function normalizeAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.min(Math.max(amount, 0), 1000000000) : 0;
}

function normalizeDate(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  const date =
    typeof value?.toDate === "function"
      ? value.toDate()
      : value instanceof Date
        ? value
        : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function normalizeAcquisition(entry = {}) {
  const serialNumber = normalizeText(entry.serialNumber, 80);
  const itemName = normalizeText(entry.itemName);
  const unitPrice = normalizeAmount(entry.unitPrice);
  const quantity = normalizeAmount(entry.quantity);

  if (!serialNumber || !itemName || quantity <= 0) {
    return null;
  }

  return {
    id: entry.id ?? `acq-${Date.now()}-${serialNumber}`,
    serialNumber,
    itemName,
    unitPrice,
    quantity,
    totalPrice: unitPrice * quantity,
    purchasedBy: normalizeText(entry.purchasedBy),
    acquiredDate: normalizeDate(entry.acquiredDate ?? entry.date),
  };
}

function normalizeRequisition(entry = {}) {
  const serialNumber = normalizeText(entry.serialNumber, 80);
  const itemName = normalizeText(entry.itemName);
  const unitPrice = normalizeAmount(entry.unitPrice);
  const quantity = normalizeAmount(entry.quantity);
  const departmentKey = normalizeText(entry.departmentKey, 40);

  if (!serialNumber || !itemName || quantity <= 0 || !departmentKey) {
    return null;
  }

  return {
    id: entry.id ?? `req-${Date.now()}-${serialNumber}`,
    serialNumber,
    itemName,
    unitPrice,
    quantity,
    totalPrice: unitPrice * quantity,
    departmentKey,
    departmentName:
      normalizeText(entry.departmentName, 80) || departmentsByKey[departmentKey]?.name || departmentKey,
    requisitionDate: normalizeDate(entry.requisitionDate ?? entry.date),
  };
}

function normalizeReturn(entry = {}) {
  const serialNumber = normalizeText(entry.serialNumber, 80);
  const itemName = normalizeText(entry.itemName);
  const unitPrice = normalizeAmount(entry.unitPrice);
  const quantity = normalizeAmount(entry.quantity);
  const departmentKey = normalizeText(entry.departmentKey, 40);

  if (!serialNumber || !itemName || quantity <= 0 || !departmentKey) {
    return null;
  }

  return {
    id: entry.id ?? `return-${Date.now()}-${serialNumber}`,
    serialNumber,
    itemName,
    unitPrice,
    quantity,
    totalPrice: unitPrice * quantity,
    departmentKey,
    departmentName:
      normalizeText(entry.departmentName, 80) || departmentsByKey[departmentKey]?.name || departmentKey,
    returnedDate: normalizeDate(entry.returnedDate ?? entry.date),
  };
}

function normalizeAdjustment(entry = {}) {
  const serialNumber = normalizeText(entry.serialNumber, 80);
  const itemName = normalizeText(entry.itemName);
  const unitPrice = normalizeAmount(entry.unitPrice);
  const quantity = normalizeAmount(entry.quantity);
  const adjustmentType = normalizeText(entry.adjustmentType, 20);

  if (!serialNumber || !itemName || quantity <= 0 || !adjustmentType) {
    return null;
  }

  return {
    id: entry.id ?? `adjust-${Date.now()}-${serialNumber}`,
    serialNumber,
    itemName,
    unitPrice,
    quantity,
    totalPrice: unitPrice * quantity,
    adjustmentType,
    reason: normalizeText(entry.reason, 500),
    adjustedDate: normalizeDate(entry.adjustedDate ?? entry.date),
  };
}

export function normalizeAcquisitions(entries = []) {
  return (Array.isArray(entries) ? entries : []).slice(0, 400)
    .map((entry) => normalizeAcquisition(entry))
    .filter(Boolean)
    .sort((left, right) => {
      if (left.acquiredDate === right.acquiredDate) {
        return left.serialNumber.localeCompare(right.serialNumber);
      }

      return right.acquiredDate.localeCompare(left.acquiredDate);
    });
}

export function normalizeRequisitions(entries = []) {
  return (Array.isArray(entries) ? entries : []).slice(0, 400)
    .map((entry) => normalizeRequisition(entry))
    .filter(Boolean)
    .sort((left, right) => {
      if (left.requisitionDate === right.requisitionDate) {
        return left.serialNumber.localeCompare(right.serialNumber);
      }

      return right.requisitionDate.localeCompare(left.requisitionDate);
    });
}

export function normalizeReturns(entries = []) {
  return (Array.isArray(entries) ? entries : []).slice(0, 400)
    .map((entry) => normalizeReturn(entry))
    .filter(Boolean)
    .sort((left, right) => {
      if (left.returnedDate === right.returnedDate) {
        return left.serialNumber.localeCompare(right.serialNumber);
      }

      return right.returnedDate.localeCompare(left.returnedDate);
    });
}

export function normalizeAdjustments(entries = []) {
  return (Array.isArray(entries) ? entries : []).slice(0, 400)
    .map((entry) => normalizeAdjustment(entry))
    .filter(Boolean)
    .sort((left, right) => {
      if (left.adjustedDate === right.adjustedDate) {
        return left.serialNumber.localeCompare(right.serialNumber);
      }

      return right.adjustedDate.localeCompare(left.adjustedDate);
    });
}

function deriveInventoryItems(acquisitions, requisitions, returns, adjustments) {
  const inventoryMap = new Map();

  acquisitions.forEach((entry) => {
    const current = inventoryMap.get(entry.serialNumber) ?? {
      serialNumber: entry.serialNumber,
      itemName: entry.itemName,
      unitPrice: entry.unitPrice,
      acquiredQuantity: 0,
      issuedQuantity: 0,
    };

    current.itemName = entry.itemName;
    current.unitPrice = entry.unitPrice;
    current.acquiredQuantity += entry.quantity;
    inventoryMap.set(entry.serialNumber, current);
  });

  requisitions.forEach((entry) => {
    const current = inventoryMap.get(entry.serialNumber) ?? {
      serialNumber: entry.serialNumber,
      itemName: entry.itemName,
      unitPrice: entry.unitPrice,
      acquiredQuantity: 0,
      issuedQuantity: 0,
    };

    current.itemName = current.itemName || entry.itemName;
    current.unitPrice = current.unitPrice || entry.unitPrice;
    current.issuedQuantity += entry.quantity;
    inventoryMap.set(entry.serialNumber, current);
  });

  returns.forEach((entry) => {
    const current = inventoryMap.get(entry.serialNumber) ?? {
      serialNumber: entry.serialNumber,
      itemName: entry.itemName,
      unitPrice: entry.unitPrice,
      acquiredQuantity: 0,
      issuedQuantity: 0,
      returnedQuantity: 0,
      adjustedOutQuantity: 0,
    };

    current.itemName = current.itemName || entry.itemName;
    current.unitPrice = current.unitPrice || entry.unitPrice;
    current.returnedQuantity = (current.returnedQuantity ?? 0) + entry.quantity;
    inventoryMap.set(entry.serialNumber, current);
  });

  adjustments.forEach((entry) => {
    const current = inventoryMap.get(entry.serialNumber) ?? {
      serialNumber: entry.serialNumber,
      itemName: entry.itemName,
      unitPrice: entry.unitPrice,
      acquiredQuantity: 0,
      issuedQuantity: 0,
      returnedQuantity: 0,
      adjustedOutQuantity: 0,
    };

    current.itemName = current.itemName || entry.itemName;
    current.unitPrice = current.unitPrice || entry.unitPrice;

    if (entry.adjustmentType === "add") {
      current.acquiredQuantity += entry.quantity;
    } else {
      current.adjustedOutQuantity = (current.adjustedOutQuantity ?? 0) + entry.quantity;
    }

    inventoryMap.set(entry.serialNumber, current);
  });

  return [...inventoryMap.values()]
    .map((entry) => {
      const availableQuantity = Math.max(
        entry.acquiredQuantity -
          entry.issuedQuantity +
          (entry.returnedQuantity ?? 0) -
          (entry.adjustedOutQuantity ?? 0),
        0,
      );

      return {
        ...entry,
        availableQuantity,
        stockValue: availableQuantity * entry.unitPrice,
      };
    })
    .sort((left, right) => left.itemName.localeCompare(right.itemName));
}

export function mergeStoreInventory(payload = {}) {
  const acquisitions = normalizeAcquisitions(payload.acquisitions ?? []);
  const requisitions = normalizeRequisitions(payload.requisitions ?? []);
  const returns = normalizeReturns(payload.returns ?? []);
  const adjustments = normalizeAdjustments(payload.adjustments ?? []);
  const inventoryItems = deriveInventoryItems(
    acquisitions,
    requisitions,
    returns,
    adjustments,
  );
  const lowStockItems = inventoryItems.filter(
    (item) => item.availableQuantity > 0 && item.availableQuantity <= lowStockThreshold,
  );

  return {
    ...defaultStoreInventory,
    ...payload,
    acquisitions,
    requisitions,
    returns,
    adjustments,
    inventoryItems,
    lowStockItems,
    stockedItems: inventoryItems.filter((item) => item.availableQuantity > 0).length,
    totalStockQuantity: inventoryItems.reduce(
      (total, item) => total + item.availableQuantity,
      0,
    ),
    totalStockValue: inventoryItems.reduce((total, item) => total + item.stockValue, 0),
    totalIssuedQuantity: requisitions.reduce((total, entry) => total + entry.quantity, 0),
    totalReturnedQuantity: returns.reduce((total, entry) => total + entry.quantity, 0),
    totalAdjustmentQuantity: adjustments.reduce((total, entry) => total + entry.quantity, 0),
    totalAcquisitionCost: acquisitions.reduce((total, entry) => total + entry.totalPrice, 0),
    totalRequisitionCost: requisitions.reduce((total, entry) => total + entry.totalPrice, 0),
    totalReturnCost: returns.reduce((total, entry) => total + entry.totalPrice, 0),
    totalAdjustmentCost: adjustments.reduce((total, entry) => total + entry.totalPrice, 0),
  };
}
