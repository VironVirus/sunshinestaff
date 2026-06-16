"use client";

import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "@firebase/firestore";
import {
  defaultBirthdays,
  defaultFrontOfficeSnapshot,
  defaultHighlights,
  defaultSiteContent,
} from "@/data/mockData";
import { deriveOperationsSnapshot, normalizeRoomNumbers } from "@/data/hotelRooms";
import { defaultPropertyStatus, mergePropertyStatus } from "@/data/propertyStatus";
import { defaultEventsBookings, mergeEventsBookings } from "@/data/eventsBookings";
import {
  buildDefaultHousekeepingReports,
  mergeHousekeepingReports,
} from "@/data/housekeepingReports";
import { defaultStoreInventory, mergeStoreInventory } from "@/data/storeInventory";
import { defaultNightDutyData, mergeNightDutyData } from "@/data/nightDuty";
import { db, hasFirebaseConfig } from "@/lib/firebase";
import {
  getHousekeepingReportAccess,
  getNightDutyAccess,
  getManagerWorkspaceAccess,
  getOperationsAccess,
  getPropertyAccess,
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
  staffDirectory: [],
  teamMembers: [],
  departmentShifts: [],
};

const MAX_REPORT_HISTORY_DAYS = 120;

function normalizeOperationsRoomMoves(roomMoves = []) {
  return roomMoves
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

function normalizeOperationsReportHistory(reportHistory = []) {
  return reportHistory
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
  return deriveOperationsSnapshot({
    ...defaultFrontOfficeSnapshot,
    ...payload,
  });
}

function mergeSiteContent(payload = {}) {
  return {
    ...defaultSiteContent,
    ...payload,
    announcements: Array.isArray(payload.announcements) ? payload.announcements : [],
    newsItems: Array.isArray(payload.newsItems) ? payload.newsItems : [],
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
  return shifts
    .filter((shift) => shift?.id && shift?.userId && shift?.shiftDate)
    .sort((left, right) => left.shiftDate.localeCompare(right.shiftDate));
}

function isActiveStaff(user = {}) {
  return (user.employmentStatus ?? "active") === "active";
}

export function usePortalData(profile) {
  const [portalState, setPortalState] = useState(defaultPortalState);
  const [syncing, setSyncing] = useState(hasFirebaseConfig);
  const [error, setError] = useState("");
  const operationsAccess = getOperationsAccess(profile);
  const propertyAccess = getPropertyAccess(profile);
  const managerWorkspaceAccess = getManagerWorkspaceAccess(profile);
  const housekeepingReportAccess = getHousekeepingReportAccess(profile);
  const storeAccess = getStoreAccess(profile);
  const nightDutyAccess = getNightDutyAccess(profile);

  useEffect(() => {
    if (!hasFirebaseConfig || !db) {
      setSyncing(false);
      return undefined;
    }

    setSyncing(true);
    setError("");

    let pendingListeners =
      3 +
      (operationsAccess.canViewPanel ? 1 : 0) +
      (profile?.departmentKey ? 1 : 0) +
      (propertyAccess.canViewPanel ? 1 : 0) +
      (managerWorkspaceAccess.canViewEvents ? 1 : 0) +
      (housekeepingReportAccess.canViewPanel ? 1 : 0) +
      (storeAccess.canViewPanel ? 1 : 0) +
      (nightDutyAccess.canViewPanel ? 1 : 0);

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
      onSnapshot(
        collection(db, "users"),
        (snapshot) => {
          const users = snapshot.docs
            .map((document) => ({
              uid: document.id,
              ...document.data(),
            }))
            .sort((left, right) => left.fullName.localeCompare(right.fullName));
          const activeUsers = users.filter((user) => isActiveStaff(user));

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
      ),
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
    profile?.departmentKey,
    propertyAccess.canViewPanel,
    storeAccess.canViewPanel,
  ]);

  async function saveOperations(values) {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    const nextOperations = mergeOperations({
      ...portalState.operations,
      ...values,
    });
    const visibleOperations = mergeOperationsWithPropertyStatus(
      nextOperations,
      portalState.propertyStatus,
    );

    await setDoc(
      doc(db, "portal", "frontOffice"),
      {
        occupiedRooms: nextOperations.occupiedRooms,
        occupiedRoomNumbers: nextOperations.occupiedRoomNumbers,
        roomMoves: normalizeOperationsRoomMoves(nextOperations.roomMoves ?? []),
        reportHistory: upsertOperationsReportHistory(
          portalState.operations.reportHistory ?? [],
          visibleOperations,
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
      },
      { merge: true },
    );
  }

  async function saveHousekeepingProgress(values) {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    const nextOperations = mergeOperations({
      ...portalState.operations,
      ...values,
    });
    const visibleOperations = mergeOperationsWithPropertyStatus(
      nextOperations,
      portalState.propertyStatus,
    );

    await setDoc(
      doc(db, "portal", "frontOffice"),
      {
        cleanedRoomNumbers: nextOperations.cleanedRoomNumbers,
        cleanedRooms: nextOperations.cleanedRooms,
        reportHistory: upsertOperationsReportHistory(
          portalState.operations.reportHistory ?? [],
          visibleOperations,
          profile,
        ),
        housekeepingUpdatedAt: serverTimestamp(),
        housekeepingUpdatedByUid: profile?.uid ?? null,
        housekeepingUpdatedByName: profile?.fullName ?? "HouseKeeping",
        housekeepingUpdatedByDepartment: profile?.departmentName ?? "HouseKeeping",
      },
      { merge: true },
    );
  }

  async function saveRoomIssues(values) {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    const nextPropertyStatus = mergePropertyStatus({
      ...portalState.propertyStatus,
      ...values,
    });

    await setDoc(
      doc(db, "portal", "maintenance"),
      {
        roomIssues: nextPropertyStatus.roomIssues,
        roomIssuesUpdatedAt: serverTimestamp(),
        roomIssuesUpdatedByUid: profile?.uid ?? null,
        roomIssuesUpdatedByName: profile?.fullName ?? "",
        roomIssuesUpdatedByDepartment: profile?.departmentName ?? "",
      },
      { merge: true },
    );
  }

  async function saveRoomComplaints(values) {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    const nextPropertyStatus = mergePropertyStatus({
      ...portalState.propertyStatus,
      ...values,
    });

    await setDoc(
      doc(db, "portal", "maintenance"),
      {
        roomComplaints: nextPropertyStatus.roomComplaints,
        roomComplaintsUpdatedAt: serverTimestamp(),
        roomComplaintsUpdatedByUid: profile?.uid ?? null,
        roomComplaintsUpdatedByName: profile?.fullName ?? "",
        roomComplaintsUpdatedByDepartment: profile?.departmentName ?? "",
      },
      { merge: true },
    );
  }

  async function saveUtilities(values) {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    const nextPropertyStatus = mergePropertyStatus({
      ...portalState.propertyStatus,
      ...values,
    });

    await setDoc(
      doc(db, "portal", "maintenance"),
      {
        utilities: nextPropertyStatus.utilities,
        utilitiesUpdatedAt: serverTimestamp(),
        utilitiesUpdatedByUid: profile?.uid ?? null,
        utilitiesUpdatedByName: profile?.fullName ?? "",
        utilitiesUpdatedByDepartment: profile?.departmentName ?? "",
      },
      { merge: true },
    );
  }

  async function saveEventBooking(values) {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    const nextEventsBookings = mergeEventsBookings({
      ...portalState.eventsBookings,
      ...values,
    });

    await setDoc(
      doc(db, "portal", "eventsBookings"),
      {
        events: nextEventsBookings.events,
        updatedAt: serverTimestamp(),
        updatedByUid: profile?.uid ?? null,
        updatedByName: profile?.fullName ?? "",
        updatedByDepartment: profile?.departmentName ?? "",
      },
      { merge: true },
    );
  }

  async function saveHousekeepingReports(values) {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    const nextHousekeepingReports = mergeHousekeepingReports({
      ...portalState.housekeepingReports,
      ...values,
    });

    await setDoc(
      doc(db, "portal", "housekeepingReports"),
      {
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
      { merge: true },
    );
  }

  async function saveStoreInventorySection(fieldName, values) {
    if (!db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    const nextStoreInventory = mergeStoreInventory({
      ...portalState.storeInventory,
      ...values,
    });

    await setDoc(
      doc(db, "portal", "storeInventory"),
      {
        [fieldName]: nextStoreInventory[fieldName],
        updatedAt: serverTimestamp(),
        updatedByUid: profile?.uid ?? null,
        updatedByName: profile?.fullName ?? "",
        updatedByDepartment: profile?.departmentName ?? "",
      },
      { merge: true },
    );
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

    await setDoc(
      doc(db, "portal", "nightDuty"),
      {
        operationalDateKey: nextNightDutyData.operationalDateKey,
        income: nextNightDutyData.income,
        onDutyStaff: nextNightDutyData.onDutyStaff,
        cookingGas: nextNightDutyData.cookingGas,
        updatedAt: serverTimestamp(),
        updatedByUid: profile?.uid ?? null,
        updatedByName: profile?.fullName ?? "",
        updatedByDepartment: profile?.departmentName ?? "",
      },
      { merge: true },
    );
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

    await setDoc(
      doc(db, "users", userId),
      {
        ...values,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
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

    await setDoc(
      doc(db, "departments", profile.departmentKey),
      {
        shifts: nextShifts,
        updatedAt: serverTimestamp(),
        updatedByUid: profile.uid,
        updatedByName: profile.fullName,
      },
      { merge: true },
    );
  }

  async function removeShiftAssignment(shiftId) {
    if (!db || !profile?.departmentKey) {
      throw new Error("Shift assignments are not available yet.");
    }

    const nextShifts = portalState.departmentShifts.filter((shift) => shift.id !== shiftId);

    await setDoc(
      doc(db, "departments", profile.departmentKey),
      {
        shifts: nextShifts,
        updatedAt: serverTimestamp(),
        updatedByUid: profile.uid,
        updatedByName: profile.fullName,
      },
      { merge: true },
    );
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
