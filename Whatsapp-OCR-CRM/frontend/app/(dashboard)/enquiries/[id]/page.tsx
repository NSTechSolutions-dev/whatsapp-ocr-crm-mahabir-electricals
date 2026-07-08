"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Send, ArrowLeft, CheckCircle2, Search, UserPlus, X, ChevronDown, ChevronUp, Clock, Package, RefreshCw, Download } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { formatINR, timeAgo, formatDate } from "../../../../lib/format";
import { formatUserErrorMessage } from "../../../../lib/user-error";
import { calculateGstTotals, displayLineAmount, displayUnitRate, type GstMode } from "../../../../lib/gst-calculation";

interface RowData {
  id?: string;
  productName: string;
  qty: number;
  unit: string;
  rate: number | string;
  confidence: number;
  matchType?: string;
  matchScore?: number;
  inventoryId?: string | null;
  rawText?: string | null;
  unitRates?: { id?: string; unit: string; rate: number }[];
}

interface Customer {
  id: string;
  name: string | null;
  phone: string;
}

interface SendHistoryEntry {
  id: string;
  sentAt: string;
  caption: string;
  status: string;
  customer: Customer;
}

interface QuotationData {
  id: string;
  number: string;
  grandTotal: number;
  subtotal: number;
  gstPercent: number;
  gstAmount: number;
  presignedUrl: string;
  pdfReady?: boolean;
  sentAt: string | null;
  deliveryStatus: string | null;
  customer?: Customer;
  items?: any[];
  sendHistory?: SendHistoryEntry[];
}

interface CustomerSearchResult {
  id: string;
  name: string | null;
  phone: string;
  stage?: string;
}

