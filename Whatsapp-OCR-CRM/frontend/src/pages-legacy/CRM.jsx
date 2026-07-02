import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { timeAgo } from "@/lib/format";

export default function CRM() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    const run = async () => {
      try {
        const r = await api.get("/customers", { params: q ? { q } : {} });
        if (!cancel) setItems(r.data.items || []);
      } finally {
        if (!cancel) setLoading(false);
      }
    };
    run();
    return () => {
      cancel = true;
    };
  }, [q]);

  return (
    <div className="p-8 lg:p-12">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-muted">CRM</div>
          <h1 className="font-display text-3xl font-semibold mt-1">Customers</h1>
        </div>
        <div className="relative w-72">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-muted" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, phone, company"
            className="pl-9 bg-surface border-line"
            data-testid="crm-search-input"
          />
        </div>
      </div>

      <div className="rounded-lg border border-line bg-surface shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-canvas text-xs uppercase tracking-[0.08em] text-ink-muted">
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Phone</th>
              <th className="text-left px-4 py-3">Company</th>
              <th className="text-right px-4 py-3">Enquiries</th>
              <th className="text-right px-4 py-3">Last activity</th>
            </tr>
          </thead>
          <tbody data-testid="customers-table">
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">Loading…</td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">No customers yet.</td>
              </tr>
            )}
            {items.map((c) => (
              <tr
                key={c.id}
                onClick={() => navigate(`/crm/${c.id}`)}
                className="border-b border-line hover:bg-canvas cursor-pointer"
                data-testid={`customer-row-${c.id}`}
              >
                <td className="px-4 py-3 font-medium text-ink">{c.name || "—"}</td>
                <td className="px-4 py-3 text-ink-muted tabular">{c.phone}</td>
                <td className="px-4 py-3 text-ink-muted">{c.company || "—"}</td>
                <td className="px-4 py-3 text-right tabular">{c.enquiryCount}</td>
                <td className="px-4 py-3 text-right text-ink-muted">{timeAgo(c.lastActivity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
