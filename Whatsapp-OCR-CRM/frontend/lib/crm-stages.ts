/** CRM pipeline stages — Customer.stage defaults to "Lead" in the database. */
export const CRM_STAGES = [
  "Lead",
  "Contacted",
  "Proposal",
  "Negotiation",
  "Closed",
  "Lost",
] as const;

export type CrmStage = (typeof CRM_STAGES)[number];

export const STAGE_CARD_COLORS: Record<
  string,
  { accent: string; avatar: string; badge: string }
> = {
  Lead: {
    accent: "border-l-red-400",
    avatar: "bg-red-50 text-red-800",
    badge: "bg-red-50 text-red-800",
  },
  Contacted: {
    accent: "border-l-rose-500",
    avatar: "bg-rose-50 text-rose-800",
    badge: "bg-rose-50 text-rose-800",
  },
  Proposal: {
    accent: "border-l-red-600",
    avatar: "bg-red-100 text-red-900",
    badge: "bg-red-100 text-red-900",
  },
  Negotiation: {
    accent: "border-l-amber-600",
    avatar: "bg-amber-50 text-amber-900",
    badge: "bg-amber-50 text-amber-900",
  },
  Closed: {
    accent: "border-l-red-900",
    avatar: "bg-red-900 text-white",
    badge: "bg-red-900 text-white",
  },
  Lost: {
    accent: "border-l-stone-400",
    avatar: "bg-stone-100 text-stone-700",
    badge: "bg-stone-100 text-stone-700",
  },
};

export const STAGE_LIST_COLORS: Record<string, { text: string }> = {
  Lead: { text: "text-red-700" },
  Contacted: { text: "text-rose-800" },
  Proposal: { text: "text-red-900" },
  Negotiation: { text: "text-amber-900" },
  Closed: { text: "text-red-950" },
  Lost: { text: "text-stone-600" },
};

export const STAGE_COLUMN_COLORS: Record<string, { dot: string; header: string }> = {
  Lead: { dot: "bg-red-400", header: "bg-red-50/60" },
  Contacted: { dot: "bg-rose-500", header: "bg-rose-50/60" },
  Proposal: { dot: "bg-red-600", header: "bg-red-100/50" },
  Negotiation: { dot: "bg-amber-600", header: "bg-amber-50/60" },
  Closed: { dot: "bg-red-900", header: "bg-red-950/10" },
  Lost: { dot: "bg-stone-400", header: "bg-stone-50/80" },
};
