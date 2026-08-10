"use client";

import { useRouter } from "next/navigation";
import { Bell, BellOff, Building2, FileText, Phone, Trash2 } from "lucide-react";
import { timeAgo } from "../../../../lib/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CRM_STAGES, STAGE_CARD_COLORS } from "../../../../lib/crm-stages";

export interface CustomerItem {
  id: string;
  name: string | null;
  phone: string;
  company: string | null;
  stage: string;
  doNotDisturb?: boolean;
  enquiryCount: number;
  lastActivity: string;
}

function getInitials(name: string | null, phone: string): string {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  return phone.replace(/\D/g, "").slice(-2) || "??";
}

interface CustomerCardProps {
  customer: CustomerItem;
  onStageChange: (customerId: string, stage: string) => void;
  onDndToggle?: (customerId: string, doNotDisturb: boolean) => void;
  onRemoveFromPipeline?: (customerId: string) => void;
}

export function CustomerCard({
  customer,
  onStageChange,
  onDndToggle,
  onRemoveFromPipeline,
}: CustomerCardProps) {
  const router = useRouter();
  const colors = STAGE_CARD_COLORS[customer.stage || "Lead"] || STAGE_CARD_COLORS.Lead;
  const displayName = customer.name?.trim() || "Unknown";
  const dndOn = !!customer.doNotDisturb;

  return (
    <article
      className={cn(
        "group rounded-lg border border-line/80 bg-surface border-l-[3px] overflow-hidden",
        "hover:border-brand/35 hover:shadow-sm transition-all duration-150",
        colors.accent
      )}
      data-testid={`kanban-card-${customer.id}`}
    >
      <button
        type="button"
        onClick={() => router.push(`/crm/${customer.id}`)}
        className="w-full text-left p-3 space-y-2.5"
      >
        <div className="flex items-start gap-2.5 min-w-0">
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
              colors.avatar
            )}
            aria-hidden
          >
            {getInitials(customer.name, customer.phone)}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <h3 className="font-medium text-[13px] leading-snug text-ink truncate group-hover:text-brand transition-colors">
                {displayName}
              </h3>
              {dndOn ? (
                <span
                  className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide bg-stone-200 text-stone-700"
                  title="Do Not Disturb"
                >
                  DND
                </span>
              ) : null}
            </div>

            {customer.company ? (
              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-muted truncate">
                <Building2 className="h-3 w-3 shrink-0 opacity-70" />
                <span className="truncate">{customer.company}</span>
              </p>
            ) : null}

            <p className="mt-1 flex items-center gap-1 text-[11px] text-ink-muted truncate">
              <Phone className="h-3 w-3 shrink-0 opacity-70" />
              <span className="tabular-nums truncate">{customer.phone}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
              colors.badge
            )}
          >
            <FileText className="h-3 w-3" />
            {customer.enquiryCount} enq
          </span>
          <span className="text-[10px] text-ink-muted tabular-nums shrink-0">
            {timeAgo(customer.lastActivity)}
          </span>
        </div>
      </button>

      <div
        className="flex items-center gap-1 border-t border-line/60 bg-canvas/50 px-2 py-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        {onDndToggle ? (
          <button
            type="button"
            onClick={() => onDndToggle(customer.id, !dndOn)}
            className={cn(
              "rounded-md p-1.5 transition-colors shrink-0",
              dndOn
                ? "text-stone-800 bg-stone-200 hover:bg-stone-300"
                : "text-ink-muted hover:text-ink hover:bg-surface"
            )}
            title={dndOn ? "DND on — click to allow automations" : "DND off — click to silence automations"}
            data-testid={`dnd-toggle-${customer.id}`}
          >
            {dndOn ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
          </button>
        ) : null}

        {onRemoveFromPipeline ? (
          <button
            type="button"
            onClick={() => onRemoveFromPipeline(customer.id)}
            className="rounded-md p-1.5 text-ink-muted hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
            title="Remove from pipeline"
            data-testid={`remove-pipeline-${customer.id}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}

        <Select value={customer.stage || "Lead"} onValueChange={(val) => onStageChange(customer.id, val)}>
          <SelectTrigger className="h-7 flex-1 min-w-0 text-[11px] bg-surface border-line text-ink px-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-surface border-line text-ink">
            {CRM_STAGES.map((s) => (
              <SelectItem key={s} value={s} className="text-xs text-ink hover:bg-canvas">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </article>
  );
}

export { CRM_STAGES as STAGES, STAGE_CARD_COLORS as STAGE_COLORS };
