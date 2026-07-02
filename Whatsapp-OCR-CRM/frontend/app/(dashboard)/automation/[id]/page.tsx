"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Save, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getRuleMeta } from "../../../../lib/automation-meta";
import { CRM_STAGES } from "../../../../lib/crm-stages";
import { cn } from "../../../../lib/utils";
import { DevTestPanel } from "../_components/dev-test-panel";

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

interface Stats {
  total: number;
  completed: number;
  failed: number;
  last7Days: number;
  lastExecutedAt?: string | null;
}

interface Execution {
  id: string;
  status: string;
  scheduledAt: string;
  messageContent?: string | null;
  errorMsg?: string | null;
  isTest?: boolean;
  customer?: { name: string | null; phone: string; stage: string } | null;
}

interface Conversation {
  id: string;
  message: string;
  sentAt: string;
  customer?: { name: string | null; phone: string; stage: string } | null;
}

export default function AutomationRuleDetailPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";
  const [tab, setTab] = useState<"executions" | "conversations">("executions");
  const [rule, setRule] = useState<RuleItem | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [triggerParams, setTriggerParams] = useState<Record<string, unknown>>({});
  const [actionParams, setActionParams] = useState<Record<string, unknown>>({});
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDev, setIsDev] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [ruleRes, statsRes, execRes, convRes, metaRes] = await Promise.all([
        api.get(`/automation/rules/${id}`),
        api.get(`/automation/rules/${id}/stats`),
        api.get(`/automation/rules/${id}/executions`, { params: { limit: 100 } }),
        api.get(`/automation/rules/${id}/conversations`, { params: { limit: 100 } }),
        api.get("/automation/meta").catch(() => ({ data: { isDev: false } })),
      ]);
      const r = ruleRes.data as RuleItem;
      setRule(r);
      setName(r.name);
      setIsActive(r.isActive);
      setTriggerParams({ ...(r.triggerParams || {}) });
      setActionParams({ ...(r.actionParams || {}) });
      setStats(statsRes.data);
      setExecutions(execRes.data.items || []);
      setConversations(convRes.data.items || []);
      setIsDev(!!metaRes.data?.isDev);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load rule");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const meta = rule ? getRuleMeta(rule.triggerType) : null;

  const setField = (path: "trigger" | "action", key: string, value: unknown) => {
    if (path === "trigger") {
      setTriggerParams((p) => ({ ...p, [key]: value }));
    } else {
      setActionParams((p) => ({ ...p, [key]: value }));
    }
  };

  const getFieldValue = (path: "trigger" | "action", key: string) => {
    const src = path === "trigger" ? triggerParams : actionParams;
    return src[key];
  };

  const toggleStage = (stage: string) => {
    const current = (triggerParams.stages as string[]) || [...CRM_STAGES.filter((s) => s !== "Closed")];
    const next = current.includes(stage) ? current.filter((s) => s !== stage) : [...current, stage];
    setField("trigger", "stages", next);
  };

  const save = async () => {
    if (!rule) return;
    setSaving(true);
    try {
      await api.put(`/automation/rules/${rule.id}`, {
        name,
        isActive,
        triggerParams,
        actionParams,
      });
      toast.success("Rule saved");
      await load();
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!rule) {
    return (
      <div className="p-8 text-ink-muted text-sm">Loading rule…</div>
    );
  }

  return (
    <div className="p-6 lg:p-10 text-ink max-w-5xl">
      <Link
        href="/automation"
        className="inline-flex items-center gap-1.5 text-sm text-brand hover:text-brand-hover mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        All rules
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-muted">
            {meta?.label || rule.triggerType}
          </div>
          <h1 className="font-display text-2xl font-semibold mt-1">{meta?.label || name}</h1>
          <p className="text-sm text-ink-muted mt-1">{rule.description || meta?.description}</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={load} className="border-line">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs text-ink-muted">Active</span>
          <Switch checked={isActive} onCheckedChange={setIsActive} data-testid="rule-detail-toggle" />
        </div>
      </div>

      {isDev && rule && (
        <div className="mb-8">
          <DevTestPanel
            compact
            onDone={load}
          />
          <p className="text-[11px] text-ink-muted mt-2">
            Or test only this rule:{" "}
            <button
              type="button"
              className="text-brand hover:underline"
              onClick={async () => {
                try {
                  await api.post(`/automation/dev/test/${rule.triggerType}`);
                  toast.success("Dev test sent");
                  await load();
                } catch (e: any) {
                  toast.error(e?.response?.data?.detail || "Test failed");
                }
              }}
            >
              Force test {meta?.label}
            </button>
          </p>
        </div>
      )}

      {/* Editable parameters */}
      <div className="bg-surface border border-line rounded-lg p-5 mb-8 shadow-card">
        <h2 className="font-display font-semibold text-sm mb-4">Parameters</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <Label className="text-xs text-ink-muted">Display name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 border-line"
              data-testid="rule-name-input"
            />
          </div>
          {meta?.fields.map((f) => (
            <div key={f.key} className={f.type === "stages" ? "sm:col-span-2" : ""}>
              <Label className="text-xs text-ink-muted">{f.label}</Label>
              {f.type === "stages" ? (
                <div className="flex flex-wrap gap-2 mt-2">
                  {CRM_STAGES.filter((s) => s !== "Closed").map((stage) => {
                    const selected = ((triggerParams.stages as string[]) || []).includes(stage);
                    return (
                      <button
                        key={stage}
                        type="button"
                        onClick={() => toggleStage(stage)}
                        className={cn(
                          "text-xs px-2.5 py-1 rounded-md border transition-colors",
                          selected
                            ? "bg-brand-50 border-brand text-brand"
                            : "border-line text-ink-muted hover:border-brand/30"
                        )}
                      >
                        {stage}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <Input
                  type={f.type === "number" ? "number" : f.type === "time" ? "time" : "text"}
                  value={String(getFieldValue(f.path, f.key) ?? "")}
                  onChange={(e) => {
                    const v =
                      f.type === "number" ? Number(e.target.value) : e.target.value;
                    setField(f.path, f.key, v);
                  }}
                  className="mt-1 border-line"
                  min={f.min}
                  data-testid={`rule-field-${f.key}`}
                />
              )}
            </div>
          ))}
        </div>
        <Button
          onClick={save}
          disabled={saving}
          className="mt-5 bg-brand hover:bg-brand-hover text-white"
          data-testid="rule-save-button"
        >
          <Save className="h-4 w-4 mr-1.5" />
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Total runs", value: stats.total },
            { label: "Completed", value: stats.completed },
            { label: "Failed", value: stats.failed },
            { label: "Last 7 days", value: stats.last7Days },
          ].map((s) => (
            <div key={s.label} className="bg-surface border border-line rounded-lg p-4 text-center">
              <div className="text-2xl font-semibold tabular text-brand">{s.value}</div>
              <div className="text-[10px] uppercase tracking-wider text-ink-muted mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-line mb-4">
        {(["executions", "conversations"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize",
              tab === t ? "border-brand text-brand" : "border-transparent text-ink-muted hover:text-ink"
            )}
            data-testid={`tab-${t}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "executions" && (
        <div className="rounded-lg border border-line bg-surface overflow-hidden shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-canvas text-xs uppercase tracking-wider text-ink-muted">
                <th className="text-left px-4 py-3">Customer</th>
                <th className="text-left px-4 py-3">When</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Message / error</th>
              </tr>
            </thead>
            <tbody data-testid="executions-table">
              {executions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-ink-muted text-sm">
                    <p>No executions recorded yet.</p>
                    <p className="text-xs mt-2 max-w-md mx-auto">
                      Run <strong>Run daily rules now</strong> on the Automation page — a summary row appears here even when no customers match.
                      In development, use the <strong>Dev test panel</strong> to force a test message.
                    </p>
                  </td>
                </tr>
              ) : (
                executions.map((ex) => (
                  <tr key={ex.id} className="border-t border-line">
                    <td className="px-4 py-3">
                      <div className="font-medium">{ex.customer?.name || "—"}</div>
                      <div className="text-xs text-ink-muted tabular">{ex.customer?.phone}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-muted tabular whitespace-nowrap">
                      {new Date(ex.scheduledAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <span
                          className={cn(
                            "text-[10px] uppercase px-1.5 py-0.5 rounded",
                            ex.status === "COMPLETED"
                              ? "bg-emerald-50 text-emerald-800"
                              : ex.status === "FAILED"
                              ? "bg-red-50 text-red-800"
                              : ex.status === "PROCESSING"
                              ? "bg-amber-50 text-amber-800"
                              : "bg-secondary text-ink-muted"
                          )}
                        >
                          {ex.status}
                        </span>
                        {ex.isTest && (
                          <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">
                            test
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink max-w-md">
                      <span className="line-clamp-3">{ex.errorMsg || ex.messageContent || "—"}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "conversations" && (
        <div className="space-y-3" data-testid="conversations-list">
          {conversations.length === 0 ? (
            <div className="text-center text-sm text-ink-muted py-10 border border-dashed border-line rounded-lg">
              No messages sent by this rule yet.
            </div>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                className="bg-surface border border-line rounded-lg p-4 shadow-card"
              >
                <div className="flex justify-between items-start gap-2 mb-2">
                  <div>
                    <div className="font-medium text-sm">{c.customer?.name || "Customer"}</div>
                    <div className="text-xs text-ink-muted tabular">{c.customer?.phone}</div>
                  </div>
                  <div className="text-[10px] text-ink-muted tabular shrink-0">
                    {new Date(c.sentAt).toLocaleString()}
                  </div>
                </div>
                <div className="text-sm bg-brand-50 text-ink rounded-md px-3 py-2 whitespace-pre-wrap">
                  {c.message}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
