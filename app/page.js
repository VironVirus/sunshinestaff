"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PortalLogo from "@/components/PortalLogo";
import { departmentOptions } from "@/data/departments";
import { useAuth } from "@/context/AuthContext";
import { getDefaultStaffTitle, jobLevelOptions } from "@/lib/roles";

const emptyLogin = { email: "", password: "" };
const emptyRegister = {
  fullName: "",
  email: "",
  password: "",
  departmentKey: "front_office",
  jobLevel: "line_staff",
};

export default function HomePage() {
  const router = useRouter();
  const { user, profile, loading, login, register, logout, hasFirebaseConfig } = useAuth();
  const [mode, setMode] = useState("login");
  const [loginForm, setLoginForm] = useState(emptyLogin);
  const [registerForm, setRegisterForm] = useState(emptyRegister);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });

  useEffect(() => {
    if (!loading && user && profile) router.replace("/dashboard");
  }, [loading, profile, router, user]);

  async function submitLogin(event) {
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

  async function submitRegister(event) {
    event.preventDefault();
    setBusy(true);
    setFeedback({ type: "", message: "" });
    try {
      await register({
        ...registerForm,
        birthday: "",
        phoneNumber: "",
        homeAddress: "",
        staffTitle: getDefaultStaffTitle(registerForm.departmentKey, registerForm.jobLevel),
      });
      setRegisterForm(emptyRegister);
      setMode("login");
      setFeedback({ type: "success", message: "Account created. Wait for approval before signing in." });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  function updateRegister(field, value) {
    setRegisterForm((current) => ({ ...current, [field]: value }));
  }

  if (!loading && user && !profile) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 py-8">
        <section className="panel w-full max-w-md p-6 text-center sm:p-8">
          <PortalLogo size="md" showText={false} className="justify-center" />
          <h1 className="section-title mt-6">Profile unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">Contact IT to restore your staff profile.</p>
          <button type="button" className="button-secondary mt-6 w-full" onClick={logout}>
            Sign out
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <section className="panel w-full max-w-md p-6 sm:p-8">
        <div className="text-center">
          <PortalLogo size="md" showText={false} className="justify-center" />
          <h1 className="section-title mt-5">Staff Portal</h1>
        </div>

        <div className="mt-6 flex rounded-full bg-slate-100 p-1">
          {[{ key: "login", label: "Sign in" }, { key: "register", label: "Create account" }].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => { setMode(item.key); setFeedback({ type: "", message: "" }); }}
              className={`min-h-11 flex-1 rounded-full px-3 text-sm font-semibold transition ${
                mode === item.key ? "bg-white text-[#162338] shadow" : "text-slate-500"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {!hasFirebaseConfig ? (
          <p className="mt-5 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Firebase is not configured.
          </p>
        ) : null}
        {feedback.message ? (
          <p className={`mt-5 rounded-2xl px-4 py-3 text-sm ${
            feedback.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
          }`}>
            {feedback.message}
          </p>
        ) : null}

        {mode === "login" ? (
          <form onSubmit={submitLogin} className="mt-6 space-y-4">
            <label className="field">
              <span>Email</span>
              <input type="email" autoComplete="email" maxLength={254} required value={loginForm.email}
                onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))} />
            </label>
            <label className="field">
              <span>Password</span>
              <input type="password" autoComplete="current-password" minLength={8} maxLength={128} required
                value={loginForm.password}
                onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))} />
            </label>
            <button className="button-primary w-full" disabled={busy || loading || !hasFirebaseConfig}>
              {busy ? "Signing in..." : "Sign in"}
            </button>
          </form>
        ) : (
          <form onSubmit={submitRegister} className="mt-6 space-y-4">
            <label className="field">
              <span>Full name</span>
              <input autoComplete="name" maxLength={80} required value={registerForm.fullName}
                onChange={(event) => updateRegister("fullName", event.target.value)} />
            </label>
            <label className="field">
              <span>Email</span>
              <input type="email" autoComplete="email" maxLength={254} required value={registerForm.email}
                onChange={(event) => updateRegister("email", event.target.value)} />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field">
                <span>Department</span>
                <select value={registerForm.departmentKey} onChange={(event) => updateRegister("departmentKey", event.target.value)}>
                  {departmentOptions.map((department) => <option key={department.value} value={department.value}>{department.label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Role</span>
                <select value={registerForm.jobLevel} onChange={(event) => updateRegister("jobLevel", event.target.value)}>
                  {jobLevelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            </div>
            <label className="field">
              <span>Password</span>
              <input type="password" autoComplete="new-password" minLength={8} maxLength={128} required
                value={registerForm.password} onChange={(event) => updateRegister("password", event.target.value)} />
            </label>
            <button className="button-primary w-full" disabled={busy || loading || !hasFirebaseConfig}>
              {busy ? "Creating..." : "Create account"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
