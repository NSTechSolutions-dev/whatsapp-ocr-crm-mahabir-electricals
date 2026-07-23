/** Normalize legacy trigger type keys from older DB rows. */
export function normalizeTriggerType(triggerType: string): string {
  if (triggerType === "inactivity_followup") return "inquiry_followup";
  return triggerType;
}

function num(params: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = params[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const n = Number(raw);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

function str(params: Record<string, unknown>, key: string): string | undefined {
  const raw = params[key];
  if (raw === undefined || raw === null || raw === "") return undefined;
  return String(raw);
}

/** Human-readable summary from saved rule parameters (no hardcoded defaults). */
export function formatRuleParamSummary(rule: {
  triggerType: string;
  triggerParams?: Record<string, unknown> | null;
}): string {
  const type = normalizeTriggerType(rule.triggerType);
  const p = (rule.triggerParams || {}) as Record<string, unknown>;

  switch (type) {
    case "inquiry_followup": {
      const days = num(p, "days");
      if (days == null) return "After quotation is sent";
      return `${days} day${days === 1 ? "" : "s"} after quote sent`;
    }
    case "price_drop_alert": {
      const maxDays = num(p, "maxInquiryAgeDays");
      const threshold = num(p, "threshold");
      const parts: string[] = [];
      if (maxDays != null) parts.push(`last inquiry within ${maxDays}d`);
      if (threshold != null && threshold > 0) parts.push(`min ${threshold}% drop`);
      else if (threshold === 0) parts.push("any price drop");
      return parts.length ? parts.join(" · ") : "On inventory rate decrease";
    }
    case "repeat_engagement": {
      const inactive = num(p, "inactiveDays", "days");
      const time = str(p, "scheduleTime");
      const stages = Array.isArray(p.stages) ? (p.stages as string[]) : [];
      const parts: string[] = [];
      if (inactive != null) parts.push(`${inactive}d since last enquiry`);
      if (time) parts.push(`runs ${time} IST daily`);
      if (stages.length) parts.push(stages.join(", "));
      return parts.length ? parts.join(" · ") : "Open pipeline re-engagement";
    }
    case "enquiry_reminder": {
      const days = num(p, "daysSinceSent", "days");
      const hours = num(p, "hours");
      const time = str(p, "scheduleTime");
      const parts: string[] = [];
      if (days != null) parts.push(`${days}d since quote sent`);
      else if (hours != null) parts.push(`${hours}h since quote sent`);
      if (time) parts.push(`runs ${time} IST daily`);
      return parts.length ? parts.join(" · ") : "Sent quotation reminder";
    }
    case "closed_review":
      return "When customer stage → Closed";
    default:
      return "";
  }
}
