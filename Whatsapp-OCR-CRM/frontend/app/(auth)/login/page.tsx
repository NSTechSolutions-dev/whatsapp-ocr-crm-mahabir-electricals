"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { BrandLogo } from "../../../lib/brand-logo";
import { BRAND, LOGIN_HERO_IMAGE } from "../../../lib/branding";

function LoginForm() {
  const { login, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("Admin@1234");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) {
      const from = searchParams?.get("from") || "/inbox";
      router.replace(from);
    }
  }, [user, router, searchParams]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(email, password);
      toast.success(`Welcome to ${BRAND.name}`);
      router.replace("/inbox");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-canvas">
      <div className="flex items-center justify-center p-8 lg:p-16">
        <div className="w-full max-w-sm">
          <div className="mb-12">
            <BrandLogo size="lg" />
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">Welcome back</h1>
          <p className="text-ink-muted mt-2 text-sm">
            Sign in to manage enquiries and quotations for {BRAND.name}.
          </p>

          <form onSubmit={onSubmit} className="mt-10 space-y-5">
            <div>
              <Label htmlFor="email" className="text-xs uppercase tracking-wider text-ink-muted">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-2 bg-surface border-line text-ink focus-visible:ring-brand"
                data-testid="login-email-input"
              />
            </div>
            <div>
              <Label htmlFor="password" className="text-xs uppercase tracking-wider text-ink-muted">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="mt-2 bg-surface border-line text-ink focus-visible:ring-brand"
                data-testid="login-password-input"
              />
            </div>
            <Button
              type="submit"
              disabled={submitting}
              data-testid="login-submit-button"
              className="w-full bg-brand hover:bg-brand-hover h-10 text-white"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="text-xs text-ink-muted mt-8">
            Demo credentials are pre-filled. Press <span className="font-medium text-ink">Sign in</span> to continue.
          </p>
        </div>
      </div>
      <div
        className="hidden lg:block bg-cover bg-center relative"
        style={{ backgroundImage: `url('${LOGIN_HERO_IMAGE}')` }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-red-950/80 via-red-900/40 to-black/20" />
        <div className="absolute bottom-12 left-12 right-12 text-white">
          <div className="text-xs uppercase tracking-[0.18em] opacity-90">{BRAND.loginEyebrow}</div>
          <div className="font-display text-3xl font-semibold mt-3 max-w-md">{BRAND.loginHero}</div>
          <div className="mt-4 text-sm opacity-80">{BRAND.name}</div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
