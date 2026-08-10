"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { CustomerCard, type CustomerItem } from "./customer-card";
import { cn } from "@/lib/utils";

const INITIAL_VISIBLE = 12;
const LOAD_MORE_COUNT = 10;

interface StageColors {
  dot: string;
  header: string;
}

interface PipelineColumnProps {
  stage: string;
  items: CustomerItem[];
  colors: StageColors;
  loading?: boolean;
  onStageChange: (customerId: string, stage: string) => void;
  onDndToggle?: (customerId: string, doNotDisturb: boolean) => void;
  onRemoveFromPipeline?: (customerId: string) => void;
}

export function PipelineColumn({
  stage,
  items,
  colors,
  loading = false,
  onStageChange,
  onDndToggle,
  onRemoveFromPipeline,
}: PipelineColumnProps) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const visibleItems = items.slice(0, visibleCount);
  const hasMore = visibleCount < items.length;

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE);
  }, [items]);

  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;
    setIsLoadingMore(true);
    requestAnimationFrame(() => {
      setVisibleCount((prev) => Math.min(prev + LOAD_MORE_COUNT, items.length));
      setIsLoadingMore(false);
    });
  }, [hasMore, isLoadingMore, items.length]);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { root, rootMargin: "80px", threshold: 0 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, visibleCount]);

  return (
    <div
      className="flex min-w-0 flex-1 flex-col rounded-lg border border-line bg-surface/50 overflow-hidden"
      data-testid={`kanban-column-${stage.toLowerCase()}`}
    >
      <div
        className={cn(
          "flex items-center justify-between border-b border-line px-2.5 py-2",
          colors.header
        )}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", colors.dot)} />
          <span className="truncate text-xs font-semibold text-ink">{stage}</span>
        </div>
        <span className="shrink-0 rounded bg-canvas px-1.5 py-0.5 text-[10px] tabular-nums text-ink-muted border border-line/60">
          {loading ? "…" : items.length}
        </span>
      </div>

      <div
        ref={scrollRef}
        className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-1.5 max-h-[calc(100vh-220px)] min-h-[320px] scroll-thin"
      >
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[88px] animate-pulse rounded-md border border-line/60 bg-canvas/60" />
          ))
        ) : items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-8 text-[11px] text-ink-muted">
            No customers
          </div>
        ) : (
          <>
            {visibleItems.map((customer) => (
              <CustomerCard
                key={customer.id}
                customer={customer}
                onStageChange={onStageChange}
                onDndToggle={onDndToggle}
                onRemoveFromPipeline={onRemoveFromPipeline}
              />
            ))}

            {hasMore ? (
              <div ref={sentinelRef} className="flex items-center justify-center py-2">
                {isLoadingMore ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-muted" />
                ) : (
                  <button
                    type="button"
                    onClick={loadMore}
                    className="text-[10px] text-ink-muted hover:text-brand transition-colors"
                  >
                    Load {Math.min(LOAD_MORE_COUNT, items.length - visibleCount)} more
                  </button>
                )}
              </div>
            ) : items.length > INITIAL_VISIBLE ? (
              <p className="py-1 text-center text-[10px] text-ink-muted">All loaded</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
