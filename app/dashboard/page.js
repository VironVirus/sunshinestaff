"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PortalLogo from "@/components/PortalLogo";
import ActivityLogPanel from "@/components/dashboard/ActivityLogPanel";
import EventsBookingsPanel from "@/components/dashboard/EventsBookingsPanel";
import HousekeepingStatusPanel from "@/components/dashboard/HousekeepingStatusPanel";
import InformationPanel from "@/components/dashboard/InformationPanel";
import InventoryPanel from "@/components/dashboard/InventoryPanel";
import NightDutyPanel from "@/components/dashboard/NightDutyPanel";
import NotificationsPanel, {
  canSeeNotification,
} from "@/components/dashboard/NotificationsPanel";
import OperationsPanel from "@/components/dashboard/OperationsPanel";
import PropertyPanel from "@/components/dashboard/PropertyPanel";
import RoomComplaintsPanel from "@/components/dashboard/RoomComplaintsPanel";
import StaffDashboardPanel from "@/components/dashboard/StaffDashboardPanel";
import StaffManagementPanel from "@/components/dashboard/StaffManagementPanel";
import TeamSchedulePanel from "@/components/dashboard/TeamSchedulePanel";
import { useAuth } from "@/context/AuthContext";
import { usePortalData } from "@/hooks/usePortalData";
import { toInitials } from "@/lib/format";
import {
  getAuditLogAccess,
  formatJobLevel,
  getAccessLabel,
  getDepartment,
  getHousekeepingReportAccess,
  getManagerWorkspaceAccess,
  getNightDutyAccess,
  getOperationsAccess,
  isLead,
  operationsMetricConfig,
} from "@/lib/roles";

function MetricCard({ label, value }) {
  return (
    <div className="subpanel min-w-[14rem] md:min-w-0">
      <span className="metric-label">{label}</span>
      <span className="metric-value">
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
    </div>
  );
}

function MobileSectionTabs({ sections, activeKey, onChange }) {
  return (
    <div className="mobile-section-tabs md:hidden">
      {sections.map((section) => (
        <button
          key={section.key}
          type="button"
          onClick={() => onChange(section.key)}
          className={`mobile-section-tab ${
            activeKey === section.key ? "mobile-section-tab-active" : ""
          }`}
        >
          {section.label}
        </button>
      ))}
    </div>
  );
}

