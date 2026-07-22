"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Download, Search, X } from "lucide-react";

interface CustomerResult {
  id: string;
  name: string | null;
  phone: string;
  company?: string | null;
}

function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultFrom(): string {
  const d = new Date();
  return toDateInputValue(new Date(d.getFullYear(), d.getMonth(), 1));
}

function defaultTo(): string {
  return toDateInputValue(new Date());
}

export default function QuotationsExportPage() {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [customer, setCustomer] = useState<CustomerResult | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CustomerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!searchQuery.trim() || customer) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api.get("/customers", { params: { q: searchQuery } });
        setSearchResults(r.data.items || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, customer]);

  const filterSummary = useMemo(() => {
    const who = customer
      ? customer.name || customer.phone
      : "all customers";
    return `${from} → ${to} · ${who}`;
  }, [from, to, customer]);

  const downloadTally = async () => {
    if (!from || !to) {
      toast.error("Select from and to dates");
      return;
    }
    setDownloading(true);
    try {
      const params: Record<string, string> = { from, to };
      if (customer?.id) params.customerId = customer.id;

      const r = await api.get("/quotations/tally-export", {
        params,
        responseType: "blob",
        timeout: 120000,
      });

      const contentType = String(r.headers["content-type"] || "");
      if (contentType.includes("application/json")) {
        const text = await (r.data as Blob).text();
        const body = JSON.parse(text);
        toast.error(body.detail || "Export failed");
        return;
      }

      const blob = new Blob([r.data], { type: "application/xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quotations-tally-${from}-${to}.xml`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Tally XML downloaded");
    } catch (e: any) {
      const blob = e?.response?.data;
      if (blob instanceof Blob) {
        try {
          const text = await blob.text();
          const body = JSON.parse(text);
          toast.error(body.detail || "Export failed");
          return;
        } catch {
          // fall through
        }
      }
      toast.error(e?.response?.data?.detail || "Failed to download Tally export");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="p-8 lg:p-12 max-w-5xl text-ink space-y-8">
      <div>
        <div className="text-xs uppercase tracking-wider text-ink-muted">Quotations</div>
        <h1 className="font-display text-3xl font-semibold mt-1">Export for Tally</h1>
        <p className="text-sm text-ink-muted mt-2">
          Download quotations as a TallyPrime-compatible XML file. Filter by date range and
          optionally a single customer.
        </p>
      </div>

      <div className="rounded-lg border border-line bg-surface shadow-card p-5 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-ink-muted">From</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1.5 border-line text-ink"
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-ink-muted">To</Label>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1.5 border-line text-ink"
            />
          </div>
        </div>

        <div>
          <Label className="text-xs uppercase tracking-wider text-ink-muted">Customer</Label>
          {customer ? (
            <div className="mt-1.5 flex items-center justify-between gap-2 rounded-md border border-line bg-canvas/50 px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{customer.name || "Unnamed"}</div>
                <div className="text-xs text-ink-muted">{customer.phone}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCustomer(null);
                  setSearchQuery("");
                }}
                className="p-1 rounded hover:bg-secondary text-ink-muted"
                title="Clear — use all customers"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="mt-1.5 relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-muted" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="All customers — or search name / phone"
                className="pl-9 border-line text-ink"
              />
              {(searching || searchResults.length > 0) && searchQuery.trim() && (
                <div className="absolute z-10 mt-1 w-full rounded-md border border-line bg-surface shadow-card max-h-48 overflow-y-auto">
                  {searching && (
                    <div className="px-3 py-2 text-xs text-ink-muted">Searching…</div>
                  )}
                  {!searching &&
                    searchResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setCustomer(c);
                          setSearchQuery("");
                          setSearchResults([]);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-canvas border-b border-line last:border-0"
                      >
                        <div className="text-sm font-medium">{c.name || "Unnamed"}</div>
                        <div className="text-xs text-ink-muted">{c.phone}</div>
                      </button>
                    ))}
                  {!searching && searchResults.length === 0 && (
                    <div className="px-3 py-2 text-xs text-ink-muted">No customers found</div>
                  )}
                </div>
              )}
            </div>
          )}
          <p className="text-[11px] text-ink-muted mt-1.5">
            Leave empty (or clear selection) to export quotations for all customers.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-line">
          <div className="text-xs text-ink-muted">{filterSummary}</div>
          <Button
            onClick={downloadTally}
            disabled={downloading}
            className="bg-brand hover:bg-brand-hover text-white"
          >
            <Download className="h-4 w-4 mr-1.5" />
            {downloading ? "Preparing…" : "Download for Tally"}
          </Button>
        </div>
      </div>
    </div>
  );
}
