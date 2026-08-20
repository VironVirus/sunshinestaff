"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "@firebase/firestore";
import {
  defaultBirthdays,
  defaultFrontOfficeSnapshot,
  defaultHighlights,
  defaultSiteContent,
} from "@/data/mockData";
import {
  guestRoomCount,
  deriveOperationsSnapshot,
  getRoomRecord,
  hotelRooms,
  normalizeRoomNumbers,
} from "@/data/hotelRooms";
import {
  buildRoomPropertyStatusRecord,
  getRoomPropertyStatusDocumentId,
} from "@/data/roomPropertyStatus";
import { defaultPropertyStatus, mergePropertyStatus } from "@/data/propertyStatus";
import { defaultEventsBookings, mergeEventsBookings } from "@/data/eventsBookings";
import {
  buildDefaultHousekeepingReports,
  mergeHousekeepingReports,
} from "@/data/housekeepingReports";
import {
  buildInHouseReport,
  normalizeStoredInHouseReport,
} from "@/data/inHouseReports";
import { defaultStoreInventory, mergeStoreInventory } from "@/data/storeInventory";
import {
  defaultNightDutyData,
  getNightDutyReportDateKey,
  mergeNightDutyData,
  normalizeStoredNightDutyReport,
} from "@/data/nightDuty";
import {
  archiveRecord,
  archiveRecordBatch,
  hasCloudflareArchiveConfig,
  loadArchivedRange,
  loadArchivedRecord,
  loadArchivedRevisions,
} from "@/lib/cloudflareArchive";
import { db, hasFirebaseConfig } from "@/lib/firebase";
import { getOperationalDateKey, listDateKeysInRange } from "@/lib/hotelTime";
import {
  getAuditLogAccess,
  getHousekeepingReportAccess,
  getNightDutyAccess,
  getManagerWorkspaceAccess,
  getOperationsAccess,
  getPropertyAccess,
  getRoomPropertyStatusAccess,
  getStoreAccess,
  canManageOperationsTargets,
  isSuperAdmin,
} from "@/lib/roles";

const defaultPortalState = {
  highlights: defaultHighlights,
  birthdays: defaultBirthdays,
  operations: deriveOperationsSnapshot(defaultFrontOfficeSnapshot),
  propertyStatus: defaultPropertyStatus,
  eventsBookings: defaultEventsBookings,
  housekeepingReports: mergeHousekeepingReports(buildDefaultHousekeepingReports()),
  storeInventory: mergeStoreInventory(defaultStoreInventory),
  nightDutyData: mergeNightDutyData(defaultNightDutyData),
  nightDutyReportHistory: [],
  operationsTargets: { monthlyTargets: {} },
  siteContent: defaultSiteContent,
  notifications: [],
  activityLogs: [],
  staffDirectory: [],
  teamMembers: [],
  departmentShifts: [],
};

const MAX_REPORT_HISTORY_DAYS = 120;
const MAX_VISIBLE_NIGHT_DUTY_REPORTS = 31;
const MAX_OPERATIONS_ACTIVITY = 300;
const MAX_VISIBLE_NOTIFICATIONS = 80;
const MAX_VISIBLE_ACTIVITY_LOGS = 200;

function buildArchivePayload(record = {}) {
  const payload = { ...record };
  [
    "id",
    "updatedAt",
    "generatedAt",
    "groupedStaff",
    "incomeSections",
    "grandIncomeTotal",
    "actualRevenueTotal",
    "occupancyTotal",
  ].forEach((fieldName) => delete payload[fieldName]);

  return payload;
}

function buildArchiveRecord(recordType, recordKey, operationalDate, report) {
  const payload = buildArchivePayload(report);

  return {
    recordType,
    recordKey,
    operationalDate,
    sourceUpdatedAt: payload.updatedAtIso ?? "",
    payload,
  };
}

function normalizeOperationsRoomMoves(roomMoves = []) {
  return (Array.isArray(roomMoves) ? roomMoves : [])
    .filter(
      (roomMove) =>
        roomMove?.id &&
        roomMove?.fromRoomNumber &&
        roomMove?.toRoomNumber &&
        roomMove?.operationalDateKey,
    )
    .sort((left, right) => {
      const leftTime = new Date(left.movedAt ?? 0).getTime();
      const rightTime = new Date(right.movedAt ?? 0).getTime();
      return rightTime - leftTime;
    })
    .slice(0, 500);
}

function normalizeOperationsActivityEntries(activityEntries = []) {
  return (Array.isArray(activityEntries) ? activityEntries : [])
    .filter((entry) => entry?.id && entry?.actionType && entry?.createdAt)
    .sort((left, right) => getSafeSortText(right.createdAt).localeCompare(getSafeSortText(left.createdAt)))
    .slice(0, MAX_OPERATIONS_ACTIVITY);
}

function normalizeNotifications(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => typeof entry?.createdAt === "string" && typeof entry?.message === "string")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, MAX_VISIBLE_NOTIFICATIONS);
}

function normalizeActivityLogs(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => typeof entry?.createdAt === "string" && typeof entry?.message === "string")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, MAX_VISIBLE_ACTIVITY_LOGS);
}

function normalizeOperationsReportHistory(reportHistory = []) {
  return (Array.isArray(reportHistory) ? reportHistory : [])
    .filter((reportEntry) => reportEntry?.dateKey)
    .sort((left, right) => right.dateKey.localeCompare(left.dateKey))
    .filter(
      (reportEntry, index, current) =>
        current.findIndex((candidate) => candidate.dateKey === reportEntry.dateKey) === index,
    )
    .slice(0, MAX_REPORT_HISTORY_DAYS);
}

function buildDailyReportEntry(snapshot, profile) {
  return {
    dateKey: snapshot.operationalDateKey,
    inHouse: snapshot.inHouse ?? 0,
    availableRooms: snapshot.availableRooms ?? 0,
    outOfOrderRoomNumbers: snapshot.outOfOrderRoomNumbers ?? [],
    breakfastEntitled: snapshot.breakfastEntitled ?? 0,
    cleanedRooms: snapshot.cleanedRooms ?? 0,
    occupiedRoomNumbers: snapshot.occupiedRoomNumbers ?? [],
    cleanedRoomNumbers: snapshot.cleanedRoomNumbers ?? [],
    otherCleanedAreas: snapshot.otherCleanedAreas ?? [],
    updatedAt: new Date().toISOString(),
    updatedByName: profile?.fullName ?? "",
    updatedByDepartment: profile?.departmentName ?? "",
  };
}

function hasCompleteClassifiedRoomData(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source.operationalDateKey ?? "")) return false;
  const occupiedRooms = Array.isArray(source.occupiedRooms)
    ? source.occupiedRooms
    : [];
  const occupiedRoomNumbers = Array.isArray(source.occupiedRoomNumbers)
    ? source.occupiedRoomNumbers
    : [];
  const expectedRoomCount = Number.isFinite(Number(source.inHouse))
    ? Number(source.inHouse)
    : occupiedRoomNumbers.length;

  return occupiedRooms.length === expectedRoomCount &&
    occupiedRooms.every((room) =>
      room?.roomNumber && ["walk_in", "corporate"].includes(room?.guestType),
    );
}

function upsertOperationsReportHistory(reportHistory = [], snapshot, profile) {
  if (!snapshot?.operationalDateKey) {
    return normalizeOperationsReportHistory(reportHistory);
  }

  const nextEntry = buildDailyReportEntry(snapshot, profile);

  return normalizeOperationsReportHistory([
    nextEntry,
    ...reportHistory.filter((reportEntry) => reportEntry.dateKey !== nextEntry.dateKey),
  ]);
}

function mergeHighlights(payload = {}) {
  return {
    ...defaultHighlights,
    ...payload,
    staffOfWeek: {
      ...defaultHighlights.staffOfWeek,
      ...(payload.staffOfWeek ?? {}),
    },
    staffOfMonth: {
      ...defaultHighlights.staffOfMonth,
      ...(payload.staffOfMonth ?? {}),
    },
  };
}

function mergeOperations(payload = {}) {
  const mergedOperations = deriveOperationsSnapshot({
    ...defaultFrontOfficeSnapshot,
    ...payload,
  });

  return {
    ...mergedOperations,
    activityEntries: normalizeOperationsActivityEntries(payload.activityEntries ?? []),
  };
}

function mergeSiteContent(payload = {}) {
  return {
    ...defaultSiteContent,
    ...payload,
    announcements: Array.isArray(payload.announcements) ? payload.announcements.slice(0, 100) : [],
    newsItems: Array.isArray(payload.newsItems) ? payload.newsItems.slice(0, 100) : [],
  };
}

function mergeOperationsWithPropertyStatus(rawOperations = {}, propertyStatusPayload = {}) {
  const baseOperations = mergeOperations(rawOperations);
  const propertyStatus = mergePropertyStatus(propertyStatusPayload);
  const outOfOrderRoomNumbers = normalizeRoomNumbers(
    propertyStatus.roomIssues.map((roomIssue) => roomIssue.roomNumber),
  );
  const outOfOrderRoomSet = new Set(outOfOrderRoomNumbers);
  const occupiedRooms = baseOperations.occupiedRooms.filter(
    (room) => !outOfOrderRoomSet.has(room.roomNumber),
  );
  const occupiedRoomNumbers = occupiedRooms.map((room) => room.roomNumber);
  const cleanedRoomNumbers = baseOperations.cleanedRoomNumbers.filter(
    (roomNumber) => !outOfOrderRoomSet.has(roomNumber),
  );

  return {
    ...baseOperations,
    occupiedRooms,
    occupiedRoomNumbers,
    inHouse: occupiedRooms.length,
    breakfastEntitled: occupiedRooms.reduce(
      (total, room) => total + (room.breakfastIncluded ? room.breakfastCount : 0),
      0,
    ),
    cleanedRoomNumbers,
    cleanedRooms: cleanedRoomNumbers.length,
    outOfOrderRoomNumbers,
    availableRooms: Math.max(guestRoomCount - outOfOrderRoomNumbers.length, 0),
  };
}

