"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { timeAgo, formatDate } from "../../../lib/format";
import { RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";

type DeliveryStatus = "queued" | "submitted" | "sent" | "delivered" | "read" | "failed" | "all";

interface LogItem {
  id: string;
  conversationId: string;
  type: string;
  content: string | null;
  templateName: string | null;
  deliveryStatus: string;
  failureReason: string | null;
  waMessageId: string | null;
  msg91RequestId: string | null;
  createdAt: string;
  statusUpdatedAt: string | null;
  customer: { id: string; name: string | null; phone: string } | null;
}

const STATUS_FILTERS: DeliveryStatus[] = [
  "all",
  "queued",
  "submitted",
  "sent",
  "delivered",
  "read",
  "failed",
];

function statusClasses(status: string) {
  switch (status) {
    case "failed":
      return "bg-red-50 text-red-700 border-red-200";
    case "delivered":
    case "read":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "sent":
    case "submitted":
      return "bg-brand-50 text-brand border-brand/30";
    case "queued":
      return "bg-amber-50 text-amber-800 border-amber-200";
    default:
      return "bg-canvas text-ink-muted border-line";
  }
}

export default function WhatsappLogsPage() {
  const [items, setItems] = useState<LogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<DeliveryStatus>("all");
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/whatsapp-logs", {
        params: {
          limit,
          offset,
          status: status === "all" ? undefined : status,
          q: q.trim() || undefined,
        },
      });
      setItems(r.data.items || []);
      setTotal(r.data.total || 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, offset]);

  return (
    <div className="p-4 lg:p-6 text-ink max-w-6xl">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-muted">MSG91 · WhatsApp</div>
          <h1 className="font-display text-2xl font-semibold mt-0.5">Delivery logs</h1>
          <p className="text-sm text-ink-muted mt-1">
            Real send status from MSG91 — not just CRM queue status.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          className="self-start"
        >
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-ink-muted" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setOffset(0);
                void load();
              }
            }}
            placeholder="Search phone, name, template, error…"
            className="h-8 pl-8 text-sm bg-surface border-line"
            data-testid="whatsapp-logs-search"
          />
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setOffset(0);
            void load();
          }}
        >
          Search
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setStatus(s);
              setOffset(0);
            }}
            className={cn(
              "rounded-md border px-2.5 py-1 text-[11px] capitalize transition-colors",
              status === s
                ? "bg-brand text-white border-brand"
                : "bg-surface text-ink-muted border-line hover:text-ink"
            )}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="bg-canvas text-[10px] uppercase tracking-wider text-ink-muted">
                <th className="text-left px-3 py-2.5">When</th>
                <th className="text-left px-3 py-2.5">Customer</th>
                <th className="text-left px-3 py-2.5">Type</th>
                <th className="text-left px-3 py-2.5">Status</th>
                <th className="text-left px-3 py-2.5">Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-ink-muted">
                    Loading logs…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-ink-muted">
                    No outbound messages found.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="border-t border-line align-top" data-testid={`wa-log-${item.id}`}>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="text-ink">{timeAgo(item.createdAt)}</div>
                      <div className="text-[10px] text-ink-muted">{formatDate(item.createdAt)}</div>
                    </td>
                    <td className="px-3 py-3">
                      {item.customer ? (
                        <div className="min-w-0">
                          <Link
                            href={`/inbox/${item.conversationId}`}
                            className="font-medium text-ink hover:text-brand truncate block"
                          >
                            {item.customer.name || "Unnamed"}
                          </Link>
                          <div className="text-[11px] text-ink-muted tabular-nums">{item.customer.phone}</div>
                        </div>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-ink capitalize">{item.type}</div>
                      {item.templateName ? (
                        <div className="text-[10px] text-ink-muted font-mono break-all">{item.templateName}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                          statusClasses(item.deliveryStatus)
                        )}
                      >
                        {item.deliveryStatus}
                      </span>
                    </td>
                    <td className="px-3 py-3 max-w-md">
                      {item.failureReason ? (
                        <div className="text-[11px] text-red-700 break-words mb-1">{item.failureReason}</div>
                      ) : null}
                      {item.content ? (
                        <div className="text-[11px] text-ink-muted line-clamp-2 break-words">{item.content}</div>
                      ) : null}
                      {(item.waMessageId || item.msg91RequestId) && (
                        <div className="mt-1 text-[10px] font-mono text-ink-muted/80 break-all">
                          {item.msg91RequestId || item.waMessageId}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-ink-muted">
        <span>
          Showing {items.length === 0 ? 0 : offset + 1}–{offset + items.length} of {total}
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={offset <= 0 || loading}
            onClick={() => setOffset((v) => Math.max(0, v - limit))}
          >
            Previous
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={offset + limit >= total || loading}
            onClick={() => setOffset((v) => v + limit)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
