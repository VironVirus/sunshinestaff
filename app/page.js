"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PortalLogo from "@/components/PortalLogo";
import { departmentOptions } from "@/data/departments";
import { useAuth } from "@/context/AuthContext";
import {
  getDefaultStaffTitle,
  getStaffTitleOptions,
  jobLevelOptions,
} from "@/lib/roles";
import { missingFirebaseKeys } from "@/lib/firebase";

const emptyLoginForm = {
  email: "",
  password: "",
};

const emptyRegisterForm = {
  fullName: "",
  email: "",
  password: "",
  birthday: "",
  phoneNumber: "",
  homeAddress: "",
  departmentKey: "it",
  jobLevel: "manager",
  staffTitle: getDefaultStaffTitle("it", "manager"),
};

function StaffTitleField({ departmentKey, jobLevel, value, onChange }) {
  const titleOptions = getStaffTitleOptions(departmentKey, jobLevel);

  return (
    <label className="field">
      <span>Staff title</span>
      <select value={value} onChange={onChange}>
        {titleOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function HomePage() {
  const router = useRouter();
  const {
    user,
    profile,
    loading,
    login,
    register,
    restoreProfile,
    logout,
    hasFirebaseConfig,
  } = useAuth();
  const [mode, setMode] = useState("register");
  const [loginForm, setLoginForm] = useState(emptyLoginForm);
  const [registerForm, setRegisterForm] = useState(emptyRegisterForm);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });

  const currentTitleOptions = useMemo(
    () => getStaffTitleOptions(registerForm.departmentKey, registerForm.jobLevel),
    [registerForm.departmentKey, registerForm.jobLevel],
  );

  useEffect(() => {
    if (!loading && user && profile) {
      router.replace("/dashboard");
    }
  }, [loading, profile, router, user]);

  useEffect(() => {
    if (!user || profile) {
      return;
    }

    setRegisterForm((current) => ({
      ...current,
      email: user.email ?? current.email,
      fullName: current.fullName || user.displayName || "",
    }));
  }, [profile, user]);

  useEffect(() => {
    if (!currentTitleOptions.some((option) => option.value === registerForm.staffTitle)) {
      setRegisterForm((current) => ({
        ...current,
        staffTitle: getDefaultStaffTitle(current.departmentKey, current.jobLevel),
      }));
    }
  }, [currentTitleOptions, registerForm.staffTitle]);

  async function handleLogin(event) {
    event.preventDefault();
    setBusy(true);
    setFeedback({ type: "", message: "" });

    try {
      await login(loginForm);
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    setBusy(true);
    setFeedback({ type: "", message: "" });

    try {
      const nextProfile = await register(registerForm);

      setFeedback({
        type: "success",
        message: nextProfile.approvalStatus === "pending"
          ? "Your account is pending approval. The Super Admin or HR Manager must approve it before you can log in."
          : nextProfile.isSuperAdmin
          ? `${nextProfile.staffTitle} account is now active as a super admin.`
          : "Your staff account has been created. Opening your dashboard now.",
      });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleOrphanedSessionSignOut() {
    setBusy(true);
    setFeedback({ type: "", message: "" });

    try {
      await logout();
      setLoginForm(emptyLoginForm);
      setRegisterForm(emptyRegisterForm);
    } finally {
      setBusy(false);
    }
  }

  async function handleRestoreProfile(event) {
    event.preventDefault();
    setBusy(true);
    setFeedback({ type: "", message: "" });

    try {
      const restoredProfile = await restoreProfile({
        fullName: registerForm.fullName || user?.displayName || user?.email || "Staff Member",
        birthday: registerForm.birthday,
        phoneNumber: registerForm.phoneNumber,
        homeAddress: registerForm.homeAddress,
        departmentKey: registerForm.departmentKey,
        jobLevel: registerForm.jobLevel,
        staffTitle: registerForm.staffTitle,
      });

      setFeedback({
        type: "success",
        message: restoredProfile.approvalStatus === "pending"
          ? "Your staff profile is saved and now pending approval from the Super Admin or HR Manager before you can log in."
          : restoredProfile.restoredLocally
          ? "Your staff profile was restored in this browser. The dashboard is opening, but Firebase permissions still need to be fixed for shared sync."
          : restoredProfile.isSuperAdmin
            ? `${restoredProfile.staffTitle} profile has been restored as a super admin.`
            : "Your staff profile has been restored. Opening your dashboard now.",
      });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  function updateRegisterForm(field, value) {
    setRegisterForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateDepartment(value) {
    setRegisterForm((current) => ({
      ...current,
      departmentKey: value,
      staffTitle: getDefaultStaffTitle(value, current.jobLevel),
    }));
  }

  function updateJobLevel(value) {
    setRegisterForm((current) => ({
      ...current,
      jobLevel: value,
      staffTitle: getDefaultStaffTitle(current.departmentKey, value),
    }));
  }

  if (!loading && user && profile) {
    return (
      <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4 py-10">
        <div className="panel w-full max-w-xl p-8 text-center">
          <h2 className="section-title">Opening your dashboard</h2>
        </div>
      </div>
    );
  }

  if (!loading && user && !profile) {
    return (
      <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4 py-10">
        <div className="panel w-full max-w-3xl p-8">
          <h2 className="section-title">Profile required</h2>

          {feedback.message ? (
            <div
              className={`mt-6 rounded-[24px] px-5 py-4 text-sm leading-7 ${
                feedback.type === "success"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-rose-50 text-rose-700"
              }`}
            >
              {feedback.message}
            </div>
          ) : null}

          <form onSubmit={handleRestoreProfile} className="mt-6 space-y-4">
            <label className="field">
              <span>Staff email</span>
              <input type="email" value={user.email ?? ""} disabled />
            </label>

            <label className="field">
              <span>Full name</span>
              <input
                type="text"
                value={registerForm.fullName}
                onChange={(event) => updateRegisterForm("fullName", event.target.value)}
                required
              />
            </label>

            <label className="field">
              <span>Birthday</span>
              <input
                type="date"
                value={registerForm.birthday}
                onChange={(event) => updateRegisterForm("birthday", event.target.value)}
                required
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field">
                <span>Phone number</span>
                <input
                  type="tel"
                  value={registerForm.phoneNumber}
                  onChange={(event) => updateRegisterForm("phoneNumber", event.target.value)}
                  required
                />
              </label>

              <label className="field">
                <span>Home address</span>
                <input
                  type="text"
                  value={registerForm.homeAddress}
                  onChange={(event) => updateRegisterForm("homeAddress", event.target.value)}
                  required
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field">
                <span>Department</span>
                <select
                  value={registerForm.departmentKey}
                  onChange={(event) => updateDepartment(event.target.value)}
                >
                  {departmentOptions.map((department) => (
                    <option key={department.value} value={department.value}>
                      {department.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Role level</span>
                <select
                  value={registerForm.jobLevel}
                  onChange={(event) => updateJobLevel(event.target.value)}
                >
                  {jobLevelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <StaffTitleField
              departmentKey={registerForm.departmentKey}
              jobLevel={registerForm.jobLevel}
              value={registerForm.staffTitle}
              onChange={(event) => updateRegisterForm("staffTitle", event.target.value)}
            />

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                disabled={busy || !hasFirebaseConfig}
                className="button-primary flex-1"
              >
                {busy ? "Restoring profile..." : "Restore profile"}
              </button>
              <button
                type="button"
                onClick={handleOrphanedSessionSignOut}
                disabled={busy}
                className="button-secondary flex-1"
              >
                Sign out and try again
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl items-center px-4 py-8 sm:px-6 lg:px-8">
      <div className="grid w-full gap-8 lg:grid-cols-[1.08fr_0.92fr]">
        <section className="panel hero-panel overflow-hidden p-8">
          <PortalLogo size="lg" />

          <div className="mt-8">
            <h2 className="section-title">Staff Portal</h2>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {departmentOptions.map((department) => (
                <div
                  key={department.value}
                  className="rounded-2xl border border-white/80 bg-white/85 px-4 py-3 text-sm text-slate-700"
                >
                  {department.label}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="panel p-6 sm:p-8">
          <div className="flex gap-3 rounded-full bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`flex-1 rounded-full px-4 py-3 text-sm font-semibold transition ${
                mode === "register"
                  ? "bg-white text-[#162338] shadow"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Register first
            </button>
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`flex-1 rounded-full px-4 py-3 text-sm font-semibold transition ${
                mode === "login"
                  ? "bg-white text-[#162338] shadow"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Staff sign in
            </button>
          </div>

          <div className="mt-6">
            <h2 className="section-title">
              {mode === "register" ? "Create staff account" : "Staff sign in"}
            </h2>
          </div>

          {!hasFirebaseConfig ? (
            <div className="mt-6 rounded-[28px] border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
              Firebase is not ready yet.
              <div className="mt-3 rounded-2xl bg-white/70 px-4 py-3 text-xs text-rose-900">
                Missing keys: {missingFirebaseKeys.join(", ")}
              </div>
            </div>
          ) : null}

          {feedback.message ? (
            <div
              className={`mt-6 rounded-[24px] px-5 py-4 text-sm leading-7 ${
                feedback.type === "success"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-rose-50 text-rose-700"
              }`}
            >
              {feedback.message}
            </div>
          ) : null}

          {mode === "login" ? (
            <form onSubmit={handleLogin} className="mt-6 space-y-4">
              <label className="field">
                <span>Staff email</span>
                <input
                  type="email"
                  value={loginForm.email}
                  onChange={(event) =>
                    setLoginForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  required
                />
              </label>

              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(event) =>
                    setLoginForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  required
                />
              </label>

              <button
                type="submit"
                disabled={busy || !hasFirebaseConfig}
                className="button-primary w-full"
              >
                {busy ? "Signing in..." : "Open dashboard"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="mt-6 space-y-4">
              <label className="field">
                <span>Full name</span>
                <input
                  type="text"
                  value={registerForm.fullName}
                  onChange={(event) => updateRegisterForm("fullName", event.target.value)}
                  required
                />
              </label>

              <label className="field">
                <span>Staff email</span>
                <input
                  type="email"
                  value={registerForm.email}
                  onChange={(event) => updateRegisterForm("email", event.target.value)}
                  required
                />
              </label>

              <label className="field">
                <span>Birthday</span>
                <input
                  type="date"
                  value={registerForm.birthday}
                  onChange={(event) => updateRegisterForm("birthday", event.target.value)}
                  required
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="field">
                  <span>Phone number</span>
                  <input
                    type="tel"
                    value={registerForm.phoneNumber}
                    onChange={(event) => updateRegisterForm("phoneNumber", event.target.value)}
                    required
                  />
                </label>

                <label className="field">
                  <span>Home address</span>
                  <input
                    type="text"
                    value={registerForm.homeAddress}
                    onChange={(event) => updateRegisterForm("homeAddress", event.target.value)}
                    required
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="field">
                  <span>Department</span>
                  <select
                    value={registerForm.departmentKey}
                    onChange={(event) => updateDepartment(event.target.value)}
                  >
                    {departmentOptions.map((department) => (
                      <option key={department.value} value={department.value}>
                        {department.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Role level</span>
                  <select
                    value={registerForm.jobLevel}
                    onChange={(event) => updateJobLevel(event.target.value)}
                  >
                    {jobLevelOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <StaffTitleField
                departmentKey={registerForm.departmentKey}
                jobLevel={registerForm.jobLevel}
                value={registerForm.staffTitle}
                onChange={(event) => updateRegisterForm("staffTitle", event.target.value)}
              />

              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  value={registerForm.password}
                  onChange={(event) => updateRegisterForm("password", event.target.value)}
                  required
                />
              </label>

              <button
                type="submit"
                disabled={busy || !hasFirebaseConfig}
                className="button-primary w-full"
              >
                {busy ? "Creating account..." : "Create staff account"}
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