function sortBirthdays(birthdays = []) {
  const today = new Date();
  const currentYear = today.getFullYear();

  return birthdays
    .filter((birthday) => birthday.date)
    .map((birthday) => {
      const date = new Date(birthday.date);

      if (Number.isNaN(date.getTime())) {
        return null;
      }

      const nextBirthday = new Date(currentYear, date.getMonth(), date.getDate());

      if (nextBirthday < new Date(currentYear, today.getMonth(), today.getDate())) {
        nextBirthday.setFullYear(currentYear + 1);
      }

      return {
        ...birthday,
        nextBirthday,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.nextBirthday - right.nextBirthday)
    .map(({ nextBirthday, ...birthday }) => birthday);
}

function buildBirthdaysFromUsers(users = []) {
  return sortBirthdays(
    users.map((user) => ({
      id: user.uid,
      name: user.fullName,
      department: user.departmentName,
      date: user.birthday ?? "",
    })),
  );
}

function normalizeShifts(shifts = []) {
  return (Array.isArray(shifts) ? shifts : [])
    .filter((shift) => shift?.id && shift?.userId && shift?.shiftDate)
    .sort((left, right) => left.shiftDate.localeCompare(right.shiftDate))
    .slice(0, 400);
}

function getSafeSortText(value, fallback = "") {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return fallback;
  }

  return String(value);
}

function applyKeyedArrayDelta(currentEntries, baselineEntries, desiredEntries, getKey) {
  const current = Array.isArray(currentEntries) ? currentEntries : [];
  const baseline = Array.isArray(baselineEntries) ? baselineEntries : [];
  const desired = Array.isArray(desiredEntries) ? desiredEntries : [];
  const baselineMap = new Map(baseline.map((entry) => [getKey(entry), entry]));
  const desiredMap = new Map(desired.map((entry) => [getKey(entry), entry]));
  const removedKeys = new Set(
    baseline.filter((entry) => !desiredMap.has(getKey(entry))).map(getKey),
  );
  const changedMap = new Map(
    desired
      .filter((entry) => {
        const previous = baselineMap.get(getKey(entry));
        return !previous || JSON.stringify(previous) !== JSON.stringify(entry);
      })
      .map((entry) => [getKey(entry), entry]),
  );

  return [
    ...current.filter((entry) => {
      const key = getKey(entry);
      return !removedKeys.has(key) && !changedMap.has(key);
    }),
    ...changedMap.values(),
  ];
}

function isActiveStaff(user = {}) {
  return (user.employmentStatus ?? "active") === "active";
}

function isApprovedStaff(user = {}) {
  return user.approvalStatus === "approved";
}

function getNotificationAudienceTags({
  canViewOperations,
  canViewEvents,
  canViewHousekeeping,
  canViewProperty,
  canViewStore,
  canViewNightDuty,
}) {
  const tags = ["all"];
  if (canViewOperations) tags.push("operations");
  if (canViewEvents) tags.push("events");
  if (canViewHousekeeping) tags.push("housekeeping_reports");
  if (canViewProperty) tags.push("property");
  if (canViewStore) tags.push("store");
  if (canViewNightDuty) tags.push("night-duty");
  return tags;
}

export function usePortalData(profile) {
  const [portalState, setPortalState] = useState(defaultPortalState);
  const [syncing, setSyncing] = useState(hasFirebaseConfig);
  const [error, setError] = useState("");
  const operationsAccess = getOperationsAccess(profile);
  const propertyAccess = getPropertyAccess(profile);
  const managerWorkspaceAccess = getManagerWorkspaceAccess(profile);
  const housekeepingReportAccess = getHousekeepingReportAccess(profile);
  const roomPropertyStatusAccess = getRoomPropertyStatusAccess(profile);
  const storeAccess = getStoreAccess(profile);
  const nightDutyAccess = getNightDutyAccess(profile);
  const canEditOperationsTargets = canManageOperationsTargets(profile);
  const auditLogAccess = getAuditLogAccess(profile);
  const profileIsSuperAdmin = isSuperAdmin(profile);
  const canLoadAllStaff = managerWorkspaceAccess.canManageStaff || auditLogAccess.canViewPanel;
  const canLoadTeamDirectory = canLoadAllStaff;
  const notificationAudienceTags = useMemo(
    () => getNotificationAudienceTags({
      canViewOperations: operationsAccess.canViewPanel,
      canViewEvents: managerWorkspaceAccess.canViewEvents,
      canViewHousekeeping: housekeepingReportAccess.canViewPanel,
      canViewProperty: propertyAccess.canViewPanel,
      canViewStore: storeAccess.canViewPanel,
      canViewNightDuty: nightDutyAccess.canViewPanel,
    }),
    [
      housekeepingReportAccess.canViewPanel,
      managerWorkspaceAccess.canViewEvents,
      nightDutyAccess.canViewPanel,
      operationsAccess.canViewPanel,
      propertyAccess.canViewPanel,
      storeAccess.canViewPanel,
    ],
  );

  useEffect(() => {
    if (!hasFirebaseConfig || !db) {
      setSyncing(false);
      return undefined;
    }

    setSyncing(true);
    setError("");

    let pendingListeners =
      3 +
      (canLoadTeamDirectory ? 1 : 0) +
      (operationsAccess.canViewPanel ? 1 : 0) +
      (profile?.departmentKey ? 1 : 0) +
      (propertyAccess.canViewPanel ? 1 : 0) +
      (managerWorkspaceAccess.canViewEvents ? 1 : 0) +
      (housekeepingReportAccess.canViewPanel ? 1 : 0) +
      (storeAccess.canViewPanel ? 1 : 0) +
      (nightDutyAccess.canViewPanel ? 3 : 0) +
      (auditLogAccess.canViewPanel ? 1 : 0);

    const markResolved = () => {
      if (pendingListeners <= 0) {
        return;
      }

      pendingListeners -= 1;

      if (pendingListeners === 0) {
        setSyncing(false);
      }
    };

    const unsubscribes = [
      onSnapshot(
        doc(db, "portal", "highlights"),
        (snapshot) => {
          setPortalState((current) => ({
            ...current,
            highlights: snapshot.exists()
              ? mergeHighlights(snapshot.data())
              : defaultHighlights,
          }));
          markResolved();
        },
        (snapshotError) => {
          setError(snapshotError.message);
          markResolved();
        },
      ),
      ...(canLoadTeamDirectory
        ? [onSnapshot(
        query(collection(db, "users"), limit(200)),
        (snapshot) => {
          const users = snapshot.docs
            .map((document) => ({
              uid: document.id,
              ...document.data(),
            }))
            .sort((left, right) =>
              getSafeSortText(left.fullName, "Unnamed staff").localeCompare(
                getSafeSortText(right.fullName, "Unnamed staff"),
              ),
            );
          const activeUsers = users.filter(
            (user) => isActiveStaff(user) && isApprovedStaff(user),
          );

          setPortalState((current) => ({
            ...current,
            birthdays: activeUsers.length > 0
              ? buildBirthdaysFromUsers(activeUsers)
              : defaultBirthdays,
            staffDirectory: users,
            teamMembers: profileIsSuperAdmin
              ? activeUsers
              : profile?.departmentKey
                ? activeUsers.filter((user) => user.departmentKey === profile.departmentKey)
                : [],
          }));
          markResolved();
        },
        (snapshotError) => {
          setError(snapshotError.message);
          markResolved();
        },
      )]
        : []),
      ...(operationsAccess.canViewPanel
        ? [
            onSnapshot(
              doc(db, "portal", "frontOffice"),
              (snapshot) => {
                setPortalState((current) => ({
                  ...current,
                  operations: mergeOperationsWithPropertyStatus(
                    snapshot.exists() ? snapshot.data() : {},
                    current.propertyStatus,
                  ),
                }));
                markResolved();
              },
              (snapshotError) => {
                setError(snapshotError.message);
                markResolved();
              },
            ),
          ]
        : []),
      onSnapshot(
        doc(db, "portal", "siteContent"),
        (snapshot) => {
          setPortalState((current) => ({
            ...current,
            siteContent: snapshot.exists()
              ? mergeSiteContent(snapshot.data())
              : defaultSiteContent,
          }));
          markResolved();
        },
        (snapshotError) => {
          setError(snapshotError.message);
          markResolved();
        },
      ),
      onSnapshot(
        query(
          collection(db, "notifications"),
          where("audienceTag", "in", notificationAudienceTags),
          orderBy("createdAt", "desc"),
          limit(MAX_VISIBLE_NOTIFICATIONS),
        ),
        (snapshot) => {
          setPortalState((current) => ({
            ...current,
            notifications: normalizeNotifications(
              snapshot.docs.map((document) => ({
                id: document.id,
                ...document.data(),
              })),
            ),
          }));
          markResolved();
        },
        (snapshotError) => {
          setError(snapshotError.message);
          markResolved();
        },
      ),
      ...(propertyAccess.canViewPanel
        ? [
            onSnapshot(
              doc(db, "portal", "maintenance"),
              (snapshot) => {
                const nextPropertyStatus = snapshot.exists()
                  ? mergePropertyStatus(snapshot.data())
                  : defaultPropertyStatus;

                setPortalState((current) => ({
                  ...current,
                  propertyStatus: nextPropertyStatus,
                  operations: mergeOperationsWithPropertyStatus(
                    current.operations,
                    nextPropertyStatus,
                  ),
                }));
                markResolved();
              },
              (snapshotError) => {
                setError(snapshotError.message);
                markResolved();
              },
            ),
          ]
        : []),
      ...(managerWorkspaceAccess.canViewEvents
        ? [
            onSnapshot(
              doc(db, "portal", "eventsBookings"),
              (snapshot) => {
                setPortalState((current) => ({
                  ...current,
                  eventsBookings: snapshot.exists()
                    ? mergeEventsBookings(snapshot.data())
                    : defaultEventsBookings,
                }));
                markResolved();
              },
              (snapshotError) => {
                setError(snapshotError.message);
                markResolved();
              },
            ),
          ]
        : []),
      ...(housekeepingReportAccess.canViewPanel
        ? [
            onSnapshot(
              doc(db, "portal", "housekeepingReports"),
              (snapshot) => {
                setPortalState((current) => ({
                  ...current,
                  housekeepingReports: snapshot.exists()
                    ? mergeHousekeepingReports(snapshot.data())
                    : mergeHousekeepingReports(buildDefaultHousekeepingReports()),
                }));
                markResolved();
              },
              (snapshotError) => {
                setError(snapshotError.message);
                markResolved();
              },
            ),
          ]
        : []),
      ...(storeAccess.canViewPanel
        ? [
            onSnapshot(
              doc(db, "portal", "storeInventory"),
              (snapshot) => {
                setPortalState((current) => ({
                  ...current,
                  storeInventory: snapshot.exists()
                    ? mergeStoreInventory(snapshot.data())
                    : mergeStoreInventory(defaultStoreInventory),
                }));
                markResolved();
              },
              (snapshotError) => {
                setError(snapshotError.message);
                markResolved();
              },
            ),
          ]
        : []),
      ...(nightDutyAccess.canViewPanel
        ? [
            onSnapshot(
              doc(db, "portal", "operationsTargets"),
              (snapshot) => {
                const monthlyTargets = snapshot.exists() &&
                  snapshot.data()?.monthlyTargets &&
                  typeof snapshot.data().monthlyTargets === "object"
                  ? snapshot.data().monthlyTargets
                  : {};
                setPortalState((current) => ({
                  ...current,
                  operationsTargets: { monthlyTargets },
                }));
                markResolved();
              },
              (snapshotError) => {
                setError(snapshotError.message);
                markResolved();
              },
            ),
            onSnapshot(
              doc(db, "portal", "nightDuty"),
              (snapshot) => {
                setPortalState((current) => ({
                  ...current,
                  nightDutyData: snapshot.exists()
                    ? mergeNightDutyData(snapshot.data())
                    : mergeNightDutyData(defaultNightDutyData),
                }));
                markResolved();
              },
              (snapshotError) => {
                setError(snapshotError.message);
                markResolved();
              },
            ),
            onSnapshot(
              query(
                collection(db, "nightDutyReports"),
                orderBy("operationalDateKey", "desc"),
                limit(MAX_VISIBLE_NIGHT_DUTY_REPORTS),
              ),
              (snapshot) => {
                setPortalState((current) => ({
                  ...current,
                  nightDutyReportHistory: snapshot.docs.map((reportDocument) =>
                    normalizeStoredNightDutyReport({
                      id: reportDocument.id,
                      ...reportDocument.data(),
                    }),
                  ),
                }));
                markResolved();
              },
              (snapshotError) => {
                setError(snapshotError.message);
                markResolved();
              },
            ),
          ]
        : []),
      ...(auditLogAccess.canViewPanel
        ? [
            onSnapshot(
              query(collection(db, "activityLogs"), orderBy("createdAt", "desc"), limit(MAX_VISIBLE_ACTIVITY_LOGS)),
              (snapshot) => {
                setPortalState((current) => ({
                  ...current,
                  activityLogs: normalizeActivityLogs(
                    snapshot.docs.map((document) => ({
                      id: document.id,
                      ...document.data(),
                    })),
                  ),
                }));
                markResolved();
              },
              (snapshotError) => {
                setError(snapshotError.message);
                markResolved();
              },
            ),
          ]
        : []),
      ...(profile?.departmentKey
        ? [
            profileIsSuperAdmin
              ? onSnapshot(
                  collection(db, "departments"),
                  (snapshot) => {
                    setPortalState((current) => ({
                      ...current,
                      departmentShifts: snapshot.docs.flatMap((departmentDocument) =>
                        normalizeShifts(departmentDocument.data().shifts ?? []).map((shift) => ({
                          ...shift,
                          departmentKey: departmentDocument.id,
                        })),
                      ),
                    }));
                    markResolved();
                  },
                  (snapshotError) => {
                    setError(snapshotError.message);
                    markResolved();
                  },
                )
              : onSnapshot(
                  doc(db, "departments", profile.departmentKey),
                  (snapshot) => {
                    setPortalState((current) => ({
                      ...current,
                      departmentShifts: snapshot.exists()
                        ? normalizeShifts(snapshot.data().shifts ?? []).map((shift) => ({
                            ...shift,
                            departmentKey: profile.departmentKey,
                          }))
                        : [],
                    }));
                    markResolved();
                  },
                  (snapshotError) => {
                    setError(snapshotError.message);
                    markResolved();
                  },
                ),
          ]
        : []),
    ];

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [
    housekeepingReportAccess.canViewPanel,
    operationsAccess.canViewPanel,
    managerWorkspaceAccess.canViewEvents,
    nightDutyAccess.canViewPanel,
    notificationAudienceTags,
    auditLogAccess.canViewPanel,
    canLoadTeamDirectory,
    profile?.departmentKey,
    profile?.isSuperAdmin,
    profileIsSuperAdmin,
    propertyAccess.canViewPanel,
    storeAccess.canViewPanel,
  ]);

  function buildActorFields() {
    return {
      actorUid: profile?.uid ?? "",
      actorName: profile?.fullName ?? "",
      actorDepartment: profile?.departmentName ?? "",
      actorDepartmentKey: profile?.departmentKey ?? "",
    };
  }

  const loadRoomPropertyStatus = useCallback(async (roomNumber) => {
    if (!roomPropertyStatusAccess.canViewPanel) {
      throw new Error("This report is available to managers and supervisors only.");
    }

    const room = getRoomRecord(roomNumber);

    if (!room) {
      throw new Error("Select a valid hotel room.");
    }

    if (!db) {
      return buildRoomPropertyStatusRecord({}, room);
    }

    const snapshot = await getDoc(
      doc(db, "roomPropertyStatus", getRoomPropertyStatusDocumentId(roomNumber)),
    );

    if (snapshot.exists()) {
      return buildRoomPropertyStatusRecord(snapshot.data(), room);
    }

    if (hasCloudflareArchiveConfig) {
      try {
        const archived = await loadArchivedRecord("room-property-status", roomNumber);
        if (archived?.payload) {
          return buildRoomPropertyStatusRecord(archived.payload, room);
        }
      } catch (archiveError) {
        console.error("Unable to load the D1 room property archive", archiveError);
      }
    }

    return buildRoomPropertyStatusRecord({}, room);
  }, [roomPropertyStatusAccess.canViewPanel]);

  const loadAllRoomPropertyStatuses = useCallback(async () => {
    if (!roomPropertyStatusAccess.canViewPanel) {
      throw new Error("This report is available to managers and supervisors only.");
    }

    if (!db) {
      return hotelRooms.map((room) => buildRoomPropertyStatusRecord({}, room));
    }

    const snapshot = await getDocs(collection(db, "roomPropertyStatus"));
    const reportMap = new Map(
      snapshot.docs
        .map((reportDocument) => reportDocument.data())
        .filter((report) => getRoomRecord(report?.roomNumber))
        .map((report) => [report.roomNumber, report]),
    );

    return hotelRooms
      .map((room) => buildRoomPropertyStatusRecord(reportMap.get(room.label) ?? {}, room));
  }, [roomPropertyStatusAccess.canViewPanel]);

  const saveRoomPropertyStatus = useCallback(async (values) => {
    if (!roomPropertyStatusAccess.canEditPanel) {
      throw new Error("Only Housekeeping leads and the Super Admin can edit this report.");
    }

    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    const room = getRoomRecord(values?.roomNumber);

    if (!room) {
      throw new Error("Select a valid hotel room before saving.");
    }

    const normalizedReport = buildRoomPropertyStatusRecord(values, room);
    const updatedAtIso = new Date().toISOString();
    const savedReport = {
      ...normalizedReport,
      updatedAtIso,
      updatedByName: profile?.fullName ?? "",
      updatedByDepartment: profile?.departmentName ?? "Housekeeping",
      signedByName: profile?.fullName ?? "",
      signedByTitle: profile?.staffTitle ?? "",
      signedAtIso: updatedAtIso,
    };

    await setDoc(
      doc(db, "roomPropertyStatus", getRoomPropertyStatusDocumentId(room.label)),
      {
        ...savedReport,
        updatedAt: serverTimestamp(),
        updatedByUid: profile?.uid ?? "",
      },
    );

    if (hasCloudflareArchiveConfig) {
      try {
        await archiveRecord(buildArchiveRecord(
          "room-property-status",
          room.label,
          getOperationalDateKey(updatedAtIso),
          savedReport,
        ));
      } catch (archiveError) {
        console.error("Room property report saved without its D1 archive copy", archiveError);
        savedReport.archiveWarning = "The Firebase report was saved, but its Cloudflare D1 backup is pending.";
      }
    }

    return savedReport;
  }, [
    profile?.departmentName,
    profile?.fullName,
    profile?.staffTitle,
    profile?.uid,
    roomPropertyStatusAccess.canEditPanel,
  ]);

  function buildNotificationEntry({
    audienceTag = "all",
    title,
    message,
    relatedRoomNumber = "",
    relatedUserId = "",
  }) {
    const createdAt = new Date().toISOString();

    return {
      ...buildActorFields(),
      audienceTag,
      title: title?.trim() ?? "",
      message: message?.trim() ?? "",
      relatedRoomNumber,
      relatedUserId,
      createdAt,
      createdDateKey: createdAt.slice(0, 10),
      operationalDateKey: getOperationalDateKey(createdAt),
    };
  }

  function buildActivityLogEntry({
    area,
    actionType,
    message,
    targetUserId = "",
    targetRoomNumber = "",
    metadata = {},
  }) {
    const createdAt = new Date().toISOString();

    return {
      ...buildActorFields(),
      area,
      actionType,
      message,
      targetUserId,
      targetRoomNumber,
      metadata,
      createdAt,
      createdDateKey: createdAt.slice(0, 10),
      operationalDateKey: getOperationalDateKey(createdAt),
    };
  }

  async function commitTrackedWrite({
    writes,
    notification,
    activity,
  }) {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    const batch = writeBatch(db);

    writes.forEach(({ ref, data, options }) => {
      batch.set(ref, data, options ?? { merge: true });
    });

    if (notification) {
      batch.set(doc(collection(db, "notifications")), notification);
    }

    if (activity) {
      batch.set(doc(collection(db, "activityLogs")), activity);
    }

    await batch.commit();
  }

  async function saveOperations(values) {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    const {
      activityEntry,
      notificationEntry,
      ...operationValues
    } = values;
    const baselineOperations = mergeOperations(portalState.operations);
    const desiredOperations = mergeOperations({
      ...portalState.operations,
      ...operationValues,
    });
    const frontOfficeRef = doc(db, "portal", "frontOffice");
    const notification = notificationEntry ? buildNotificationEntry(notificationEntry) : null;
    const activity = activityEntry ? buildActivityLogEntry(activityEntry) : null;
    const notificationRef = notification ? doc(collection(db, "notifications")) : null;
    const activityRef = activity ? doc(collection(db, "activityLogs")) : null;

    await runTransaction(db, async (transaction) => {
      const currentSnapshot = await transaction.get(frontOfficeRef);
      const currentOperations = mergeOperations(currentSnapshot.exists() ? currentSnapshot.data() : {});
      const occupiedRooms = applyKeyedArrayDelta(
        currentOperations.occupiedRooms,
        baselineOperations.occupiedRooms,
        desiredOperations.occupiedRooms,
        (entry) => entry?.roomNumber ?? "",
      );
      const roomMoves = applyKeyedArrayDelta(
        currentOperations.roomMoves,
        baselineOperations.roomMoves,
        desiredOperations.roomMoves,
        (entry) => entry?.id ?? "",
      );
      const activityEntries = applyKeyedArrayDelta(
        currentOperations.activityEntries,
        baselineOperations.activityEntries,
        desiredOperations.activityEntries,
        (entry) => entry?.id ?? "",
      );
      const nextOperations = mergeOperations({
        ...currentOperations,
        ...operationValues,
        occupiedRooms,
        roomMoves,
        activityEntries,
      });
      const visibleOperations = mergeOperationsWithPropertyStatus(
        nextOperations,
        portalState.propertyStatus,
      );
      const normalizedActivityEntries = normalizeOperationsActivityEntries(activityEntries);
      const inHouseReport = buildInHouseReport(
        nextOperations.occupiedRooms,
        nextOperations.operationalDateKey,
        visibleOperations.outOfOrderRoomNumbers,
      );

      transaction.set(frontOfficeRef, {
        occupiedRooms: visibleOperations.occupiedRooms,
        occupiedRoomNumbers: visibleOperations.occupiedRoomNumbers,
        roomMoves: normalizeOperationsRoomMoves(roomMoves),
        activityEntries: normalizedActivityEntries,
        reportHistory: upsertOperationsReportHistory(
          currentOperations.reportHistory ?? [],
          { ...visibleOperations, activityEntries: normalizedActivityEntries },
          profile,
        ),
        inHouse: visibleOperations.inHouse,
        availableRooms: visibleOperations.availableRooms,
        breakfastEntitled: visibleOperations.breakfastEntitled,
        notes: nextOperations.notes ?? "",
        updatedAt: serverTimestamp(),
        updatedByUid: profile?.uid ?? null,
        updatedByName: profile?.fullName ?? "Front Office",
        updatedByDepartment: profile?.departmentName ?? "Front Office",
      }, { merge: true });

      transaction.set(
        doc(db, "inHouseReports", inHouseReport.operationalDateKey),
        {
          ...inHouseReport,
          updatedAt: serverTimestamp(),
          updatedAtIso: new Date().toISOString(),
          updatedByUid: profile?.uid ?? null,
          updatedByName: profile?.fullName ?? "Front Office",
          updatedByDepartment: profile?.departmentName ?? "Front Office",
        },
        { merge: false },
      );

      if (notificationRef) transaction.set(notificationRef, notification);
      if (activityRef) transaction.set(activityRef, activity);
    });
  }

  async function saveHousekeepingProgress(values) {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    const {
      activityEntry,
      notificationEntry,
      ...operationValues
    } = values;
    const nextOperations = mergeOperations({
      ...portalState.operations,
      ...operationValues,
    });
    const visibleOperations = mergeOperationsWithPropertyStatus(
      nextOperations,
      portalState.propertyStatus,
    );
    const normalizedActivityEntries = normalizeOperationsActivityEntries(
      nextOperations.activityEntries ?? portalState.operations.activityEntries ?? [],
    );

    await commitTrackedWrite({
      writes: [
        {
          ref: doc(db, "portal", "frontOffice"),
          data: {
            cleanedRoomNumbers: nextOperations.cleanedRoomNumbers,
            cleanedRooms: nextOperations.cleanedRooms,
            otherCleanedAreas: nextOperations.otherCleanedAreas ?? [],
            activityEntries: normalizedActivityEntries,
            reportHistory: upsertOperationsReportHistory(
              portalState.operations.reportHistory ?? [],
              {
                ...visibleOperations,
                activityEntries: normalizedActivityEntries,
              },
              profile,
            ),
            housekeepingUpdatedAt: serverTimestamp(),
            housekeepingUpdatedByUid: profile?.uid ?? null,
            housekeepingUpdatedByName: profile?.fullName ?? "Housekeeping",
            housekeepingUpdatedByDepartment: profile?.departmentName ?? "Housekeeping",
          },
          options: { merge: true },
        },
      ],
      notification: notificationEntry ? buildNotificationEntry(notificationEntry) : null,
      activity: activityEntry ? buildActivityLogEntry(activityEntry) : null,
    });
  }

  async function saveRoomIssues(values) {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    const nextPropertyStatus = mergePropertyStatus({
      ...portalState.propertyStatus,
      ...values,
    });

    await commitTrackedWrite({
      writes: [
        {
          ref: doc(db, "portal", "maintenance"),
          data: {
            roomIssues: nextPropertyStatus.roomIssues,
            roomIssuesUpdatedAt: serverTimestamp(),
            roomIssuesUpdatedByUid: profile?.uid ?? null,
            roomIssuesUpdatedByName: profile?.fullName ?? "",
            roomIssuesUpdatedByDepartment: profile?.departmentName ?? "",
          },
          options: { merge: true },
        },
      ],
      notification: buildNotificationEntry({
        audienceTag: "property",
        title: "Room issue update",
        message: `${profile?.departmentName ?? "Property"} updated room issue status.`,
      }),
      activity: buildActivityLogEntry({
        area: "property",
        actionType: "room_issue_update",
        message: `${profile?.departmentName ?? "Property"} updated room issues.`,
      }),
    });
  }

  async function saveRoomComplaints(values) {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    const nextPropertyStatus = mergePropertyStatus({
      ...portalState.propertyStatus,
      ...values,
    });

    await commitTrackedWrite({
      writes: [
        {
          ref: doc(db, "portal", "maintenance"),
          data: {
            roomComplaints: nextPropertyStatus.roomComplaints,
            roomComplaintsUpdatedAt: serverTimestamp(),
            roomComplaintsUpdatedByUid: profile?.uid ?? null,
            roomComplaintsUpdatedByName: profile?.fullName ?? "",
            roomComplaintsUpdatedByDepartment: profile?.departmentName ?? "",
            ...(propertyAccess.canEditRoomIssues
              ? {
                  roomIssues: nextPropertyStatus.roomIssues,
                  roomIssuesUpdatedAt: serverTimestamp(),
                  roomIssuesUpdatedByUid: profile?.uid ?? null,
                  roomIssuesUpdatedByName: profile?.fullName ?? "",
                  roomIssuesUpdatedByDepartment: profile?.departmentName ?? "",
                }
              : {}),
          },
          options: { merge: true },
        },
      ],
      notification: buildNotificationEntry({
        audienceTag: "operations",
        title: "Room complaint update",
        message: `${profile?.departmentName ?? "Operations"} updated room complaints.`,
      }),
      activity: buildActivityLogEntry({
        area: "complaints",
        actionType: "room_complaint_update",
        message: `${profile?.departmentName ?? "Operations"} updated room complaints.`,
      }),
    });
  }

  async function saveUtilities(values) {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    const nextPropertyStatus = mergePropertyStatus({
      ...portalState.propertyStatus,
      ...values,
    });

    await commitTrackedWrite({
      writes: [
        {
          ref: doc(db, "portal", "maintenance"),
          data: {
            utilities: nextPropertyStatus.utilities,
            utilitiesUpdatedAt: serverTimestamp(),
            utilitiesUpdatedByUid: profile?.uid ?? null,
            utilitiesUpdatedByName: profile?.fullName ?? "",
            utilitiesUpdatedByDepartment: profile?.departmentName ?? "",
          },
          options: { merge: true },
        },
      ],
      notification: buildNotificationEntry({
        audienceTag: "property",
        title: "Utility update",
        message: `${profile?.departmentName ?? "Property"} updated utility levels.`,
      }),
      activity: buildActivityLogEntry({
        area: "property",
        actionType: "utility_update",
        message: `${profile?.departmentName ?? "Property"} updated utility levels.`,
      }),
    });
  }

  async function saveEventBooking(values) {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    const nextEventsBookings = mergeEventsBookings({
      ...portalState.eventsBookings,
      ...values,
    });

    await commitTrackedWrite({
      writes: [
        {
          ref: doc(db, "portal", "eventsBookings"),
          data: {
            events: nextEventsBookings.events,
            updatedAt: serverTimestamp(),
            updatedByUid: profile?.uid ?? null,
            updatedByName: profile?.fullName ?? "",
            updatedByDepartment: profile?.departmentName ?? "",
          },
          options: { merge: true },
        },
      ],
      notification: buildNotificationEntry({
        audienceTag: "events",
        title: "Events and bookings update",
        message: `${profile?.fullName ?? "Front Office"} updated the events and bookings board.`,
      }),
      activity: buildActivityLogEntry({
        area: "events",
        actionType: "events_update",
        message: `${profile?.fullName ?? "Front Office"} updated events and bookings.`,
      }),
    });
  }

  async function saveHousekeepingReports(values) {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    const nextHousekeepingReports = mergeHousekeepingReports({
      ...portalState.housekeepingReports,
      ...values,
    });

    await commitTrackedWrite({
      writes: [
        {
          ref: doc(db, "portal", "housekeepingReports"),
          data: {
            operationalDateKey: nextHousekeepingReports.operationalDateKey,
            morningRooms: nextHousekeepingReports.morningRooms,
            afternoonRooms: nextHousekeepingReports.afternoonRooms,
            morningUpdatedByName: nextHousekeepingReports.morningUpdatedByName ?? "",
            morningUpdatedByDepartment: nextHousekeepingReports.morningUpdatedByDepartment ?? "",
            afternoonUpdatedByName: nextHousekeepingReports.afternoonUpdatedByName ?? "",
            afternoonUpdatedByDepartment: nextHousekeepingReports.afternoonUpdatedByDepartment ?? "",
            updatedAt: serverTimestamp(),
            updatedByUid: profile?.uid ?? null,
            updatedByName: profile?.fullName ?? "",
            updatedByDepartment: profile?.departmentName ?? "",
          },
          options: { merge: true },
        },
      ],
      notification: buildNotificationEntry({
        audienceTag: "housekeeping_reports",
        title: "Housekeeping report updated",
        message: `${profile?.fullName ?? "Housekeeping"} updated the room inspection report.`,
      }),
      activity: buildActivityLogEntry({
        area: "housekeeping_reports",
        actionType: "housekeeping_report_update",
        message: `${profile?.fullName ?? "Housekeeping"} updated housekeeping room reports.`,
      }),
    });
  }

  async function saveStoreInventorySection(fieldName, values) {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    const nextStoreInventory = mergeStoreInventory({
      ...portalState.storeInventory,
      ...values,
    });
    const fieldLabelMap = {
      acquisitions: "acquisitions",
      requisitions: "requisitions",
      returns: "returns",
      adjustments: "adjustments",
    };
    const sectionLabel = fieldLabelMap[fieldName] ?? "inventory";

    await commitTrackedWrite({
      writes: [
        {
          ref: doc(db, "portal", "storeInventory"),
          data: {
            [fieldName]: nextStoreInventory[fieldName],
            updatedAt: serverTimestamp(),
            updatedByUid: profile?.uid ?? null,
            updatedByName: profile?.fullName ?? "",
            updatedByDepartment: profile?.departmentName ?? "",
          },
          options: { merge: true },
        },
      ],
      notification: buildNotificationEntry({
        audienceTag: "store",
        title: "Store update",
        message: `${profile?.fullName ?? "Store"} updated ${sectionLabel}.`,
      }),
      activity: buildActivityLogEntry({
        area: "store",
        actionType: `store_${fieldName}`,
        message: `${profile?.fullName ?? "Store"} updated ${sectionLabel}.`,
      }),
    });
  }

  async function saveStoreAcquisition(values) {
    await saveStoreInventorySection("acquisitions", values);
  }

  async function saveStoreRequisition(values) {
    await saveStoreInventorySection("requisitions", values);
  }

  async function saveStoreReturn(values) {
    await saveStoreInventorySection("returns", values);
  }

  async function saveStoreAdjustment(values) {
    await saveStoreInventorySection("adjustments", values);
  }

  async function saveNightDutyData(values) {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    const nextNightDutyData = mergeNightDutyData({
      ...portalState.nightDutyData,
      ...values,
    });
    const updatedAtIso = new Date().toISOString();
    const persistedReport = {
      operationalDateKey: nextNightDutyData.operationalDateKey,
      occupancyByFloor: nextNightDutyData.occupancyByFloor,
      frontOfficeOccupancyByFloor: nextNightDutyData.frontOfficeOccupancyByFloor,
      frontOfficeOccupancyReport: nextNightDutyData.frontOfficeOccupancyReport,
      outOfOrderRoomNumbers: nextNightDutyData.outOfOrderRoomNumbers,
      occupancyQuery: nextNightDutyData.occupancyQuery,
      occupancyGuestMix: nextNightDutyData.occupancyGuestMix,
      income: nextNightDutyData.income,
      onDutyStaff: nextNightDutyData.onDutyStaff,
      departmentNotes: nextNightDutyData.departmentNotes,
      gasLevels: nextNightDutyData.gasLevels,
      hotWaterTemperature: nextNightDutyData.hotWaterTemperature,
      generatorServices: nextNightDutyData.generatorServices,
      powerSupplies: nextNightDutyData.powerSupplies,
      waterSupplyCount: nextNightDutyData.waterSupplyCount,
      guestIncident: nextNightDutyData.guestIncident,
      employeeIncident: nextNightDutyData.employeeIncident,
      nightDutySupervisorSignature: nextNightDutyData.nightDutySupervisorSignature,
      utilitiesSnapshot: mergePropertyStatus({
        utilities: nextNightDutyData.utilitiesSnapshot,
      }).utilities,
      eventsSnapshot: nextNightDutyData.eventsSnapshot,
      complaintsSnapshot: nextNightDutyData.complaintsSnapshot,
      updatedAt: serverTimestamp(),
      updatedAtIso,
      updatedByUid: profile?.uid ?? null,
      updatedByName: profile?.fullName ?? "",
      updatedByDepartment: profile?.departmentName ?? "",
    };
    let warning = "";
    let archivedInD1 = false;

    if (hasCloudflareArchiveConfig) {
      try {
        await archiveRecord(buildArchiveRecord(
          "night-duty",
          nextNightDutyData.operationalDateKey,
          nextNightDutyData.operationalDateKey,
          persistedReport,
        ));
        archivedInD1 = true;
      } catch (archiveError) {
        warning = "Cloudflare D1 was unavailable, so the full report was retained in Firebase as a safety fallback.";
        console.error("Night Duty report could not be archived in D1 before saving", archiveError);
      }
    }

    const datedReportData = archivedInD1
      ? {
          storageMode: "d1-full",
          operationalDateKey: persistedReport.operationalDateKey,
          occupancyByFloor: persistedReport.occupancyByFloor,
          frontOfficeOccupancyReport: persistedReport.frontOfficeOccupancyReport,
          outOfOrderRoomNumbers: persistedReport.outOfOrderRoomNumbers,
          occupancyGuestMix: persistedReport.occupancyGuestMix,
          income: persistedReport.income,
          gasLevels: persistedReport.gasLevels,
          hotWaterTemperature: persistedReport.hotWaterTemperature,
          waterSupplyCount: persistedReport.waterSupplyCount,
          nightDutySupervisorSignature: persistedReport.nightDutySupervisorSignature,
          updatedAt: persistedReport.updatedAt,
          updatedAtIso: persistedReport.updatedAtIso,
          updatedByUid: persistedReport.updatedByUid,
          updatedByName: persistedReport.updatedByName,
          updatedByDepartment: persistedReport.updatedByDepartment,
        }
      : persistedReport;
    const datedReportWrite = {
      ref: doc(db, "nightDutyReports", nextNightDutyData.operationalDateKey),
      data: datedReportData,
      options: { merge: false },
    };
    const currentBoardDate = portalState.nightDutyData?.operationalDateKey ?? "";
    const shouldUpdateCurrentBoard =
      nextNightDutyData.operationalDateKey === getNightDutyReportDateKey() ||
      !currentBoardDate ||
      nextNightDutyData.operationalDateKey >= currentBoardDate;

    try {
      await commitTrackedWrite({ writes: [datedReportWrite] });
    } catch (error) {
      const permissionDenied = error?.code === "permission-denied" ||
        error?.code === "firestore/permission-denied";

      if (!permissionDenied || !profile?.uid) throw error;

      let message = `Firestore rejected nightDutyReports/${nextNightDutyData.operationalDateKey}.`;

      try {
        const profileSnapshot = await getDoc(doc(db, "users", profile.uid));

        if (!profileSnapshot.exists()) {
          message += " The matching users document is missing. Recreate users/" +
            `${profile.uid} using the same UID shown in Firebase Authentication.`;
        } else {
          const storedProfile = profileSnapshot.data();
          const approvedActive = storedProfile.approvalStatus === "approved" &&
            storedProfile.employmentStatus === "active";
          const superAdmin = storedProfile.isSuperAdmin === true;
          const nightDutyLead = storedProfile.departmentKey === "night_duty" &&
            ["manager", "supervisor"].includes(storedProfile.jobLevel);

          if (!approvedActive) {
            message += " The users document must have approvalStatus set to approved and employmentStatus set to active.";
          } else if (!superAdmin && !nightDutyLead) {
            message += " The users document must contain isSuperAdmin as Boolean true, or departmentKey night_duty with jobLevel manager or supervisor.";
          } else if (
            storedProfile.fullName !== profile.fullName ||
            storedProfile.departmentName !== profile.departmentName
          ) {
            message += " The browser has an older staff profile. Sign out completely and sign in again before saving.";
          } else {
            message += ` The staff profile is valid. Publish the complete firestore.rules file to Firebase project ${db.app.options.projectId}. Hostinger deployment does not publish Firestore rules.`;
          }
        }
      } catch {
        message += " The app could not read the matching users document; confirm it still exists and that its document ID equals the Authentication UID.";
      }

      const diagnosedError = new Error(message);
      diagnosedError.code = error.code;
      throw diagnosedError;
    }

    if (shouldUpdateCurrentBoard) {
      try {
        await commitTrackedWrite({
          writes: [{
            ref: doc(db, "portal", "nightDuty"),
            data: persistedReport,
            options: { merge: false },
          }],
        });
      } catch (error) {
        warning = `${warning} The dated report was saved, but Firestore rejected the current Night Duty dashboard copy.`.trim();
        console.error("Night Duty dated report saved without current dashboard copy", error);
      }
    }

    try {
      await commitTrackedWrite({
        writes: [],
        notification: buildNotificationEntry({
          audienceTag: "night-duty",
          title: "Night Duty update",
          message: `${profile?.fullName ?? "Night Duty"} updated the ${nextNightDutyData.operationalDateKey} night duty report.`,
        }),
        activity: buildActivityLogEntry({
          area: "night_duty",
          actionType: "night_duty_update",
          message: `${profile?.fullName ?? "Night Duty"} updated Night Duty records for ${nextNightDutyData.operationalDateKey}.`,
        }),
      });
    } catch (error) {
      warning = `${warning} The report was saved, but Firestore rejected its notification/audit entry.`.trim();
      console.error("Night Duty report saved without its tracking entries", error);
    }

    return { warning };
  }

  async function saveOperationsTarget(monthKey, values = {}) {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }
    if (!canEditOperationsTargets) {
      throw new Error("Only the Operations Manager, Front Office Manager, or Super Admin can change revenue targets.");
    }
    if (!/^\d{4}-\d{2}$/.test(monthKey ?? "")) {
      throw new Error("Select a valid target month.");
    }

    const normalizeTarget = (value) => {
      const amount = Number(value);
      return Number.isFinite(amount) ? Math.min(Math.max(amount, 0), 1000000000000) : 0;
    };
    const target = {
      monthKey,
      roomRevenueTarget: normalizeTarget(values.roomRevenueTarget),
      foodBeverageRevenueTarget: normalizeTarget(values.foodBeverageRevenueTarget),
      updatedAtIso: new Date().toISOString(),
      updatedByUid: profile?.uid ?? "",
      updatedByName: profile?.fullName ?? "",
    };
    const targetRef = doc(db, "portal", "operationsTargets");
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(targetRef);
      const existingTargets = snapshot.exists() &&
        snapshot.data()?.monthlyTargets &&
        typeof snapshot.data().monthlyTargets === "object"
        ? snapshot.data().monthlyTargets
        : {};
      const nextMonthlyTargets = {
        ...existingTargets,
        [monthKey]: target,
      };
      const oldestMonthKeys = Object.keys(nextMonthlyTargets)
        .sort()
        .slice(0, Math.max(Object.keys(nextMonthlyTargets).length - 120, 0));
      oldestMonthKeys.forEach((oldestMonthKey) => delete nextMonthlyTargets[oldestMonthKey]);

      transaction.set(targetRef, {
        monthlyTargets: nextMonthlyTargets,
        updatedAt: serverTimestamp(),
        updatedAtIso: target.updatedAtIso,
        updatedByUid: target.updatedByUid,
        updatedByName: target.updatedByName,
      });
    });

    return target;
  }

  const fetchFirestoreNightDutyRange = useCallback(async (rangeStart, rangeEnd) => {
    const snapshot = await getDocs(query(
      collection(db, "nightDutyReports"),
      where("operationalDateKey", ">=", rangeStart),
      where("operationalDateKey", "<=", rangeEnd),
      orderBy("operationalDateKey", "asc"),
      limit(MAX_REPORT_HISTORY_DAYS),
    ));

    return snapshot.docs.map((reportDocument) => normalizeStoredNightDutyReport({
      id: reportDocument.id,
      ...reportDocument.data(),
    }));
  }, []);

  const archiveNightDutyRange = useCallback(async (reports, coveredDateKeys) => {
    if (!hasCloudflareArchiveConfig) {
      throw new Error("Cloudflare D1 archive is not configured.");
    }

    const archiveRecords = reports.map((report) => buildArchiveRecord(
      "night-duty",
      report.operationalDateKey,
      report.operationalDateKey,
      report,
    ));
    const chunkSize = 20;

    if (archiveRecords.length === 0) {
      await archiveRecordBatch({
        records: [],
        coverageType: "night-duty",
        coveredDateKeys,
      });
      return;
    }

    for (let index = 0; index < archiveRecords.length; index += chunkSize) {
      const isFinalChunk = index + chunkSize >= archiveRecords.length;
      await archiveRecordBatch({
        records: archiveRecords.slice(index, index + chunkSize),
        coverageType: isFinalChunk ? "night-duty" : "",
        coveredDateKeys: isFinalChunk ? coveredDateKeys : [],
      });
    }
  }, []);

  const loadNightDutyReport = useCallback(async (operationalDateKey) => {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(operationalDateKey ?? "")) {
      throw new Error("Select a valid report date.");
    }

    if (hasCloudflareArchiveConfig) {
      try {
        const archived = await loadArchivedRecord("night-duty", operationalDateKey);
        if (archived?.payload) {
          return normalizeStoredNightDutyReport({
            id: operationalDateKey,
            ...archived.payload,
          });
        }
      } catch (archiveError) {
        console.error("Unable to load the D1 Night Duty archive", archiveError);
      }
    }

    const snapshot = await getDoc(doc(db, "nightDutyReports", operationalDateKey));

    if (snapshot.exists()) {
      return normalizeStoredNightDutyReport({ id: snapshot.id, ...snapshot.data() });
    }

    return null;
  }, []);

  const loadNightDutyReportsInRange = useCallback(async (startDateKey, endDateKey) => {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(startDateKey ?? "") ||
      !/^\d{4}-\d{2}-\d{2}$/.test(endDateKey ?? "")
    ) {
      throw new Error("Select a valid report date range.");
    }

    const rangeStart = startDateKey <= endDateKey ? startDateKey : endDateKey;
    const rangeEnd = startDateKey <= endDateKey ? endDateKey : startDateKey;
    const dateKeys = listDateKeysInRange(rangeStart, rangeEnd);
    let archivedReports = [];

    if (hasCloudflareArchiveConfig) {
      try {
        const archivedRange = await loadArchivedRange("night-duty", rangeStart, rangeEnd);
        archivedReports = archivedRange.records
          .filter((entry) => entry?.payload)
          .map((entry) => normalizeStoredNightDutyReport({
            id: entry.recordKey,
            ...entry.payload,
          }));
        const coveredDateSet = new Set(archivedRange.coveredDateKeys);
        if (dateKeys.every((dateKey) => coveredDateSet.has(dateKey))) {
          return archivedReports;
        }
      } catch (archiveError) {
        console.error("Unable to use the D1 Night Duty range archive", archiveError);
      }
    }

    try {
      const firestoreReports = await fetchFirestoreNightDutyRange(rangeStart, rangeEnd);
      const archivedByDate = new Map(
        archivedReports.map((report) => [report.operationalDateKey, report]),
      );
      const combinedReports = firestoreReports.map((report) =>
        archivedByDate.get(report.operationalDateKey) ?? report,
      );
      archivedReports.forEach((report) => {
        if (!combinedReports.some((entry) => entry.operationalDateKey === report.operationalDateKey)) {
          combinedReports.push(report);
        }
      });

      if (hasCloudflareArchiveConfig && nightDutyAccess.canEditPanel) {
        try {
          const legacyFullReports = firestoreReports.filter(
            (report) => report.storageMode !== "d1-full",
          );
          const unavailableCompactDates = new Set(
            firestoreReports
              .filter((report) => report.storageMode === "d1-full" && !archivedByDate.has(report.operationalDateKey))
              .map((report) => report.operationalDateKey),
          );
          await archiveNightDutyRange(
            legacyFullReports,
            dateKeys.filter((dateKey) => !unavailableCompactDates.has(dateKey)),
          );
        } catch (archiveError) {
          console.error("Unable to backfill the D1 Night Duty archive", archiveError);
        }
      }

      return combinedReports.sort((left, right) =>
        left.operationalDateKey.localeCompare(right.operationalDateKey),
      );
    } catch (firestoreError) {
      if (archivedReports.length > 0) return archivedReports;
      throw firestoreError;
    }
  }, [
    archiveNightDutyRange,
    fetchFirestoreNightDutyRange,
    nightDutyAccess.canEditPanel,
  ]);

  const backupNightDutyReportsInRange = useCallback(async (startDateKey, endDateKey) => {
    if (!nightDutyAccess.canEditPanel) {
      throw new Error("Only the Night Duty manager, supervisor or Super Admin can back up reports.");
    }
    if (!hasCloudflareArchiveConfig) {
      throw new Error("Add NEXT_PUBLIC_CLOUDFLARE_ARCHIVE_URL before using D1 backup.");
    }

    const dateKeys = listDateKeysInRange(startDateKey, endDateKey);
    if (dateKeys.length === 0 || dateKeys.length > MAX_REPORT_HISTORY_DAYS) {
      throw new Error("Choose a valid range of 120 days or fewer.");
    }
    const reports = await fetchFirestoreNightDutyRange(
      dateKeys[0],
      dateKeys[dateKeys.length - 1],
    );
    const archivedRange = await loadArchivedRange(
      "night-duty",
      dateKeys[0],
      dateKeys[dateKeys.length - 1],
    );
    const archivedKeys = new Set(
      archivedRange.records.map((record) => record.recordKey),
    );
    const legacyFullReports = reports.filter((report) => report.storageMode !== "d1-full");
    const unavailableCompactDates = new Set(
      reports
        .filter((report) => report.storageMode === "d1-full" && !archivedKeys.has(report.operationalDateKey))
        .map((report) => report.operationalDateKey),
    );
    const coveredDateKeys = dateKeys.filter((dateKey) => !unavailableCompactDates.has(dateKey));
    await archiveNightDutyRange(legacyFullReports, coveredDateKeys);

    if (legacyFullReports.length > 0) {
      const compactedAtIso = new Date().toISOString();
      const batch = writeBatch(db);
      legacyFullReports.forEach((report) => {
        batch.set(doc(db, "nightDutyReports", report.operationalDateKey), {
          storageMode: "d1-full",
          operationalDateKey: report.operationalDateKey,
          occupancyByFloor: report.occupancyByFloor,
          occupancyGuestMix: report.occupancyGuestMix,
          income: report.income,
          gasLevels: report.gasLevels,
          hotWaterTemperature: report.hotWaterTemperature,
          waterSupplyCount: report.waterSupplyCount,
          nightDutySupervisorSignature: report.nightDutySupervisorSignature,
          updatedAt: serverTimestamp(),
          updatedAtIso: compactedAtIso,
          updatedByUid: profile?.uid ?? null,
          updatedByName: profile?.fullName ?? "",
          updatedByDepartment: profile?.departmentName ?? "",
        });
      });
      await batch.commit();
    }

    return {
      archivedRecords: new Set([
        ...archivedKeys,
        ...legacyFullReports.map((report) => report.operationalDateKey),
      ]).size,
      coveredDates: coveredDateKeys.length,
      compactedFirebaseRecords: legacyFullReports.length,
    };
  }, [
    archiveNightDutyRange,
    fetchFirestoreNightDutyRange,
    nightDutyAccess.canEditPanel,
    profile?.departmentName,
    profile?.fullName,
    profile?.uid,
  ]);

  const loadNightDutyReportRevisions = useCallback(async (operationalDateKey) => {
    if (!hasCloudflareArchiveConfig) return [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(operationalDateKey ?? "")) {
      throw new Error("Select a valid report date.");
    }

    const revisions = await loadArchivedRevisions("night-duty", operationalDateKey);
    return revisions
      .filter((revision) => revision?.payload)
      .map((revision) => ({
        revisionId: revision.revisionId,
        archivedAt: revision.archivedAt,
        archivedByName: revision.updatedByName,
        report: normalizeStoredNightDutyReport({
          id: operationalDateKey,
          ...revision.payload,
        }),
      }));
  }, []);

  const loadInHouseReport = useCallback(async (operationalDateKey) => {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(operationalDateKey ?? "")) {
      throw new Error("Select a valid In-house activity date.");
    }

    let archivedPayload = null;

    if (hasCloudflareArchiveConfig) {
      try {
        const archived = await loadArchivedRecord("in-house", operationalDateKey);
        if (archived?.payload) {
          archivedPayload = archived.payload;
        }
      } catch (archiveError) {
        console.error("Unable to load the D1 In-house archive", archiveError);
      }
    }

    const snapshot = await getDoc(doc(db, "inHouseReports", operationalDateKey));
    if (snapshot.exists()) {
      const firestorePayload = snapshot.data();
      const preferredPayload = hasCompleteClassifiedRoomData(firestorePayload) ||
        !hasCompleteClassifiedRoomData(archivedPayload)
        ? firestorePayload
        : archivedPayload;

      return normalizeStoredInHouseReport(preferredPayload, operationalDateKey);
    }

    return archivedPayload
      ? normalizeStoredInHouseReport(archivedPayload, operationalDateKey)
      : null;
  }, []);

  const loadInHouseReportsInRange = useCallback(async (startDateKey, endDateKey) => {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(startDateKey ?? "") ||
      !/^\d{4}-\d{2}-\d{2}$/.test(endDateKey ?? "")
    ) {
      throw new Error("Select a valid In-house report date range.");
    }

    const rangeStart = startDateKey <= endDateKey ? startDateKey : endDateKey;
    const rangeEnd = startDateKey <= endDateKey ? endDateKey : startDateKey;
    const archivedByDate = new Map();

    if (hasCloudflareArchiveConfig) {
      try {
        const archivedRange = await loadArchivedRange("in-house", rangeStart, rangeEnd);
        archivedRange.records
          .filter((entry) => entry?.payload)
          .forEach((entry) => {
            archivedByDate.set(
              entry.recordKey,
              {
                complete: hasCompleteClassifiedRoomData(entry.payload),
                report: normalizeStoredInHouseReport(entry.payload, entry.recordKey),
              },
            );
          });
      } catch (archiveError) {
        console.error("Unable to use the D1 In-house range archive", archiveError);
      }
    }

    const [snapshot, priorSnapshot] = await Promise.all([
      getDocs(query(
        collection(db, "inHouseReports"),
        where("operationalDateKey", ">=", rangeStart),
        where("operationalDateKey", "<=", rangeEnd),
        orderBy("operationalDateKey", "asc"),
        limit(MAX_REPORT_HISTORY_DAYS),
      )),
      getDocs(query(
        collection(db, "inHouseReports"),
        where("operationalDateKey", "<", rangeStart),
        orderBy("operationalDateKey", "desc"),
        limit(1),
      )),
    ]);
    const reportsByDate = new Map(
      snapshot.docs.map((reportDocument) => {
        const payload = reportDocument.data();
        const report = normalizeStoredInHouseReport(
          payload,
          reportDocument.id,
        );
        return [report.operationalDateKey, {
          complete: hasCompleteClassifiedRoomData(payload),
          report,
        }];
      }),
    );

    archivedByDate.forEach((archivedEntry, dateKey) => {
      const firestoreEntry = reportsByDate.get(dateKey);
      if (!firestoreEntry || (!firestoreEntry.complete && archivedEntry.complete)) {
        reportsByDate.set(dateKey, archivedEntry);
      }
    });

    priorSnapshot.docs.forEach((reportDocument) => {
      const payload = reportDocument.data();
      reportsByDate.set(reportDocument.id, {
        complete: hasCompleteClassifiedRoomData(payload),
        report: normalizeStoredInHouseReport(payload, reportDocument.id),
      });
    });

    return [...reportsByDate.values()].map((entry) => entry.report).sort((left, right) =>
      left.operationalDateKey.localeCompare(right.operationalDateKey),
    );
  }, []);

  async function saveInHouseReport(values) {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    const dateKey = values?.operationalDateKey ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      throw new Error("Select a valid In-house activity date.");
    }

    if (dateKey > getNightDutyReportDateKey()) {
      throw new Error("Dated In-house reports can only be saved for yesterday or an earlier date.");
    }

    const normalized = buildInHouseReport(
      values?.occupiedRooms ?? [],
      dateKey,
      values?.outOfOrderRoomNumbers ?? portalState.operations.outOfOrderRoomNumbers ?? [],
    );
    const persistedReport = {
      ...normalized,
      updatedAt: serverTimestamp(),
      updatedAtIso: new Date().toISOString(),
      updatedByUid: profile?.uid ?? null,
      updatedByName: profile?.fullName ?? "",
      updatedByDepartment: profile?.departmentName ?? "",
    };

    const savedReport = normalizeStoredInHouseReport({
      ...persistedReport,
      updatedAt: null,
    }, dateKey);
    let archivedInD1 = false;

    if (hasCloudflareArchiveConfig) {
      try {
        await archiveRecord(buildArchiveRecord(
          "in-house",
          dateKey,
          dateKey,
          savedReport,
        ));
        archivedInD1 = true;
      } catch (archiveError) {
        console.error("In-house report could not be archived in D1 before saving", archiveError);
        savedReport.archiveWarning = "Cloudflare D1 was unavailable, so the full In-house report was retained in Firebase as a safety fallback.";
      }
    }

    const firestoreReport = archivedInD1
      ? {
          storageMode: "d1-full",
          operationalDateKey: persistedReport.operationalDateKey,
          occupiedRooms: persistedReport.occupiedRooms,
          occupiedRoomNumbers: persistedReport.occupiedRoomNumbers,
          occupancyByFloor: persistedReport.occupancyByFloor,
          inHouse: persistedReport.inHouse,
          outOfOrderRoomNumbers: persistedReport.outOfOrderRoomNumbers,
          availableRooms: persistedReport.availableRooms,
          breakfastEntitled: persistedReport.breakfastEntitled,
          updatedAt: persistedReport.updatedAt,
          updatedAtIso: persistedReport.updatedAtIso,
          updatedByUid: persistedReport.updatedByUid,
          updatedByName: persistedReport.updatedByName,
          updatedByDepartment: persistedReport.updatedByDepartment,
        }
      : persistedReport;
    await setDoc(doc(db, "inHouseReports", dateKey), firestoreReport, { merge: false });

    return savedReport;
  }

  async function saveStaffProfile(userId, values) {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    if (!userId) {
      throw new Error("Select a staff member first.");
    }

    const targetProfile = portalState.staffDirectory.find((staffMember) => staffMember.uid === userId);

    if (!targetProfile) {
      throw new Error("The selected staff account was not found.");
    }

    const nextProfile = {
      ...targetProfile,
      ...values,
    };
    const approvalStatus = nextProfile.approvalStatus ?? targetProfile.approvalStatus ?? "pending";
    const approvalJustChanged =
      approvalStatus !== (targetProfile.approvalStatus ?? "pending");
    const profileNoteTimestamp = new Date().toISOString();
    let lastProfileNotification = nextProfile.lastProfileNotification ?? targetProfile.lastProfileNotification ?? "";
    let lastProfileNotificationAt =
      nextProfile.lastProfileNotificationAt ?? targetProfile.lastProfileNotificationAt ?? "";

    if (values.surcharges !== undefined && values.surcharges !== targetProfile.surcharges) {
      lastProfileNotification = "Your surcharge list was updated. Open My Dashboard to review it.";
      lastProfileNotificationAt = profileNoteTimestamp;
    } else if (values.leaveRecords !== undefined) {
      lastProfileNotification = "Your leave record was updated. Open My Dashboard to review it.";
      lastProfileNotificationAt = profileNoteTimestamp;
    } else if (
      values.monthlySalary !== undefined ||
      values.payrollMonthKey !== undefined ||
      values.absenceDays !== undefined ||
      values.lateCount !== undefined ||
      values.pensionAmount !== undefined ||
      values.taxAmount !== undefined
    ) {
      lastProfileNotification = "Your payroll breakdown was updated. Open My Dashboard to review it.";
      lastProfileNotificationAt = profileNoteTimestamp;
    } else if (approvalJustChanged && approvalStatus === "approved") {
      lastProfileNotification = "Your account has been approved. You can now log in.";
      lastProfileNotificationAt = profileNoteTimestamp;
    } else if (
      values.employmentStatus &&
      values.employmentStatus !== targetProfile.employmentStatus &&
      values.employmentStatus !== "active"
    ) {
      lastProfileNotification = "Your staff access status was updated. Please contact Human Resource.";
      lastProfileNotificationAt = profileNoteTimestamp;
    }

    const activityMessage =
      approvalJustChanged && approvalStatus === "approved"
        ? `Approved staff account for ${nextProfile.fullName}.`
        : values.surcharges !== undefined && values.surcharges !== targetProfile.surcharges
          ? `Updated surcharge list for ${nextProfile.fullName}.`
          : values.leaveRecords !== undefined
            ? `Updated leave record for ${nextProfile.fullName}.`
            : values.monthlySalary !== undefined ||
                values.payrollMonthKey !== undefined ||
                values.absenceDays !== undefined ||
                values.lateCount !== undefined ||
                values.pensionAmount !== undefined ||
                values.taxAmount !== undefined
              ? `Updated payroll record for ${nextProfile.fullName}.`
              : values.employmentStatus && values.employmentStatus === "sacked"
                ? `Moved ${nextProfile.fullName} to sacked staff.`
          : values.jobLevel && values.jobLevel !== targetProfile.jobLevel
            ? `Updated role level for ${nextProfile.fullName}.`
            : values.departmentKey && values.departmentKey !== targetProfile.departmentKey
              ? `Moved ${nextProfile.fullName} to ${nextProfile.departmentName}.`
              : `Updated staff record for ${nextProfile.fullName}.`;

    await commitTrackedWrite({
      writes: [
        {
          ref: doc(db, "users", userId),
          data: {
            ...values,
            approvalStatus,
            approvedAt:
              approvalStatus === "approved"
                ? (approvalJustChanged ? profileNoteTimestamp : nextProfile.approvedAt ?? "")
                : "",
            approvedByName:
              approvalStatus === "approved"
                ? (approvalJustChanged ? profile?.fullName ?? "" : nextProfile.approvedByName ?? "")
                : "",
            lastProfileNotification,
            lastProfileNotificationAt,
            updatedAt: serverTimestamp(),
          },
          options: { merge: true },
        },
      ],
      activity: buildActivityLogEntry({
        area: "staff",
        actionType: "staff_profile_update",
        message: activityMessage,
        targetUserId: userId,
      }),
    });
  }

  async function saveShiftAssignment(values) {
    if (!db || !profile?.departmentKey) {
      throw new Error("Shift assignments are not available yet.");
    }

    const targetDepartmentKey = profileIsSuperAdmin
      ? values.departmentKey
      : profile.departmentKey;
    const staffMember = portalState.teamMembers.find(
      (member) => member.uid === values.userId && member.departmentKey === targetDepartmentKey,
    );

    if (!targetDepartmentKey || !staffMember) {
      throw new Error("Select a valid team member before assigning a shift.");
    }

    if (!values.shiftDate) {
      throw new Error("Select a shift date before saving.");
    }

    const shiftId = `${values.userId}-${values.shiftDate}`;
    const nextShifts = normalizeShifts([
      ...portalState.departmentShifts.filter(
        (shift) => shift.departmentKey === targetDepartmentKey && shift.id !== shiftId,
      ),
      {
        id: shiftId,
        userId: values.userId,
        staffName: staffMember.fullName,
        shiftDate: values.shiftDate,
        departmentKey: targetDepartmentKey,
      },
    ]);

    await commitTrackedWrite({
      writes: [
        {
          ref: doc(db, "departments", targetDepartmentKey),
          data: {
            shifts: nextShifts,
            updatedAt: serverTimestamp(),
            updatedByUid: profile.uid,
            updatedByName: profile.fullName,
          },
          options: { merge: true },
        },
      ],
      activity: buildActivityLogEntry({
        area: "team",
        actionType: "shift_assignment",
        message: `Assigned shift on ${values.shiftDate} to ${staffMember.fullName}.`,
        targetUserId: values.userId,
      }),
    });
  }

  async function removeShiftAssignment(shiftId, departmentKey = "") {
    if (!db || !profile?.departmentKey) {
      throw new Error("Shift assignments are not available yet.");
    }

    const targetDepartmentKey = profileIsSuperAdmin
      ? departmentKey
      : profile.departmentKey;

    if (!targetDepartmentKey) {
      throw new Error("Select a department before removing a shift.");
    }

    const nextShifts = portalState.departmentShifts.filter(
      (shift) => shift.departmentKey === targetDepartmentKey && shift.id !== shiftId,
    );

    await commitTrackedWrite({
      writes: [
        {
          ref: doc(db, "departments", targetDepartmentKey),
          data: {
            shifts: nextShifts,
            updatedAt: serverTimestamp(),
            updatedByUid: profile.uid,
            updatedByName: profile.fullName,
          },
          options: { merge: true },
        },
      ],
      activity: buildActivityLogEntry({
        area: "team",
        actionType: "shift_remove",
        message: `Removed shift assignment ${shiftId}.`,
      }),
    });
  }

  return {
    ...portalState,
    syncing,
    error,
    saveOperations,
    saveHousekeepingProgress,
    saveRoomIssues,
    saveRoomComplaints,
    saveUtilities,
    saveEventBooking,
    saveHousekeepingReports,
    loadRoomPropertyStatus,
    loadAllRoomPropertyStatuses,
    saveRoomPropertyStatus,
    saveStoreAcquisition,
    saveStoreRequisition,
    saveStoreReturn,
    saveStoreAdjustment,
    loadNightDutyReport,
    loadNightDutyReportsInRange,
    backupNightDutyReportsInRange,
    loadNightDutyReportRevisions,
    saveNightDutyData,
    saveOperationsTarget,
    loadInHouseReport,
    loadInHouseReportsInRange,
    saveInHouseReport,
    saveStaffProfile,
    saveShiftAssignment,
    removeShiftAssignment,
  };
}
