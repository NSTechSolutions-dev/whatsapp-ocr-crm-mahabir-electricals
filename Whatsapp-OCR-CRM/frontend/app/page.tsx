"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (user) {
        router.replace("/inbox");
      } else {
        router.replace("/login");
      }
    }
  }, [user, loading, router]);

  // Fallback: if still loading after 8 seconds, force redirect to login
  useEffect(() => {
    const t = setTimeout(() => {
      router.replace("/login");
    }, 8000);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <div className="flex h-screen items-center justify-center flex-col gap-3">
      <div className="h-8 w-8 rounded-full border-4 border-brand border-t-transparent animate-spin" />
      <div className="text-sm text-ink-muted">Loading…</div>
    </div>
  );
}
