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
import { defaultStoreInventory, mergeStoreInventory } from "@/data/storeInventory";
import { defaultNightDutyData, mergeNightDutyData } from "@/data/nightDuty";
import { db, hasFirebaseConfig } from "@/lib/firebase";
import { getOperationalDateKey } from "@/lib/hotelTime";
import {
  getAuditLogAccess,
  getHousekeepingReportAccess,
  getNightDutyAccess,
  getManagerWorkspaceAccess,
  getOperationsAccess,
  getPropertyAccess,
  getRoomPropertyStatusAccess,
  getStoreAccess,
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
  siteContent: defaultSiteContent,
  notifications: [],
  activityLogs: [],
  staffDirectory: [],
  teamMembers: [],
  departmentShifts: [],
};

const MAX_REPORT_HISTORY_DAYS = 120;
const MAX_OPERATIONS_ACTIVITY = 300;
const MAX_VISIBLE_NOTIFICATIONS = 80;
const MAX_VISIBLE_ACTIVITY_LOGS = 200;

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
  const occupiedRoomSet = new Set(baseOperations.occupiedRoomNumbers);
  const outOfOrderRoomSet = new Set(outOfOrderRoomNumbers);
  const blockedAvailableCount = outOfOrderRoomNumbers.filter(
    (roomNumber) => !occupiedRoomSet.has(roomNumber),
  ).length;
  const cleanedRoomNumbers = baseOperations.cleanedRoomNumbers.filter(
    (roomNumber) => !outOfOrderRoomSet.has(roomNumber),
  );

  return {
    ...baseOperations,
    cleanedRoomNumbers,
    cleanedRooms: cleanedRoomNumbers.length,
    outOfOrderRoomNumbers,
    availableRooms: Math.max(baseOperations.availableRooms - blockedAvailableCount, 0),
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
  const auditLogAccess = getAuditLogAccess(profile);
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
      (nightDutyAccess.canViewPanel ? 1 : 0) +
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
            teamMembers: profile?.departmentKey
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
            onSnapshot(
              doc(db, "departments", profile.departmentKey),
              (snapshot) => {
                setPortalState((current) => ({
                  ...current,
                  departmentShifts: snapshot.exists()
                    ? normalizeShifts(snapshot.data().shifts ?? [])
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

    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    const room = getRoomRecord(roomNumber);

    if (!room) {
      throw new Error("Select a valid hotel room.");
    }

    const snapshot = await getDoc(
      doc(db, "roomPropertyStatus", getRoomPropertyStatusDocumentId(roomNumber)),
    );

    return buildRoomPropertyStatusRecord(snapshot.exists() ? snapshot.data() : {}, room);
  }, [roomPropertyStatusAccess.canViewPanel]);

  const loadAllRoomPropertyStatuses = useCallback(async () => {
    if (!roomPropertyStatusAccess.canViewPanel) {
      throw new Error("This report is available to managers and supervisors only.");
    }

    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    const snapshot = await getDocs(collection(db, "roomPropertyStatus"));
    const reportMap = new Map(
      snapshot.docs
        .map((reportDocument) => reportDocument.data())
        .filter((report) => getRoomRecord(report?.roomNumber))
        .map((report) => [report.roomNumber, report]),
    );

    return hotelRooms
      .filter((room) => reportMap.has(room.label))
      .map((room) => buildRoomPropertyStatusRecord(reportMap.get(room.label), room));
  }, [roomPropertyStatusAccess.canViewPanel]);

  const saveRoomPropertyStatus = useCallback(async (values) => {
    if (!roomPropertyStatusAccess.canEditPanel) {
      throw new Error("Only Housekeeping managers and supervisors can edit this report.");
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
    };

    await setDoc(
      doc(db, "roomPropertyStatus", getRoomPropertyStatusDocumentId(room.label)),
      {
        ...savedReport,
        updatedAt: serverTimestamp(),
        updatedByUid: profile?.uid ?? "",
      },
    );

    return savedReport;
  }, [
    profile?.departmentName,
    profile?.fullName,
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

      transaction.set(frontOfficeRef, {
        occupiedRooms: nextOperations.occupiedRooms,
        occupiedRoomNumbers: nextOperations.occupiedRoomNumbers,
        roomMoves: normalizeOperationsRoomMoves(roomMoves),
        activityEntries: normalizedActivityEntries,
        reportHistory: upsertOperationsReportHistory(
          currentOperations.reportHistory ?? [],
          { ...visibleOperations, activityEntries: normalizedActivityEntries },
          profile,
        ),
        inHouse: nextOperations.inHouse,
        availableRooms: visibleOperations.availableRooms,
        breakfastEntitled: nextOperations.breakfastEntitled,
        cleanedRoomNumbers: nextOperations.cleanedRoomNumbers,
        cleanedRooms: nextOperations.cleanedRooms,
        notes: nextOperations.notes ?? "",
        updatedAt: serverTimestamp(),
        updatedByUid: profile?.uid ?? null,
        updatedByName: profile?.fullName ?? "Front Office",
        updatedByDepartment: profile?.departmentName ?? "Front Office",
      }, { merge: true });

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

    await commitTrackedWrite({
      writes: [
        {
          ref: doc(db, "portal", "nightDuty"),
          data: {
            operationalDateKey: nextNightDutyData.operationalDateKey,
            income: nextNightDutyData.income,
            onDutyStaff: nextNightDutyData.onDutyStaff,
            cookingGas: nextNightDutyData.cookingGas,
            updatedAt: serverTimestamp(),
            updatedByUid: profile?.uid ?? null,
            updatedByName: profile?.fullName ?? "",
            updatedByDepartment: profile?.departmentName ?? "",
          },
          options: { merge: true },
        },
      ],
      notification: buildNotificationEntry({
        audienceTag: "night-duty",
        title: "Night Duty update",
        message: `${profile?.fullName ?? "Night Duty"} updated the night duty board.`,
      }),
      activity: buildActivityLogEntry({
        area: "night_duty",
        actionType: "night_duty_update",
        message: `${profile?.fullName ?? "Night Duty"} updated night duty records.`,
      }),
    });
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

    const staffMember = portalState.teamMembers.find((member) => member.uid === values.userId);

    if (!staffMember) {
      throw new Error("Select a valid team member before assigning a shift.");
    }

    if (!values.shiftDate) {
      throw new Error("Select a shift date before saving.");
    }

    const shiftId = `${values.userId}-${values.shiftDate}`;
    const nextShifts = normalizeShifts([
      ...portalState.departmentShifts.filter((shift) => shift.id !== shiftId),
      {
        id: shiftId,
        userId: values.userId,
        staffName: staffMember.fullName,
        shiftDate: values.shiftDate,
      },
    ]);

    await commitTrackedWrite({
      writes: [
        {
          ref: doc(db, "departments", profile.departmentKey),
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

  async function removeShiftAssignment(shiftId) {
    if (!db || !profile?.departmentKey) {
      throw new Error("Shift assignments are not available yet.");
    }

    const nextShifts = portalState.departmentShifts.filter((shift) => shift.id !== shiftId);

    await commitTrackedWrite({
      writes: [
        {
          ref: doc(db, "departments", profile.departmentKey),
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
    saveNightDutyData,
    saveStaffProfile,
    saveShiftAssignment,
    removeShiftAssignment,
  };
}
