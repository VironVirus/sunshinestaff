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

export function canSeeNotification(notification, profile) {
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

export default function NotificationsPanel({
  profile,
  notifications,
  maxItems = Number.POSITIVE_INFINITY,
  lastSeenNotificationAt = "",
}) {
  const visibleNotifications = useMemo(
    () =>
      (notifications ?? [])
        .filter((notification) => canSeeNotification(notification, profile))
        .slice(0, maxItems),
    [maxItems, notifications, profile],
  );
  const unreadCount = useMemo(
    () =>
      visibleNotifications.filter(
        (notification) =>
          notification.createdAt && notification.createdAt > lastSeenNotificationAt,
      ).length,
    [lastSeenNotificationAt, visibleNotifications],
  );

  return (
    <section className="panel p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="section-title">Notifications</h2>
        <span className="badge">{visibleNotifications.length}</span>
      </div>

      {unreadCount > 0 ? (
        <div className="mt-5 rounded-2xl border border-amber-300 bg-gradient-to-r from-amber-100 via-amber-50 to-white px-4 py-4 text-sm text-amber-950 shadow-[0_12px_30px_rgba(245,158,11,0.12)]">
          <p className="font-semibold">
            {unreadCount} new update{unreadCount === 1 ? "" : "s"} waiting for you.
          </p>
          <p className="mt-1 text-amber-900/80">
            New alerts stay highlighted here until you open this page.
          </p>
        </div>
      ) : null}

      <div className="mt-5 space-y-3">
        {visibleNotifications.length > 0 ? (
          visibleNotifications.map((notification) => (
            <div
              key={notification.id}
              className={`rounded-2xl border px-4 py-4 ${
                notification.createdAt && notification.createdAt > lastSeenNotificationAt
                  ? "border-amber-300 bg-amber-50/90 shadow-[0_0_0_1px_rgba(251,191,36,0.28)]"
                  : "border-slate-200 bg-slate-50/80"
              }`}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-[#162338]">
                      {notification.title || "Update"}
                    </p>
                    {notification.createdAt && notification.createdAt > lastSeenNotificationAt ? (
                      <span className="rounded-full border border-amber-300 bg-amber-200/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-900">
                        New
                      </span>
                    ) : null}
                  </div>
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
            No notifications right now.
          </div>
        )}
      </div>
    </section>
  );
}