function TabButton({ active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-3 text-sm font-semibold transition ${
        active
          ? "bg-[#162338] text-white"
          : "bg-white text-slate-600 hover:text-[#162338]"
      }`}
    >
      {label}
    </button>
  );
}

function NotificationBell({ count, onClick, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex h-14 w-14 items-center justify-center rounded-full border transition no-print ${
        active
          ? "border-[#162338] bg-[#162338] text-white"
          : "border-amber-200 bg-amber-50 text-[#162338]"
      }`}
      aria-label="Open notifications"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-6 w-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
        <path d="M9.5 17a2.5 2.5 0 0 0 5 0" />
      </svg>
      {count > 0 ? (
        <>
          <span className="absolute -right-1 -top-1 inline-flex min-h-6 min-w-6 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-white">
            {count > 99 ? "99+" : count}
          </span>
          <span className="absolute -right-1 -top-1 h-6 w-6 animate-ping rounded-full bg-rose-400 opacity-70" />
        </>
      ) : null}
    </button>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, profile, loading, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const {
    highlights,
    birthdays,
    operations,
    propertyStatus,
    eventsBookings,
    housekeepingReports,
    storeInventory,
    nightDutyData,
    siteContent,
    notifications,
    activityLogs,
    staffDirectory,
    teamMembers,
    departmentShifts,
    syncing,
    error,
    saveOperations,
    saveHousekeepingProgress,
    saveRoomIssues,
    saveRoomComplaints,
    saveUtilities,
    saveEventBooking,
    saveHousekeepingReports,
    saveStoreAcquisition,
    saveStoreRequisition,
    saveStoreReturn,
    saveStoreAdjustment,
    saveNightDutyData,
    saveStaffProfile,
    saveShiftAssignment,
    removeShiftAssignment,
  } = usePortalData(profile);
  const [activeTab, setActiveTab] = useState("work");
  const [activeWorkSection, setActiveWorkSection] = useState("rooms");
  const [activeInformationSection, setActiveInformationSection] = useState("staff");
  const [lastSeenNotificationAt, setLastSeenNotificationAt] = useState("");

  const currentDepartment =
    getDepartment(profile?.departmentKey) ?? {
      name: "Department",
    };
  const operationsAccess = getOperationsAccess(profile);
  const housekeepingReportAccess = getHousekeepingReportAccess(profile);
  const nightDutyAccess = getNightDutyAccess(profile);
  const managerWorkspaceAccess = getManagerWorkspaceAccess(profile);
  const auditLogAccess = getAuditLogAccess(profile);
  const canViewManagerTabs = managerWorkspaceAccess.canViewTabs;
  const canViewEventsTab = managerWorkspaceAccess.canViewEvents;
  const canViewStorePanel = managerWorkspaceAccess.canViewStore;
  const canViewHousekeepingReports = housekeepingReportAccess.canViewPanel;
  const canViewNightDutyPanel = nightDutyAccess.canViewPanel;
  const myShiftsCount = departmentShifts.filter((shift) => shift.userId === profile?.uid).length;
  const visibleNotifications = useMemo(
    () => (notifications ?? []).filter((notification) => canSeeNotification(notification, profile)),
    [notifications, profile],
  );
  const newNotificationCount = useMemo(
    () =>
      visibleNotifications.filter(
        (notification) =>
          notification.createdAt &&
          notification.createdAt > (lastSeenNotificationAt || ""),
      ).length,
    [lastSeenNotificationAt, visibleNotifications],
  );
  const tabOptions = canViewManagerTabs
    ? [
        { key: "work", label: "Work" },
        { key: "information", label: "Information" },
        { key: "notifications", label: "Notifications" },
        ...(canViewEventsTab ? [{ key: "events", label: "Events and Bookings" }] : []),
      ]
    : [
        { key: "staff", label: "Staff Dashboard" },
        { key: "notifications", label: "Notifications" },
      ];
  const selectedTab = tabOptions.some((tab) => tab.key === activeTab)
    ? activeTab
    : tabOptions[0].key;

  useEffect(() => {
    if (!profile?.uid || typeof window === "undefined") {
      return;
    }

    try {
      const rawValue = window.localStorage.getItem("sunshine_staff_notifications_seen");
      const seenMap = rawValue ? JSON.parse(rawValue) : {};
      setLastSeenNotificationAt(seenMap[profile.uid] ?? "");
    } catch {
      setLastSeenNotificationAt("");
    }
  }, [profile?.uid]);

  useEffect(() => {
    if (
      selectedTab !== "notifications" ||
      !profile?.uid ||
      visibleNotifications.length === 0 ||
      typeof window === "undefined"
    ) {
      return;
    }

    const latestNotificationTime = visibleNotifications[0]?.createdAt ?? "";

    if (!latestNotificationTime || latestNotificationTime === lastSeenNotificationAt) {
      return;
    }

    try {
      const rawValue = window.localStorage.getItem("sunshine_staff_notifications_seen");
      const seenMap = rawValue ? JSON.parse(rawValue) : {};
      seenMap[profile.uid] = latestNotificationTime;
      window.localStorage.setItem(
        "sunshine_staff_notifications_seen",
        JSON.stringify(seenMap),
      );
      setLastSeenNotificationAt(latestNotificationTime);
    } catch {
      setLastSeenNotificationAt(latestNotificationTime);
    }
  }, [lastSeenNotificationAt, profile?.uid, selectedTab, visibleNotifications]);

  useEffect(() => {
    const currentStaffRecord = staffDirectory.find((staffMember) => staffMember.uid === profile?.uid);

    if (currentStaffRecord && currentStaffRecord.employmentStatus && currentStaffRecord.employmentStatus !== "active") {
      void logout().finally(() => {
        router.replace("/");
      });
    }
  }, [logout, profile?.uid, router, staffDirectory]);

  const summaryCards = useMemo(() => {
    if (!canViewManagerTabs) {
      return [
        { label: "Department", value: currentDepartment.name },
        {
          label: "Staff title",
          value: profile?.staffTitle || formatJobLevel(profile?.jobLevel),
        },
        { label: "Shifts", value: myShiftsCount },
        {
          label: "Leave eligibility",
          value: profile?.leaveEligibility?.trim() || "Not set",
        },
      ];
    }

    if (canViewStorePanel && profile?.departmentKey === "store") {
      return [
        { label: "Stock items", value: storeInventory?.stockedItems ?? 0 },
        { label: "Stock quantity", value: storeInventory?.totalStockQuantity ?? 0 },
        { label: "Issued quantity", value: storeInventory?.totalIssuedQuantity ?? 0 },
        { label: "Low stock", value: storeInventory?.lowStockItems?.length ?? 0 },
      ];
    }

    const cards = operationsAccess.visibleMetrics.slice(0, 3).map((metricKey) => ({
      label: operationsMetricConfig[metricKey]?.shortLabel ?? metricKey,
      value: operations?.[metricKey] ?? 0,
    }));

    cards.push({
      label: "Team",
      value: isLead(profile) ? teamMembers.length : myShiftsCount,
    });

    while (cards.length < 4) {
      if (!cards.some((card) => card.label === "Department")) {
        cards.push({ label: "Department", value: currentDepartment.name });
        continue;
      }

      if (!cards.some((card) => card.label === "Staff title")) {
        cards.push({
          label: "Staff title",
          value: profile?.staffTitle || formatJobLevel(profile?.jobLevel),
        });
        continue;
      }

      cards.push({
        label: "Access",
        value: getAccessLabel(profile),
      });
    }

    return cards.slice(0, 4);
  }, [
    canViewManagerTabs,
    currentDepartment.name,
    myShiftsCount,
    operations,
    canViewStorePanel,
    operationsAccess.visibleMetrics,
    profile,
    storeInventory?.lowStockItems?.length,
    storeInventory?.stockedItems,
    storeInventory?.totalIssuedQuantity,
    storeInventory?.totalStockQuantity,
    teamMembers.length,
  ]);

  if (loading || syncing) {
    return (
      <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4 py-10">
        <div className="panel w-full max-w-xl p-8 text-center">
          <h2 className="section-title">Loading</h2>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (!profile) {
    return (
      <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4 py-10">
        <div className="panel w-full max-w-xl p-8 text-center">
          <h2 className="section-title">Profile missing</h2>
          <button
            type="button"
            onClick={() => router.replace("/")}
            className="button-primary mt-6"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  async function handleLogout() {
    setSigningOut(true);

    try {
      await logout();
      router.replace("/");
    } finally {
      setSigningOut(false);
    }
  }

  function renderManagerWorkTab() {
    const sections = [
      ...(canViewStorePanel
        ? [
            {
              key: "inventory",
              label: "Inventory",
              content: (
                <InventoryPanel
                  profile={profile}
                  storeInventory={storeInventory}
                  onSaveAcquisition={saveStoreAcquisition}
                  onSaveRequisition={saveStoreRequisition}
                  onSaveReturn={saveStoreReturn}
                  onSaveAdjustment={saveStoreAdjustment}
                />
              ),
            },
          ]
        : []),
      ...(canViewNightDutyPanel
        ? [
            {
              key: "night-duty",
              label: "Night Duty",
              content: (
                <NightDutyPanel
                  profile={profile}
                  operations={operations}
                  eventsBookings={eventsBookings}
                  propertyStatus={propertyStatus}
                  nightDutyData={nightDutyData}
                  onSaveNightDuty={saveNightDutyData}
                  onSaveUtilities={saveUtilities}
                />
              ),
            },
          ]
        : []),
      ...(canViewHousekeepingReports
        ? [
            {
              key: "housekeeping-reports",
              label: "HouseKeeping Reports",
              content: (
                <HousekeepingStatusPanel
                  profile={profile}
                  housekeepingReports={housekeepingReports}
                  propertyStatus={propertyStatus}
                  operations={operations}
                  onSaveHousekeepingReports={saveHousekeepingReports}
                />
              ),
            },
          ]
        : []),
      ...(operationsAccess.canViewPanel
        ? [
            {
              key: "rooms",
              label: "Rooms",
              content: (
                <OperationsPanel
                  profile={profile}
                  operations={operations}
                  propertyStatus={propertyStatus}
                  eventsBookings={eventsBookings}
                  onSaveFrontOffice={saveOperations}
                  onSaveHousekeeping={saveHousekeepingProgress}
                />
              ),
            },
          ]
        : []),
      ...(operationsAccess.canViewPanel || profile?.isSuperAdmin
        ? [
            {
              key: "complaints",
              label: "Complaints",
              content: (
                <RoomComplaintsPanel
                  profile={profile}
                  propertyStatus={propertyStatus}
                  onSaveRoomComplaints={saveRoomComplaints}
                />
              ),
            },
            {
              key: "property",
              label: "Property",
              content: (
                <PropertyPanel
                  profile={profile}
                  propertyStatus={propertyStatus}
                  onSaveRoomIssues={saveRoomIssues}
                  onSaveUtilities={saveUtilities}
                />
              ),
            },
          ]
        : []),
      ...(isLead(profile) || profile?.isSuperAdmin
        ? [
            {
              key: "team",
              label: "Team",
              content: (
                <TeamSchedulePanel
                  profile={profile}
                  teamMembers={teamMembers}
                  departmentShifts={departmentShifts}
                  onSaveShift={saveShiftAssignment}
                  onRemoveShift={removeShiftAssignment}
                />
              ),
            },
          ]
        : []),
      ...(managerWorkspaceAccess.canManageStaff
        ? [
            {
              key: "staff",
              label: "Staff",
              content: (
                <StaffManagementPanel
                  profile={profile}
                  staffDirectory={staffDirectory}
                  onSaveStaffProfile={saveStaffProfile}
                />
              ),
            },
          ]
        : []),
      ...(auditLogAccess.canViewPanel
        ? [
            {
              key: "activity-log",
              label: "Time Stamp Log",
              content: <ActivityLogPanel activityLogs={activityLogs} />,
            },
          ]
        : []),
    ];
    const activeSection =
      sections.find((section) => section.key === activeWorkSection) ?? sections[0];

    return (
      <div className="space-y-6">
        <div className="md:hidden">
          <MobileSectionTabs
            sections={sections}
            activeKey={activeSection.key}
            onChange={setActiveWorkSection}
          />
          {activeSection.content}
        </div>

        <div className="hidden space-y-6 md:block">
          {sections.map((section) => (
            <div key={section.key}>{section.content}</div>
          ))}
        </div>

        {error ? (
          <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </div>
    );
  }

  function renderInformationTab() {
    const sections = [
      {
        key: "staff",
        label: "My Dashboard",
        content: <StaffDashboardPanel profile={profile} departmentShifts={departmentShifts} />,
      },
      {
        key: "news",
        label: "News",
        content: (
          <InformationPanel
            highlights={highlights}
            birthdays={birthdays}
            siteContent={siteContent}
          />
        ),
      },
    ];
    const activeSection =
      sections.find((section) => section.key === activeInformationSection) ?? sections[0];

    return (
      <div className="space-y-6">
        <div className="md:hidden">
          <MobileSectionTabs
            sections={sections}
            activeKey={activeSection.key}
            onChange={setActiveInformationSection}
          />
          {activeSection.content}
        </div>

        <div className="hidden space-y-6 md:block">
          {sections.map((section) => (
            <div key={section.key}>{section.content}</div>
          ))}
        </div>

        {error ? (
          <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </div>
    );
  }

  function renderEventsTab() {
    if (!canViewEventsTab) {
      return null;
    }

    return (
      <div className="space-y-6">
        <EventsBookingsPanel
          profile={profile}
          eventsBookings={eventsBookings}
          onSaveEventBooking={saveEventBooking}
        />

        {error ? (
          <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </div>
    );
  }

  function renderNotificationsTab() {
    return (
      <div className="space-y-6">
        <NotificationsPanel
          profile={profile}
          notifications={notifications}
          lastSeenNotificationAt={lastSeenNotificationAt}
        />

        {error ? (
          <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </div>
    );
  }

  function renderLineStaffView() {
    const sections = [
      {
        key: "staff",
        label: "My Dashboard",
        content: <StaffDashboardPanel profile={profile} departmentShifts={departmentShifts} />,
      },
      {
        key: "news",
        label: "Information",
        content: (
          <InformationPanel
            highlights={highlights}
            birthdays={birthdays}
            siteContent={siteContent}
          />
        ),
      },
    ];
    const activeSection =
      sections.find((section) => section.key === activeInformationSection) ?? sections[0];

    return (
      <div className="space-y-6">
        <div className="md:hidden">
          <MobileSectionTabs
            sections={sections}
            activeKey={activeSection.key}
            onChange={setActiveInformationSection}
          />
          {activeSection.content}
        </div>

        <div className="hidden space-y-6 md:block">
          {sections.map((section) => (
            <div key={section.key}>{section.content}</div>
          ))}
        </div>

        {error ? (
          <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="panel p-6 sm:p-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-start gap-4">
            <NotificationBell
              count={newNotificationCount}
              active={selectedTab === "notifications"}
              onClick={() => setActiveTab("notifications")}
            />
            <PortalLogo size="md" />
          </div>

          <div className="flex flex-col gap-4 xl:items-end">
            <div className="flex items-center gap-4">
              <div className="min-w-0 text-right">
                <h2 className="font-display text-3xl text-[#162338]">{profile.fullName}</h2>
                <p className="mt-1 break-all text-sm text-slate-500">{profile.email}</p>
              </div>
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#162338] text-lg font-semibold text-white">
                {toInitials(profile.fullName)}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 xl:justify-end">
              <span className="badge">{currentDepartment.name}</span>
              <span className="badge">{profile.staffTitle || formatJobLevel(profile.jobLevel)}</span>
              <span className="badge">{getAccessLabel(profile)}</span>
              <button
                type="button"
                onClick={handleLogout}
                className="button-secondary no-print"
              >
                {signingOut ? "Signing out..." : "Sign out"}
              </button>
            </div>
          </div>
        </div>
      </header>

      <section className="mt-6 flex gap-4 overflow-x-auto pb-2 md:grid md:grid-cols-2 md:overflow-visible md:pb-0 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <MetricCard key={card.label} label={card.label} value={card.value} />
        ))}
      </section>

      <section className="mt-6">
        <div className="no-print flex flex-wrap gap-3 rounded-[28px] bg-slate-100 p-2">
          {tabOptions.map((tab) => (
            <TabButton
              key={tab.key}
              label={tab.label}
              active={selectedTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
            />
          ))}
        </div>
      </section>

      <section className="mt-6">
        {!canViewManagerTabs
          ? selectedTab === "notifications"
            ? renderNotificationsTab()
            : renderLineStaffView()
          : selectedTab === "work"
            ? renderManagerWorkTab()
            : selectedTab === "information"
              ? renderInformationTab()
              : selectedTab === "notifications"
                ? renderNotificationsTab()
                : renderEventsTab()}
      </section>
    </div>
  );
}
