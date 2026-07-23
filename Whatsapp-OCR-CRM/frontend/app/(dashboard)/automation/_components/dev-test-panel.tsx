"use client";

import { useState } from "react";
import { api } from "../../../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { FlaskConical, Loader2 } from "lucide-react";
import { RULE_ORDER } from "../../../../lib/automation-meta";

const RULE_LABELS: Record<string, string> = {
  inquiry_followup: "Inquiry follow-up",
  price_drop_alert: "Price drop",
  repeat_engagement: "Repeat engagement",
  enquiry_reminder: "Enquiry reminder",
  closed_review: "Google review",
};

interface DevTestPanelProps {
  onDone?: () => void;
  compact?: boolean;
}

export function DevTestPanel({ onDone, compact }: DevTestPanelProps) {
  const [customerId, setCustomerId] = useState("");
  const [testing, setTesting] = useState<string | null>(null);
  const [testingAll, setTestingAll] = useState(false);

  const testOne = async (triggerType: string) => {
    setTesting(triggerType);
    try {
      const r = await api.post(`/automation/dev/test/${triggerType}`, {
        customerId: customerId.trim() || undefined,
      });
      toast.success(`Test OK: ${RULE_LABELS[triggerType] || triggerType}`, {
        description: r.data.messageContent?.slice(0, 120),
      });
      onDone?.();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || `Test failed: ${triggerType}`);
    } finally {
      setTesting(null);
    }
  };

  const testAll = async () => {
    setTestingAll(true);
    try {
      const r = await api.post("/automation/dev/test-all", {
        customerId: customerId.trim() || undefined,
      });
      const { passed, failed, results } = r.data;
      if (failed === 0) {
        toast.success(`All ${passed} rules passed dev test`);
      } else {
        toast.warning(`${passed} passed, ${failed} failed`, {
          description: results
            .filter((x: { ok: boolean }) => !x.ok)
            .map((x: { triggerType: string; error: string }) => `${x.triggerType}: ${x.error}`)
            .join("; "),
        });
      }
      onDone?.();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Test-all failed");
    } finally {
      setTestingAll(false);
    }
  };

  return (
    <div
      className={`border border-amber-300/60 bg-amber-50/50 rounded-lg ${compact ? "p-4" : "p-5"}`}
      data-testid="dev-test-panel"
    >
      <div className="flex items-center gap-2 mb-3">
        <FlaskConical className="h-4 w-4 text-amber-800" />
        <h3 className="font-display font-semibold text-sm text-amber-950">Dev test panel</h3>
        <span className="text-[10px] uppercase tracking-wider text-amber-700/80 ml-1">development only</span>
      </div>
      <p className="text-xs text-amber-900/80 mb-4">
        Force-send each rule to a customer (bypasses eligibility). Uses the latest customer, or optional customer ID below.
        Messages are marked as test runs in execution history.
      </p>

      <div className="mb-4">
        <Label className="text-xs text-amber-900/70">Customer ID (optional)</Label>
        <Input
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          placeholder="Leave blank for latest customer"
          className="mt-1 h-8 text-xs border-amber-200 bg-white"
          data-testid="dev-test-customer-id"
        />
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {RULE_ORDER.map((type) => (
          <Button
            key={type}
            size="sm"
            variant="outline"
            disabled={!!testing || testingAll}
            onClick={() => testOne(type)}
            className="h-8 text-xs border-amber-300 text-amber-950 hover:bg-amber-100"
            data-testid={`dev-test-${type}`}
          >
            {testing === type ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            {RULE_LABELS[type] || type}
          </Button>
        ))}
      </div>

      <Button
        size="sm"
        onClick={testAll}
        disabled={!!testing || testingAll}
        className="h-8 text-xs bg-amber-800 hover:bg-amber-900 text-white"
        data-testid="dev-test-all"
      >
        {testingAll ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
        Force test all rules
      </Button>
    </div>
  );
}
