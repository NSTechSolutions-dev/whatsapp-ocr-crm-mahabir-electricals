"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Inbox, Users, Package, Zap, Settings as SettingsIcon, LogOut } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { cn } from "../../lib/utils";
import { BrandLogo } from "../../lib/brand-logo";
import { socket } from "../../lib/socket";
import { toast } from "sonner";

const NAV = [
  { to: "/crm", label: "Customers", icon: Users, testId: "nav-crm" },
  { to: "/inbox", label: "Inbox", icon: Inbox, testId: "nav-inbox" },
  { to: "/inventory", label: "Inventory", icon: Package, testId: "nav-inventory" },
];

const ADMIN_NAV = [
  { to: "/automation", label: "Automation", icon: Zap, testId: "nav-automation" },
  { to: "/settings", label: "Settings", icon: SettingsIcon, testId: "nav-settings" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? "/";

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?from=${encodeURIComponent(pathname)}`);
    }
  }, [user, loading, router, pathname]);

  useEffect(() => {
    if (user) {
      socket.connect();
      socket.on("notification", (n: any) => {
        toast(n.title, {
          description: n.message,
        });
      });
      return () => {
        socket.off("notification");
        socket.disconnect();
      };
    }
  }, [user]);

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-ink-muted">
        Loading…
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen flex bg-canvas">
      <aside className="w-[240px] shrink-0 border-r border-line bg-surface flex flex-col" data-testid="sidebar">
        <div className="px-6 py-6 border-b border-line">
          <BrandLogo size="md" />
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map((n) => {
            const isActive = pathname.startsWith(n.to);
            return (
              <Link
                key={n.to}
                href={n.to}
                data-testid={n.testId}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive
                    ? "bg-brand-50 text-brand font-medium"
                    : "text-ink hover:bg-secondary"
                )}
              >
                <n.icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
          {user.role === "ADMIN" &&
            ADMIN_NAV.map((n) => {
              const isActive = pathname.startsWith(n.to);
              return (
                <Link
                  key={n.to}
                  href={n.to}
                  data-testid={n.testId}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                    isActive
                      ? "bg-brand-50 text-brand font-medium"
                      : "text-ink hover:bg-secondary"
                  )}
                >
                  <n.icon className="h-4 w-4" />
                  {n.label}
                </Link>
              );
            })}
        </nav>
        <div className="px-3 py-4 border-t border-line text-ink">
          <div className="px-3 pb-3">
            <div className="text-sm font-medium" data-testid="current-user-name">
              {user?.name}
            </div>
            <div className="text-xs text-ink-muted">{user?.email}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-ink-muted">
              {user?.role}
            </div>
          </div>
          <button
            onClick={handleLogout}
            data-testid="logout-button"
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-secondary rounded-md transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
