export const AUTOMATION_RULE_TYPES = [
  "inquiry_followup",
  "price_drop_alert",
  "repeat_engagement",
  "enquiry_reminder",
] as const;

export type AutomationRuleType = (typeof AUTOMATION_RULE_TYPES)[number];

export const OPEN_PIPELINE_STAGES = ["Lead", "Contacted", "Proposal", "Negotiation"] as const;

export const MSG91_TEMPLATE_DOCS = {
  mahabir_inquiry_followup: {
    variables: ["customer_name", "quote_ref"],
    sample: "Hi {{1}}, following up on quote {{2}}. Reply if you'd like to proceed. — Mahabir Electricals",
  },
  mahabir_price_drop: {
    variables: ["customer_name", "product_name", "old_rate", "new_rate"],
    sample: "Hi {{1}}, {{2}} dropped from ₹{{3}} to ₹{{4}}. — Mahabir Electricals",
  },
  mahabir_repeat_engagement: {
    variables: ["customer_name"],
    sample: "Hi {{1}}, need electrical supplies? Reply with your list for a quick quote. — Mahabir Electricals",
  },
  mahabir_enquiry_reminder: {
    variables: ["customer_name", "quote_ref"],
    sample: "Hi {{1}}, following up on quote {{2}}. — Mahabir Electricals",
  },
  mahabir_gallery_catalog: {
    variables: ["customer_name", "gallery_name"],
    sample:
      "Hi {{1}}, Please find our {{2}} catalog attached from Mahabir Electricals. If you have any questions or would like a quotation, reply to this message. Call Us",
  },
  image_gallery: {
    variables: ["customer_name", "gallery_name"],
    sample:
      "Hi {{1}}, Please find our {{2}} catalog attached from Mahabir Electricals. Header: document PDF. Namespace: null.",
  },
} as const;

export interface RuleDefinition {
  triggerType: AutomationRuleType;
  name: string;
  triggerParams: Record<string, unknown>;
  actionType: string;
  actionParams: Record<string, unknown>;
  isActive: boolean;
  description: string;
}

export const DEFAULT_AUTOMATION_RULES: RuleDefinition[] = [
  {
    triggerType: "inquiry_followup",
    name: "Inquiry Follow-up",
    description: "Send a WhatsApp nudge N days after a quotation is sent with no customer reply.",
    triggerParams: { days: 3 },
    actionType: "send_template",
    actionParams: { templateName: "mahabir_inquiry_followup" },
    isActive: true,
  },
  {
    triggerType: "price_drop_alert",
    name: "Price Drop Alert",
    description:
      "Notify customers who enquired about a product when its rate drops, if their last enquiry is within the configured window.",
    triggerParams: { threshold: 0, maxInquiryAgeDays: 30 },
    actionType: "send_template",
    actionParams: { templateName: "mahabir_price_drop" },
    isActive: true,
  },
  {
    triggerType: "repeat_engagement",
    name: "Repeat Engagement",
    description:
      "Daily message to customers in open pipeline stages whose last enquiry is older than the inactive period.",
    triggerParams: {
      inactiveDays: 30,
      scheduleTime: "09:00",
      stages: [...OPEN_PIPELINE_STAGES],
    },
    actionType: "send_template",
    actionParams: { templateName: "mahabir_repeat_engagement" },
    isActive: true,
  },
  {
    triggerType: "enquiry_reminder",
    name: "Last Inquiry Reminder",
    description:
      "Daily reminder for customers (not Closed) about their last sent quotation with no reply.",
    triggerParams: { daysSinceSent: 7, scheduleTime: "09:00" },
    actionType: "send_template",
    actionParams: { templateName: "mahabir_enquiry_reminder" },
    isActive: true,
  },
];

export const CRON_RULE_TYPES: AutomationRuleType[] = ["repeat_engagement", "enquiry_reminder"];

export function isCronRuleType(type: string): type is AutomationRuleType {
  return CRON_RULE_TYPES.includes(type as AutomationRuleType);
}

/** Map legacy trigger types still present in DB or queued jobs. */
export const LEGACY_TRIGGER_TYPE_ALIASES: Record<string, AutomationRuleType> = {
  inactivity_followup: "inquiry_followup",
};

export function normalizeTriggerType(triggerType: string): string {
  return LEGACY_TRIGGER_TYPE_ALIASES[triggerType] || triggerType;
}
