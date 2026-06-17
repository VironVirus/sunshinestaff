"use client";

import { useMemo } from "react";
import { formatFriendlyDate } from "@/lib/format";
import {
  getHousekeepingReportAccess,
  getManagerWorkspaceAccess,
  getNightDutyAccess,
  getOperationsAccess,
  getPropertyAccess,
  getStoreAccess,
} from "@/lib/roles";

function canSeeNotification(notification, profile) {
  if (!notification) {
    return false;
  }

  if (notification.relatedUserId && notification.relatedUserId === profile?.uid) {
    return true;
  }

  const audienceTag = notification.audienceTag ?? "all";

  if (audienceTag === "all") {
    return true;
  }

  if (audienceTag === "operations") {
    return getOperationsAccess(profile).canViewPanel;
  }

  if (audienceTag === "events") {
    return getManagerWorkspaceAccess(profile).canViewEvents;
  }

  if (audienceTag === "housekeeping_reports") {
    return getHousekeepingReportAccess(profile).canViewPanel;
  }

  if (audienceTag === "property") {
    return getPropertyAccess(profile).canViewPanel;
  }

  if (audienceTag === "store") {
    return getStoreAccess(profile).canViewPanel;
  }

  if (audienceTag === "night-duty") {
    return getNightDutyAccess(profile).canViewPanel;
  }

  return false;
}

export default function NotificationsPanel({ profile, notifications }) {
  const visibleNotifications = useMemo(
    () =>
      (notifications ?? [])
        .filter((notification) => canSeeNotification(notification, profile))
        .slice(0, 8),
    [notifications, profile],
  );

  return (
    <section className="panel p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="section-title">Notifications</h2>
        <span className="badge">{visibleNotifications.length}</span>
      </div>

      <div className="mt-5 space-y-3">
        {visibleNotifications.length > 0 ? (
          visibleNotifications.map((notification) => (
            <div
              key={notification.id}
              className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold text-[#162338]">
                    {notification.title || "Update"}
                  </p>
                  <p className="mt-2 text-sm text-slate-600">{notification.message}</p>
                  {(notification.actorName || notification.actorDepartment) ? (
                    <p className="mt-2 text-xs text-slate-500">
                      {notification.actorName || "Portal"}
                      {notification.actorDepartment ? ` - ${notification.actorDepartment}` : ""}
                    </p>
                  ) : null}
                </div>

                <span className="text-xs font-medium text-slate-500">
                  {notification.createdAt
                    ? formatFriendlyDate(new Date(notification.createdAt), {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : ""}
                </span>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-500">
            No new notifications right now.
          </div>
        )}
      </div>
    </section>
  );
}