export default function UnifiedEnquiryPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  
  // Enquiry state
  const [data, setData] = useState<any>(null);
  const [rows, setRows] = useState<RowData[]>([]);
  const [gst, setGst] = useState<number | string>(18);
  const [gstMode, setGstMode] = useState<GstMode>("exclusive");
  const [billCustomerName, setBillCustomerName] = useState("");
  const [billCustomerPhone, setBillCustomerPhone] = useState("");
  const [billCustomerCompany, setBillCustomerCompany] = useState("");
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  
  // Layout state
  const [showSource, setShowSource] = useState(false);
  
  useEffect(() => {
    if (data?.status === "IGNORED") {
      setShowSource(true);
    }
  }, [data?.status]);
  
  // Quotation state
  const [quotation, setQuotation] = useState<QuotationData | null>(null);
  const [sending, setSending] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  
  // Custom customer send state
  const [customMode, setCustomMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CustomerSearchResult[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchResult | null>(null);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [searching, setSearching] = useState(false);
 
  // Add unit state
  const [addingUnitForRow, setAddingUnitForRow] = useState<any>(null);
  const [newUnitName, setNewUnitName] = useState("");
  const [newUnitRate, setNewUnitRate] = useState("");

  const handleAddUnit = async () => {
    if (!newUnitName.trim() || !newUnitRate.trim() || addingUnitForRow === null) return;
    const row = rows[addingUnitForRow];
    if (!row.inventoryId) {
      toast.error("Save product to inventory first before adding units");
      return;
    }
    const nextUnitRates = [
      ...(row.unitRates || []),
      { unit: newUnitName.trim(), rate: Number(newUnitRate) }
    ];
    try {
      await api.put(`/inventory/${row.inventoryId}`, {
        unitRates: nextUnitRates
      });
      toast.success("New unit saved to inventory");
      updateRow(addingUnitForRow, {
        unit: newUnitName.trim(),
        rate: Number(newUnitRate),
        unitRates: nextUnitRates
      });
      setAddingUnitForRow(null);
      setNewUnitName("");
      setNewUnitRate("");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to save unit");
    }
  };

  const isIgnored = data?.status === "IGNORED";
  const isSent = data?.status === "SENT";
  const isFinalized = data?.status === "FINALIZED" || isSent;
  const isLocked = isIgnored;
  const quotationId = quotation?.id ?? data?.quotation?.id ?? null;
  const hasQuotation = isFinalized && !!quotationId;
  const hasItems = rows.length > 0;
  const readyToSend = !isFinalized && !isIgnored && hasItems;

  const lineItems = useMemo(
    () =>
      rows.map((r) => ({
        qty: Number(r.qty || 0),
        rate: Number(r.rate || 0),
      })),
    [rows]
  );
  const { subtotal, gstAmount, grandTotal } = useMemo(
    () => calculateGstTotals(lineItems, Number(gst) || 0, gstMode),
    [lineItems, gst, gstMode]
  );

  const billPayload = () => ({
    gstPercent: Number(gst) || 18,
    gstMode,
    billCustomerName: billCustomerName.trim() || null,
    billCustomerPhone: billCustomerPhone.trim() || null,
    billCustomerCompany: billCustomerCompany.trim() || null,
  });

  const loadQuotation = async (quotationId: string) => {
    try {
      const r = await api.get(`/quotations/${quotationId}`);
      setQuotation(r.data);
      return r.data as QuotationData;
    } catch (err) {
      toast.error("Failed to load quotation");
      return null;
    }
  };

  const load = async () => {
    try {
      const r = await api.get(`/enquiries/${id}`);
      setData(r.data);
      setGst(r.data.gstPercent ?? 18);
      setGstMode(r.data.gstMode === "inclusive" ? "inclusive" : "exclusive");
      setBillCustomerName(r.data.billCustomerName ?? r.data.customer?.name ?? "");
      setBillCustomerPhone(r.data.billCustomerPhone ?? r.data.customer?.phone ?? "");
      setBillCustomerCompany(r.data.billCustomerCompany ?? r.data.customer?.company ?? "");
      setRows(
        (r.data.items || []).map((i: any) => ({
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
          unitRates: i.inventory?.unitRates || [],
        }))
      );
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
 
      const qid = r.data.quotation?.id || r.data.quotationId;
      if ((r.data.status === "FINALIZED" || r.data.status === "SENT") && qid) {
        await loadQuotation(qid);
      } else {
        setQuotation(null);
      }
    } catch (err) {
      toast.error("Failed to load enquiry");
    }
  };
 
  useEffect(() => {
    setQuotation(null);
    setCustomMode(false);
    setSelectedCustomer(null);
    setShowNewCustomer(false);
    setSearchQuery("");
    load();
  }, [id]);
 
  // Debounced customer search
  useEffect(() => {
    if (!searchQuery.trim() || !customMode) {
      setSearchResults([]);
      return;
    }
    
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api.get("/customers", { params: { q: searchQuery } });
        setSearchResults(r.data.items || []);
      } catch (e) {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    
    return () => clearTimeout(timer);
  }, [searchQuery, customMode]);
 
  const updateRow = (idx: number, patch: Partial<RowData>) => {
    setRows((rs) =>
      rs.map((r, i) => {
        if (i === idx) {
          const nextRow = { ...r, ...patch };
          if (patch.unit !== undefined && r.unitRates) {
            const matchedRate = r.unitRates.find(
              (ur) => ur.unit.trim().toLowerCase() === patch.unit!.trim().toLowerCase()
            );
            if (matchedRate) {
              nextRow.rate = matchedRate.rate;
            }
          }
          return nextRow;
        }
        return r;
      })
    );
    setHasUnsavedChanges(true);
  };
  const addRow = () => {
    setRows((rs) => [
      ...rs,
      { productName: "", qty: 1, unit: "", rate: "", confidence: 1, matchType: "new", unitRates: [] },
    ]);
    setHasUnsavedChanges(true);
  };
  const delRow = (idx: number) => {
    setRows((rs) => rs.filter((_, i) => i !== idx));
    setHasUnsavedChanges(true);
  };
  const updateGst = (value: string) => {
    setGst(value);
    setHasUnsavedChanges(true);
  };
  const updateGstMode = (mode: GstMode) => {
    setGstMode(mode);
    setHasUnsavedChanges(true);
  };
  const updateBillCustomer = (patch: Partial<{ name: string; phone: string; company: string }>) => {
    if (patch.name !== undefined) setBillCustomerName(patch.name);
    if (patch.phone !== undefined) setBillCustomerPhone(patch.phone);
    if (patch.company !== undefined) setBillCustomerCompany(patch.company);
    setHasUnsavedChanges(true);
  };

  const serializeRows = () =>
    rows
      .filter((r) => r.productName.trim())
      .map((r) => ({
        productName: r.productName.trim(),
        qty: Number(r.qty || 0),
        unit: r.unit || null,
        rate: r.rate === "" || r.rate === null ? null : Number(r.rate),
        inventoryId: r.inventoryId || null,
        rawText: r.rawText || null,
        confidence: r.confidence ?? 1,
      }));

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/enquiries/${id}`, {
        items: serializeRows(),
        ...billPayload(),
      });
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      toast.success("Saved");
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const resolveQuotationId = (overrideId?: string) =>
    overrideId ?? quotation?.id ?? data?.quotation?.id ?? null;

  const saveAndRegenerate = async () => {
    const quotationId = resolveQuotationId();
    setSaving(true);
    if (quotationId) setRegenerating(true);
    try {
      await api.put(`/enquiries/${id}`, {
        items: serializeRows(),
        ...billPayload(),
      });
      setLastSaved(new Date());
      setHasUnsavedChanges(false);

      if (quotationId) {
        await api.post(`/quotations/${quotationId}/regenerate`, billPayload(), { timeout: 120000 });
        await loadQuotation(quotationId);
        toast.success("Saved and PDF regenerated");
      } else {
        toast.success("Saved");
      }
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Save & regenerate failed");
    } finally {
      setSaving(false);
      setRegenerating(false);
    }
  };

  const sendQuotation = async (overrideQuotationId?: string) => {
    const quotationId = resolveQuotationId(overrideQuotationId);
    if (!quotationId) {
      toast.error("Quotation not loaded yet — refresh the page");
      return false;
    }

    setSending(true);
    try {
      const payload: any = { ...billPayload() };

      if (customMode) {
        if (showNewCustomer && newCustomerPhone) {
          payload.newCustomer = {
            name: newCustomerName,
            phone: newCustomerPhone,
          };
        } else if (selectedCustomer) {
          payload.customerId = selectedCustomer.id;
        }
      }

      const r = await api.post(`/quotations/${quotationId}/send`, payload, { timeout: 120000 });
      const recipient = r.data.customer?.name || r.data.customer?.phone || "customer";
      toast.success(`Quotation sent to ${recipient}`);

      setQuotation((prev) =>
        prev
          ? {
              ...prev,
              id: quotationId,
              sentAt: r.data.sentAt,
              deliveryStatus: "sent",
            }
          : {
              id: quotationId,
              number: data?.quotation?.number || "",
              grandTotal,
              subtotal,
              gstPercent: Number(gst) || 18,
              gstAmount,
              presignedUrl: "",
              sentAt: r.data.sentAt,
              deliveryStatus: "sent",
            }
      );
      setData((prev: any) => (prev ? { ...prev, status: "SENT" } : prev));

      await loadQuotation(quotationId);
      await load();

      setCustomMode(false);
      setSelectedCustomer(null);
      setShowNewCustomer(false);
      setNewCustomerName("");
      setNewCustomerPhone("");
      setSearchQuery("");
      return true;
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Send failed");
      return false;
    } finally {
      setSending(false);
    }
  };

  const finalize = async () => {
    const payload = serializeRows();
    if (payload.length === 0) {
      toast.error("Add at least one product before sending");
      return;
    }

    setFinalizing(true);
    let quotationId: string | null = null;
    try {
      const r = await api.post(`/enquiries/${id}/finalize`, {
        items: payload,
        ...billPayload(),
      });

      if (r.data.quotationPending) {
        toast.info("Generating quotation PDF…");
        for (let attempt = 0; attempt < 40; attempt++) {
          const enquiry = await api.get(`/enquiries/${id}`);
          quotationId = enquiry.data?.quotation?.id ?? null;
          if (quotationId) break;
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        if (!quotationId) {
          toast.error("Quotation generation timed out — refresh to check status");
          await load();
          return;
        }
      } else {
        quotationId = r.data.quotationId ?? null;
      }

      if (!quotationId) {
        toast.error("Quotation was not created");
        return;
      }

      await loadQuotation(quotationId);
      await load();
      toast.success("Quotation generated");
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      const offline = !e?.response ? " — is the backend running on port 4001?" : "";
      toast.error(detail ? `${detail}${offline}` : `Finalize failed${offline}`);
      return;
    } finally {
      setFinalizing(false);
    }

    if (quotationId) {
      await sendQuotation(quotationId);
    }
  };

  const selectCustomer = (customer: CustomerSearchResult) => {
    setSelectedCustomer(customer);
    setBillCustomerName(customer.name || "");
    setBillCustomerPhone(customer.phone);
    setBillCustomerCompany("");
    setSearchQuery("");
    setSearchResults([]);
    setShowNewCustomer(false);
    setHasUnsavedChanges(true);
  };

  const clearSelection = () => {
    setSelectedCustomer(null);
    setShowNewCustomer(false);
    setSearchQuery("");
    setNewCustomerName("");
    setNewCustomerPhone("");
  };

  // Generate quotation number for preview
  const quotationNumber = useMemo(() => {
    if (quotation?.number) return quotation.number;
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `QT-${year}-${month}-XXXX`;
  }, [quotation]);

  const displayCustomer = {
    name: billCustomerName || quotation?.customer?.name || data?.customer?.name || "Customer",
    phone: billCustomerPhone || quotation?.customer?.phone || data?.customer?.phone || "",
    company: billCustomerCompany || data?.customer?.company || "",
  };

  const downloadQuotation = () => {
    if (!quotationId) {
      toast.error("Quotation not available yet");
      return;
    }
    window.open(`/api/public/quotations/${quotationId}/pdf?download=1`, "_blank");
  };

  if (!data) return <div className="p-8 text-ink-muted">Loading…</div>;

  const statusBadge = isIgnored ? (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
      Ignored
    </span>
  ) : isSent ? (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-800">
      <CheckCircle2 className="h-2.5 w-2.5" /> Sent
    </span>
  ) : isFinalized ? (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-100 text-violet-800">
      <Package className="h-2.5 w-2.5" /> Finalized
    </span>
  ) : readyToSend ? (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-brand-50 text-brand">
      <Package className="h-2.5 w-2.5" /> Ready
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">
      <Clock className="h-2.5 w-2.5" /> Draft
    </span>
  );

  return (
    <div className="p-4 lg:p-5 max-w-[1600px] text-ink">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        {data.conversation && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/inbox/${data.conversation.id}`)}
            className="h-7 px-2 text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-lg font-semibold text-ink truncate">
              {data.customer?.name || "Customer"}
            </h1>
            {statusBadge}
            <span className="text-xs text-ink-muted truncate">{data.customer?.phone}</span>
          </div>
        </div>

        {!isLocked ? (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] text-ink-muted hidden sm:inline">
              {saving || regenerating ? "Saving…" : hasUnsavedChanges ? "Unsaved" : lastSaved ? `Saved ${lastSaved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={hasQuotation ? saveAndRegenerate : save}
              disabled={saving || regenerating}
              className="h-7 px-2.5 text-xs border-line"
              data-testid="save-enquiry-button"
            >
              {saving || regenerating ? (
                "…"
              ) : hasQuotation ? (
                <>
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Save & Regenerate
                </>
              ) : (
                "Save"
              )}
            </Button>
            {hasQuotation && (
              <Button variant="outline" size="sm" onClick={downloadQuotation} className="h-7 px-2.5 text-xs border-line">
                <Download className="h-3 w-3 mr-1" />
                Download
              </Button>
            )}
            {!isFinalized ? (
              <Button size="sm" onClick={finalize} disabled={finalizing || !hasItems} className="h-7 px-2.5 text-xs bg-brand hover:bg-brand-hover text-white" data-testid="finalize-enquiry-button">
                <Send className="h-3 w-3 mr-1" />
                {finalizing ? "…" : "Send"}
              </Button>
            ) : hasQuotation ? (
              <Button size="sm" onClick={() => sendQuotation()} disabled={sending} className="h-7 px-2.5 text-xs bg-brand hover:bg-brand-hover text-white">
                <Send className="h-3 w-3 mr-1" />
                {sending ? "…" : isSent ? "Resend" : "Send"}
              </Button>
            ) : null}
            {hasUnsavedChanges && !isFinalized && (
              <span className="text-[9px] text-amber-600 hidden sm:inline">unsaved edits will be saved</span>
            )}
          </div>
        ) : (
          <div className="text-right shrink-0">
            <span className="text-lg font-semibold text-brand tabular">{formatINR(quotation?.grandTotal || grandTotal)}</span>
            {quotation?.sentAt && <div className="text-[10px] text-ink-muted">{timeAgo(quotation.sentAt)}</div>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 xl:gap-4">
        {isIgnored && (
          <div className="xl:col-span-2 rounded-md border border-line bg-canvas/60 px-3 py-2 text-xs text-ink-muted">
            This message was not recognized as an inventory or quotation request. It has been logged as an ignored enquiry.
          </div>
        )}
        {/* Left — Editor */}
        <div className={`space-y-2 ${isIgnored ? "xl:col-span-2" : ""}`}>
          <div className="border border-line rounded-md overflow-hidden bg-surface">
            <div className="px-2 py-1.5 border-b border-line flex items-center justify-between bg-canvas/60">
              <span className="text-[11px] font-medium text-ink-muted uppercase tracking-wide">
                Products · {rows.length}
              </span>
              {!isLocked && (
                <button onClick={addRow} className="text-[11px] text-brand hover:text-brand-hover flex items-center gap-0.5" data-testid="add-row-button">
                  <Plus className="h-3 w-3" /> Add
                </button>
              )}
            </div>
            <table className="w-full text-xs table-fixed bg-surface">
              <colgroup>
                <col className="w-[36%]" />
                <col className="w-16" />
                <col className="w-12" />
                <col className="w-[4.5rem]" />
                <col className="w-[4.5rem]" />
                {!isLocked && <col className="w-7" />}
              </colgroup>
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-ink-muted border-b border-line">
                  <th className="text-left px-2 py-1 font-medium w-[36%]">Product</th>
                  <th className="text-left px-1 py-1 font-medium w-16">Qty</th>
                  <th className="text-left px-1 py-1 font-medium">Unit</th>
                  <th className="text-right px-1 py-1 font-medium">Rate</th>
                  <th className="text-right px-2 py-1 font-medium">Amt</th>
                  {!isLocked && <th className="w-7" />}
                </tr>
              </thead>
              <tbody data-testid="enquiry-items-table">
                {rows.map((r, i) => {
                  const amount = displayLineAmount(
                    Number(r.qty || 0),
                    Number(r.rate || 0),
                    Number(gst) || 0,
                    gstMode
                  );
                  const lowConf = (r.confidence ?? 1) < 0.75;
                  const rowBg = lowConf ? "bg-amber-500/5" : "bg-surface";
                  return (
                    <tr key={i} className="border-b border-line/60 last:border-0" data-testid={`row-${i}`}>
                      <td className={`px-2 py-1 align-top min-w-0 overflow-hidden w-[36%] ${rowBg}`}>
                        <ProductCell
                          value={r.productName}
                          inventoryId={r.inventoryId}
                          rowUnit={r.unit}
                          rowRate={r.rate}
                          onPick={(it: any) =>
                            updateRow(i, {
                              productName: it.name,
                              inventoryId: it.id,
                              unit: it.unit || r.unit,
                              rate: it.currentRate ?? r.rate,
                              matchType: it.isNew ? "new" : "exact",
                              matchScore: it.isNew ? 0 : 1,
                              unitRates: it.unitRates || [],
                            })
                          }
                          onChange={(v: string) =>
                            updateRow(i, {
                              productName: v,
                              inventoryId: null,
                              matchType: "new",
                              matchScore: 0,
                            })
                          }
                          testId={`product-input-${i}`}
                          disabled={isLocked}
                        />
                        {r.rawText && r.rawText !== r.productName && (
                          <div className="text-[9px] text-ink-muted mt-0.5 italic truncate">“{r.rawText}”</div>
                        )}
                      </td>
                      <td className={`px-1 py-1 w-16 ${rowBg}`}>
                        <Input
                          type="number"
                          step="any"
                          value={r.qty}
                          onChange={(e) => updateRow(i, { qty: Number(e.target.value) })}
                          className="h-6 w-full min-w-0 text-xs tabular border-line px-1 bg-transparent"
                          data-testid={`qty-input-${i}`}
                          disabled={isLocked}
                        />
                      </td>
                      <td className={`px-1 py-1 w-12 ${rowBg}`}>
                        {!isLocked && r.inventoryId ? (
                          <select
                            value={r.unit}
                            onChange={(e) => {
                              if (e.target.value === "ADD_NEW") {
                                setAddingUnitForRow(i);
                              } else {
                                updateRow(i, { unit: e.target.value });
                              }
                            }}
                            className="h-6 w-full text-xs border border-line bg-surface rounded px-1 text-ink focus:outline-none focus:ring-1 focus:ring-brand"
                            data-testid={`unit-select-${i}`}
                          >
                            {!r.unit && <option value="">—</option>}
                            {r.unit && !(r.unitRates || []).some(ur => ur.unit.toLowerCase() === r.unit.toLowerCase()) && (
                              <option value={r.unit}>{r.unit}</option>
                            )}
                            {(r.unitRates || []).map((ur, idx) => (
                              <option key={idx} value={ur.unit}>
                                {ur.unit}
                              </option>
                            ))}
                            <option value="ADD_NEW" className="text-brand font-medium">
                              + Add unit...
                            </option>
                          </select>
                        ) : (
                          <Input
                            value={r.unit}
                            onChange={(e) => updateRow(i, { unit: e.target.value })}
                            className="h-6 w-full min-w-0 text-xs border-line px-1 bg-transparent"
                            data-testid={`unit-input-${i}`}
                            disabled={isLocked}
                          />
                        )}
                      </td>
                      <td className={`px-1 py-1 w-[4.5rem] ${rowBg}`}>
                        <Input
                          type="number"
                          step="any"
                          value={r.rate ?? ""}
                          onChange={(e) => updateRow(i, { rate: e.target.value })}
                          className="h-6 w-full min-w-0 text-xs tabular text-right border-line px-1 bg-transparent"
                          data-testid={`rate-input-${i}`}
                          disabled={isLocked}
                        />
                      </td>
                      <td className={`px-2 py-1 text-right tabular text-[11px] font-medium w-[4.5rem] overflow-hidden ${rowBg}`}>
                        <span className="block truncate" title={amount ? String(amount) : undefined}>
                          {amount ? amount.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "—"}
                        </span>
                      </td>
                      {!isLocked && (
                        <td className={`w-7 p-0 align-top ${rowBg}`}>
                          <button
                            onClick={() => delRow(i)}
                            className="inline-flex items-center justify-center w-7 h-6 text-ink-muted/60 hover:text-destructive"
                            data-testid={`del-row-${i}`}
                          >
                            <Trash2 className="h-3 w-3 shrink-0" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={isLocked ? 5 : 6} className="px-2 py-4 text-center text-[11px] text-ink-muted">
                      No items
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="border-t border-line bg-canvas/40">
                <tr>
                  <td colSpan={4} className="px-2 py-1 text-[10px] text-ink-muted text-right">
                    Subtotal
                  </td>
                  <td className="px-2 py-1 text-right tabular text-[11px] font-medium w-[4.5rem] overflow-hidden">
                    <span className="block truncate">
                      {subtotal.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                    </span>
                  </td>
                  {!isLocked && <td className="w-7" />}
                </tr>
                <tr>
                  <td colSpan={4} className="px-2 py-1 text-[10px] text-ink-muted text-right">
                    <span className="inline-flex items-center gap-1 justify-end flex-wrap">
                      <span className="inline-flex rounded border border-line overflow-hidden">
                        <button
                          type="button"
                          onClick={() => updateGstMode("exclusive")}
                          className={`px-1.5 py-0.5 text-[9px] ${gstMode === "exclusive" ? "bg-brand text-white" : "bg-surface text-ink-muted"}`}
                        >
                          GST
                        </button>
                        <button
                          type="button"
                          onClick={() => updateGstMode("inclusive")}
                          className={`px-1.5 py-0.5 text-[9px] ${gstMode === "inclusive" ? "bg-brand text-white" : "bg-surface text-ink-muted"}`}
                        >
                          Pre-GST
                        </button>
                      </span>
                      GST
                      {!isLocked ? (
                        <Input
                          type="number"
                          value={gst}
                          step="any"
                          onChange={(e) => updateGst(e.target.value)}
                          className="h-5 w-10 text-[10px] tabular text-center border-line px-0.5"
                          data-testid="gst-input"
                        />
                      ) : (
                        <span>({gst}%)</span>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-right tabular text-[11px] w-[4.5rem] overflow-hidden">
                    <span className="block truncate">
                      {gstAmount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                    </span>
                  </td>
                  {!isLocked && <td className="w-7" />}
                </tr>
                <tr className="border-t border-line/60">
                  <td colSpan={4} className="px-2 py-1.5 text-[11px] font-semibold text-right">
                    Total
                  </td>
                  <td className="px-2 py-1.5 text-right tabular text-sm font-semibold text-brand w-[4.5rem] overflow-hidden" data-testid="grand-total">
                    <span className="block truncate">
                      ₹{grandTotal.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                    </span>
                  </td>
                  {!isLocked && <td className="w-7" />}
                </tr>
              </tfoot>
            </table>
          </div>

          <button
            onClick={() => setShowSource(!showSource)}
            className="text-[11px] text-ink-muted hover:text-ink flex items-center gap-1"
          >
            {showSource ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Source
          </button>

          {showSource && (
            <SourcePreview
              conversation={data.conversation}
              sourceData={data.sourceData}
              enquiryId={id}
              onUpdate={load}
              isFinalized={isFinalized || isIgnored}
            />
          )}
        </div>

        {/* Right — Live quotation preview */}
        {!isIgnored && (
        <div className="space-y-2">
          <div className="border border-line rounded-md bg-white p-4 lg:p-5">
            <div className="mb-3 rounded-md border border-line bg-canvas/40 p-2.5 space-y-2">
              <div className="text-[10px] uppercase tracking-wide text-ink-muted">Bill customer</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <Label className="text-[9px] text-ink-muted">Name</Label>
                  <Input
                    value={billCustomerName}
                    onChange={(e) => updateBillCustomer({ name: e.target.value })}
                    className="mt-1 h-7 text-xs border-line"
                    disabled={isLocked}
                  />
                </div>
                <div>
                  <Label className="text-[9px] text-ink-muted">Phone</Label>
                  <Input
                    value={billCustomerPhone}
                    onChange={(e) => updateBillCustomer({ phone: e.target.value })}
                    className="mt-1 h-7 text-xs border-line"
                    disabled={isLocked}
                  />
                </div>
                <div>
                  <Label className="text-[9px] text-ink-muted">Company</Label>
                  <Input
                    value={billCustomerCompany}
                    onChange={(e) => updateBillCustomer({ company: e.target.value })}
                    className="mt-1 h-7 text-xs border-line"
                    disabled={isLocked}
                  />
                </div>
              </div>
            </div>
            <QuotationPreview
            quotationNumber={quotationNumber}
            customer={displayCustomer}
            rows={rows}
            subtotal={subtotal}
            gst={gst}
            gstMode={gstMode}
            gstAmount={gstAmount}
            grandTotal={grandTotal}
          />
          </div>

          {hasQuotation && (
            <div className="border border-line rounded-md p-3 bg-surface space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Delivery</span>
                {(quotation?.sentAt || isSent) ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-brand" data-testid="delivery-status">
                    <CheckCircle2 className="h-3 w-3" />
                    {quotation?.deliveryStatus || "Sent"}
                  </span>
                ) : (
                  <span className="text-[10px] text-ink-muted">Not sent yet</span>
                )}
              </div>

              {quotation?.sendHistory && quotation.sendHistory.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-ink-muted">Send history</div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {quotation.sendHistory.map((entry) => (
                      <div key={entry.id} className="border border-line rounded-md p-2 bg-canvas/40" data-testid={`send-history-${entry.id}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-ink truncate">
                              {entry.customer.name || "Unnamed"}
                            </div>
                            <div className="text-[10px] text-ink-muted">{entry.customer.phone}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[10px] text-ink-muted">{timeAgo(entry.sentAt)}</div>
                            <div className="text-[9px] text-ink-muted/70">{formatDate(entry.sentAt)}</div>
                          </div>
                        </div>
                        <div className="mt-1.5 text-[10px] text-ink-muted font-mono leading-relaxed break-words border-t border-line/60 pt-1.5">
                          {entry.caption}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => {
                  setCustomMode(!customMode);
                  if (customMode) clearSelection();
                }}
                className="text-[11px] text-brand hover:text-brand-hover flex items-center gap-1"
              >
                {customMode ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {(quotation?.sentAt || isSent) ? "Send to different customer" : "Different customer"}
              </button>

              {customMode && (
                <div className="space-y-2 border-t border-line pt-2">
                  {selectedCustomer ? (
                    <div className="p-2 bg-emerald-50 border border-emerald-200 rounded flex items-center justify-between">
                      <div className="text-xs">
                        <div className="font-medium text-emerald-900">{selectedCustomer.name || "Unnamed"}</div>
                        <div className="text-emerald-700">{selectedCustomer.phone}</div>
                      </div>
                      <button onClick={clearSelection} className="p-0.5 hover:bg-emerald-100 rounded">
                        <X className="h-3 w-3 text-emerald-600" />
                      </button>
                    </div>
                  ) : showNewCustomer ? (
                    <div className="space-y-1.5">
                      <Input placeholder="Name" value={newCustomerName} onChange={(e) => { setNewCustomerName(e.target.value); setBillCustomerName(e.target.value); setHasUnsavedChanges(true); }} className="h-7 text-xs" />
                      <Input placeholder="Phone *" value={newCustomerPhone} onChange={(e) => { setNewCustomerPhone(e.target.value); setBillCustomerPhone(e.target.value); setHasUnsavedChanges(true); }} className="h-7 text-xs" />
                      <button onClick={() => setShowNewCustomer(false)} className="text-[10px] text-ink-muted">Cancel</button>
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-ink-muted" />
                        <Input placeholder="Search customers…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-7 h-7 text-xs" />
                      </div>
                      {searchResults.length > 0 && (
                        <div className="border border-line rounded max-h-32 overflow-y-auto">
                          {searchResults.map((c) => (
                            <button key={c.id} onClick={() => selectCustomer(c)} className="w-full text-left px-2 py-1.5 hover:bg-canvas border-b border-line last:border-0 text-xs">
                              <div className="font-medium">{c.name || "Unnamed"}</div>
                              <div className="text-ink-muted">{c.phone}</div>
                            </button>
                          ))}
                        </div>
                      )}
                      <button onClick={() => { setShowNewCustomer(true); setSearchQuery(""); setSearchResults([]); }} className="text-[11px] text-brand flex items-center gap-1">
                        <UserPlus className="h-3 w-3" /> New customer
                      </button>
                    </>
                  )}
                </div>
              )}

              {quotation && quotation.pdfReady === false && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900 flex items-center justify-between gap-2">
                  <span>PDF file missing. Save and generate before sending on WhatsApp.</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[10px] border-amber-300 shrink-0"
                    onClick={saveAndRegenerate}
                    disabled={saving || regenerating}
                  >
                    <RefreshCw className={`h-3 w-3 mr-1 ${saving || regenerating ? "animate-spin" : ""}`} />
                    {saving || regenerating ? "Generating…" : "Save & Generate PDF"}
                  </Button>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={downloadQuotation}
                  size="sm"
                  className="h-7 text-xs border-line"
                >
                  <Download className="h-3 w-3 mr-1" />
                  Download
                </Button>
                <Button
                  type="button"
                  onClick={() => sendQuotation()}
                  disabled={sending || (customMode && showNewCustomer && !newCustomerPhone)}
                  size="sm"
                  className="flex-1 h-7 text-xs bg-brand hover:bg-brand-hover text-white"
                  data-testid="send-quotation-button"
                >
                  <Send className="h-3 w-3 mr-1" />
                  {sending
                    ? "…"
                    : customMode && (selectedCustomer || (showNewCustomer && newCustomerPhone))
                      ? "Send to selected"
                      : (quotation?.sentAt || isSent)
                        ? "Resend WhatsApp"
                        : "Send WhatsApp"}
                </Button>
              </div>
            </div>
          )}
        </div>
        )}
      <Dialog open={addingUnitForRow !== null} onOpenChange={(o) => !o && setAddingUnitForRow(null)}>
        <DialogContent className="bg-surface border-line max-w-sm text-ink">
          <DialogHeader>
            <DialogTitle className="font-display text-ink text-sm font-semibold">
              Add unit rate for {addingUnitForRow !== null ? rows[addingUnitForRow].productName : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-4 text-xs">
            <div>
              <Label className="text-ink-muted">Unit name (e.g. Box, Packet)</Label>
              <Input
                value={newUnitName}
                onChange={(e) => setNewUnitName(e.target.value)}
                placeholder="Unit"
                className="mt-1 border-line text-ink"
              />
            </div>
            <div>
              <Label className="text-ink-muted">Rate (₹)</Label>
              <Input
                type="number"
                value={newUnitRate}
                onChange={(e) => setNewUnitRate(e.target.value)}
                placeholder="Rate"
                className="mt-1 border-line text-ink"
              />
            </div>
            <div className="flex gap-2 justify-end pt-3">
              <Button variant="outline" size="sm" onClick={() => setAddingUnitForRow(null)} className="h-7 border-line text-ink">
                Cancel
              </Button>
              <Button size="sm" onClick={handleAddUnit} className="h-7 bg-brand hover:bg-brand-hover text-white">
                Add and Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}

