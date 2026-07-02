"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, Plus, History, Check, X, Pencil, AlertTriangle, Trash2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { formatINR, formatDate } from "../../../lib/format";
import { useAuth } from "../../../lib/auth";

interface InventoryItem {
  id: string;
  name: string;
  aliases: string[];
  unit: string | null;
  category: string | null;
  currentRate: number | null;
  stock: number;
  lowStockThreshold: number;
  updatedAt: string;
  unitRates?: { id: string; unit: string; rate: number }[];
}

export default function InventoryPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<{ id: string; value: number | string } | null>(null);

  const load = async () => {
    try {
      const r = await api.get("/inventory", { params: q ? { q } : {} });
      setItems(r.data.items || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    load();
  }, [q]);

  const saveRate = async (id: string) => {
    if (!editing || editing.id !== id) return;
    try {
      await api.put(`/inventory/${id}/rate`, { rate: Number(editing.value) });
      toast.success("Rate updated");
      setEditing(null);
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Update failed");
    }
  };

  return (
    <div className="p-8 lg:p-12 text-ink">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-muted">Catalogue</div>
          <h1 className="font-display text-3xl font-semibold mt-1 text-ink">Inventory</h1>
          <p className="text-ink-muted text-sm mt-1">Manage products, aliases & rates.</p>
        </div>
        <div className="flex gap-3">
          <div className="relative w-72">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-muted" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search"
              className="pl-9 bg-surface border-line text-ink"
              data-testid="inventory-search-input"
            />
          </div>
          {isAdmin && (
            <>
              <ClearInventoryButton onCleared={load} disabled={items.length === 0} />
              <AddProductSheet onCreated={load} />
            </>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-line bg-surface shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-canvas text-xs uppercase tracking-[0.08em] text-ink-muted">
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Aliases</th>
              <th className="text-left px-4 py-3">Rates</th>
              <th className="text-right px-4 py-3">Updated</th>
              <th className="px-4 py-3 w-[120px]" />
            </tr>
          </thead>
          <tbody data-testid="inventory-table">
            {items.map((it) => {
              const ratesStr = it.unitRates && it.unitRates.length > 0
                ? it.unitRates.map((ur) => `${ur.unit}: ${formatINR(ur.rate)}`).join(", ")
                : it.currentRate != null ? `${it.unit || "Unit"}: ${formatINR(it.currentRate)}` : "—";
              return (
                <tr key={it.id} className="border-b border-line hover:bg-canvas">
                  <td className="px-4 py-3 font-medium text-ink">{it.name}</td>
                  <td className="px-4 py-3 text-ink-muted text-xs truncate max-w-[200px]">
                    {(it.aliases || []).join(", ")}
                  </td>
                  <td className="px-4 py-3 text-ink-muted font-medium">{ratesStr}</td>
                  <td className="px-4 py-3 text-right text-ink-muted text-xs">{formatDate(it.updatedAt)}</td>
                  <td className="px-4 py-3 flex items-center justify-end gap-2">
                    {isAdmin && <EditProductSheet product={it} onUpdated={load} />}
                    <RateHistoryButton id={it.id} />
                    {isAdmin && <DeleteProductButton id={it.id} name={it.name} onDeleted={load} />}
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">
                  No items
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ClearInventoryButton({ onCleared, disabled }: { onCleared: () => void; disabled: boolean }) {
  const [loading, setLoading] = useState(false);

  const confirm = async () => {
    setLoading(true);
    try {
      const r = await api.delete("/inventory");
      toast.success(`Cleared ${r.data.deleted ?? 0} products`);
      onCleared();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed to clear inventory");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          className="border-line text-red-600 hover:text-red-700 hover:bg-red-50"
          disabled={disabled}
          data-testid="clear-inventory-button"
        >
          <Trash2 className="h-4 w-4 mr-1.5" /> Clear inventory
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="bg-surface border-line text-ink">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            Clear entire inventory?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-ink-muted">
            This permanently deletes all products, rates, and embeddings. Enquiry line items will be kept but unlinked from inventory. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="border-line text-ink">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirm}
            disabled={loading}
            className="bg-red-600 hover:bg-red-700 text-white"
            data-testid="clear-inventory-confirm"
          >
            {loading ? "Clearing…" : "Clear all"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteProductButton({ id, name, onDeleted }: { id: string; name: string; onDeleted: () => void }) {
  const [loading, setLoading] = useState(false);

  const confirm = async () => {
    setLoading(true);
    try {
      await api.delete(`/inventory/${id}`);
      toast.success(`Deleted "${name}"`);
      onDeleted();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Delete failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          className="text-ink-muted hover:text-red-600"
          title="Delete product"
          data-testid={`delete-product-${id}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent className="bg-surface border-line text-ink">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display">Delete product?</AlertDialogTitle>
          <AlertDialogDescription className="text-ink-muted">
            Permanently delete <span className="font-medium text-ink">{name}</span>? Linked enquiry items will be kept but unlinked.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="border-line text-ink">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirm}
            disabled={loading}
            className="bg-red-600 hover:bg-red-700 text-white"
            data-testid={`delete-product-confirm-${id}`}
          >
            {loading ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AddProductSheet({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [unitRates, setUnitRates] = useState<{ unit: string; rate: string }[]>([{ unit: "", rate: "" }]);

  const addRateRow = () => setUnitRates([...unitRates, { unit: "", rate: "" }]);
  const removeRateRow = (index: number) => setUnitRates(unitRates.filter((_, i) => i !== index));
  const updateRateRow = (index: number, field: "unit" | "rate", value: string) => {
    const updated = [...unitRates];
    updated[index][field] = value;
    setUnitRates(updated);
  };

  const submit = async () => {
    try {
      const filteredRates = unitRates
        .filter((r) => r.unit.trim() && r.rate.trim())
        .map((r) => ({ unit: r.unit.trim(), rate: Number(r.rate) }));

      await api.post("/inventory", {
        name,
        aliases: aliases
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        unitRates: filteredRates,
      });
      toast.success("Product added");
      setOpen(false);
      setName("");
      setAliases("");
      setUnitRates([{ unit: "", rate: "" }]);
      onCreated();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button className="bg-brand hover:bg-brand-hover text-white" data-testid="add-product-button">
          <Plus className="h-4 w-4 mr-1.5" /> Add product
        </Button>
      </SheetTrigger>
      <SheetContent className="bg-surface border-line w-[420px] sm:max-w-md text-ink overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display text-ink">New Product</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-6">
          <div>
            <Label className="text-xs uppercase tracking-wider text-ink-muted">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 border-line text-ink" data-testid="new-product-name" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-ink-muted">Aliases (comma separated)</Label>
            <Input
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              placeholder="e.g. a4 paper, copier"
              className="mt-1.5 border-line text-ink"
              data-testid="new-product-aliases"
            />
          </div>

          <div className="space-y-2 border-t border-line pt-4">
            <div className="flex justify-between items-center mb-2">
              <Label className="text-xs uppercase tracking-wider text-ink-muted">Unit Rates</Label>
              <Button type="button" variant="outline" size="sm" onClick={addRateRow} className="h-7 border-line text-ink">
                + Add unit
              </Button>
            </div>
            {unitRates.map((ur, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <Input
                  value={ur.unit}
                  onChange={(e) => updateRateRow(idx, "unit", e.target.value)}
                  placeholder="Unit (e.g. Pcs)"
                  className="border-line text-ink flex-1"
                />
                <Input
                  type="number"
                  value={ur.rate}
                  onChange={(e) => updateRateRow(idx, "rate", e.target.value)}
                  placeholder="Rate (₹)"
                  className="border-line text-ink w-28 tabular"
                />
                {unitRates.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeRateRow(idx)} className="text-red-500 hover:text-red-700 h-9 px-2">
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
        <SheetFooter className="mt-8">
          <Button onClick={submit} className="bg-brand hover:bg-brand-hover text-white w-full" data-testid="new-product-save">
            Save product
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function RateHistoryButton({ id }: { id: string }) {
  const [history, setHistory] = useState<any[] | null>(null);

  const load = async () => {
    try {
      const r = await api.get(`/inventory/${id}/rate-history`);
      setHistory(r.data.items || []);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <Dialog onOpenChange={(o) => o && load()}>
      <DialogTrigger asChild>
        <button className="text-ink-muted hover:text-brand" title="Rate history" data-testid={`history-${id}`}>
          <History className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="bg-surface border-line max-w-md text-ink">
        <DialogHeader>
          <DialogTitle className="font-display text-ink">Rate history</DialogTitle>
        </DialogHeader>
        <div className="max-h-[400px] overflow-y-auto scroll-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-ink-muted text-left">
                <th className="px-3 py-2">Rate</th>
                <th className="px-3 py-2">Changed by</th>
                <th className="px-3 py-2">When</th>
              </tr>
            </thead>
            <tbody>
              {(history || []).map((h) => (
                <tr key={h.id} className="border-t border-line text-ink">
                  <td className="px-3 py-2 tabular font-medium">{formatINR(h.rate)}</td>
                  <td className="px-3 py-2 text-ink-muted">{h.changedBy || "—"}</td>
                  <td className="px-3 py-2 text-ink-muted">{formatDate(h.recordedAt)}</td>
                </tr>
              ))}
              {history && history.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-ink-muted">
                    No history yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditProductSheet({ product, onUpdated }: { product: InventoryItem; onUpdated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(product.name);
  const [aliases, setAliases] = useState((product.aliases || []).join(", "));
  const [unitRates, setUnitRates] = useState<{ unit: string; rate: string }[]>(
    product.unitRates && product.unitRates.length > 0
      ? product.unitRates.map((ur) => ({ unit: ur.unit, rate: String(ur.rate) }))
      : [{ unit: product.unit || "", rate: product.currentRate !== null ? String(product.currentRate) : "" }]
  );

  const addRateRow = () => setUnitRates([...unitRates, { unit: "", rate: "" }]);
  const removeRateRow = (index: number) => setUnitRates(unitRates.filter((_, i) => i !== index));
  const updateRateRow = (index: number, field: "unit" | "rate", value: string) => {
    const updated = [...unitRates];
    updated[index][field] = value;
    setUnitRates(updated);
  };

  const submit = async () => {
    try {
      const filteredRates = unitRates
        .filter((r) => r.unit.trim() && r.rate.trim())
        .map((r) => ({ unit: r.unit.trim(), rate: Number(r.rate) }));

      await api.put(`/inventory/${product.id}`, {
        name,
        aliases: aliases
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        unitRates: filteredRates,
      });
      toast.success("Product updated");
      setOpen(false);
      onUpdated();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button className="text-ink-muted hover:text-brand" title="Edit product" data-testid={`edit-product-${product.id}`}>
          <Pencil className="h-4 w-4" />
        </button>
      </SheetTrigger>
      <SheetContent className="bg-surface border-line w-[420px] sm:max-w-md text-ink overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display text-ink">Edit Product</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-6">
          <div>
            <Label className="text-xs uppercase tracking-wider text-ink-muted">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 border-line text-ink" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-ink-muted">Aliases (comma separated)</Label>
            <Input
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              placeholder="e.g. a4 paper, copier"
              className="mt-1.5 border-line text-ink"
            />
          </div>

          <div className="space-y-2 border-t border-line pt-4">
            <div className="flex justify-between items-center mb-2">
              <Label className="text-xs uppercase tracking-wider text-ink-muted">Unit Rates</Label>
              <Button type="button" variant="outline" size="sm" onClick={addRateRow} className="h-7 border-line text-ink">
                + Add unit
              </Button>
            </div>
            {unitRates.map((ur, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <Input
                  value={ur.unit}
                  onChange={(e) => updateRateRow(idx, "unit", e.target.value)}
                  placeholder="Unit (e.g. Pcs)"
                  className="border-line text-ink flex-1"
                />
                <Input
                  type="number"
                  value={ur.rate}
                  onChange={(e) => updateRateRow(idx, "rate", e.target.value)}
                  placeholder="Rate (₹)"
                  className="border-line text-ink w-28 tabular"
                />
                {unitRates.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeRateRow(idx)} className="text-red-500 hover:text-red-700 h-9 px-2">
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
        <SheetFooter className="mt-8">
          <Button onClick={submit} className="bg-brand hover:bg-brand-hover text-white w-full">
            Save changes
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

