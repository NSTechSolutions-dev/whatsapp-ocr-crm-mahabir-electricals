import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { Inbox, Users, Package, Zap, Settings as SettingsIcon, LogOut, FileText } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/inbox", label: "Inbox", icon: Inbox, testId: "nav-inbox" },
  { to: "/crm", label: "Customers", icon: Users, testId: "nav-crm" },
  { to: "/inventory", label: "Inventory", icon: Package, testId: "nav-inventory" },
  { to: "/automation", label: "Automation", icon: Zap, testId: "nav-automation" },
];

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };
  return (
    <div className="min-h-screen flex bg-canvas">
      <aside className="w-[240px] shrink-0 border-r border-line bg-surface flex flex-col" data-testid="sidebar">
        <div className="px-6 py-6 border-b border-line">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-brand flex items-center justify-center">
              <FileText className="h-4 w-4 text-white" />
            </div>
            <div>
              <div className="font-display text-base font-semibold leading-none">Ledger</div>
              <div className="text-[11px] text-ink-muted mt-1">Enquiry CRM</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              data-testid={n.testId}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive
                    ? "bg-brand-50 text-brand font-medium"
                    : "text-ink hover:bg-secondary",
                )
              }
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </NavLink>
          ))}
          {user?.role === "ADMIN" && (
            <NavLink
              to="/settings"
              data-testid="nav-settings"
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive
                    ? "bg-brand-50 text-brand font-medium"
                    : "text-ink hover:bg-secondary",
                )
              }
            >
              <SettingsIcon className="h-4 w-4" />
              Settings
            </NavLink>
          )}
        </nav>
        <div className="px-3 py-4 border-t border-line">
          <div className="px-3 pb-3">
            <div className="text-sm font-medium" data-testid="current-user-name">{user?.name}</div>
            <div className="text-xs text-ink-muted">{user?.email}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-ink-muted">{user?.role}</div>
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
      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
