"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function DashboardLayout({ children }) {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/");
    }
  }, [loading, router, user]);

  if (loading || !user) {
    return (
      <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4 py-10">
        <div className="panel w-full max-w-xl p-8 text-center">
          <p className="eyebrow">Security Check</p>
          <h2 className="section-title">Preparing your dashboard</h2>
          <p className="section-copy mx-auto">
            We are checking your session and loading the correct staff workspace.
          </p>
        </div>
      </div>
    );
  }

  return children;
}
