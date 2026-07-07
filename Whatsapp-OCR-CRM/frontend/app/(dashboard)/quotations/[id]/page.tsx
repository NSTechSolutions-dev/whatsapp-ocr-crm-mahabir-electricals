"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, CheckCircle2, Search, UserPlus, X, ChevronDown, ChevronUp, Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { formatINR, timeAgo } from "../../../../lib/format";

interface Customer {
  id: string;
  name: string | null;
  phone: string;
}

interface QuotationData {
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
}

interface CustomerSearchResult {
  id: string;
  name: string | null;
  phone: string;
  stage?: string;
}

export default function QuotationPreviewPage() {
  const { id } = useParams() as { id: string };
  const [q, setQ] = useState<QuotationData | null>(null);
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

  const load = async () => {
    try {
      const r = await api.get(`/quotations/${id}`);
      setQ(r.data);
    } catch (err) {
      toast.error("Failed to load quotation");
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  // Debounced search
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

  const regenerate = async () => {
    setRegenerating(true);
    try {
      await api.post(`/quotations/${id}/regenerate`, { gstPercent: q?.gstPercent || 18 }, { timeout: 120000 });
      toast.success("Quotation PDF regenerated");
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "PDF regeneration failed");
    } finally {
      setRegenerating(false);
    }
  };

  const send = async () => {
    setSending(true);
    try {
      const payload: any = {};
      
      if (customMode) {
        if (showNewCustomer && newCustomerPhone) {
          // Send to new customer
          payload.newCustomer = {
            name: newCustomerName,
            phone: newCustomerPhone,
          };
        } else if (selectedCustomer) {
          // Send to selected existing customer
          payload.customerId = selectedCustomer.id;
        }
        // If neither selected, fall back to original customer
      }
      
      const r = await api.post(`/quotations/${id}/send`, payload, { timeout: 120000 });
      toast.success(`Sent to ${r.data.customerId ? "customer" : "original customer"}`);
      await load();
      
      // Reset custom mode
      setCustomMode(false);
      setSelectedCustomer(null);
      setShowNewCustomer(false);
      setNewCustomerName("");
      setNewCustomerPhone("");
      setSearchQuery("");
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Send failed");
    } finally {
      setSending(false);
    }
  };

  const selectCustomer = (customer: CustomerSearchResult) => {
    setSelectedCustomer(customer);
    setSearchQuery("");
    setSearchResults([]);
    setShowNewCustomer(false);
  };

  const clearSelection = () => {
    setSelectedCustomer(null);
    setShowNewCustomer(false);
    setSearchQuery("");
    setNewCustomerName("");
    setNewCustomerPhone("");
  };

  if (!q) return <div className="p-8 text-ink-muted">Loading…</div>;

  return (
    <div className="p-8 lg:p-12 max-w-6xl text-ink">
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-muted">Quotation</div>
          <h1 className="font-display text-3xl font-semibold mt-1 text-ink">{q.number}</h1>
          <p className="text-ink-muted text-sm mt-1">
            {q.customer?.name || "Customer"} · {q.customer?.phone}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-ink-muted">Grand Total</div>
          <div className="font-display text-3xl font-semibold text-brand tabular mt-1">{formatINR(q.grandTotal)}</div>
        </div>
      </div>

      {!q.pdfReady && (
        <div className="mb-6 p-4 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-900 flex items-center justify-between gap-4">
          <div>
            PDF is not ready for WhatsApp delivery. Regenerate to create a proper PDF file.
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 border-amber-300"
            onClick={regenerate}
            disabled={regenerating}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${regenerating ? "animate-spin" : ""}`} />
            {regenerating ? "Regenerating…" : "Regenerate PDF"}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-surface border border-line rounded-lg shadow-card overflow-hidden min-h-[300px]">
          {q.presignedUrl ? (
            <iframe
              src={q.presignedUrl}
              className="w-full h-[750px] border-0 block"
              title={`Quotation ${q.number}`}
              data-testid="quotation-image"
            />
          ) : (
            <div className="p-8 text-center text-ink-muted flex items-center justify-center h-full min-h-[300px]">
              <div>
                <div className="text-sm">Quotation not available</div>
                <div className="text-xs mt-2 text-ink-muted/60">The PDF may still be generating</div>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div className="bg-surface border border-line rounded-lg shadow-card p-5">
            <h3 className="font-display font-semibold text-base mb-3 text-ink">Delivery</h3>
            
            {q.sentAt ? (
              <div className="flex items-start gap-2 text-sm text-ink mb-4" data-testid="delivery-status">
                <CheckCircle2 className="h-4 w-4 text-brand mt-0.5" />
                <div>
                  <div className="font-medium text-ink">{q.deliveryStatus || "sent"}</div>
                  <div className="text-xs text-ink-muted">Sent {timeAgo(q.sentAt)}</div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-ink-muted mb-4">Not sent yet.</div>
            )}

            {/* Custom customer toggle */}
            <button
              onClick={() => {
                setCustomMode(!customMode);
                if (customMode) clearSelection();
              }}
              className="flex items-center gap-2 text-sm text-brand hover:text-brand-hover mb-3"
            >
              {customMode ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {customMode ? "Hide options" : "Send to different customer"}
            </button>

            {/* Custom customer selection UI */}
            {customMode && (
              <div className="mb-4 space-y-3 border-t border-line pt-3">
                {selectedCustomer ? (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-emerald-900">
                          {selectedCustomer.name || "Unnamed"}
                        </div>
                        <div className="text-xs text-emerald-700">{selectedCustomer.phone}</div>
                      </div>
                      <button
                        onClick={clearSelection}
                        className="p-1 hover:bg-emerald-100 rounded"
                      >
                        <X className="h-4 w-4 text-emerald-600" />
                      </button>
                    </div>
                  </div>
                ) : showNewCustomer ? (
                  <div className="space-y-2">
                    <Input
                      placeholder="Customer name (optional)"
                      value={newCustomerName}
                      onChange={(e) => setNewCustomerName(e.target.value)}
                      className="text-sm"
                    />
                    <Input
                      placeholder="Phone number *"
                      value={newCustomerPhone}
                      onChange={(e) => setNewCustomerPhone(e.target.value)}
                      className="text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowNewCustomer(false)}
                        className="text-xs text-ink-muted hover:text-ink"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
                      <Input
                        placeholder="Search existing customers..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 text-sm"
                      />
                      {searching && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <div className="h-4 w-4 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                        </div>
                      )}
                    </div>
                    
                    {searchResults.length > 0 && (
                      <div className="border border-line rounded-md max-h-48 overflow-y-auto">
                        {searchResults.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => selectCustomer(c)}
                            className="w-full text-left px-3 py-2 hover:bg-canvas border-b border-line last:border-0"
                          >
                            <div className="text-sm font-medium">{c.name || "Unnamed"}</div>
                            <div className="text-xs text-ink-muted">{c.phone}</div>
                          </button>
                        ))}
                      </div>
                    )}
                    
                    <button
                      onClick={() => {
                        setShowNewCustomer(true);
                        setSearchQuery("");
                        setSearchResults([]);
                      }}
                      className="flex items-center gap-2 text-sm text-brand hover:text-brand-hover"
                    >
                      <UserPlus className="h-4 w-4" />
                      Create new customer
                    </button>
                  </>
                )}
              </div>
            )}

            <Button
              onClick={send}
              disabled={sending || (customMode && showNewCustomer && !newCustomerPhone)}
              className="w-full bg-brand hover:bg-brand-hover text-white"
              data-testid="send-quotation-button"
            >
              <Send className="h-4 w-4 mr-2" />
              {sending ? "Sending…" : q.sentAt ? "Resend on WhatsApp" : "Send via WhatsApp"}
            </Button>

            {q.presignedUrl && (
              <a
                href={q.presignedUrl}
                download={`Quotation-${q.number}.pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="block mt-2"
              >
                <Button
                  variant="outline"
                  className="w-full border-line hover:bg-surface-hover text-ink"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download PDF
                </Button>
              </a>
            )}
            
            {customMode && selectedCustomer && (
              <p className="text-[11px] text-emerald-600 mt-2">
                Will send to: {selectedCustomer.name || "Unnamed"} ({selectedCustomer.phone})
              </p>
            )}
            {customMode && showNewCustomer && newCustomerPhone && (
              <p className="text-[11px] text-emerald-600 mt-2">
                Will send to new customer: {newCustomerName || "Unnamed"} ({newCustomerPhone})
              </p>
            )}
            
            <p className="text-[11px] text-ink-muted mt-2">
              MSG91 is MOCKED in this preview — message is logged to the conversation.
            </p>
          </div>
          
          <div className="bg-surface border border-line rounded-lg shadow-card p-5">
            <h3 className="font-display font-semibold text-base mb-3 text-ink">Summary</h3>
            <div className="text-sm space-y-1.5 text-ink">
              <Row label="Subtotal" value={formatINR(q.subtotal)} />
              <Row label={`GST (${q.gstPercent}%)`} value={formatINR(q.gstAmount)} />
              <div className="border-t border-line my-2" />
              <Row label="Grand total" value={formatINR(q.grandTotal)} bold />
              <Row label="Items" value={q.items?.length || 0} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string | number; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-muted">{label}</span>
      <span className={`tabular ${bold ? "font-semibold text-ink" : ""}`}>{value}</span>
    </div>
  );
}
