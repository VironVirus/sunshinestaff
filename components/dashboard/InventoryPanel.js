"use client";

import { useEffect, useMemo, useState } from "react";
import { departmentOptions } from "@/data/departments";
import { mergeStoreInventory } from "@/data/storeInventory";
import { getHotelDateKey } from "@/lib/hotelTime";
import { downloadTextPdf } from "@/lib/pdf";
import { getStoreAccess } from "@/lib/roles";

const adjustmentTypes = [
  { value: "loss", label: "Loss" },
  { value: "damage", label: "Damage" },
  { value: "breakage", label: "Breakage" },
  { value: "remove", label: "Correction (remove stock)" },
  { value: "add", label: "Correction (add stock)" },
];

const emptyAcquisitionForm = {
  serialNumber: "",
  itemName: "",
  unitPrice: "",
  quantity: "",
  purchasedBy: "",
  acquiredDate: getHotelDateKey(),
};

const emptyRequisitionForm = {
  serialNumber: "",
  quantity: "",
  departmentKey: "front_office",
  requisitionDate: getHotelDateKey(),
};

const emptyReturnForm = {
  departmentKey: "",
  serialNumber: "",
  quantity: "",
  returnedDate: getHotelDateKey(),
};

const emptyAdjustmentForm = {
  serialNumber: "",
  adjustmentType: "loss",
  quantity: "",
  reason: "",
  adjustedDate: getHotelDateKey(),
};

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getAdjustmentTypeLabel(value) {
  return adjustmentTypes.find((entry) => entry.value === value)?.label ?? value;
}

function buildDepartmentSerialStats(storeInventory) {
  const outstandingMap = new Map();

  (storeInventory?.requisitions ?? []).forEach((entry) => {
    const key = `${entry.departmentKey}::${entry.serialNumber}`;
    const current = outstandingMap.get(key) ?? {
      key,
      departmentKey: entry.departmentKey,
      departmentName: entry.departmentName,
      serialNumber: entry.serialNumber,
      itemName: entry.itemName,
      unitPrice: entry.unitPrice,
      issuedQuantity: 0,
      returnedQuantity: 0,
    };

    current.departmentName = entry.departmentName;
    current.itemName = entry.itemName;
    current.unitPrice = entry.unitPrice;
    current.issuedQuantity += entry.quantity;
    outstandingMap.set(key, current);
  });

  (storeInventory?.returns ?? []).forEach((entry) => {
    const key = `${entry.departmentKey}::${entry.serialNumber}`;
    const current = outstandingMap.get(key);

    if (!current) {
      return;
    }

    current.returnedQuantity += entry.quantity;
    outstandingMap.set(key, current);
  });

  return outstandingMap;
}

function buildReturnableItems(storeInventory) {
  const outstandingMap = buildDepartmentSerialStats(storeInventory);

  return [...outstandingMap.values()]
    .map((entry) => ({
      ...entry,
      outstandingQuantity: Math.max(entry.issuedQuantity - entry.returnedQuantity, 0),
    }))
    .filter((entry) => entry.outstandingQuantity > 0)
    .sort((left, right) => {
      const departmentComparison = left.departmentName.localeCompare(right.departmentName);

      if (departmentComparison !== 0) {
        return departmentComparison;
      }

      return left.itemName.localeCompare(right.itemName);
    });
}

function buildTradeSummaryLines(storeInventory) {
  const acquisitions = storeInventory?.acquisitions ?? [];
  const requisitions = storeInventory?.requisitions ?? [];
  const returns = storeInventory?.returns ?? [];
  const adjustments = storeInventory?.adjustments ?? [];
  const inventoryItems = storeInventory?.inventoryItems ?? [];
  const lowStockItems = storeInventory?.lowStockItems ?? [];

  return [
    `Generated: ${new Date().toLocaleString()}`,
    "",
    `Total acquisition cost: ${formatAmount(storeInventory?.totalAcquisitionCost)}`,
    `Total requisition cost: ${formatAmount(storeInventory?.totalRequisitionCost)}`,
    `Total return value: ${formatAmount(storeInventory?.totalReturnCost)}`,
    `Total adjustment value: ${formatAmount(storeInventory?.totalAdjustmentCost)}`,
    `Current stock value: ${formatAmount(storeInventory?.totalStockValue)}`,
    "",
    "Acquisitions:",
    ...(acquisitions.length > 0
      ? acquisitions.map(
          (entry, index) =>
            `${index + 1}. ${entry.serialNumber} - ${entry.itemName} - ${entry.quantity} @ ${formatAmount(entry.unitPrice)} = ${formatAmount(entry.totalPrice)} - ${entry.purchasedBy || "Store"} - ${entry.acquiredDate}`,
        )
      : ["None"]),
    "",
    "Requisitions:",
    ...(requisitions.length > 0
      ? requisitions.map(
          (entry, index) =>
            `${index + 1}. ${entry.serialNumber} - ${entry.itemName} - ${entry.quantity} @ ${formatAmount(entry.unitPrice)} = ${formatAmount(entry.totalPrice)} - ${entry.departmentName} - ${entry.requisitionDate}`,
        )
      : ["None"]),
    "",
    "Returns:",
    ...(returns.length > 0
      ? returns.map(
          (entry, index) =>
            `${index + 1}. ${entry.serialNumber} - ${entry.itemName} - ${entry.quantity} @ ${formatAmount(entry.unitPrice)} = ${formatAmount(entry.totalPrice)} - ${entry.departmentName} - ${entry.returnedDate}`,
        )
      : ["None"]),
    "",
    "Adjustments:",
    ...(adjustments.length > 0
      ? adjustments.map(
          (entry, index) =>
            `${index + 1}. ${entry.serialNumber} - ${entry.itemName} - ${getAdjustmentTypeLabel(entry.adjustmentType)} - ${entry.quantity} @ ${formatAmount(entry.unitPrice)} = ${formatAmount(entry.totalPrice)} - ${entry.reason || "No note"} - ${entry.adjustedDate}`,
        )
      : ["None"]),
    "",
    "Current stock balance:",
    ...(inventoryItems.length > 0
      ? inventoryItems.map(
          (item, index) =>
            `${index + 1}. ${item.serialNumber} - ${item.itemName} - Acquired ${item.acquiredQuantity} - Issued ${item.issuedQuantity} - Returned ${item.returnedQuantity ?? 0} - Adjusted out ${item.adjustedOutQuantity ?? 0} - Balance ${item.availableQuantity} - Stock value ${formatAmount(item.stockValue)}`,
        )
      : ["None"]),
    "",
    "Low stock watchlist:",
    ...(lowStockItems.length > 0
      ? lowStockItems.map(
          (item, index) =>
            `${index + 1}. ${item.serialNumber} - ${item.itemName} - ${item.availableQuantity} left`,
        )
      : ["None"]),
  ];
}

