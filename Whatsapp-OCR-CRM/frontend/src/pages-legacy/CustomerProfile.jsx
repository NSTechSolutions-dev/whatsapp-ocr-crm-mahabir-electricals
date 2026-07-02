import { useEffect, useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "@/lib/api";
import { formatINR, timeAgo, formatDate } from "@/lib/format";

export default function CustomerProfile() {
  const { customerId } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get(`/customers/${customerId}`).then((r) => setData(r.data));
  }, [customerId]);

  const timeline = useMemo(() => {
    if (!data) return [];
    const items = [];
    for (const e of data.enquiries || []) {
      items.push({ kind: "enquiry", ts: e.createdAt, payload: e });
    }
    for (const m of data.messages || []) {
      items.push({ kind: "message", ts: m.createdAt, payload: m });
    }
    items.sort((a, b) => (a.ts < b.ts ? 1 : -1));
    return items;
  }, [data]);

  if (!data) return <div className="p-8 text-ink-muted">Loading…</div>;
  const c = data.customer;
  return (
    <div className="p-8 lg:p-12 max-w-6xl">
      <div className="mb-8">
        <div className="text-xs uppercase tracking-wider text-ink-muted">Customer</div>
        <h1 className="font-display text-3xl font-semibold mt-1">{c.name || "Unnamed"}</h1>
        <p className="text-ink-muted text-sm mt-1">
          {c.phone}
          {c.company && <> · {c.company}</>} · since {formatDate(c.createdAt)}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8" data-testid="customer-stats">
        <StatCard label="Total enquiries" value={data.stats.totalEnquiries} />
        <StatCard label="Quotations sent" value={data.stats.quotationsSent} />
        <StatCard label="Last activity" value={timeAgo(data.stats.lastActivity)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <h2 className="font-display text-lg font-semibold mb-4">Activity Timeline</h2>
          <div className="space-y-3" data-testid="customer-timeline">
            {timeline.length === 0 && <div className="text-sm text-ink-muted">No activity yet.</div>}
            {timeline.map((t, i) =>
              t.kind === "enquiry" ? (
                <EnquiryCard key={i} e={t.payload} />
              ) : (
                <MessageRow key={i} m={t.payload} />
              ),
            )}
          </div>
        </div>
        <div>
          <h2 className="font-display text-lg font-semibold mb-4">Top Products</h2>
          <div className="bg-surface border border-line rounded-lg shadow-card divide-y divide-line" data-testid="customer-top-products">
            {(data.topProducts || []).length === 0 && (
              <div className="px-4 py-6 text-sm text-ink-muted">No history yet.</div>
            )}
            {data.topProducts?.map((p, i) => (
              <div key={i} className="px-4 py-3 flex items-center justify-between text-sm">
                <span className="text-ink">{p.name}</span>
                <span className="tabular text-ink-muted">×{p.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="bg-surface border border-line rounded-lg shadow-card p-5">
      <div className="text-xs uppercase tracking-wider text-ink-muted">{label}</div>
      <div className="font-display text-2xl font-semibold mt-2 tabular">{value}</div>
    </div>
  );
}

function EnquiryCard({ e }) {
  return (
    <Link
      to={`/enquiries/${e.id}`}
      className="block bg-surface border border-line rounded-lg shadow-card p-4 hover:border-brand transition-colors"
      data-testid={`enquiry-card-${e.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-muted">Enquiry</div>
          <div className="font-medium mt-0.5">{e.itemsCount} items</div>
          {e.quotation && (
            <div className="text-xs text-ink-muted mt-1 tabular">
              {e.quotation.number} · {formatINR(e.quotation.grandTotal)}
            </div>
          )}
        </div>
        <div className="text-right">
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-brand-50 text-brand">
            {e.status}
          </span>
          <div className="text-[11px] text-ink-muted mt-1">{timeAgo(e.createdAt)}</div>
        </div>
      </div>
    </Link>
  );
}

function MessageRow({ m }) {
  const isOut = m.direction === "OUTBOUND";
  return (
    <div className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${isOut ? "bg-brand-50" : "bg-secondary"}`}>
        {m.mediaUrl && m.type === "image" && (
          <img src={m.mediaUrl} alt="" className="max-h-[180px] rounded mb-1" />
        )}
        {m.content && <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>}
        <div className="text-[10px] text-ink-muted mt-1">{timeAgo(m.createdAt)}</div>
      </div>
    </div>
  );
}
