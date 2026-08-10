"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";
import { Input } from "@/components/ui/input";
import { Bell, BellOff, Search, List, Kanban, Trash2 } from "lucide-react";
import { timeAgo } from "../../../lib/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PipelineColumn } from "./_components/pipeline-column";
import { STAGES, type CustomerItem } from "./_components/customer-card";
import { STAGE_LIST_COLORS, STAGE_COLUMN_COLORS } from "../../../lib/crm-stages";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const LIST_STAGE_COLORS = STAGE_LIST_COLORS;
const COLUMN_HEADER = STAGE_COLUMN_COLORS;

export default function CRMPage() {
  const router = useRouter();
  const [items, setItems] = useState<CustomerItem[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"list" | "kanban">("kanban");

  const fetchCustomers = async (cancel = false) => {
    try {
      const r = await api.get("/customers", { params: q ? { q } : {} });
      if (!cancel) setItems(r.data.items || []);
    } catch (err) {
      console.error(err);
    } finally {
      if (!cancel) setLoading(false);
    }
  };

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    fetchCustomers(cancel);
    return () => {
      cancel = true;
    };
  }, [q]);

  const handleStageChange = async (customerId: string, newStage: string) => {
    try {
      await api.put(`/customers/${customerId}/stage`, { stage: newStage });
      setItems((prev) =>
        prev.map((item) => (item.id === customerId ? { ...item, stage: newStage } : item))
      );
      if (newStage === "Lost") {
        toast.success("Customer marked Lost — automations cancelled");
      }
    } catch (error) {
      console.error("Failed to update customer stage:", error);
      toast.error("Could not update stage");
    }
  };

  const handleDndToggle = async (customerId: string, doNotDisturb: boolean) => {
    try {
      await api.patch(`/customers/${customerId}/dnd`, { doNotDisturb });
      setItems((prev) =>
        prev.map((item) => (item.id === customerId ? { ...item, doNotDisturb } : item))
      );
      toast.success(doNotDisturb ? "DND on — automations silenced" : "DND off — automations allowed");
    } catch (error) {
      console.error("Failed to update DND:", error);
      toast.error("Could not update DND");
    }
  };

  const handleRemoveFromPipeline = async (customerId: string) => {
    if (!confirm("Remove this customer from the pipeline? They will remain in inbox and enquiries.")) {
      return;
    }
    try {
      await api.delete(`/customers/${customerId}/pipeline`);
      setItems((prev) => prev.filter((item) => item.id !== customerId));
      toast.success("Customer removed from pipeline");
    } catch (error) {
      console.error("Failed to remove customer from pipeline:", error);
      toast.error("Could not remove customer from pipeline");
    }
  };

  const grouped = useMemo(
    () =>
      STAGES.reduce(
        (acc, stage) => {
          acc[stage] = items.filter((item) => (item.stage || "Lead") === stage);
          return acc;
        },
        {} as Record<string, CustomerItem[]>
      ),
    [items]
  );

  return (
    <div className="p-4 lg:p-6 text-ink">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-muted">Mahabir Electricals · CRM</div>
          <h1 className="font-display text-2xl font-semibold mt-0.5 text-ink">Customer Pipeline</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-56">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-ink-muted" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search customers..."
              className="h-8 pl-8 text-sm bg-surface border-line text-ink"
              data-testid="crm-search-input"
            />
          </div>

          <div className="flex rounded-md border border-line bg-surface p-0.5">
            <button
              onClick={() => setViewMode("kanban")}
              className={`rounded p-1.5 transition-colors ${
                viewMode === "kanban"
                  ? "bg-brand text-white"
                  : "text-ink-muted hover:text-ink hover:bg-secondary/50"
              }`}
              title="Kanban Board"
              data-testid="view-mode-kanban"
            >
              <Kanban className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`rounded p-1.5 transition-colors ${
                viewMode === "list"
                  ? "bg-brand text-white"
                  : "text-ink-muted hover:text-ink hover:bg-secondary/50"
              }`}
              title="List View"
              data-testid="view-mode-list"
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {viewMode === "kanban" && (
        <div className="w-full overflow-x-auto overflow-y-hidden pb-2 scroll-thin">
          <div className="flex w-max min-w-full gap-2 px-0.5">
            {STAGES.map((stage) => (
              <PipelineColumn
                key={stage}
                stage={stage}
                items={grouped[stage] || []}
                colors={COLUMN_HEADER[stage] || COLUMN_HEADER.Lead}
                loading={loading}
                onStageChange={handleStageChange}
                onDndToggle={handleDndToggle}
                onRemoveFromPipeline={handleRemoveFromPipeline}
              />
            ))}
          </div>
        </div>
      )}

      {viewMode === "list" && (
        <div className="rounded-lg border border-line bg-surface shadow-card overflow-hidden">
          {loading ? (
            <div className="px-4 py-10 text-center text-sm text-ink-muted">Loading pipeline data…</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-canvas text-xs uppercase tracking-[0.08em] text-ink-muted">
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Phone</th>
                  <th className="text-left px-4 py-3">Company</th>
                  <th className="text-left px-4 py-3">Stage</th>
                  <th className="text-right px-4 py-3">Enquiries</th>
                  <th className="text-right px-4 py-3">Last activity</th>
                  <th className="text-right px-4 py-3 w-20">DND</th>
                  <th className="text-right px-4 py-3 w-12"></th>
                </tr>
              </thead>
              <tbody data-testid="customers-table">
                {items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-ink-muted">
                      No customers found.
                    </td>
                  </tr>
                )}
                {items.map((c) => {
                  const colors = LIST_STAGE_COLORS[c.stage || "Lead"] || LIST_STAGE_COLORS.Lead;
                  const dndOn = !!c.doNotDisturb;
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-line hover:bg-canvas transition-colors cursor-pointer text-ink"
                      data-testid={`customer-row-${c.id}`}
                    >
                      <td
                        className="px-4 py-3 font-medium text-ink"
                        onClick={() => router.push(`/crm/${c.id}`)}
                      >
                        {c.name || "—"}
                      </td>
                      <td
                        className="px-4 py-3 text-ink-muted tabular"
                        onClick={() => router.push(`/crm/${c.id}`)}
                      >
                        {c.phone}
                      </td>
                      <td
                        className="px-4 py-3 text-ink-muted"
                        onClick={() => router.push(`/crm/${c.id}`)}
                      >
                        {c.company || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Select
                          value={c.stage || "Lead"}
                          onValueChange={(val) => handleStageChange(c.id, val)}
                        >
                          <SelectTrigger
                            className={`h-7 w-28 text-xs border border-line bg-canvas ${colors.text}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-surface border-line text-ink">
                            {STAGES.map((s) => (
                              <SelectItem key={s} value={s} className="text-xs text-ink hover:bg-canvas">
                                {s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td
                        className="px-4 py-3 text-right tabular"
                        onClick={() => router.push(`/crm/${c.id}`)}
                      >
                        {c.enquiryCount}
                      </td>
                      <td
                        className="px-4 py-3 text-right text-ink-muted"
                        onClick={() => router.push(`/crm/${c.id}`)}
                      >
                        {timeAgo(c.lastActivity)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleDndToggle(c.id, !dndOn)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors",
                            dndOn
                              ? "bg-stone-200 text-stone-800 hover:bg-stone-300"
                              : "text-ink-muted hover:text-ink hover:bg-canvas border border-line"
                          )}
                          title={dndOn ? "DND on — click to allow automations" : "DND off — click to silence automations"}
                          data-testid={`dnd-toggle-${c.id}`}
                        >
                          {dndOn ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
                          {dndOn ? "On" : "Off"}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemoveFromPipeline(c.id)}
                          className="rounded p-1.5 text-ink-muted hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Remove from pipeline"
                          data-testid={`remove-pipeline-${c.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
