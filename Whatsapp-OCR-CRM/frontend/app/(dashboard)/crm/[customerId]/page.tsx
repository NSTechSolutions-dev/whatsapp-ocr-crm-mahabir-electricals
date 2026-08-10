"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Check, Pencil, X, Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../../lib/api";
import { formatINR, timeAgo, formatDate } from "../../../../lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface EnquiryItem {
  id: string;
  status: string;
  itemsCount: number;
  imageCount?: number;
  createdAt: string;
  quotation: {
    number: string;
    grandTotal: number;
  } | null;
}

interface MessageItem {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  content: string | null;
  mediaUrl: string | null;
  createdAt: string;
}

interface CustomerProfileData {
  customer: {
    id: string;
    name: string | null;
    phone: string;
    company: string | null;
    stage?: string;
    doNotDisturb?: boolean;
    createdAt: string;
  };
  stats: {
    totalEnquiries: number;
    quotationsSent: number;
    lastActivity: string;
  };
  enquiries: EnquiryItem[];
  messages: MessageItem[];
  topProducts: { name: string; count: number }[];
}

export default function CustomerProfilePage() {
  const { customerId } = useParams() as { customerId: string };
  const [data, setData] = useState<CustomerProfileData | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [savingDnd, setSavingDnd] = useState(false);

  useEffect(() => {
    api.get(`/customers/${customerId}`).then((r) => setData(r.data));
  }, [customerId]);

  const timeline = useMemo(() => {
    if (!data) return [];
    type TimelineItem =
      | { kind: "enquiry"; ts: string; payload: EnquiryItem }
      | { kind: "message"; ts: string; payload: MessageItem };
    const items: TimelineItem[] = [];
    for (const e of data.enquiries || []) {
      items.push({ kind: "enquiry", ts: e.createdAt, payload: e });
    }
    for (const m of data.messages || []) {
      items.push({ kind: "message", ts: m.createdAt, payload: m });
    }
    items.sort((a, b) => (a.ts < b.ts ? 1 : -1));
    return items;
  }, [data]);

  const toggleDnd = async () => {
    if (!data) return;
    const next = !data.customer.doNotDisturb;
    setSavingDnd(true);
    try {
      const r = await api.patch(`/customers/${customerId}/dnd`, { doNotDisturb: next });
      setData((prev) =>
        prev
          ? {
              ...prev,
              customer: {
                ...prev.customer,
                doNotDisturb: r.data.customer.doNotDisturb,
              },
            }
          : prev
      );
      toast.success(next ? "DND on — automations silenced" : "DND off — automations allowed");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to update DND");
    } finally {
      setSavingDnd(false);
    }
  };

  const startEditName = () => {
    if (!data) return;
    setNameDraft(data.customer.name || "");
    setEditingName(true);
  };

  const cancelEditName = () => {
    setEditingName(false);
    setNameDraft("");
  };

  const saveName = async () => {
    if (!data) return;
    const next = nameDraft.trim();
    if (next === (data.customer.name || "").trim()) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      const r = await api.patch(`/customers/${customerId}`, { name: next });
      setData((prev) =>
        prev
          ? {
              ...prev,
              customer: {
                ...prev.customer,
                name: r.data.customer.name,
              },
            }
          : prev
      );
      setEditingName(false);
      toast.success("Customer name updated");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to update name");
    } finally {
      setSavingName(false);
    }
  };

  if (!data) return <div className="p-8 text-ink-muted">Loading…</div>;
  const c = data.customer;

  return (
    <div className="p-8 lg:p-12 max-w-6xl text-ink">
      <div className="mb-8">
        <div className="text-xs uppercase tracking-wider text-ink-muted">Customer</div>
        {editingName ? (
          <div className="mt-1 flex flex-wrap items-center gap-2 max-w-xl">
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="Customer name"
              className="font-display text-lg h-10 border-line"
              autoFocus
              data-testid="customer-name-input"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void saveName();
                }
                if (e.key === "Escape") cancelEditName();
              }}
            />
            <Button
              type="button"
              size="sm"
              onClick={() => void saveName()}
              disabled={savingName}
              data-testid="customer-name-save"
            >
              <Check className="h-4 w-4 mr-1" />
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={cancelEditName}
              disabled={savingName}
              data-testid="customer-name-cancel"
            >
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
          </div>
        ) : (
          <div className="mt-1 flex items-center gap-2">
            <h1 className="font-display text-3xl font-semibold text-ink">{c.name || "Unnamed"}</h1>
            <button
              type="button"
              onClick={startEditName}
              className="rounded p-1.5 text-ink-muted hover:text-brand hover:bg-brand-50 transition-colors"
              title="Edit customer name"
              data-testid="customer-name-edit"
            >
              <Pencil className="h-4 w-4" />
            </button>
          </div>
        )}
        <p className="text-ink-muted text-sm mt-1">
          {c.phone}
          {c.company && <> · {c.company}</>} · since {formatDate(c.createdAt)}
          {c.stage ? <> · {c.stage}</> : null}
        </p>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => void toggleDnd()}
            disabled={savingDnd}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
              c.doNotDisturb
                ? "border-stone-300 bg-stone-200 text-stone-800 hover:bg-stone-300"
                : "border-line bg-surface text-ink-muted hover:text-ink hover:bg-canvas"
            )}
            data-testid="customer-dnd-toggle"
            title={
              c.doNotDisturb
                ? "DND on — click to allow automations"
                : "DND off — click to silence automations"
            }
          >
            {c.doNotDisturb ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
            {c.doNotDisturb ? "DND On" : "DND Off"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8" data-testid="customer-stats">
        <StatCard label="Total enquiries" value={data.stats.totalEnquiries} />
        <StatCard label="Quotations sent" value={data.stats.quotationsSent} />
        <StatCard label="Last activity" value={timeAgo(data.stats.lastActivity)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <h2 className="font-display text-lg font-semibold mb-4 text-ink">Activity Timeline</h2>
          <div className="space-y-3" data-testid="customer-timeline">
            {timeline.length === 0 && <div className="text-sm text-ink-muted">No activity yet.</div>}
            {timeline.map((t: any, i) =>
              t.kind === "enquiry" ? (
                <EnquiryCard key={i} e={t.payload} />
              ) : (
                <MessageRow key={i} m={t.payload} />
              )
            )}
          </div>
        </div>
        <div>
          <h2 className="font-display text-lg font-semibold mb-4 text-ink">Top Products</h2>
          <div className="bg-surface border border-line rounded-lg shadow-card divide-y divide-line" data-testid="customer-top-products">
            {(data.topProducts || []).length === 0 && (
              <div className="px-4 py-6 text-sm text-ink-muted">No history yet.</div>
            )}
            {data.topProducts?.map((p, i) => (
              <div key={i} className="px-4 py-3 flex items-center justify-between text-sm text-ink">
                <span>{p.name}</span>
                <span className="tabular text-ink-muted">×{p.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-surface border border-line rounded-lg shadow-card p-5">
      <div className="text-xs uppercase tracking-wider text-ink-muted">{label}</div>
      <div className="font-display text-2xl font-semibold mt-2 tabular text-ink">{value}</div>
    </div>
  );
}

function enquiryStatusLabel(status: string): string {
  switch (status) {
    case "WAITING":
      return "Waiting for images";
    case "PROCESSING":
      return "Processing OCR";
    case "FAILED":
      return "Failed";
    case "DRAFT":
    case "REVIEW":
      return "Ready for review";
    default:
      return status;
  }
}

function EnquiryCard({ e }: { e: EnquiryItem }) {
  return (
    <Link
      href={`/enquiries/${e.id}`}
      className="block bg-surface border border-line rounded-lg shadow-card p-4 hover:border-brand transition-colors text-ink"
      data-testid={`enquiry-card-${e.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-muted">Enquiry</div>
          <div className="font-medium mt-0.5">
            {e.status === "WAITING" || e.status === "PROCESSING"
              ? `${e.imageCount ?? 0} page(s)`
              : `${e.itemsCount} items`}
          </div>
          {e.quotation && (
            <div className="text-xs text-ink-muted mt-1 tabular">
              {e.quotation.number} · {formatINR(e.quotation.grandTotal)}
            </div>
          )}
        </div>
        <div className="text-right">
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-brand-50 text-brand">
            {enquiryStatusLabel(e.status)}
          </span>
          <div className="text-[11px] text-ink-muted mt-1">{timeAgo(e.createdAt)}</div>
        </div>
      </div>
    </Link>
  );
}

function MessageRow({ m }: { m: MessageItem }) {
  const isOut = m.direction === "OUTBOUND";
  const url = m.mediaUrl ? (m.mediaUrl.startsWith("http") ? m.mediaUrl : `/api/files/${m.mediaUrl}`) : null;

  return (
    <div className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${isOut ? "bg-brand-50 text-brand" : "bg-secondary text-ink"}`}>
        {url && m.type === "image" && (
          <img src={url} alt="" className="max-h-[180px] rounded mb-1 object-cover" />
        )}
        {m.content && <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>}
        <div className="text-[10px] text-ink-muted mt-1">{timeAgo(m.createdAt)}</div>
      </div>
    </div>
  );
}
