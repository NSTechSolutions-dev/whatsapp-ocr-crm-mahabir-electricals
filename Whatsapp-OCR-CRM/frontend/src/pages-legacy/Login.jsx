import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { FileText } from "lucide-react";

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldsReady, setFieldsReady] = useState(false);

  useEffect(() => {
    if (user) {
      navigate(location.state?.from?.pathname || "/inbox", { replace: true });
    }
  }, [user, navigate, location]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(email, password);
      toast.success("Welcome back");
      navigate("/inbox", { replace: true });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-canvas">
      <div className="flex items-center justify-center p-8 lg:p-16">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 mb-12">
            <div className="h-9 w-9 rounded-md bg-brand flex items-center justify-center">
              <FileText className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="font-display text-lg font-semibold leading-none">Ledger</div>
              <div className="text-xs text-ink-muted mt-1">Enquiry CRM</div>
            </div>
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-tight">Welcome back</h1>
          <p className="text-ink-muted mt-2 text-sm">Sign in to manage WhatsApp enquiries.</p>

          <form onSubmit={onSubmit} className="mt-10 space-y-5" autoComplete="off">
            <div>
              <Label htmlFor="login-email" className="text-xs uppercase tracking-wider text-ink-muted">Email</Label>
              <Input
                id="login-email"
                name="crm-login-email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setFieldsReady(true)}
                readOnly={!fieldsReady}
                required
                className="mt-2 bg-surface border-line"
                data-testid="login-email-input"
              />
            </div>
            <div>
              <Label htmlFor="login-password" className="text-xs uppercase tracking-wider text-ink-muted">Password</Label>
              <Input
                id="login-password"
                name="crm-login-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFieldsReady(true)}
                readOnly={!fieldsReady}
                required
                className="mt-2 bg-surface border-line"
                data-testid="login-password-input"
              />
            </div>
            <Button
              type="submit"
              disabled={submitting}
              data-testid="login-submit-button"
              className="w-full bg-brand hover:bg-brand-hover h-10"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>
      </div>
      <div
        className="hidden lg:block bg-cover bg-center relative"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1531346878377-a5be20888e57?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2NzF8MHwxfHNlYXJjaHwzfHxvZmZpY2UlMjBzdXBwbGllcyUyMG5vdGVib29rJTIwcGVuc3xlbnwwfHx8fDE3ODA2NDY0Mjd8MA&ixlib=rb-4.1.0&q=85')",
        }}
      >
        <div className="absolute inset-0 bg-black/10" />
        <div className="absolute bottom-12 left-12 right-12 text-white">
          <div className="text-xs uppercase tracking-[0.18em] opacity-80">For Indian stationery and office supply businesses</div>
          <div className="font-display text-3xl font-semibold mt-3 max-w-md">
            Turn WhatsApp slips into ready-to-send quotations in minutes.
          </div>
        </div>
      </div>
    </div>
  );
}
