import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, Plus, History, Check, X } from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatINR, formatDate } from "@/lib/format";
import { useAuth } from "@/lib/auth";

export default function Inventory() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null); // {id, value}

  const load = async () => {
    const r = await api.get("/inventory", { params: q ? { q } : {} });
    setItems(r.data.items || []);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, [q]);

  const saveRate = async (id) => {
    if (!editing || editing.id !== id) return;
    try {
      await api.put(`/inventory/${id}/rate`, { rate: Number(editing.value) });
      toast.success("Rate updated");
      setEditing(null);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Update failed");
    }
  };

  return (
    <div className="p-8 lg:p-12">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-muted">Catalogue</div>
          <h1 className="font-display text-3xl font-semibold mt-1">Inventory</h1>
          <p className="text-ink-muted text-sm mt-1">Manage products, aliases & rates.</p>
        </div>
        <div className="flex gap-3">
          <div className="relative w-72">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="pl-9 bg-surface border-line" data-testid="inventory-search-input" />
          </div>
          {isAdmin && <AddProductSheet onCreated={load} />}
        </div>
      </div>

      <div className="rounded-lg border border-line bg-surface shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-canvas text-xs uppercase tracking-[0.08em] text-ink-muted">
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Aliases</th>
              <th className="text-left px-4 py-3">Unit</th>
              <th className="text-left px-4 py-3">Category</th>
              <th className="text-right px-4 py-3">Current rate</th>
              <th className="text-right px-4 py-3">Updated</th>
              <th className="px-4 py-3 w-[40px]" />
            </tr>
          </thead>
          <tbody data-testid="inventory-table">
            {items.map((it) => (
              <tr key={it.id} className="border-b border-line hover:bg-canvas">
                <td className="px-4 py-3 font-medium">{it.name}</td>
                <td className="px-4 py-3 text-ink-muted text-xs truncate max-w-[200px]">{(it.aliases || []).join(", ")}</td>
                <td className="px-4 py-3 text-ink-muted">{it.unit || "—"}</td>
                <td className="px-4 py-3 text-ink-muted">{it.category || "—"}</td>
                <td className="px-4 py-3 text-right tabular">
                  {editing?.id === it.id ? (
                    <div className="flex items-center gap-1 justify-end">
                      <Input
                        type="number"
                        autoFocus
                        value={editing.value}
                        onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveRate(it.id);
                          if (e.key === "Escape") setEditing(null);
                        }}
                        className="h-7 w-24 text-right tabular border-line"
                        data-testid={`rate-edit-${it.id}`}
                      />
                      <button onClick={() => saveRate(it.id)} className="text-brand p-1" data-testid={`rate-save-${it.id}`}>
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setEditing(null)} className="text-ink-muted p-1">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditing({ id: it.id, value: it.currentRate ?? 0 })}
                      className="hover:text-brand tabular"
                      data-testid={`rate-cell-${it.id}`}
                    >
                      {it.currentRate != null ? formatINR(it.currentRate) : "—"}
                    </button>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-ink-muted text-xs">{formatDate(it.updatedAt)}</td>
                <td className="px-4 py-3">
                  <RateHistoryButton id={it.id} />
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-muted">No items</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AddProductSheet({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [unit, setUnit] = useState("");
  const [category, setCategory] = useState("");
  const [rate, setRate] = useState("");

  const submit = async () => {
    try {
      await api.post("/inventory", {
        name,
        aliases: aliases.split(",").map((s) => s.trim()).filter(Boolean),
        unit: unit || null,
        category: category || null,
        currentRate: rate ? Number(rate) : null,
      });
      toast.success("Product added");
      setOpen(false);
      setName(""); setAliases(""); setUnit(""); setCategory(""); setRate("");
      onCreated && onCreated();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button className="bg-brand hover:bg-brand-hover" data-testid="add-product-button">
          <Plus className="h-4 w-4 mr-1.5" /> Add product
        </Button>
      </SheetTrigger>
      <SheetContent className="bg-surface border-line w-[420px] sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="font-display">New Product</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-6">
          <div>
            <Label className="text-xs uppercase tracking-wider text-ink-muted">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 border-line" data-testid="new-product-name" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-ink-muted">Aliases (comma separated)</Label>
            <Input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="e.g. a4 paper, copier" className="mt-1.5 border-line" data-testid="new-product-aliases" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs uppercase tracking-wider text-ink-muted">Unit</Label>
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Pcs / Ream" className="mt-1.5 border-line" data-testid="new-product-unit" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-ink-muted">Category</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Paper" className="mt-1.5 border-line" data-testid="new-product-category" />
            </div>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-ink-muted">Starting Rate (₹)</Label>
            <Input type="number" value={rate} onChange={(e) => setRate(e.target.value)} className="mt-1.5 border-line tabular" data-testid="new-product-rate" />
          </div>
        </div>
        <SheetFooter className="mt-8">
          <Button onClick={submit} className="bg-brand hover:bg-brand-hover" data-testid="new-product-save">Save product</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function RateHistoryButton({ id }) {
  const [history, setHistory] = useState(null);

  const load = async () => {
    const r = await api.get(`/inventory/${id}/rate-history`);
    setHistory(r.data.items || []);
  };

  return (
    <Dialog onOpenChange={(o) => o && load()}>
      <DialogTrigger asChild>
        <button className="text-ink-muted hover:text-brand" title="Rate history" data-testid={`history-${id}`}>
          <History className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="bg-surface border-line max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Rate history</DialogTitle>
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
                <tr key={h.id} className="border-t border-line">
                  <td className="px-3 py-2 tabular font-medium">{formatINR(h.rate)}</td>
                  <td className="px-3 py-2 text-ink-muted">{h.changedBy || "—"}</td>
                  <td className="px-3 py-2 text-ink-muted">{formatDate(h.recordedAt)}</td>
                </tr>
              ))}
              {history && history.length === 0 && (
                <tr><td colSpan={3} className="px-3 py-6 text-center text-ink-muted">No history yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
