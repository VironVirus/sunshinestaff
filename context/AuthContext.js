"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "@firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "@firebase/firestore";
import { auth, db, hasFirebaseConfig } from "@/lib/firebase";
import { buildProfilePayload } from "@/lib/roles";

const AuthContext = createContext(null);

function normalizeLoadedProfile(profile = null) {
  if (!profile) return null;

  return {
    ...profile,
    approvalStatus: profile.approvalStatus ?? "pending",
    approvedAt: profile.approvedAt ?? "",
    approvedByName: profile.approvedByName ?? "",
    phoneNumber: profile.phoneNumber ?? "",
    homeAddress: profile.homeAddress ?? "",
    employmentStartDate: profile.employmentStartDate ?? "",
    leaveRecords: Array.isArray(profile.leaveRecords) ? profile.leaveRecords : [],
    monthlySalary: Number.isFinite(profile.monthlySalary) ? profile.monthlySalary : 0,
    payrollMonthKey: profile.payrollMonthKey ?? "",
    absenceDays: Number.isFinite(profile.absenceDays) ? profile.absenceDays : 0,
    lateCount: Number.isFinite(profile.lateCount) ? profile.lateCount : 0,
    pensionAmount: Number.isFinite(profile.pensionAmount) ? profile.pensionAmount : 0,
    taxAmount: Number.isFinite(profile.taxAmount) ? profile.taxAmount : 0,
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
    if (!db || !uid) {
      setProfile(null);
      return null;
    }

    try {
      const snapshot = await getDoc(doc(db, "users", uid));
      const nextProfile = snapshot.exists()
        ? normalizeLoadedProfile(snapshot.data())
        : null;
      setProfile(nextProfile);
      return nextProfile;
    } catch (error) {
      console.error("Unable to load staff profile", error);
      setProfile(null);
      return null;
    }
  }

  useEffect(() => {
    if (!hasFirebaseConfig || !auth) {
      setLoading(false);
      return undefined;
    }

    return onAuthStateChanged(auth, async (currentUser) => {
      setLoading(true);
      setUser(currentUser ?? null);

      if (!currentUser) {
        setProfile(null);
        setLoading(false);
        return;
      }

      await loadProfile(currentUser.uid);
      setLoading(false);
    });
  }, []);

  async function login({ email, password }) {
    if (!auth) throw new Error("Firebase is not configured.");

    setLoading(true);
    try {
      const credential = await signInWithEmailAndPassword(
        auth,
        email.trim().toLowerCase(),
        password,
      );
      const loadedProfile = await loadProfile(credential.user.uid);

      if (!loadedProfile) {
        await signOut(auth);
        throw new Error("Staff profile not found. Contact IT.");
      }
      if (loadedProfile.employmentStatus !== "active") {
        await signOut(auth);
        throw new Error("This account is inactive. Contact HR.");
      }
      if (loadedProfile.approvalStatus !== "approved") {
        await signOut(auth);
        throw new Error("This account is awaiting approval.");
      }

      setUser(credential.user);
      return loadedProfile;
    } catch (error) {
      setUser(null);
      setProfile(null);
      throw error;
    } finally {
      setLoading(false);
    }
  }

  async function register(form) {
    if (!auth || !db) throw new Error("Firebase is not configured.");

    setLoading(true);
    try {
      const email = form.email.trim().toLowerCase();
      const credential = await createUserWithEmailAndPassword(auth, email, form.password);
      const baseProfile = buildProfilePayload({
        ...form,
        uid: credential.user.uid,
        email,
      });

      await setDoc(doc(db, "users", credential.user.uid), {
        ...baseProfile,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await signOut(auth);
      setUser(null);
      setProfile(null);
      return baseProfile;
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    if (auth) await signOut(auth);
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
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
};
