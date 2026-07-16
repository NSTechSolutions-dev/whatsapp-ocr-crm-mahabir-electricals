"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatDate } from "../../../lib/format";
import { Plus, Trash2, Upload } from "lucide-react";

interface UserItem {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "STAFF";
  createdAt: string;
  isActive: boolean;
}

interface CompanySettings {
  companyName?: string | null;
  companyAddress?: string | null;
  companyPhone?: string | null;
  companyGstin?: string | null;
  bankName?: string | null;
  accountName?: string | null;
  accountNumber?: string | null;
  ifsc?: string | null;
  branch?: string | null;
  upiId?: string | null;
  qrUrl?: string | null;
  updatedAt?: string;
}

interface BrandLogoItem {
  id: string;
  name: string | null;
  url: string | null;
}

export default function SettingsPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [company, setCompany] = useState<CompanySettings>({});
  const [brandLogos, setBrandLogos] = useState<BrandLogoItem[]>([]);
  const [companyName, setCompanyName] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyGstin, setCompanyGstin] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [branch, setBranch] = useState("");
  const [upiId, setUpiId] = useState("");
  const [savingCompany, setSavingCompany] = useState(false);
  const [uploadingQr, setUploadingQr] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const qrInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const loadUsers = async () => {
    try {
      const r = await api.get("/users");
      setUsers(r.data.items || []);
      setIsAdmin(true);
    } catch (e: any) {
      if (e?.response?.status === 403) {
        setIsAdmin(false);
      }
    }
  };

  const loadCompany = async () => {
    try {
      const r = await api.get("/settings/company");
      setCompany(r.data);
      setCompanyName(r.data.companyName || "");
      setCompanyAddress(r.data.companyAddress || "");
      setCompanyPhone(r.data.companyPhone || "");
      setCompanyGstin(r.data.companyGstin || "");
      setBankName(r.data.bankName || "");
      setAccountName(r.data.accountName || "");
      setAccountNumber(r.data.accountNumber || "");
      setIfsc(r.data.ifsc || "");
      setBranch(r.data.branch || "");
      setUpiId(r.data.upiId || "");
    } catch {
      // Settings readable by all authenticated users
    }
  };

  const loadBrandLogos = async () => {
    try {
      const r = await api.get("/settings/brand-logos");
      setBrandLogos(r.data.items || []);
    } catch {
      // optional
    }
  };

  useEffect(() => {
    loadUsers();
    loadCompany();
    loadBrandLogos();
  }, []);

  const toggleActive = async (u: UserItem) => {
    try {
      await api.put(`/users/${u.id}`, { isActive: !u.isActive });
      await loadUsers();
    } catch {
      toast.error("Update failed");
    }
  };

  const saveCompany = async () => {
    setSavingCompany(true);
    try {
      const r = await api.put("/settings/company", {
        companyName,
        companyAddress,
        companyPhone,
        companyGstin,
        bankName,
        accountName,
        accountNumber,
        ifsc,
        branch,
        upiId,
      });
      setCompany(r.data);
      toast.success("Settings saved");
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed to save settings");
    } finally {
      setSavingCompany(false);
    }
  };

  const uploadQr = async (file: File) => {
    setUploadingQr(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api.post("/settings/company/qr", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setCompany((prev) => ({ ...prev, qrUrl: r.data.qrUrl }));
      toast.success("Payment QR uploaded");
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "QR upload failed");
    } finally {
      setUploadingQr(false);
    }
  };

  const uploadBrandLogo = async (file: File) => {
    setUploadingLogo(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api.post("/settings/brand-logos", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setBrandLogos((prev) => [...prev, r.data.item]);
      toast.success("Brand logo added");
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Logo upload failed");
    } finally {
      setUploadingLogo(false);
    }
  };

  const deleteBrandLogo = async (id: string) => {
    try {
      await api.delete(`/settings/brand-logos/${id}`);
      setBrandLogos((prev) => prev.filter((l) => l.id !== id));
      toast.success("Brand logo removed");
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed to remove logo");
    }
  };

  return (
    <div className="p-8 lg:p-12 max-w-5xl text-ink space-y-8">
      <div>
        <div className="text-xs uppercase tracking-wider text-ink-muted">Settings</div>
        <h1 className="font-display text-3xl font-semibold mt-1 text-ink font-medium">Admin settings</h1>
        <p className="text-sm text-ink-muted mt-2">
          Manage company details, payment info, brand logos, and users.
        </p>
      </div>

      <Tabs defaultValue="general" className="space-y-6">
        <TabsList className="bg-canvas border border-line">
          <TabsTrigger value="general" className="data-[state=active]:bg-surface data-[state=active]:text-ink">
            General
          </TabsTrigger>
          <TabsTrigger value="payment" className="data-[state=active]:bg-surface data-[state=active]:text-ink">
            Payment
          </TabsTrigger>
          <TabsTrigger value="users" className="data-[state=active]:bg-surface data-[state=active]:text-ink">
            User management
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <div className="rounded-lg border border-line bg-surface shadow-card p-5 space-y-4">
            <div>
              <h2 className="text-sm font-medium text-ink">Company details</h2>
              <p className="text-xs text-ink-muted mt-1">
                Shown in the top-right of quotation PDFs.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-ink-muted">Company name</Label>
                <Input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="mt-1.5 border-line text-ink"
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-ink-muted">Contact number</Label>
                <Input
                  value={companyPhone}
                  onChange={(e) => setCompanyPhone(e.target.value)}
                  className="mt-1.5 border-line text-ink"
                  disabled={!isAdmin}
                />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs uppercase tracking-wider text-ink-muted">Address</Label>
                <Input
                  value={companyAddress}
                  onChange={(e) => setCompanyAddress(e.target.value)}
                  placeholder="Street, city, state, PIN"
                  className="mt-1.5 border-line text-ink"
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-ink-muted">GSTIN</Label>
                <Input
                  value={companyGstin}
                  onChange={(e) => setCompanyGstin(e.target.value)}
                  className="mt-1.5 border-line text-ink"
                  disabled={!isAdmin}
                />
              </div>
            </div>

            {isAdmin && (
              <Button onClick={saveCompany} disabled={savingCompany} className="bg-brand hover:bg-brand-hover text-white">
                {savingCompany ? "Saving…" : "Save company details"}
              </Button>
            )}
          </div>

          <div className="rounded-lg border border-line bg-surface shadow-card p-5 space-y-4">
            <div>
              <h2 className="text-sm font-medium text-ink">Brand logos</h2>
              <p className="text-xs text-ink-muted mt-1">
                Logos appear in a single row on quotation PDFs.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {brandLogos.map((logo) => (
                <div key={logo.id} className="relative group">
                  {logo.url ? (
                    <img
                      src={logo.url}
                      alt={logo.name || "Brand logo"}
                      className="h-12 w-auto max-w-[96px] rounded border border-line object-contain bg-white p-1"
                    />
                  ) : (
                    <div className="h-12 w-20 rounded border border-dashed border-line bg-canvas" />
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => deleteBrandLogo(logo.id)}
                      className="absolute -top-2 -right-2 rounded-full bg-red-600 text-white p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove logo"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
              {brandLogos.length === 0 && (
                <div className="text-sm text-ink-muted">No brand logos added yet.</div>
              )}
            </div>

            {isAdmin && (
              <>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadBrandLogo(file);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="border-line text-ink"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={uploadingLogo}
                >
                  <Upload className="h-4 w-4 mr-1.5" />
                  {uploadingLogo ? "Uploading…" : "Add brand logo"}
                </Button>
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="payment">
          <div className="rounded-lg border border-line bg-surface shadow-card p-5 space-y-4">
            <div>
              <h2 className="text-sm font-medium text-ink">Bank & payment</h2>
              <p className="text-xs text-ink-muted mt-1">
                Bank details and payment QR appear at the bottom of quotation PDFs.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-ink-muted">Bank name</Label>
                <Input value={bankName} onChange={(e) => setBankName(e.target.value)} className="mt-1.5 border-line text-ink" disabled={!isAdmin} />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-ink-muted">Account name</Label>
                <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} className="mt-1.5 border-line text-ink" disabled={!isAdmin} />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-ink-muted">Account number</Label>
                <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} className="mt-1.5 border-line text-ink" disabled={!isAdmin} />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-ink-muted">IFSC</Label>
                <Input value={ifsc} onChange={(e) => setIfsc(e.target.value)} className="mt-1.5 border-line text-ink" disabled={!isAdmin} />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-ink-muted">Branch</Label>
                <Input value={branch} onChange={(e) => setBranch(e.target.value)} className="mt-1.5 border-line text-ink" disabled={!isAdmin} />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-ink-muted">UPI ID</Label>
                <Input value={upiId} onChange={(e) => setUpiId(e.target.value)} className="mt-1.5 border-line text-ink" disabled={!isAdmin} />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-end gap-4 pt-2 border-t border-line">
              <div className="flex-1">
                <Label className="text-xs uppercase tracking-wider text-ink-muted">Payment QR</Label>
                <div className="mt-2 flex items-center gap-3">
                  {company.qrUrl ? (
                    <img src={company.qrUrl} alt="Payment QR" className="h-24 w-24 rounded border border-line object-contain bg-white" />
                  ) : (
                    <div className="h-24 w-24 rounded border border-dashed border-line flex items-center justify-center text-[11px] text-ink-muted">
                      No QR
                    </div>
                  )}
                  {isAdmin && (
                    <>
                      <input
                        ref={qrInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) uploadQr(file);
                          e.target.value = "";
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="border-line text-ink"
                        onClick={() => qrInputRef.current?.click()}
                        disabled={uploadingQr}
                      >
                        <Upload className="h-4 w-4 mr-1.5" />
                        {uploadingQr ? "Uploading…" : "Upload QR"}
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {isAdmin && (
                <Button onClick={saveCompany} disabled={savingCompany} className="bg-brand hover:bg-brand-hover text-white shrink-0">
                  {savingCompany ? "Saving…" : "Save payment details"}
                </Button>
              )}
            </div>
            {company.updatedAt && (
              <div className="text-[11px] text-ink-muted">Last updated {formatDate(company.updatedAt)}</div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="users">
          <div className="flex items-end justify-between mb-6">
            <div>
              <h2 className="text-sm font-medium text-ink">Users</h2>
              <p className="text-xs text-ink-muted mt-1">Manage staff and admin accounts.</p>
            </div>
            {isAdmin && <NewUserDialog onCreated={loadUsers} />}
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
                  <tr key={u.id} className="border-b border-line text-ink">
                    <td className="px-4 py-3 font-medium text-ink">{u.name}</td>
                    <td className="px-4 py-3 text-ink-muted">{u.email}</td>
                    <td className="px-4 py-3 text-ink-muted text-xs uppercase tracking-wider">{u.role}</td>
                    <td className="px-4 py-3 text-ink-muted text-xs">{formatDate(u.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Switch checked={u.isActive} onCheckedChange={() => toggleActive(u)} data-testid={`user-toggle-${u.id}`} disabled={!isAdmin} />
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">
                      {isAdmin ? "No users yet" : "Admin access required to manage users"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function NewUserDialog({ onCreated }: { onCreated: () => void }) {
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
      setName("");
      setEmail("");
      setPassword("");
      setRole("STAFF");
      onCreated();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-brand hover:bg-brand-hover text-white" data-testid="add-user-button">
          <Plus className="h-4 w-4 mr-1.5" /> Add user
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-surface border-line text-ink">
        <DialogHeader>
          <DialogTitle className="font-display text-ink">New user</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-ink">
          <div>
            <Label className="text-xs uppercase tracking-wider text-ink-muted">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 border-line text-ink" data-testid="new-user-name" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-ink-muted">Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5 border-line text-ink" data-testid="new-user-email" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-ink-muted">Password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5 border-line text-ink" data-testid="new-user-password" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-ink-muted">Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="mt-1.5 border-line text-ink" data-testid="new-user-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-surface border-line text-ink">
                <SelectItem value="STAFF" className="text-ink hover:bg-canvas">Staff</SelectItem>
                <SelectItem value="ADMIN" className="text-ink hover:bg-canvas">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} className="bg-brand hover:bg-brand-hover text-white" data-testid="new-user-save">
            Create user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
