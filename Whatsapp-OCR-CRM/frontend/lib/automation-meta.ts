import { normalizeTriggerType } from "./format-rule-summary";

export const RULE_META: Record<
  string,
  {
    label: string;
    description: string;
    fields: Array<{
      key: string;
      label: string;
      type: "number" | "text" | "time" | "stages";
      path: "trigger" | "action";
      min?: number;
      options?: string[];
    }>;
  }
> = {
  inquiry_followup: {
    label: "Inquiry Follow-up",
    description: "Nudge customers N days after a quotation is sent with no reply.",
    fields: [
      { key: "days", label: "Days after quotation sent", type: "number", path: "trigger", min: 1 },
      { key: "templateName", label: "MSG91 template name", type: "text", path: "action" },
    ],
  },
  price_drop_alert: {
    label: "Price Drop Alert",
    description: "Alert when a product rate drops for customers with a recent enquiry.",
    fields: [
      { key: "threshold", label: "Min drop % (0 = any)", type: "number", path: "trigger", min: 0 },
      { key: "maxInquiryAgeDays", label: "Max inquiry age (days)", type: "number", path: "trigger", min: 1 },
      { key: "templateName", label: "MSG91 template name", type: "text", path: "action" },
    ],
  },
  repeat_engagement: {
    label: "Repeat Engagement",
    description: "Daily re-engagement for open-pipeline customers with stale enquiries.",
    fields: [
      { key: "inactiveDays", label: "Days since last enquiry", type: "number", path: "trigger", min: 1 },
      { key: "scheduleTime", label: "Daily run time (IST)", type: "time", path: "trigger" },
      { key: "stages", label: "Pipeline stages", type: "stages", path: "trigger" },
      { key: "templateName", label: "MSG91 template name", type: "text", path: "action" },
    ],
  },
  enquiry_reminder: {
    label: "Last Inquiry Reminder",
    description: "Remind customers (not Closed) about their last sent quotation with no reply.",
    fields: [
      { key: "daysSinceSent", label: "Days since quote sent", type: "number", path: "trigger", min: 1 },
      { key: "scheduleTime", label: "Daily run time (IST)", type: "time", path: "trigger" },
      { key: "templateName", label: "MSG91 template name", type: "text", path: "action" },
    ],
  },
  closed_review: {
    label: "Google Review Request",
    description:
      "When a customer is moved to Closed, send a WhatsApp message asking them to leave a Google review.",
    fields: [
      { key: "templateName", label: "MSG91 template name", type: "text", path: "action" },
    ],
  },
};

export const RULE_ORDER = [
  "inquiry_followup",
  "price_drop_alert",
  "repeat_engagement",
  "enquiry_reminder",
  "closed_review",
] as const;

export function getRuleMeta(triggerType: string) {
  return RULE_META[normalizeTriggerType(triggerType)];
}
