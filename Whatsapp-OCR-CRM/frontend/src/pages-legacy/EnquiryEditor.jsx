import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Send } from "lucide-react";
import { toast } from "sonner";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";

export default function EnquiryEditor() {
  const { enquiryId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [gst, setGst] = useState(18);
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  const load = async () => {
    const r = await api.get(`/enquiries/${enquiryId}`);
    setData(r.data);
    setGst(r.data.gstPercent ?? 18);
    setRows(
      (r.data.items || []).map((i) => ({
        id: i.id,
        productName: i.productName,
        qty: i.qty,
        unit: i.unit || "",
        rate: i.rate ?? "",
        confidence: i.confidence ?? 1,
        matchType: i.matchType,
        matchScore: i.matchScore,
        inventoryId: i.inventoryId,
        rawText: i.rawText,
      })),
    );
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, [enquiryId]);

  const subtotal = useMemo(
    () => rows.reduce((s, r) => s + Number(r.qty || 0) * Number(r.rate || 0), 0),
    [rows],
  );
  const gstAmount = useMemo(() => subtotal * (Number(gst) || 0) / 100, [subtotal, gst]);
  const grand = subtotal + gstAmount;

  const updateRow = (idx, patch) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const addRow = () =>
    setRows((rs) => [
      ...rs,
      { productName: "", qty: 1, unit: "", rate: "", confidence: 1, matchType: "new" },
    ]);
  const delRow = (idx) => setRows((rs) => rs.filter((_, i) => i !== idx));

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/enquiries/${enquiryId}`, {
        items: rows.map((r) => ({
          ...r,
          qty: Number(r.qty || 0),
          rate: r.rate === "" || r.rate === null ? null : Number(r.rate),
        })),
        gstPercent: Number(gst) || 0,
      });
      toast.success("Saved");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const finalize = async () => {
    setFinalizing(true);
    try {
      await save();
      const r = await api.post(`/enquiries/${enquiryId}/finalize`, null, { params: { gstPercent: gst } });
      toast.success("Quotation generated");
      navigate(`/quotations/${r.data.quotationId}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Finalize failed");
    } finally {
      setFinalizing(false);
    }
  };

  if (!data) return <div className="p-8 text-ink-muted">Loading…</div>;

  return (
    <div className="p-8 lg:p-12 max-w-7xl">
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-muted">Enquiry · {data.status}</div>
          <h1 className="font-display text-3xl font-semibold mt-1">{data.customer?.name || "Customer"}</h1>
          <p className="text-ink-muted text-sm mt-1">{data.customer?.phone}</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={save} disabled={saving} data-testid="save-enquiry-button" className="border-line">
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button onClick={finalize} disabled={finalizing} className="bg-brand hover:bg-brand-hover" data-testid="finalize-enquiry-button">
            <Send className="h-4 w-4 mr-2" />
            {finalizing ? "Finalizing…" : "Finalize & Generate Quotation"}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-surface shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-canvas text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
              <th className="text-left px-4 py-3 w-[35%]">Product</th>
              <th className="text-left px-4 py-3 w-[10%]">Qty</th>
              <th className="text-left px-4 py-3 w-[12%]">Unit</th>
              <th className="text-right px-4 py-3 w-[14%]">Rate (₹)</th>
              <th className="text-right px-4 py-3 w-[14%]">Amount (₹)</th>
              <th className="text-center px-4 py-3 w-[10%]">Confidence</th>
              <th className="px-4 py-3 w-[5%]" />
            </tr>
          </thead>
          <tbody data-testid="enquiry-items-table">
            {rows.map((r, i) => {
              const amount = Number(r.qty || 0) * Number(r.rate || 0);
              const lowConf = (r.confidence ?? 1) < 0.75;
              return (
                <tr
                  key={i}
                  className={`border-b border-line ${lowConf ? "bg-amberCanvas/40" : ""}`}
                  data-testid={`row-${i}`}
                >
                  <td className="px-4 py-2 align-top">
                    <ProductCell
                      value={r.productName}
                      onPick={(it) => updateRow(i, {
                        productName: it.name, inventoryId: it.id, unit: it.unit || r.unit,
                        rate: it.currentRate ?? r.rate, matchType: "exact", matchScore: 1,
                      })}
                      onChange={(v) => updateRow(i, { productName: v })}
                      matchType={r.matchType}
                      testId={`product-input-${i}`}
                    />
                    {r.rawText && r.rawText !== r.productName && (
                      <div className="text-[10px] text-ink-muted mt-1 italic truncate">“{r.rawText}”</div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      type="number" step="any" value={r.qty}
                      onChange={(e) => updateRow(i, { qty: e.target.value })}
                      className="h-8 tabular border-line"
                      data-testid={`qty-input-${i}`}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Input value={r.unit} onChange={(e) => updateRow(i, { unit: e.target.value })} className="h-8 border-line" data-testid={`unit-input-${i}`} />
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      type="number" step="any" value={r.rate ?? ""}
                      onChange={(e) => updateRow(i, { rate: e.target.value })}
                      className="h-8 tabular text-right border-line"
                      data-testid={`rate-input-${i}`}
                    />
                  </td>
                  <td className="px-4 py-2 text-right tabular font-medium">
                    {amount ? amount.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "—"}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <span className={`text-[11px] tabular ${lowConf ? "text-amberInk font-medium" : "text-ink-muted"}`}>
                      {Math.round((r.confidence ?? 1) * 100)}%
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <button onClick={() => delRow(i)} className="text-ink-muted hover:text-destructive" data-testid={`del-row-${i}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-ink-muted">
                  No items yet. Add one below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-line bg-canvas">
          <Button variant="outline" size="sm" onClick={addRow} className="border-line" data-testid="add-row-button">
            <Plus className="h-4 w-4 mr-1.5" /> Add row
          </Button>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 text-xs text-ink-muted">
          Rows with confidence below 75% are highlighted in amber and should be reviewed before finalizing.
        </div>
        <div className="bg-surface border border-line rounded-lg shadow-card p-5 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-muted">Subtotal</span>
            <span className="tabular font-medium">{subtotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <Label className="text-ink-muted">GST %</Label>
            <Input
              type="number" value={gst} step="any" onChange={(e) => setGst(e.target.value)}
              className="h-7 w-20 tabular text-right border-line"
              data-testid="gst-input"
            />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-muted">GST amount</span>
            <span className="tabular">{gstAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="border-t border-line pt-3 flex items-center justify-between">
            <span className="font-display font-semibold">Grand Total</span>
            <span className="tabular text-xl font-display font-semibold text-brand" data-testid="grand-total">
              ₹ {grand.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductCell({ value, onPick, onChange, matchType, testId }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !value) return;
    let cancel = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.get("/inventory/search", { params: { q: value } });
        if (!cancel) setOptions(r.data.items || []);
      } finally {
        if (!cancel) setLoading(false);
      }
    }, 300);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [value, open]);

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Input
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Product name"
            className="h-8 border-line"
            data-testid={testId}
          />
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[320px] bg-surface border-line" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
          {loading && <div className="p-3 text-xs text-ink-muted">Searching…</div>}
          {!loading && options.length === 0 && <div className="p-3 text-xs text-ink-muted">No matches in inventory.</div>}
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                onPick(o);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 hover:bg-canvas border-b border-line last:border-b-0"
              data-testid={`option-${o.id}`}
            >
              <div className="font-medium text-sm">{o.name}</div>
              <div className="text-[11px] text-ink-muted tabular">
                {o.unit || "—"} · ₹{o.currentRate ?? "—"}
              </div>
            </button>
          ))}
        </PopoverContent>
      </Popover>
      {matchType === "new" && (
        <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-skyTint text-brand whitespace-nowrap">New</span>
      )}
    </div>
  );
}