function QuotationPreview({
  quotationNumber,
  customer,
  rows,
  subtotal,
  gst,
  gstMode,
  gstAmount,
  grandTotal,
}: {
  quotationNumber: string;
  customer: { name?: string | null; phone?: string; company?: string | null };
  rows: RowData[];
  subtotal: number;
  gst: number | string;
  gstMode: GstMode;
  gstAmount: number;
  grandTotal: number;
}) {
  const dateStr = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const items = rows.filter((r) => r.productName);
  const gstPercent = Number(gst) || 0;

  return (
    <div className="bg-white text-gray-900 text-sm leading-snug" data-testid="quotation-preview">
      <div className="flex justify-between items-baseline border-b-2 border-gray-900 pb-2 mb-3">
        <div>
          <div className="text-base font-bold tracking-tight">QUOTATION</div>
          <div className="text-[10px] text-gray-500 font-mono mt-0.5">{quotationNumber}</div>
        </div>
        <div className="text-right text-[11px] text-gray-500">
          <div>{dateStr}</div>
        </div>
      </div>

      <div className="mb-3 text-[11px]">
        <div className="text-gray-400 uppercase tracking-wide text-[9px]">Bill To</div>
        <div className="font-semibold">{customer.name || "Customer"}</div>
        {customer.company ? <div className="text-gray-600">{customer.company}</div> : null}
        <div className="text-gray-600">{customer.phone}</div>
      </div>

      <table className="w-full text-[11px] mb-3">
        <thead>
          <tr className="border-b border-gray-300 text-gray-500 text-[9px] uppercase">
            <th className="text-left py-1 font-medium">Item</th>
            <th className="text-center py-1 font-medium w-14">Qty</th>
            <th className="text-right py-1 font-medium w-16">Rate</th>
            <th className="text-right py-1 font-medium w-16">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r, i) => {
            const unitRate = displayUnitRate(Number(r.rate || 0), gstPercent, gstMode);
            const amount = displayLineAmount(Number(r.qty || 0), Number(r.rate || 0), gstPercent, gstMode);
            return (
              <tr key={i} className="border-b border-gray-100">
                <td className="py-1 pr-2">{r.productName}</td>
                <td className="py-1 text-center text-gray-600 tabular">
                  {r.qty}{r.unit ? ` ${r.unit}` : ""}
                </td>
                <td className="py-1 text-right text-gray-600 tabular">
                  {unitRate.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </td>
                <td className="py-1 text-right font-medium tabular">
                  {amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </td>
              </tr>
            );
          })}
          {items.length === 0 && (
            <tr>
              <td colSpan={4} className="py-3 text-center text-gray-400 text-[11px]">
                Add products to preview
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="border-t border-gray-200 pt-2 space-y-0.5 text-[11px]">
        <div className="flex justify-between text-gray-600">
          <span>Subtotal</span>
          <span className="tabular">₹{subtotal.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
        </div>
        {Number(gst) > 0 && (
          <div className="flex justify-between text-gray-600">
            <span>GST ({gst}%)</span>
            <span className="tabular">₹{gstAmount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
          </div>
        )}
        <div className="flex justify-between pt-1 border-t border-gray-200 font-bold text-sm">
          <span>Total</span>
          <span className="tabular">₹{grandTotal.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
        </div>
      </div>
    </div>
  );
}

function ProductCell({
  value,
  inventoryId,
  rowUnit,
  rowRate,
  onPick,
  onChange,
  testId,
  disabled = false,
}: {
  value: string;
  inventoryId?: string | null;
  rowUnit?: string;
  rowRate?: number | string;
  onPick: (it: any) => void;
  onChange: (v: string) => void;
  testId: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const isMapped = !!inventoryId;
  const showAddNew = !!value.trim() && !isMapped;

  useEffect(() => {
    if (!value || value.length < 2) {
      setOptions([]);
      return;
    }
    let cancel = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.get("/inventory/search", { params: { q: value } });
        if (!cancel) setOptions(r.data.items || []);
      } finally {
        if (!cancel) setLoading(false);
      }
    }, 200);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    if (newValue.trim()) {
      setOpen(true);
    }
  };

  const handleSelect = (item: any) => {
    onPick(item);
    setOpen(false);
  };

  const handleCreateNew = () => {
    onPick({
      id: null,
      name: value.trim(),
      unit: rowUnit || "",
      currentRate: rowRate === "" || rowRate == null ? null : Number(rowRate),
      isNew: true,
    });
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-2 w-full">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="flex-1 min-w-0">
            <Input
              type="text"
              value={value}
              onChange={handleInputChange}
              onFocus={() => value.trim() && setOpen(true)}
              placeholder="Product…"
              className="h-6 text-xs border-line text-ink w-full px-1.5"
              data-testid={testId}
              disabled={disabled}
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          className="p-0 w-[260px] bg-surface border-line text-ink"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {loading && <div className="p-3 text-xs text-ink-muted">Searching inventory…</div>}

          {!loading && options.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-ink-muted bg-canvas border-b border-line">
                Select from inventory
              </div>
              {options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => handleSelect(o)}
                  className="w-full text-left px-3 py-2 hover:bg-canvas border-b border-line last:border-b-0 text-ink"
                  data-testid={`option-${o.id}`}
                >
                  <div className="font-medium text-sm">{o.name}</div>
                  <div className="text-[11px] text-ink-muted tabular">
                    {o.unit || "—"} · ₹{o.currentRate ?? "—"}
                  </div>
                </button>
              ))}
            </div>
          )}

          {!loading && showAddNew && (
            <button
              type="button"
              onClick={handleCreateNew}
              className={`w-full text-left px-3 py-2.5 hover:bg-canvas text-ink flex items-center gap-2 ${
                options.length > 0 ? "border-t border-line" : ""
              }`}
              data-testid="create-new-product"
            >
              <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-brand text-white">New</span>
              <span className="font-medium text-sm">Add "{value.trim()}" as new</span>
            </button>
          )}

          {!loading && !showAddNew && options.length === 0 && (
            <div className="p-3 text-xs text-ink-muted">Type to search inventory…</div>
          )}
        </PopoverContent>
      </Popover>

      {showAddNew && (
        <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-brand text-white whitespace-nowrap flex-shrink-0 animate-in fade-in duration-200">
          New
        </span>
      )}
    </div>
  );
}

