import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatDate } from "@/lib/format";
import { Plus } from "lucide-react";

export default function Settings() {
  const [users, setUsers] = useState([]);

  const load = async () => {
    try {
      const r = await api.get("/users");
      setUsers(r.data.items || []);
    } catch (e) {
      if (e?.response?.status === 403) {
        toast.error("Admin only");
      }
    }
  };
  useEffect(() => {
    load();
  }, []);

  const toggleActive = async (u) => {
    try {
      await api.put(`/users/${u.id}`, { isActive: !u.isActive });
      await load();
    } catch (e) {
      toast.error("Update failed");
    }
  };

  return (
    <div className="p-8 lg:p-12 max-w-5xl">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-muted">Settings</div>
          <h1 className="font-display text-3xl font-semibold mt-1">User management</h1>
        </div>
        <NewUserDialog onCreated={load} />
      </div>

      <div className="rounded-lg border border-line bg-surface shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-canvas text-xs uppercase tracking-[0.08em] text-ink-muted">
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Email</th>
              <th className="text-left px-4 py-3">Role</th>
              <th className="text-left px-4 py-3">Created</th>
              <th className="text-right px-4 py-3">Active</th>
            </tr>
          </thead>
          <tbody data-testid="users-table">
            {users.map((u) => (
              <tr key={u.id} className="border-b border-line">
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3 text-ink-muted">{u.email}</td>
                <td className="px-4 py-3 text-ink-muted text-xs uppercase tracking-wider">{u.role}</td>
                <td className="px-4 py-3 text-ink-muted text-xs">{formatDate(u.createdAt)}</td>
                <td className="px-4 py-3 text-right">
                  <Switch checked={u.isActive} onCheckedChange={() => toggleActive(u)} data-testid={`user-toggle-${u.id}`} />
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-ink-muted">No users yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NewUserDialog({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("STAFF");

  const submit = async () => {
    try {
      await api.post("/users", { name, email, password, role });
      toast.success("User created");
      setOpen(false);
      setName(""); setEmail(""); setPassword(""); setRole("STAFF");
      onCreated && onCreated();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-brand hover:bg-brand-hover" data-testid="add-user-button">
          <Plus className="h-4 w-4 mr-1.5" /> Add user
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-surface border-line">
        <DialogHeader>
          <DialogTitle className="font-display">New user</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs uppercase tracking-wider text-ink-muted">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 border-line" data-testid="new-user-name" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-ink-muted">Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5 border-line" data-testid="new-user-email" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-ink-muted">Password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5 border-line" data-testid="new-user-password" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-ink-muted">Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="mt-1.5 border-line" data-testid="new-user-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="STAFF">Staff</SelectItem>
                <SelectItem value="ADMIN">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} className="bg-brand hover:bg-brand-hover" data-testid="new-user-save">Create user</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
