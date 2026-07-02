import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Zap } from "lucide-react";
import { toast } from "sonner";

const TRIGGER_TYPES = [
  { value: "inactivity_followup", label: "Inactivity follow-up", paramKey: "days", paramLabel: "Days after quotation sent" },
  { value: "price_drop_alert", label: "Price drop alert", paramKey: "threshold", paramLabel: "Min drop percent (0 = any)" },
  { value: "repeat_engagement", label: "Repeat engagement", paramKey: "days", paramLabel: "Days since last enquiry" },
  { value: "enquiry_reminder", label: "Enquiry reminder (internal)", paramKey: "hours", paramLabel: "Hours in DRAFT" },
];

export default function Automation() {
  const [rules, setRules] = useState([]);
  const [jobs, setJobs] = useState([]);
  const load = async () => {
    const [r, j] = await Promise.all([api.get("/automation/rules"), api.get("/automation/jobs")]);
    setRules(r.data.items || []);
    setJobs(j.data.items || []);
  };
  useEffect(() => {
    load();
  }, []);

  const toggle = async (rule) => {
    try {
      await api.put(`/automation/rules/${rule.id}`, { isActive: !rule.isActive });
      await load();
    } catch (e) {
      toast.error("Toggle failed");
    }
  };

  const runNow = async () => {
    try {
      await api.post("/automation/run-now");
      toast.success("Automation tick triggered");
      await load();
    } catch (e) {
      toast.error("Failed");
    }
  };

  return (
    <div className="p-8 lg:p-12">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-muted">Automations</div>
          <h1 className="font-display text-3xl font-semibold mt-1">Rules</h1>
          <p className="text-ink-muted text-sm mt-1">Send follow-ups, price-drop alerts and re-engagement messages.</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={runNow} className="border-line" data-testid="run-automation-button">Run now</Button>
          <NewRuleDialog onCreated={load} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-12" data-testid="rules-grid">
        {rules.length === 0 && (
          <div className="col-span-full bg-surface border border-dashed border-line rounded-lg p-10 text-center text-sm text-ink-muted">
            No rules yet. Click <span className="text-ink font-medium">New rule</span> to create one.
          </div>
        )}
        {rules.map((r) => (
          <div key={r.id} className="bg-surface border border-line rounded-lg shadow-card p-5" data-testid={`rule-card-${r.id}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-ink-muted">{TRIGGER_TYPES.find((t) => t.value === r.triggerType)?.label || r.triggerType}</div>
                <div className="font-display font-semibold text-lg mt-1">{r.name}</div>
              </div>
              <Switch checked={r.isActive} onCheckedChange={() => toggle(r)} data-testid={`rule-toggle-${r.id}`} />
            </div>
            <div className="text-xs text-ink-muted mt-3">
              <div className="flex items-center gap-2">
                <Zap className="h-3 w-3" />
                <span>Action: {r.actionType} · template: {r.actionParams?.templateName || "—"}</span>
              </div>
              <div className="mt-1 text-[11px]">Params: {JSON.stringify(r.triggerParams || {})}</div>
            </div>
          </div>
        ))}
      </div>

      <h2 className="font-display text-lg font-semibold mb-3">Recent scheduled jobs</h2>
      <div className="rounded-lg border border-line bg-surface shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-canvas text-xs uppercase tracking-[0.08em] text-ink-muted">
              <th className="text-left px-4 py-3">Rule</th>
              <th className="text-left px-4 py-3">Customer</th>
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-left px-4 py-3">When</th>
              <th className="text-left px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody data-testid="jobs-table">
            {jobs.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-ink-muted">No jobs scheduled yet.</td></tr>
            )}
            {jobs.map((j) => (
              <tr key={j.id} className="border-b border-line">
                <td className="px-4 py-3">{j.rule?.name || "—"}</td>
                <td className="px-4 py-3 text-ink-muted">{j.customer?.name || j.customer?.phone || "—"}</td>
                <td className="px-4 py-3 text-ink-muted text-xs">{j.payload?.type}</td>
                <td className="px-4 py-3 text-ink-muted text-xs tabular">{new Date(j.scheduledAt).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${j.status === "COMPLETED" ? "bg-brand-50 text-brand" : j.status === "FAILED" ? "bg-red-50 text-red-600" : "bg-secondary text-ink-muted"}`}>
                    {j.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NewRuleDialog({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState("inactivity_followup");
  const [paramValue, setParamValue] = useState(3);
  const [templateName, setTemplateName] = useState("inactivity_followup_v1");

  const t = TRIGGER_TYPES.find((x) => x.value === triggerType);

  const submit = async () => {
    try {
      await api.post("/automation/rules", {
        name,
        triggerType,
        triggerParams: { [t.paramKey]: Number(paramValue) },
        actionType: triggerType === "enquiry_reminder" ? "log_only" : "send_template",
        actionParams: { templateName },
        isActive: true,
      });
      toast.success("Rule created");
      setOpen(false);
      setStep(1); setName(""); setParamValue(3); setTemplateName("inactivity_followup_v1");
      onCreated && onCreated();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-brand hover:bg-brand-hover" data-testid="new-rule-button">
          <Plus className="h-4 w-4 mr-1.5" /> New rule
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-surface border-line">
        <DialogHeader>
          <DialogTitle className="font-display">New Automation · Step {step} of 3</DialogTitle>
        </DialogHeader>
        {step === 1 && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs uppercase tracking-wider text-ink-muted">Rule name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 3-day follow-up" className="mt-1.5 border-line" data-testid="rule-name-input" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-ink-muted">Trigger type</Label>
              <Select value={triggerType} onValueChange={setTriggerType}>
                <SelectTrigger className="mt-1.5 border-line" data-testid="rule-trigger-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRIGGER_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        {step === 2 && (
          <div>
            <Label className="text-xs uppercase tracking-wider text-ink-muted">{t.paramLabel}</Label>
            <Input type="number" value={paramValue} onChange={(e) => setParamValue(e.target.value)} className="mt-1.5 border-line" data-testid="rule-param-input" />
          </div>
        )}
        {step === 3 && (
          <div>
            <Label className="text-xs uppercase tracking-wider text-ink-muted">MSG91 Template Name</Label>
            <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} className="mt-1.5 border-line" data-testid="rule-template-input" />
            <p className="text-xs text-ink-muted mt-2">
              Template variables will be filled automatically (customer name, product, prices, etc.).
            </p>
          </div>
        )}
        <DialogFooter>
          {step > 1 && <Button variant="outline" onClick={() => setStep(step - 1)} className="border-line">Back</Button>}
          {step < 3 ? (
            <Button onClick={() => setStep(step + 1)} className="bg-brand hover:bg-brand-hover" disabled={!name.trim()} data-testid="rule-next-button">Next</Button>
          ) : (
            <Button onClick={submit} className="bg-brand hover:bg-brand-hover" data-testid="rule-save-button">Create rule</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
