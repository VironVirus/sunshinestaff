"use client";

import { useEffect, useMemo, useState } from "react";
import {
  defaultUtilities,
  getUtilityLabel,
  propertyUtilityFields,
} from "@/data/propertyStatus";
import { formatFriendlyDate } from "@/lib/format";
import { getPropertyAccess } from "@/lib/roles";

function formatUpdatedAt(value) {
  if (!value) {
    return "";
  }

  const dateValue = typeof value?.toDate === "function" ? value.toDate() : new Date(value);

  if (Number.isNaN(dateValue.getTime())) {
    return "";
  }

  return formatFriendlyDate(dateValue, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function getTankLevelTone(value) {
  switch (value) {
    case "full":
      return {
        card: "border-emerald-300 bg-emerald-50",
        chip: "bg-emerald-600 text-white",
        bar: "bg-emerald-500",
        text: "text-emerald-900",
        fill: "100%",
      };
    case "three_quarter":
      return {
        card: "border-lime-300 bg-lime-50",
        chip: "bg-lime-600 text-white",
        bar: "bg-lime-500",
        text: "text-lime-900",
        fill: "75%",
      };
    case "half":
      return {
        card: "border-amber-300 bg-amber-50",
        chip: "bg-amber-500 text-white",
        bar: "bg-amber-400",
        text: "text-amber-900",
        fill: "50%",
      };
    case "low":
      return {
        card: "border-orange-300 bg-orange-50",
        chip: "bg-orange-500 text-white",
        bar: "bg-orange-400",
        text: "text-orange-900",
        fill: "25%",
      };
    case "empty":
      return {
        card: "border-rose-300 bg-rose-50",
        chip: "bg-rose-600 text-white",
        bar: "bg-rose-500",
        text: "text-rose-900",
        fill: "8%",
      };
    default:
      return {
        card: "border-slate-200 bg-slate-50",
        chip: "bg-slate-500 text-white",
        bar: "bg-slate-400",
        text: "text-slate-900",
        fill: "0%",
      };
  }
}

function getEedcTone(value) {
  const units = Math.max(Number(value) || 0, 0);

  if (units >= 300) {
    return {
      card: "border-emerald-300 bg-emerald-50",
      chip: "bg-emerald-600 text-white",
      bar: "bg-emerald-500",
      text: "text-emerald-900",
      fill: "100%",
    };
  }

  if (units >= 200) {
    return {
      card: "border-lime-300 bg-lime-50",
      chip: "bg-lime-600 text-white",
      bar: "bg-lime-500",
      text: "text-lime-900",
      fill: "75%",
    };
  }

  if (units >= 100) {
    return {
      card: "border-amber-300 bg-amber-50",
      chip: "bg-amber-500 text-white",
      bar: "bg-amber-400",
      text: "text-amber-900",
      fill: "50%",
    };
  }

  if (units > 0) {
    return {
      card: "border-orange-300 bg-orange-50",
      chip: "bg-orange-500 text-white",
      bar: "bg-orange-400",
      text: "text-orange-900",
      fill: "25%",
    };
  }

  return {
    card: "border-rose-300 bg-rose-50",
    chip: "bg-rose-600 text-white",
    bar: "bg-rose-500",
    text: "text-rose-900",
    fill: "8%",
  };
}

function getUtilityTone(fieldKey, value) {
  if (fieldKey === "eedcLevel") {
    return getEedcTone(value);
  }

  return getTankLevelTone(value);
}

function UtilityCard({ field, value }) {
  const tone = getUtilityTone(field.key, value);
  const displayValue = getUtilityLabel(field.key, value);

  return (
    <div className={`rounded-[24px] border p-5 shadow-sm ${tone.card}`}>
      <div className="flex items-center justify-between gap-3">
        <p className={`text-sm font-semibold ${tone.text}`}>{field.label}</p>
        <span className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ${tone.chip}`}>
          {displayValue}
        </span>
      </div>

      <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/80">
        <div
          className={`h-full rounded-full transition-all ${tone.bar}`}
          style={{ width: tone.fill }}
        />
      </div>
    </div>
  );
}

export default function PropertyPanel({
  profile,
  propertyStatus,
  onSaveUtilities,
}) {
  const access = getPropertyAccess(profile);
  const utilities = useMemo(
    () => propertyStatus?.utilities ?? defaultUtilities,
    [propertyStatus?.utilities],
  );
  const [utilityForm, setUtilityForm] = useState(defaultUtilities);
  const [savingUtilities, setSavingUtilities] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });

  useEffect(() => {
    setUtilityForm({
      ...defaultUtilities,
      ...utilities,
    });
  }, [utilities]);

  if (!access.canViewUtilities) {
    return null;
  }

  async function handleSaveUtilities(event) {
    event.preventDefault();
    setSavingUtilities(true);
    setFeedback({ type: "", message: "" });

    try {
      await onSaveUtilities({
        utilities: utilityForm,
      });
      setFeedback({ type: "success", message: "Utility levels updated." });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setSavingUtilities(false);
    }
  }

  return (
    <section className="panel p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="section-title">Utilities</h2>
        <span className="badge">{propertyUtilityFields.length} tracked</span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {propertyUtilityFields.map((field) => (
          <UtilityCard key={field.key} field={field} value={utilities[field.key]} />
        ))}
      </div>

      {propertyStatus?.utilitiesUpdatedByName || propertyStatus?.utilitiesUpdatedAt ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-xs text-slate-600">
          {propertyStatus.utilitiesUpdatedByName
            ? `Updated by ${propertyStatus.utilitiesUpdatedByName}`
            : ""}
          {propertyStatus.utilitiesUpdatedByDepartment
            ? ` - ${propertyStatus.utilitiesUpdatedByDepartment}`
            : ""}
          {formatUpdatedAt(propertyStatus.utilitiesUpdatedAt)
            ? ` - ${formatUpdatedAt(propertyStatus.utilitiesUpdatedAt)}`
            : ""}
        </div>
      ) : null}

      {access.canEditUtilities ? (
        <form onSubmit={handleSaveUtilities} className="subpanel mt-6 no-print">
          <p className="metric-label">Update utility levels</p>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {propertyUtilityFields.map((field) => (
              <label key={field.key} className="field">
                <span>{field.label}</span>
                {field.inputType === "number" ? (
                  <input
                    type="number"
                    min="0"
                    value={utilityForm[field.key] ?? ""}
                    onChange={(event) =>
                      setUtilityForm((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                    disabled={savingUtilities}
                  />
                ) : (
                  <select
                    value={utilityForm[field.key] ?? ""}
                    onChange={(event) =>
                      setUtilityForm((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                    disabled={savingUtilities}
                  >
                    <option value="">Select level</option>
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            ))}
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

          <button
            type="submit"
            disabled={savingUtilities}
            className="button-primary mt-5 w-full"
          >
            {savingUtilities ? "Saving..." : "Save utility levels"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
