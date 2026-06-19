"use client";
import { createContext, useContext, useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "@firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "@firebase/firestore";
import { auth, db, hasFirebaseConfig } from "@/lib/firebase";
import { buildProfilePayload } from "@/lib/roles";

const AuthContext = createContext(null);
const profileCacheKey = "sunshine_staff_profile_cache";

function readCachedProfile(uid) {
  if (typeof window === "undefined" || !uid) {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(profileCacheKey);

    if (!rawValue) {
      return null;
    }

    const profileMap = JSON.parse(rawValue);
    return profileMap[uid] ?? null;
  } catch {
    return null;
  }
}

function writeCachedProfile(profile) {
  if (typeof window === "undefined" || !profile?.uid) {
    return;
  }

  try {
    const rawValue = window.localStorage.getItem(profileCacheKey);
    const profileMap = rawValue ? JSON.parse(rawValue) : {};

    profileMap[profile.uid] = profile;
    window.localStorage.setItem(profileCacheKey, JSON.stringify(profileMap));
  } catch {
    // Ignore local cache failures so auth still works without browser storage.
  }
}

function sanitizeProfileForFirestore(profile = {}) {
  const { restoredLocally, ...safeProfile } = profile;
  return safeProfile;
}

function normalizeLoadedProfile(profile = null) {
  if (!profile) {
    return null;
  }

  return {
    ...profile,
    approvalStatus: profile.approvalStatus ?? "approved",
    approvedAt: profile.approvedAt ?? "",
    approvedByName: profile.approvedByName ?? "",
    phoneNumber: profile.phoneNumber ?? "",
    homeAddress: profile.homeAddress ?? "",
    employmentStartDate: profile.employmentStartDate ?? "",
    leaveRecords: Array.isArray(profile.leaveRecords) ? profile.leaveRecords : [],
    monthlySalary: profile.monthlySalary ?? 0,
    payrollMonthKey: profile.payrollMonthKey ?? "",
    absenceDays: profile.absenceDays ?? 0,
    lateCount: profile.lateCount ?? 0,
    pensionAmount: profile.pensionAmount ?? 0,
    taxAmount: profile.taxAmount ?? 0,
    salaryUpdatedAt: profile.salaryUpdatedAt ?? "",
    salaryUpdatedByName: profile.salaryUpdatedByName ?? "",
    lastProfileNotification: profile.lastProfileNotification ?? "",
    lastProfileNotificationAt: profile.lastProfileNotificationAt ?? "",
  };
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(uid) {
    const cachedProfile = normalizeLoadedProfile(readCachedProfile(uid));

    if (!db) {
      setProfile(cachedProfile);
      return cachedProfile;
    }

    try {
      const profileSnapshot = await getDoc(doc(db, "users", uid));

      if (!profileSnapshot.exists()) {
        if (cachedProfile) {
          try {
            await setDoc(
              doc(db, "users", uid),
              {
                ...sanitizeProfileForFirestore(cachedProfile),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              },
              { merge: true },
            );

            const restoredSnapshot = await getDoc(doc(db, "users", uid));

            if (restoredSnapshot.exists()) {
              const restoredProfile = normalizeLoadedProfile(restoredSnapshot.data());
              setProfile(restoredProfile);
              writeCachedProfile(restoredProfile);
              return restoredProfile;
            }
          } catch {
            // Keep using the cached profile when Firestore still cannot be repaired.
          }
        }

        setProfile(cachedProfile);
        return cachedProfile;
      }

      const profileData = normalizeLoadedProfile(profileSnapshot.data());
      setProfile(profileData);
      writeCachedProfile(profileData);
      return profileData;
    } catch (error) {
      console.error("Unable to load staff profile from Firestore", error);
      setProfile(cachedProfile);
      return cachedProfile;
    }
  }

  useEffect(() => {
    if (!hasFirebaseConfig || !auth) {
      setLoading(false);
      return undefined;
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setLoading(true);
      setUser(currentUser ?? null);

      if (currentUser) {
        try {
          const nextProfile = await loadProfile(currentUser.uid);

          if (
            nextProfile &&
            (
              (nextProfile.employmentStatus && nextProfile.employmentStatus !== "active") ||
              nextProfile.approvalStatus === "pending"
            )
          ) {
            await signOut(auth);
            setUser(null);
            setProfile(null);
          }
        } catch (error) {
          console.error("Unable to load staff profile", error);
          setProfile(null);
        }
      } else {
        setProfile(null);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  async function login({ email, password }) {
    if (!auth) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    setLoading(true);

    try {
      const credential = await signInWithEmailAndPassword(
        auth,
        email.trim().toLowerCase(),
        password,
      );

      setUser(credential.user);
      const loadedProfile = await loadProfile(credential.user.uid);

      if (!loadedProfile) {
        throw new Error(
          "Your account signed in, but the staff profile could not be loaded. Use the recovery form below or ask the IT admin to restore it.",
        );
      }

      if (loadedProfile.employmentStatus && loadedProfile.employmentStatus !== "active") {
        await signOut(auth);
        setUser(null);
        setProfile(null);
        throw new Error("This staff account is no longer active. Please contact Human Resource.");
      }

      if (loadedProfile.approvalStatus === "pending") {
        await signOut(auth);
        setUser(null);
        setProfile(null);
        throw new Error(
          "Account is pending approval. Please wait for the Super Admin or HR Manager to approve your access.",
        );
      }

      return loadedProfile;
    } catch (error) {
      setProfile(null);
      throw error;
    } finally {
      setLoading(false);
    }
  }

  async function register({
    fullName,
    email,
    password,
    birthday,
    phoneNumber,
    homeAddress,
    departmentKey,
    jobLevel,
    staffTitle,
  }) {
    if (!auth || !db) {
      throw new Error("Firebase is not configured yet. Add your NEXT_PUBLIC_FIREBASE variables first.");
    }

    const credential = await createUserWithEmailAndPassword(
      auth,
      email.trim().toLowerCase(),
      password,
    );

    const adminSnapshot = await getDocs(
      query(collection(db, "users"), where("isSuperAdmin", "==", true), limit(1)),
    );

    const isFirstItAdmin =
      adminSnapshot.empty && departmentKey === "it" && jobLevel === "manager";

    const baseProfile = buildProfilePayload({
      uid: credential.user.uid,
      fullName,
      email,
      birthday,
      phoneNumber,
      homeAddress,
      departmentKey,
      jobLevel,
      staffTitle,
      isFirstItAdmin,
    });

    await setDoc(doc(db, "users", credential.user.uid), {
      ...baseProfile,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const localProfile = normalizeLoadedProfile({
      ...baseProfile,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    writeCachedProfile(localProfile);

    if (baseProfile.approvalStatus === "approved") {
      setUser(credential.user);
      setProfile(localProfile);
      return localProfile;
    }

    await signOut(auth);
    setUser(null);
    setProfile(null);

    return localProfile;
  }

  async function restoreProfile({
    fullName,
    birthday,
    phoneNumber,
    homeAddress,
    departmentKey,
    jobLevel,
    staffTitle,
  }) {
    if (!user || !db) {
      throw new Error("You must be signed in before restoring a staff profile.");
    }

    let isFirstItAdmin = false;

    try {
      const adminSnapshot = await getDocs(
        query(collection(db, "users"), where("isSuperAdmin", "==", true), limit(1)),
      );

      isFirstItAdmin =
        adminSnapshot.empty && departmentKey === "it" && jobLevel === "manager";
    } catch {
      isFirstItAdmin = departmentKey === "it" && jobLevel === "manager";
    }

    const baseProfile = buildProfilePayload({
      uid: user.uid,
      fullName,
      email: user.email ?? "",
      birthday,
      phoneNumber,
      homeAddress,
      departmentKey,
      jobLevel,
      staffTitle,
      isFirstItAdmin,
    });

    let restoredLocally = false;

    try {
      await setDoc(
        doc(db, "users", user.uid),
        {
          ...sanitizeProfileForFirestore(baseProfile),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (error) {
      console.error("Unable to restore staff profile in Firestore", error);
      restoredLocally = true;
    }

    const restoredProfile = normalizeLoadedProfile({
      ...baseProfile,
      restoredLocally,
    });

    if (restoredProfile.approvalStatus === "approved") {
      setProfile(restoredProfile);
    } else {
      await signOut(auth);
      setUser(null);
      setProfile(null);
    }
    writeCachedProfile(restoredProfile);
    return restoredProfile;
  }

  async function logout() {
    if (!auth) {
      return;
    }

    await signOut(auth);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        hasFirebaseConfig,
        login,
        register,
        restoreProfile,
        logout,
        reloadProfile: () => (user ? loadProfile(user.uid) : Promise.resolve(null)),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
};
