"use client";

import { useRouter } from "next/navigation";
import { Building2, ChevronRight, FileText, Phone, Trash2 } from "lucide-react";
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
  onRemoveFromPipeline?: (customerId: string) => void;
}

export function CustomerCard({ customer, onStageChange, onRemoveFromPipeline }: CustomerCardProps) {
  const router = useRouter();
  const colors = STAGE_CARD_COLORS[customer.stage || "Lead"] || STAGE_CARD_COLORS.Lead;
  const displayName = customer.name?.trim() || "Unknown";

  return (
    <article
      className={cn(
        "group relative rounded-md border border-line/80 bg-surface border-l-[3px]",
        "hover:border-brand/40 hover:shadow-sm transition-all duration-150",
        colors.accent
      )}
      data-testid={`kanban-card-${customer.id}`}
    >
      <button
        type="button"
        onClick={() => router.push(`/crm/${customer.id}`)}
        className="w-full text-left p-2.5 pr-2 space-y-2"
      >
        <div className="flex items-start gap-2">
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
              colors.avatar
            )}
            aria-hidden
          >
            {getInitials(customer.name, customer.phone)}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <h3 className="font-medium text-[13px] leading-tight text-ink truncate group-hover:text-brand transition-colors">
                {displayName}
              </h3>
              <ChevronRight className="h-3 w-3 shrink-0 text-ink-muted opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            {customer.company ? (
              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-muted truncate">
                <Building2 className="h-2.5 w-2.5 shrink-0" />
                {customer.company}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1 text-[11px] text-ink-muted pl-10 -mt-1">
          <Phone className="h-2.5 w-2.5 shrink-0" />
          <span className="tabular-nums truncate">{customer.phone}</span>
        </div>

        <div className="flex items-center justify-between gap-2 pl-10 pt-0.5">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
              colors.badge
            )}
          >
            <FileText className="h-2.5 w-2.5" />
            {customer.enquiryCount}
          </span>
          <span className="text-[10px] text-ink-muted tabular-nums">{timeAgo(customer.lastActivity)}</span>
        </div>
      </button>

      <div
        className="flex items-center justify-between gap-2 border-t border-line/50 px-2.5 py-1.5 bg-canvas/40"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-[9px] uppercase tracking-wider text-ink-muted">Stage</span>
        <div className="flex items-center gap-1">
          {onRemoveFromPipeline && (
            <button
              type="button"
              onClick={() => onRemoveFromPipeline(customer.id)}
              className="rounded p-1 text-ink-muted hover:text-red-600 hover:bg-red-50 transition-colors"
              title="Remove from pipeline"
              data-testid={`remove-pipeline-${customer.id}`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
          <Select value={customer.stage || "Lead"} onValueChange={(val) => onStageChange(customer.id, val)}>
          <SelectTrigger className="h-6 w-[7.5rem] text-[11px] bg-surface border-line/80 text-ink px-2">
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
      </div>
    </article>
  );
}

export { CRM_STAGES as STAGES, STAGE_CARD_COLORS as STAGE_COLORS };
