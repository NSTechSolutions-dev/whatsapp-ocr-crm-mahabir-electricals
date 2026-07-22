"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Zap, ChevronRight, Clock, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getRuleMeta, RULE_ORDER } from "../../../lib/automation-meta";
import { formatRuleParamSummary, normalizeTriggerType } from "../../../lib/format-rule-summary";
import { DevTestPanel } from "./_components/dev-test-panel";

interface RuleItem {
  id: string;
  name: string;
  triggerType: string;
  triggerParams: Record<string, unknown>;
  actionType: string;
  actionParams: Record<string, unknown>;
  isActive: boolean;
  lastExecutedAt?: string | null;
  description?: string;
}

export default function AutomationPage() {
  const router = useRouter();
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDev, setIsDev] = useState(false);
  const [running, setRunning] = useState(false);

  const load = async () => {
    try {
      const [r, meta] = await Promise.all([
        api.get("/automation/rules"),
        api.get("/automation/meta").catch(() => ({ data: { isDev: false } })),
      ]);
      setIsDev(!!meta.data?.isDev);
      const items: RuleItem[] = r.data.items || [];
      const order = new Map(RULE_ORDER.map((t, i) => [t, i]));
      items.sort(
        (a, b) =>
          (order.get(normalizeTriggerType(a.triggerType) as (typeof RULE_ORDER)[number]) ?? 99) -
          (order.get(normalizeTriggerType(b.triggerType) as (typeof RULE_ORDER)[number]) ?? 99)
      );
      setRules(items);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load automation rules");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggle = async (rule: RuleItem, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.put(`/automation/rules/${rule.id}`, { isActive: !rule.isActive });
      await load();
      toast.success(rule.isActive ? "Rule disabled" : "Rule enabled");
    } catch {
      toast.error("Toggle failed");
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const r = await api.post("/automation/run-now");
      const s = r.data;
      const msg = `Queued ${s.totalQueued ?? 0} message(s), ${s.totalSkipped ?? 0} skipped. Check each rule's Executions tab for the daily run summary.`;
      toast.success("Daily rules executed", { description: msg });
      await load();
    } catch {
      toast.error("Run failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="p-8 lg:p-12 text-ink">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-8">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-muted">Settings</div>
          <h1 className="font-display text-3xl font-semibold mt-1">Automation Rules</h1>
          <p className="text-ink-muted text-sm mt-2 max-w-xl">
            Four built-in rules for follow-ups, price alerts, and re-engagement. Click a rule to edit parameters and view history.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" onClick={load} className="border-line text-ink" size="sm">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            onClick={runNow}
            disabled={running}
            className="border-line text-ink"
            data-testid="run-automation-button"
          >
            {running ? "Running…" : "Run daily rules now"}
          </Button>
        </div>
      </div>

      {isDev && (
        <div className="mb-8">
          <DevTestPanel onDone={load} />
        </div>
      )}

      {loading ? (
        <div className="text-sm text-ink-muted py-12 text-center">Loading rules…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="rules-grid">
          {rules.map((r) => {
            const meta = getRuleMeta(r.triggerType);
            const summary = formatRuleParamSummary(r);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => router.push(`/automation/${r.id}`)}
                className="text-left bg-surface border border-line rounded-lg shadow-card p-5 hover:border-brand/40 hover:shadow-sm transition-all group"
                data-testid={`rule-card-${r.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-display font-semibold text-lg text-ink truncate">
                      {meta?.label || r.name}
                    </div>
                  </div>
                  <Switch
                    checked={r.isActive}
                    onCheckedChange={() => {}}
                    onClick={(e) => toggle(r, e)}
                    data-testid={`rule-toggle-${r.id}`}
                  />
                </div>

                <p className="text-xs text-ink-muted mt-2 line-clamp-2">
                  {r.description || meta?.description}
                </p>

                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                  {summary && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-brand-50 text-brand">
                      <Zap className="h-3 w-3" />
                      {summary}
                    </span>
                  )}
                  {r.lastExecutedAt && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-secondary text-ink-muted">
                      <Clock className="h-3 w-3" />
                      Last run {new Date(r.lastExecutedAt).toLocaleString()}
                    </span>
                  )}
                </div>

                <div className="mt-4 flex items-center text-xs text-brand font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  Configure & history
                  <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
