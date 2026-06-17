"use client";

import { formatBirthday, formatFriendlyDate } from "@/lib/format";

function DetailRow({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4">
      <p className="metric-label">{label}</p>
      <p className="mt-2 text-sm font-semibold text-[#162338]">{value}</p>
    </div>
  );
}

function formatShiftDate(value) {
  if (!value) {
    return "";
  }

  return formatFriendlyDate(new Date(value), {
    dateStyle: "full",
  });
}

export default function StaffDashboardPanel({ profile, departmentShifts }) {
  const myShifts = (departmentShifts ?? []).filter((shift) => shift.userId === profile?.uid);
  const hasProfileNotification =
    Boolean(profile?.lastProfileNotification?.trim());

  return (
    <section className="panel p-6">
      <h2 className="section-title">Staff Dashboard</h2>

      {hasProfileNotification ? (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
          <p className="font-semibold">Notification</p>
          <p className="mt-2">{profile.lastProfileNotification}</p>
          {profile.lastProfileNotificationAt ? (
            <p className="mt-2 text-xs text-amber-700">
              {formatFriendlyDate(new Date(profile.lastProfileNotificationAt), {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DetailRow label="Department" value={profile?.departmentName ?? "Not set"} />
        <DetailRow label="Staff title" value={profile?.staffTitle ?? "Not set"} />
        <DetailRow label="Birthday" value={formatBirthday(profile?.birthday)} />
        <DetailRow
          label="Leave eligibility"
          value={profile?.leaveEligibility?.trim() || "Not set"}
        />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DetailRow label="Phone number" value={profile?.phoneNumber?.trim() || "Not set"} />
        <DetailRow label="Home address" value={profile?.homeAddress?.trim() || "Not set"} />
        <DetailRow label="Surcharges" value={profile?.surcharges?.trim() || "Not set"} />
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4">
          <p className="metric-label">My shifts</p>
          <div className="mt-3 space-y-3">
            {myShifts.length > 0 ? (
              myShifts.map((shift) => (
                <div
                  key={shift.id}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-[#162338]"
                >
                  {formatShiftDate(shift.shiftDate)}
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
                No shifts assigned.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