function SectionButton({ active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-3 text-sm font-semibold transition ${
        active
          ? "bg-[#162338] text-white"
          : "border border-slate-200 bg-white text-slate-600 hover:text-[#162338]"
      }`}
    >
      {label}
    </button>
  );
}

function EmptyState({ message }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">
      {message}
    </div>
  );
}

function ActionButton({ label, onClick, tone = "default" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
        tone === "danger"
          ? "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
          : "border border-slate-200 bg-white text-slate-600 hover:text-[#162338]"
      }`}
    >
      {label}
    </button>
  );
}

function SpreadsheetTable({ columns, rows, emptyMessage }) {
  if (rows.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
      <table className="min-w-full border-collapse text-left text-sm">
        <thead className="bg-slate-100 text-xs uppercase tracking-[0.14em] text-slate-500">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className="border-b border-slate-200 px-4 py-3 font-semibold">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={row.id ?? `${rowIndex}-${columns[0]?.key ?? "row"}`}
              className="odd:bg-white even:bg-slate-50/60"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className="border-b border-slate-200 px-4 py-3 align-top text-slate-700"
                >
                  {row[column.key] ?? "-"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getAcquisitionMinimumQuantity(inventoryItem) {
  return Math.max(
    (inventoryItem?.issuedQuantity ?? 0) +
      (inventoryItem?.adjustedOutQuantity ?? 0) -
      (inventoryItem?.returnedQuantity ?? 0) -
      (inventoryItem?.acquiredQuantity ?? 0),
    0,
  );
}

export default function InventoryPanel({
  profile,
  storeInventory,
  onSaveAcquisition,
  onSaveRequisition,
  onSaveReturn,
  onSaveAdjustment,
}) {
  const access = getStoreAccess(profile);
  const [activeSection, setActiveSection] = useState("acquisition");
  const [acquisitionForm, setAcquisitionForm] = useState(emptyAcquisitionForm);
  const [editingAcquisitionId, setEditingAcquisitionId] = useState("");
  const [requisitionForm, setRequisitionForm] = useState(emptyRequisitionForm);
  const [editingRequisitionId, setEditingRequisitionId] = useState("");
  const [returnForm, setReturnForm] = useState(emptyReturnForm);
  const [editingReturnId, setEditingReturnId] = useState("");
  const [adjustmentForm, setAdjustmentForm] = useState(emptyAdjustmentForm);
  const [editingAdjustmentId, setEditingAdjustmentId] = useState("");
  const [saving, setSaving] = useState({
    acquisition: false,
    requisition: false,
    returns: false,
    adjustments: false,
  });
  const [feedback, setFeedback] = useState({ type: "", message: "" });

  const inventoryItems = useMemo(
    () => storeInventory?.inventoryItems ?? [],
    [storeInventory?.inventoryItems],
  );
  const lowStockItems = useMemo(
    () => storeInventory?.lowStockItems ?? [],
    [storeInventory?.lowStockItems],
  );
  const editingAcquisitionEntry = useMemo(
    () =>
      (storeInventory?.acquisitions ?? []).find((entry) => entry.id === editingAcquisitionId) ?? null,
    [editingAcquisitionId, storeInventory?.acquisitions],
  );
  const acquisitionSourceInventory = useMemo(() => {
    if (!editingAcquisitionId) {
      return storeInventory;
    }

    return mergeStoreInventory({
      ...storeInventory,
      acquisitions: (storeInventory?.acquisitions ?? []).filter(
        (entry) => entry.id !== editingAcquisitionId,
      ),
    });
  }, [editingAcquisitionId, storeInventory]);
  const acquisitionSourceItem = useMemo(
    () =>
      (acquisitionSourceInventory?.inventoryItems ?? []).find(
        (item) => item.serialNumber === acquisitionForm.serialNumber,
      ) ?? null,
    [acquisitionForm.serialNumber, acquisitionSourceInventory?.inventoryItems],
  );
  const minimumAcquisitionQuantity = useMemo(
    () => getAcquisitionMinimumQuantity(acquisitionSourceItem),
    [acquisitionSourceItem],
  );
  const editingRequisitionEntry = useMemo(
    () =>
      (storeInventory?.requisitions ?? []).find((entry) => entry.id === editingRequisitionId) ?? null,
    [editingRequisitionId, storeInventory?.requisitions],
  );
  const requisitionSourceInventory = useMemo(() => {
    if (!editingRequisitionId) {
      return storeInventory;
    }

    return mergeStoreInventory({
      ...storeInventory,
      requisitions: (storeInventory?.requisitions ?? []).filter(
        (entry) => entry.id !== editingRequisitionId,
      ),
    });
  }, [editingRequisitionId, storeInventory]);
  const requisitionStats = useMemo(
    () =>
      buildDepartmentSerialStats({
        requisitions: editingRequisitionId
          ? (storeInventory?.requisitions ?? []).filter((entry) => entry.id !== editingRequisitionId)
          : storeInventory?.requisitions ?? [],
        returns: storeInventory?.returns ?? [],
      }),
    [editingRequisitionId, storeInventory?.requisitions, storeInventory?.returns],
  );
  const availableItems = useMemo(
    () => (requisitionSourceInventory?.inventoryItems ?? []).filter((item) => item.availableQuantity > 0),
    [requisitionSourceInventory?.inventoryItems],
  );
  const minimumRequisitionQuantity = useMemo(() => {
    if (!editingRequisitionEntry) {
      return 0;
    }

    const stats = requisitionStats.get(
      `${editingRequisitionEntry.departmentKey}::${editingRequisitionEntry.serialNumber}`,
    );

    return Math.max((stats?.returnedQuantity ?? 0) - (stats?.issuedQuantity ?? 0), 0);
  }, [editingRequisitionEntry, requisitionStats]);
  const returnSourceEntries = useMemo(
    () =>
      editingReturnId
        ? (storeInventory?.returns ?? []).filter((entry) => entry.id !== editingReturnId)
        : storeInventory?.returns ?? [],
    [editingReturnId, storeInventory?.returns],
  );
  const editableReturnableItems = useMemo(
    () =>
      buildReturnableItems({
        ...storeInventory,
        returns: returnSourceEntries,
      }),
    [returnSourceEntries, storeInventory],
  );
  const returnDepartments = useMemo(
    () =>
      departmentOptions.filter((department) =>
        editableReturnableItems.some((item) => item.departmentKey === department.value),
      ),
    [editableReturnableItems],
  );
  const returnDepartmentItems = useMemo(
    () => editableReturnableItems.filter((item) => item.departmentKey === returnForm.departmentKey),
    [editableReturnableItems, returnForm.departmentKey],
  );
  const selectedInventoryItem = useMemo(
    () =>
      availableItems.find((item) => item.serialNumber === requisitionForm.serialNumber) ?? null,
    [availableItems, requisitionForm.serialNumber],
  );
  const selectedReturnItem = useMemo(
    () =>
      returnDepartmentItems.find((item) => item.serialNumber === returnForm.serialNumber) ?? null,
    [returnDepartmentItems, returnForm.serialNumber],
  );
  const adjustmentSourceInventory = useMemo(() => {
    if (!editingAdjustmentId) {
      return storeInventory;
    }

    return mergeStoreInventory({
      ...storeInventory,
      adjustments: (storeInventory?.adjustments ?? []).filter(
        (entry) => entry.id !== editingAdjustmentId,
      ),
    });
  }, [editingAdjustmentId, storeInventory]);
  const selectedAdjustmentItem = useMemo(
    () =>
      (adjustmentSourceInventory?.inventoryItems ?? []).find(
        (item) => item.serialNumber === adjustmentForm.serialNumber,
      ) ?? null,
    [adjustmentForm.serialNumber, adjustmentSourceInventory?.inventoryItems],
  );
  const minimumAdjustmentQuantity = useMemo(() => {
    if (adjustmentForm.adjustmentType !== "add") {
      return 0;
    }

    return getAcquisitionMinimumQuantity(selectedAdjustmentItem);
  }, [adjustmentForm.adjustmentType, selectedAdjustmentItem]);
  const readOnly = !access.canEditPanel;

  useEffect(() => {
    setAcquisitionForm((current) => ({
      ...current,
      purchasedBy: current.purchasedBy || profile?.fullName || "",
    }));
  }, [profile?.fullName]);

  useEffect(() => {
    if (
      requisitionForm.serialNumber &&
      !availableItems.some((item) => item.serialNumber === requisitionForm.serialNumber)
    ) {
      setRequisitionForm((current) => ({
        ...current,
        serialNumber: "",
        quantity: "",
      }));
    }
  }, [availableItems, requisitionForm.serialNumber]);

  useEffect(() => {
    if (
      returnForm.departmentKey &&
      !returnDepartments.some((department) => department.value === returnForm.departmentKey)
    ) {
      setReturnForm((current) => ({
        ...current,
        departmentKey: "",
        serialNumber: "",
        quantity: "",
      }));
    }
  }, [returnDepartments, returnForm.departmentKey]);

  useEffect(() => {
    if (
      returnForm.serialNumber &&
      !returnDepartmentItems.some((item) => item.serialNumber === returnForm.serialNumber)
    ) {
      setReturnForm((current) => ({
        ...current,
        serialNumber: "",
        quantity: "",
      }));
    }
  }, [returnDepartmentItems, returnForm.serialNumber]);

  useEffect(() => {
    if (
      adjustmentForm.serialNumber &&
      !(adjustmentSourceInventory?.inventoryItems ?? []).some(
        (item) => item.serialNumber === adjustmentForm.serialNumber,
      )
    ) {
      setAdjustmentForm((current) => ({
        ...current,
        serialNumber: "",
        quantity: "",
      }));
    }
  }, [adjustmentForm.serialNumber, adjustmentSourceInventory?.inventoryItems]);

  if (!access.canViewPanel) {
    return null;
  }

  function updateAcquisition(field, value) {
    setAcquisitionForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function resetAcquisitionForm() {
    setEditingAcquisitionId("");
    setAcquisitionForm({
      ...emptyAcquisitionForm,
      purchasedBy: profile?.fullName || "",
      acquiredDate: getHotelDateKey(),
    });
  }

  function resetRequisitionForm() {
    setEditingRequisitionId("");
    setRequisitionForm({
      ...emptyRequisitionForm,
      departmentKey: "front_office",
      requisitionDate: getHotelDateKey(),
    });
  }

  function resetReturnForm() {
    setEditingReturnId("");
    setReturnForm({
      ...emptyReturnForm,
      returnedDate: getHotelDateKey(),
    });
  }

  function resetAdjustmentForm() {
    setEditingAdjustmentId("");
    setAdjustmentForm({
      ...emptyAdjustmentForm,
      adjustedDate: getHotelDateKey(),
    });
  }

  function updateRequisition(field, value) {
    setRequisitionForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateReturn(field, value) {
    setReturnForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateAdjustment(field, value) {
    setAdjustmentForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleAcquire(event) {
    event.preventDefault();
    setSaving((current) => ({ ...current, acquisition: true }));
    setFeedback({ type: "", message: "" });

    try {
      const quantity = Math.max(Number(acquisitionForm.quantity) || 0, 0);
      const unitPrice = Math.max(Number(acquisitionForm.unitPrice) || 0, 0);

      if (!acquisitionForm.serialNumber.trim() || !acquisitionForm.itemName.trim()) {
        throw new Error("Add the serial number and item name before saving.");
      }

      if (quantity <= 0) {
        throw new Error("Quantity must be greater than zero.");
      }

      if (quantity < minimumAcquisitionQuantity) {
        throw new Error(
          `Quantity cannot be lower than ${minimumAcquisitionQuantity} because stock has already been issued or adjusted from this item.`,
        );
      }

      const nextEntry = {
        id: editingAcquisitionId || `acq-${Date.now()}`,
        serialNumber: acquisitionForm.serialNumber,
        itemName: acquisitionForm.itemName,
        unitPrice,
        quantity,
        totalPrice: unitPrice * quantity,
        purchasedBy: acquisitionForm.purchasedBy || profile?.fullName || "Store",
        acquiredDate: acquisitionForm.acquiredDate,
      };

      await onSaveAcquisition({
        acquisitions: editingAcquisitionId
          ? (storeInventory?.acquisitions ?? []).map((entry) =>
              entry.id === editingAcquisitionId ? nextEntry : entry,
            )
          : [...(storeInventory?.acquisitions ?? []), nextEntry],
      });

      resetAcquisitionForm();
      setFeedback({
        type: "success",
        message: editingAcquisitionId ? "Acquisition updated." : "Acquisition saved.",
      });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setSaving((current) => ({ ...current, acquisition: false }));
    }
  }

  function handleEditAcquisition(entry) {
    setActiveSection("acquisition");
    setEditingAcquisitionId(entry.id);
    setAcquisitionForm({
      serialNumber: entry.serialNumber,
      itemName: entry.itemName,
      unitPrice: String(entry.unitPrice ?? ""),
      quantity: String(entry.quantity ?? ""),
      purchasedBy: entry.purchasedBy || profile?.fullName || "",
      acquiredDate: entry.acquiredDate || getHotelDateKey(),
    });
    setFeedback({ type: "", message: "" });
  }

  async function handleDeleteAcquisition(entry) {
    if (!window.confirm(`Delete ${entry.serialNumber} - ${entry.itemName} from acquisitions?`)) {
      return;
    }

    const baselineInventory = mergeStoreInventory({
      ...storeInventory,
      acquisitions: (storeInventory?.acquisitions ?? []).filter((current) => current.id !== entry.id),
    });
    const baselineItem =
      (baselineInventory.inventoryItems ?? []).find(
        (item) => item.serialNumber === entry.serialNumber,
      ) ?? null;
    const minimumQuantity = getAcquisitionMinimumQuantity(baselineItem);

    if (minimumQuantity > 0) {
      setFeedback({
        type: "error",
        message:
          "This acquisition cannot be deleted yet because some of that stock has already been issued or adjusted.",
      });
      return;
    }

    setSaving((current) => ({ ...current, acquisition: true }));
    setFeedback({ type: "", message: "" });

    try {
      await onSaveAcquisition({
        acquisitions: (storeInventory?.acquisitions ?? []).filter((current) => current.id !== entry.id),
      });

      if (editingAcquisitionId === entry.id) {
        resetAcquisitionForm();
      }

      setFeedback({ type: "success", message: "Acquisition deleted." });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setSaving((current) => ({ ...current, acquisition: false }));
    }
  }

  async function handleRequisition(event) {
    event.preventDefault();
    setSaving((current) => ({ ...current, requisition: true }));
    setFeedback({ type: "", message: "" });

    try {
      if (!selectedInventoryItem) {
        throw new Error("Select an available item before saving.");
      }

      const quantity = Math.max(Number(requisitionForm.quantity) || 0, 0);

      if (quantity <= 0) {
        throw new Error("Requested quantity must be greater than zero.");
      }

      if (quantity > selectedInventoryItem.availableQuantity) {
        throw new Error("Requested quantity is higher than the available stock.");
      }

      if (quantity < minimumRequisitionQuantity) {
        throw new Error(
          `Quantity cannot be lower than ${minimumRequisitionQuantity} because returns have already been recorded against this requisition.`,
        );
      }

      const nextEntry = {
        id: editingRequisitionId || `req-${Date.now()}`,
        serialNumber: selectedInventoryItem.serialNumber,
        itemName: selectedInventoryItem.itemName,
        unitPrice: selectedInventoryItem.unitPrice,
        quantity,
        totalPrice: selectedInventoryItem.unitPrice * quantity,
        departmentKey: requisitionForm.departmentKey,
        requisitionDate: requisitionForm.requisitionDate,
      };

      await onSaveRequisition({
        requisitions: editingRequisitionId
          ? (storeInventory?.requisitions ?? []).map((entry) =>
              entry.id === editingRequisitionId ? nextEntry : entry,
            )
          : [...(storeInventory?.requisitions ?? []), nextEntry],
      });

      resetRequisitionForm();
      setFeedback({
        type: "success",
        message: editingRequisitionId ? "Requisition updated." : "Requisition saved.",
      });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setSaving((current) => ({ ...current, requisition: false }));
    }
  }

  function handleEditRequisition(entry) {
    setActiveSection("requisition");
    setEditingRequisitionId(entry.id);
    setRequisitionForm({
      serialNumber: entry.serialNumber,
      quantity: String(entry.quantity ?? ""),
      departmentKey: entry.departmentKey,
      requisitionDate: entry.requisitionDate || getHotelDateKey(),
    });
    setFeedback({ type: "", message: "" });
  }

  async function handleDeleteRequisition(entry) {
    if (!window.confirm(`Delete requisition for ${entry.serialNumber} - ${entry.itemName}?`)) {
      return;
    }

    const remainingRequisitions = (storeInventory?.requisitions ?? []).filter(
      (current) => current.id !== entry.id,
    );
    const stats = buildDepartmentSerialStats({
      requisitions: remainingRequisitions,
      returns: storeInventory?.returns ?? [],
    }).get(`${entry.departmentKey}::${entry.serialNumber}`);

    if ((stats?.returnedQuantity ?? 0) > (stats?.issuedQuantity ?? 0)) {
      setFeedback({
        type: "error",
        message:
          "This requisition cannot be deleted because returns have already been recorded against it.",
      });
      return;
    }

    setSaving((current) => ({ ...current, requisition: true }));
    setFeedback({ type: "", message: "" });

    try {
      await onSaveRequisition({
        requisitions: remainingRequisitions,
      });

      if (editingRequisitionId === entry.id) {
        resetRequisitionForm();
      }

      setFeedback({ type: "success", message: "Requisition deleted." });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setSaving((current) => ({ ...current, requisition: false }));
    }
  }

  async function handleReturn(event) {
    event.preventDefault();
    setSaving((current) => ({ ...current, returns: true }));
    setFeedback({ type: "", message: "" });

    try {
      if (!selectedReturnItem) {
        throw new Error("Select the department item being returned.");
      }

      const quantity = Math.max(Number(returnForm.quantity) || 0, 0);

      if (quantity <= 0) {
        throw new Error("Returned quantity must be greater than zero.");
      }

      if (quantity > selectedReturnItem.outstandingQuantity) {
        throw new Error("Returned quantity is higher than the department outstanding balance.");
      }

      const nextEntry = {
        id: editingReturnId || `return-${Date.now()}`,
        serialNumber: selectedReturnItem.serialNumber,
        itemName: selectedReturnItem.itemName,
        unitPrice: selectedReturnItem.unitPrice,
        quantity,
        totalPrice: selectedReturnItem.unitPrice * quantity,
        departmentKey: selectedReturnItem.departmentKey,
        returnedDate: returnForm.returnedDate,
      };

      await onSaveReturn({
        returns: editingReturnId
          ? (storeInventory?.returns ?? []).map((entry) =>
              entry.id === editingReturnId ? nextEntry : entry,
            )
          : [...(storeInventory?.returns ?? []), nextEntry],
      });

      resetReturnForm();
      setFeedback({
        type: "success",
        message: editingReturnId ? "Return updated." : "Return saved.",
      });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setSaving((current) => ({ ...current, returns: false }));
    }
  }

  function handleEditReturn(entry) {
    setActiveSection("returns");
    setEditingReturnId(entry.id);
    setReturnForm({
      departmentKey: entry.departmentKey,
      serialNumber: entry.serialNumber,
      quantity: String(entry.quantity ?? ""),
      returnedDate: entry.returnedDate || getHotelDateKey(),
    });
    setFeedback({ type: "", message: "" });
  }

  async function handleDeleteReturn(entry) {
    if (!window.confirm(`Delete return for ${entry.serialNumber} - ${entry.itemName}?`)) {
      return;
    }

    setSaving((current) => ({ ...current, returns: true }));
    setFeedback({ type: "", message: "" });

    try {
      await onSaveReturn({
        returns: (storeInventory?.returns ?? []).filter((current) => current.id !== entry.id),
      });

      if (editingReturnId === entry.id) {
        resetReturnForm();
      }

      setFeedback({ type: "success", message: "Return deleted." });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setSaving((current) => ({ ...current, returns: false }));
    }
  }

  async function handleAdjustment(event) {
    event.preventDefault();
    setSaving((current) => ({ ...current, adjustments: true }));
    setFeedback({ type: "", message: "" });

    try {
      if (!selectedAdjustmentItem) {
        throw new Error("Select an item before saving the adjustment.");
      }

      const quantity = Math.max(Number(adjustmentForm.quantity) || 0, 0);

      if (quantity <= 0) {
        throw new Error("Adjustment quantity must be greater than zero.");
      }

      if (adjustmentForm.adjustmentType !== "add" && quantity > selectedAdjustmentItem.availableQuantity) {
        throw new Error("Adjustment quantity is higher than the available stock.");
      }

      if (adjustmentForm.adjustmentType === "add" && quantity < minimumAdjustmentQuantity) {
        throw new Error(
          `Quantity cannot be lower than ${minimumAdjustmentQuantity} because later stock movements depend on it.`,
        );
      }

      const nextEntry = {
        id: editingAdjustmentId || `adjust-${Date.now()}`,
        serialNumber: selectedAdjustmentItem.serialNumber,
        itemName: selectedAdjustmentItem.itemName,
        unitPrice: selectedAdjustmentItem.unitPrice,
        quantity,
        totalPrice: selectedAdjustmentItem.unitPrice * quantity,
        adjustmentType: adjustmentForm.adjustmentType,
        reason: adjustmentForm.reason,
        adjustedDate: adjustmentForm.adjustedDate,
      };

      await onSaveAdjustment({
        adjustments: editingAdjustmentId
          ? (storeInventory?.adjustments ?? []).map((entry) =>
              entry.id === editingAdjustmentId ? nextEntry : entry,
            )
          : [...(storeInventory?.adjustments ?? []), nextEntry],
      });

      resetAdjustmentForm();
      setFeedback({
        type: "success",
        message: editingAdjustmentId ? "Adjustment updated." : "Adjustment saved.",
      });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setSaving((current) => ({ ...current, adjustments: false }));
    }
  }

  function handleEditAdjustment(entry) {
    setActiveSection("adjustments");
    setEditingAdjustmentId(entry.id);
    setAdjustmentForm({
      serialNumber: entry.serialNumber,
      adjustmentType: entry.adjustmentType,
      quantity: String(entry.quantity ?? ""),
      reason: entry.reason || "",
      adjustedDate: entry.adjustedDate || getHotelDateKey(),
    });
    setFeedback({ type: "", message: "" });
  }

  async function handleDeleteAdjustment(entry) {
    if (!window.confirm(`Delete adjustment for ${entry.serialNumber} - ${entry.itemName}?`)) {
      return;
    }

    if (entry.adjustmentType === "add") {
      const baselineInventory = mergeStoreInventory({
        ...storeInventory,
        adjustments: (storeInventory?.adjustments ?? []).filter((current) => current.id !== entry.id),
      });
      const baselineItem =
        baselineInventory.inventoryItems.find((item) => item.serialNumber === entry.serialNumber) ?? null;

      if (getAcquisitionMinimumQuantity(baselineItem) > 0) {
        setFeedback({
          type: "error",
          message:
            "This adjustment cannot be deleted because later stock movements still depend on it.",
        });
        return;
      }
    }

    setSaving((current) => ({ ...current, adjustments: true }));
    setFeedback({ type: "", message: "" });

    try {
      await onSaveAdjustment({
        adjustments: (storeInventory?.adjustments ?? []).filter((current) => current.id !== entry.id),
      });

      if (editingAdjustmentId === entry.id) {
        resetAdjustmentForm();
      }

      setFeedback({ type: "success", message: "Adjustment deleted." });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setSaving((current) => ({ ...current, adjustments: false }));
    }
  }

  function handleDownloadReport() {
    downloadTextPdf({
      filename: "sunshine-store-trade-summary.pdf",
      title: "Sunshine Hotel Store Trade Summary",
      lines: buildTradeSummaryLines(storeInventory),
    });
  }

  const summaryCards = [
    { label: "Items in stock", value: storeInventory?.stockedItems ?? 0 },
    { label: "Stock quantity", value: storeInventory?.totalStockQuantity ?? 0 },
    { label: "Issued quantity", value: storeInventory?.totalIssuedQuantity ?? 0 },
    { label: "Returned quantity", value: storeInventory?.totalReturnedQuantity ?? 0 },
    { label: "Adjustment quantity", value: storeInventory?.totalAdjustmentQuantity ?? 0 },
    { label: "Low stock", value: lowStockItems.length },
  ];

  return (
    <section className="panel p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="section-title">Store Inventory</h2>
          <p className="section-copy max-w-2xl">
            Track acquisitions, requisitions, returns, and adjustments with a live stock balance.
          </p>
        </div>

        <button type="button" onClick={handleDownloadReport} className="button-secondary no-print">
          Download trade summary
        </button>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {summaryCards.map((card) => (
          <div key={card.label} className="subpanel">
            <span className="metric-label">{card.label}</span>
            <span className="metric-value">{card.value}</span>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-3 no-print">
        <SectionButton
          label="Acquisition"
          active={activeSection === "acquisition"}
          onClick={() => setActiveSection("acquisition")}
        />
        <SectionButton
          label="Requisition"
          active={activeSection === "requisition"}
          onClick={() => setActiveSection("requisition")}
        />
        <SectionButton
          label="Returns"
          active={activeSection === "returns"}
          onClick={() => setActiveSection("returns")}
        />
        <SectionButton
          label="Adjustments"
          active={activeSection === "adjustments"}
          onClick={() => setActiveSection("adjustments")}
        />
        <SectionButton
          label="Trade Summary"
          active={activeSection === "summary"}
          onClick={() => setActiveSection("summary")}
        />
      </div>

      {feedback.message ? (
        <div
          className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
            feedback.type === "success"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-rose-50 text-rose-700"
          }`}
        >
          {feedback.message}
        </div>
      ) : null}

      {activeSection === "acquisition" ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <form onSubmit={handleAcquire} className="subpanel no-print">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field">
                <span>Serial number</span>
                <input
                  type="text"
                  value={acquisitionForm.serialNumber}
                  onChange={(event) => updateAcquisition("serialNumber", event.target.value)}
                  disabled={readOnly || saving.acquisition || Boolean(editingAcquisitionId)}
                  required
                />
              </label>

              <label className="field">
                <span>Date</span>
                <input
                  type="date"
                  value={acquisitionForm.acquiredDate}
                  onChange={(event) => updateAcquisition("acquiredDate", event.target.value)}
                  disabled={readOnly || saving.acquisition}
                  required
                />
              </label>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="field sm:col-span-2">
                <span>Item name</span>
                <input
                  type="text"
                  value={acquisitionForm.itemName}
                  onChange={(event) => updateAcquisition("itemName", event.target.value)}
                  disabled={readOnly || saving.acquisition}
                  required
                />
              </label>

              <label className="field">
                <span>Unit price</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={acquisitionForm.unitPrice}
                  onChange={(event) => updateAcquisition("unitPrice", event.target.value)}
                  disabled={readOnly || saving.acquisition}
                  required
                />
              </label>

              <label className="field">
                <span>Quantity</span>
                <input
                  type="number"
                  min="1"
                  value={acquisitionForm.quantity}
                  onChange={(event) => updateAcquisition("quantity", event.target.value)}
                  disabled={readOnly || saving.acquisition}
                  required
                />
              </label>
            </div>

            <label className="field mt-4">
              <span>Purchased by</span>
              <input
                type="text"
                value={acquisitionForm.purchasedBy}
                onChange={(event) => updateAcquisition("purchasedBy", event.target.value)}
                disabled={readOnly || saving.acquisition}
                required
              />
            </label>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-600">
              Total price:{" "}
              <span className="font-semibold text-[#162338]">
                {formatAmount(
                  (Number(acquisitionForm.unitPrice) || 0) *
                    (Number(acquisitionForm.quantity) || 0),
                )}
              </span>
              {editingAcquisitionId ? (
                <>
                  <br />
                  Minimum quantity allowed:{" "}
                  <span className="font-semibold text-[#162338]">
                    {minimumAcquisitionQuantity}
                  </span>
                </>
              ) : null}
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                disabled={readOnly || saving.acquisition}
                className="button-primary w-full"
              >
                {saving.acquisition
                  ? "Saving..."
                  : editingAcquisitionId
                    ? "Update acquisition"
                    : "Save acquisition"}
              </button>
              {editingAcquisitionId ? (
                <button
                  type="button"
                  onClick={resetAcquisitionForm}
                  disabled={saving.acquisition}
                  className="button-secondary w-full"
                >
                  Cancel edit
                </button>
              ) : null}
            </div>
          </form>

          <div className="subpanel">
            <div className="flex items-center justify-between gap-3">
              <p className="metric-label">Recent acquisitions</p>
              <span className="badge">{storeInventory?.acquisitions?.length ?? 0} entries</span>
            </div>

            <div className="mt-4 space-y-3">
              {(storeInventory?.acquisitions ?? []).slice(0, 8).map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-[#162338]">
                        {entry.serialNumber} - {entry.itemName}
                      </p>
                      <p className="mt-2 text-sm text-slate-600">
                        Qty {entry.quantity} @ {formatAmount(entry.unitPrice)}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {entry.purchasedBy || "Store"} - {entry.acquiredDate}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-[#8a6923]">
                      {formatAmount(entry.totalPrice)}
                    </span>
                  </div>
                  {!readOnly ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <ActionButton label="Edit" onClick={() => handleEditAcquisition(entry)} />
                      <ActionButton
                        label="Delete"
                        tone="danger"
                        onClick={() => handleDeleteAcquisition(entry)}
                      />
                    </div>
                  ) : null}
                </div>
              ))}

              {(storeInventory?.acquisitions ?? []).length === 0 ? (
                <EmptyState message="No acquisitions saved yet." />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {activeSection === "requisition" ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <form onSubmit={handleRequisition} className="subpanel no-print">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field sm:col-span-2">
                <span>Item</span>
                <select
                  value={requisitionForm.serialNumber}
                  onChange={(event) => updateRequisition("serialNumber", event.target.value)}
                  disabled={readOnly || saving.requisition || Boolean(editingRequisitionId)}
                >
                  <option value="">Select item</option>
                  {availableItems.map((item) => (
                    <option key={item.serialNumber} value={item.serialNumber}>
                      {item.serialNumber} - {item.itemName} ({item.availableQuantity} left)
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Date</span>
                <input
                  type="date"
                  value={requisitionForm.requisitionDate}
                  onChange={(event) => updateRequisition("requisitionDate", event.target.value)}
                  disabled={readOnly || saving.requisition}
                  required
                />
              </label>

              <label className="field">
                <span>Department using it</span>
                <select
                  value={requisitionForm.departmentKey}
                  onChange={(event) => updateRequisition("departmentKey", event.target.value)}
                  disabled={readOnly || saving.requisition || Boolean(editingRequisitionId)}
                >
                  {departmentOptions.map((department) => (
                    <option key={department.value} value={department.value}>
                      {department.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="field">
                <span>Unit price</span>
                <input
                  type="text"
                  value={selectedInventoryItem ? formatAmount(selectedInventoryItem.unitPrice) : ""}
                  disabled
                />
              </label>

              <label className="field">
                <span>Quantity</span>
                <input
                  type="number"
                  min="1"
                  max={selectedInventoryItem?.availableQuantity ?? ""}
                  value={requisitionForm.quantity}
                  onChange={(event) => updateRequisition("quantity", event.target.value)}
                  disabled={readOnly || saving.requisition || !selectedInventoryItem}
                  required
                />
              </label>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-600">
              Available balance:{" "}
              <span className="font-semibold text-[#162338]">
                {selectedInventoryItem?.availableQuantity ?? 0}
              </span>
              <br />
              Total price:{" "}
              <span className="font-semibold text-[#162338]">
                {formatAmount(
                  (selectedInventoryItem?.unitPrice ?? 0) *
                    (Number(requisitionForm.quantity) || 0),
                )}
              </span>
              {editingRequisitionId ? (
                <>
                  <br />
                  Minimum quantity allowed:{" "}
                  <span className="font-semibold text-[#162338]">
                    {minimumRequisitionQuantity}
                  </span>
                </>
              ) : null}
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                disabled={readOnly || saving.requisition}
                className="button-primary w-full"
              >
                {saving.requisition
                  ? "Saving..."
                  : editingRequisitionId
                    ? "Update requisition"
                    : "Save requisition"}
              </button>
              {editingRequisitionId ? (
                <button
                  type="button"
                  onClick={resetRequisitionForm}
                  disabled={saving.requisition}
                  className="button-secondary w-full"
                >
                  Cancel edit
                </button>
              ) : null}
            </div>
          </form>

          <div className="subpanel">
            <div className="flex items-center justify-between gap-3">
              <p className="metric-label">Recent requisitions</p>
              <span className="badge">{storeInventory?.requisitions?.length ?? 0} entries</span>
            </div>

            <div className="mt-4 space-y-3">
              {(storeInventory?.requisitions ?? []).slice(0, 8).map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-[#162338]">
                        {entry.serialNumber} - {entry.itemName}
                      </p>
                      <p className="mt-2 text-sm text-slate-600">
                        Qty {entry.quantity} @ {formatAmount(entry.unitPrice)}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {entry.departmentName} - {entry.requisitionDate}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-[#8a6923]">
                      {formatAmount(entry.totalPrice)}
                    </span>
                  </div>
                  {!readOnly ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <ActionButton label="Edit" onClick={() => handleEditRequisition(entry)} />
                      <ActionButton
                        label="Delete"
                        tone="danger"
                        onClick={() => handleDeleteRequisition(entry)}
                      />
                    </div>
                  ) : null}
                </div>
              ))}

              {(storeInventory?.requisitions ?? []).length === 0 ? (
                <EmptyState message="No requisitions saved yet." />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {activeSection === "returns" ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <form onSubmit={handleReturn} className="subpanel no-print">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field">
                <span>Department returning it</span>
                <select
                  value={returnForm.departmentKey}
                  onChange={(event) => updateReturn("departmentKey", event.target.value)}
                  disabled={readOnly || saving.returns || Boolean(editingReturnId)}
                  required
                >
                  <option value="">Select department</option>
                  {returnDepartments.map((department) => (
                    <option key={department.value} value={department.value}>
                      {department.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Date</span>
                <input
                  type="date"
                  value={returnForm.returnedDate}
                  onChange={(event) => updateReturn("returnedDate", event.target.value)}
                  disabled={readOnly || saving.returns}
                  required
                />
              </label>

              <label className="field sm:col-span-2">
                <span>Item</span>
                <select
                  value={returnForm.serialNumber}
                  onChange={(event) => updateReturn("serialNumber", event.target.value)}
                  disabled={readOnly || saving.returns || !returnForm.departmentKey || Boolean(editingReturnId)}
                  required
                >
                  <option value="">Select item</option>
                  {returnDepartmentItems.map((item) => (
                    <option key={item.key} value={item.serialNumber}>
                      {item.serialNumber} - {item.itemName} ({item.outstandingQuantity} still out)
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="field">
                <span>Unit price</span>
                <input
                  type="text"
                  value={selectedReturnItem ? formatAmount(selectedReturnItem.unitPrice) : ""}
                  disabled
                />
              </label>

              <label className="field">
                <span>Quantity</span>
                <input
                  type="number"
                  min="1"
                  max={selectedReturnItem?.outstandingQuantity ?? ""}
                  value={returnForm.quantity}
                  onChange={(event) => updateReturn("quantity", event.target.value)}
                  disabled={readOnly || saving.returns || !selectedReturnItem}
                  required
                />
              </label>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-600">
              Department outstanding balance:{" "}
              <span className="font-semibold text-[#162338]">
                {selectedReturnItem?.outstandingQuantity ?? 0}
              </span>
              <br />
              Return value:{" "}
              <span className="font-semibold text-[#162338]">
                {formatAmount(
                  (selectedReturnItem?.unitPrice ?? 0) * (Number(returnForm.quantity) || 0),
                )}
              </span>
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                disabled={readOnly || saving.returns}
                className="button-primary w-full"
              >
                {saving.returns ? "Saving..." : editingReturnId ? "Update return" : "Save return"}
              </button>
              {editingReturnId ? (
                <button
                  type="button"
                  onClick={resetReturnForm}
                  disabled={saving.returns}
                  className="button-secondary w-full"
                >
                  Cancel edit
                </button>
              ) : null}
            </div>
          </form>

          <div className="subpanel">
            <div className="flex items-center justify-between gap-3">
              <p className="metric-label">Recent returns</p>
              <span className="badge">{storeInventory?.returns?.length ?? 0} entries</span>
            </div>

            <div className="mt-4 space-y-3">
              {(storeInventory?.returns ?? []).slice(0, 8).map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-[#162338]">
                        {entry.serialNumber} - {entry.itemName}
                      </p>
                      <p className="mt-2 text-sm text-slate-600">
                        Qty {entry.quantity} @ {formatAmount(entry.unitPrice)}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {entry.departmentName} - {entry.returnedDate}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-[#8a6923]">
                      {formatAmount(entry.totalPrice)}
                    </span>
                  </div>
                  {!readOnly ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <ActionButton label="Edit" onClick={() => handleEditReturn(entry)} />
                      <ActionButton
                        label="Delete"
                        tone="danger"
                        onClick={() => handleDeleteReturn(entry)}
                      />
                    </div>
                  ) : null}
                </div>
              ))}

              {(storeInventory?.returns ?? []).length === 0 ? (
                <EmptyState message="No returns saved yet." />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {activeSection === "adjustments" ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <form onSubmit={handleAdjustment} className="subpanel no-print">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field sm:col-span-2">
                <span>Item</span>
                <select
                  value={adjustmentForm.serialNumber}
                  onChange={(event) => updateAdjustment("serialNumber", event.target.value)}
                  disabled={readOnly || saving.adjustments || Boolean(editingAdjustmentId)}
                  required
                >
                  <option value="">Select item</option>
                  {inventoryItems.map((item) => (
                    <option key={item.serialNumber} value={item.serialNumber}>
                      {item.serialNumber} - {item.itemName} ({item.availableQuantity} left)
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Date</span>
                <input
                  type="date"
                  value={adjustmentForm.adjustedDate}
                  onChange={(event) => updateAdjustment("adjustedDate", event.target.value)}
                  disabled={readOnly || saving.adjustments}
                  required
                />
              </label>

              <label className="field">
                <span>Adjustment type</span>
                <select
                  value={adjustmentForm.adjustmentType}
                  onChange={(event) => updateAdjustment("adjustmentType", event.target.value)}
                  disabled={readOnly || saving.adjustments}
                >
                  {adjustmentTypes.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="field">
                <span>Unit price</span>
                <input
                  type="text"
                  value={selectedAdjustmentItem ? formatAmount(selectedAdjustmentItem.unitPrice) : ""}
                  disabled
                />
              </label>

              <label className="field">
                <span>Quantity</span>
                <input
                  type="number"
                  min="1"
                  max={
                    adjustmentForm.adjustmentType === "add"
                      ? ""
                      : selectedAdjustmentItem?.availableQuantity ?? ""
                  }
                  value={adjustmentForm.quantity}
                  onChange={(event) => updateAdjustment("quantity", event.target.value)}
                  disabled={readOnly || saving.adjustments || !selectedAdjustmentItem}
                  required
                />
              </label>
            </div>

            <label className="field mt-4">
              <span>Reason</span>
              <input
                type="text"
                value={adjustmentForm.reason}
                onChange={(event) => updateAdjustment("reason", event.target.value)}
                disabled={readOnly || saving.adjustments}
                placeholder="Breakage, loss, count correction, or damage note"
              />
            </label>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-600">
              Available balance:{" "}
              <span className="font-semibold text-[#162338]">
                {selectedAdjustmentItem?.availableQuantity ?? 0}
              </span>
              <br />
              Adjustment value:{" "}
              <span className="font-semibold text-[#162338]">
                {formatAmount(
                  (selectedAdjustmentItem?.unitPrice ?? 0) *
                    (Number(adjustmentForm.quantity) || 0),
                )}
              </span>
              {editingAdjustmentId && adjustmentForm.adjustmentType === "add" ? (
                <>
                  <br />
                  Minimum quantity allowed:{" "}
                  <span className="font-semibold text-[#162338]">
                    {minimumAdjustmentQuantity}
                  </span>
                </>
              ) : null}
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                disabled={readOnly || saving.adjustments}
                className="button-primary w-full"
              >
                {saving.adjustments
                  ? "Saving..."
                  : editingAdjustmentId
                    ? "Update adjustment"
                    : "Save adjustment"}
              </button>
              {editingAdjustmentId ? (
                <button
                  type="button"
                  onClick={resetAdjustmentForm}
                  disabled={saving.adjustments}
                  className="button-secondary w-full"
                >
                  Cancel edit
                </button>
              ) : null}
            </div>
          </form>

          <div className="subpanel">
            <div className="flex items-center justify-between gap-3">
              <p className="metric-label">Recent adjustments</p>
              <span className="badge">{storeInventory?.adjustments?.length ?? 0} entries</span>
            </div>

            <div className="mt-4 space-y-3">
              {(storeInventory?.adjustments ?? []).slice(0, 8).map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-[#162338]">
                        {entry.serialNumber} - {entry.itemName}
                      </p>
                      <p className="mt-2 text-sm text-slate-600">
                        {getAdjustmentTypeLabel(entry.adjustmentType)} - Qty {entry.quantity} @{" "}
                        {formatAmount(entry.unitPrice)}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {entry.reason || "No note"} - {entry.adjustedDate}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-[#8a6923]">
                      {formatAmount(entry.totalPrice)}
                    </span>
                  </div>
                  {!readOnly ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <ActionButton label="Edit" onClick={() => handleEditAdjustment(entry)} />
                      <ActionButton
                        label="Delete"
                        tone="danger"
                        onClick={() => handleDeleteAdjustment(entry)}
                      />
                    </div>
                  ) : null}
                </div>
              ))}

              {(storeInventory?.adjustments ?? []).length === 0 ? (
                <EmptyState message="No adjustments saved yet." />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {activeSection === "summary" ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="subpanel">
            <div className="flex items-center justify-between gap-3">
              <p className="metric-label">Current stock balance sheet</p>
              <span className="badge">{inventoryItems.length} items</span>
            </div>

            <div className="mt-4">
              <SpreadsheetTable
                columns={[
                  { key: "sn", label: "S/N" },
                  { key: "serialNumber", label: "Serial no" },
                  { key: "itemName", label: "Item name" },
                  { key: "unitPrice", label: "Unit price" },
                  { key: "acquired", label: "Acquired" },
                  { key: "issued", label: "Issued" },
                  { key: "returned", label: "Returned" },
                  { key: "adjustedOut", label: "Adjusted out" },
                  { key: "balance", label: "Balance" },
                  { key: "stockValue", label: "Stock value" },
                ]}
                rows={inventoryItems.map((item, index) => ({
                  id: item.serialNumber,
                  sn: index + 1,
                  serialNumber: item.serialNumber,
                  itemName: item.itemName,
                  unitPrice: formatAmount(item.unitPrice),
                  acquired: item.acquiredQuantity,
                  issued: item.issuedQuantity,
                  returned: item.returnedQuantity ?? 0,
                  adjustedOut: item.adjustedOutQuantity ?? 0,
                  balance: item.availableQuantity,
                  stockValue: formatAmount(item.stockValue),
                }))}
                emptyMessage="No stock recorded yet."
              />
            </div>
          </div>

          <div className="space-y-6">
            <div className="subpanel">
              <p className="metric-label">Trade summary sheet</p>
              <div className="mt-4">
                <SpreadsheetTable
                  columns={[
                    { key: "heading", label: "Row heading" },
                    { key: "value", label: "Value" },
                  ]}
                  rows={[
                    {
                      id: "acquisition",
                      heading: "Total acquisition cost",
                      value: formatAmount(storeInventory?.totalAcquisitionCost),
                    },
                    {
                      id: "requisition",
                      heading: "Total requisition cost",
                      value: formatAmount(storeInventory?.totalRequisitionCost),
                    },
                    {
                      id: "return",
                      heading: "Total return value",
                      value: formatAmount(storeInventory?.totalReturnCost),
                    },
                    {
                      id: "adjustment",
                      heading: "Total adjustment value",
                      value: formatAmount(storeInventory?.totalAdjustmentCost),
                    },
                    {
                      id: "stock-value",
                      heading: "Current stock value",
                      value: formatAmount(storeInventory?.totalStockValue),
                    },
                    {
                      id: "stock-quantity",
                      heading: "Stock quantity on hand",
                      value: storeInventory?.totalStockQuantity ?? 0,
                    },
                  ]}
                  emptyMessage="No trade summary available yet."
                />
              </div>
            </div>

            <div className="subpanel">
              <p className="metric-label">Low stock watchlist sheet</p>
              <div className="mt-4">
                <SpreadsheetTable
                  columns={[
                    { key: "sn", label: "S/N" },
                    { key: "serialNumber", label: "Serial no" },
                    { key: "itemName", label: "Item name" },
                    { key: "balance", label: "Balance left" },
                  ]}
                  rows={lowStockItems.map((item, index) => ({
                    id: item.serialNumber,
                    sn: index + 1,
                    serialNumber: item.serialNumber,
                    itemName: item.itemName,
                    balance: item.availableQuantity,
                  }))}
                  emptyMessage="No low stock items right now."
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