function SourcePreview({ 
  conversation, 
  sourceData, 
  enquiryId, 
  onUpdate,
  isFinalized
}: { 
  conversation: any; 
  sourceData?: string;
  enquiryId: string;
  onUpdate: () => void;
  isFinalized: boolean;
}) {
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(sourceData || "");
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseRetryable, setParseRetryable] = useState(false);

  useEffect(() => {
    setEditText(sourceData || "");
  }, [sourceData]);

  useEffect(() => {
    if (!conversation?.id) {
      setLoading(false);
      return;
    }
    
    const load = async () => {
      try {
        const r = await api.get(`/inbox/${conversation.id}`);
        setMessages(r.data.messages || []);
      } catch (e) {
        // Silent fail
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [conversation?.id]);

  const handleReparse = async () => {
    setIsParsing(true);
    setParseError(null);
    setParseRetryable(false);
    try {
      await api.post(`/enquiries/${enquiryId}/reparse`, { rawText: editText });
      toast.success("Products parsed with Gemini");
      setIsEditing(false);
      onUpdate();
    } catch (e: any) {
      const detail = formatUserErrorMessage(
        e?.response?.data?.detail,
        "Gemini parse failed. Please try again."
      );
      const retryable = !!e?.response?.data?.retryable;
      setParseError(detail);
      setParseRetryable(retryable);
      toast.error(detail);
    } finally {
      setIsParsing(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-xs text-ink-muted">Loading source...</div>;
  }

  const enquiryMessage = messages.find((m: any) => 
    m.direction === "INBOUND" && (m.type === "image" || (m.type === "text" && m.content?.length > 10))
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
      <div className="border border-line rounded-md overflow-hidden">
        <div className="px-2 py-1 border-b border-line bg-canvas/60 flex items-center justify-between">
          <span className="text-[10px] font-medium text-ink-muted uppercase">OCR</span>
          {sourceData && !isEditing && !isFinalized && (
            <button onClick={() => { setIsEditing(true); setParseError(null); }} className="text-[10px] text-brand hover:text-brand-hover">
              Edit
            </button>
          )}
        </div>
        <div className="p-2">
          {sourceData ? (
            isEditing ? (
              <div className="space-y-1.5">
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="w-full h-24 p-2 text-[11px] font-mono bg-canvas border border-line rounded text-ink resize-y"
                  placeholder="OCR text..."
                />
                <div className="flex gap-1.5 flex-wrap items-center">
                  <Button size="sm" onClick={handleReparse} disabled={isParsing || !editText.trim()} className="h-6 text-[10px] bg-brand text-white px-2">
                    {isParsing ? "…" : parseError ? "Retry Gemini" : "Parse with Gemini"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setIsEditing(false); setEditText(sourceData || ""); setParseError(null); }} className="h-6 text-[10px] px-2 border-line">
                    Cancel
                  </Button>
                </div>
                {parseError && (
                  <p className="text-[10px] text-red-600 leading-snug">
                    {parseError}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <pre className="text-[11px] text-ink whitespace-pre-wrap font-mono leading-relaxed">{sourceData}</pre>
                {!isFinalized && sourceData && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[10px] border-line"
                    onClick={() => { setIsEditing(true); setParseError(null); }}
                  >
                    {parseError ? "Retry Gemini parse" : "Re-parse with Gemini"}
                  </Button>
                )}
              </div>
            )
          ) : (
            <div className="text-[10px] text-ink-muted">No OCR text</div>
          )}
        </div>
      </div>

      <div className="border border-line rounded-md overflow-hidden">
        <div className="px-2 py-1 border-b border-line bg-canvas/60">
          <span className="text-[10px] font-medium text-ink-muted uppercase">Original</span>
        </div>
        <div className="p-2">
          {enquiryMessage ? (
            <>
              {enquiryMessage.type === "image" && enquiryMessage.mediaUrl && (
                <img
                  src={enquiryMessage.mediaUrl.startsWith("http") ? enquiryMessage.mediaUrl : `/api/files/${enquiryMessage.mediaUrl}`}
                  alt="Source"
                  className="max-h-[140px] rounded border border-line object-contain"
                />
              )}
              {enquiryMessage.type === "text" && enquiryMessage.content && (
                <pre className="text-[11px] text-ink whitespace-pre-wrap">{enquiryMessage.content}</pre>
              )}
            </>
          ) : (
            <div className="text-[10px] text-ink-muted">No source</div>
          )}
        </div>
      </div>
    </div>
  );
}
