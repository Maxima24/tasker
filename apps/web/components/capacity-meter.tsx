"use client";

import { AlertTriangle, TrendingUp } from "lucide-react";

export interface Capacity {
  limit: number;
  holding: number;
  canClaim: boolean;
  closedCount: number;
  reviewedCount: number;
  approvalRate: number;
  limited: boolean;
  nextTierAt: number | null;
  reason: string;
}

/**
 * How many tasks this person may hold, and why that number. Capacity here is
 * earned rather than granted, so the meter always shows the rule alongside the
 * count - a ceiling nobody can explain just feels arbitrary.
 */
export function CapacityMeter({ capacity }: { capacity: Capacity }) {
  const slots = Array.from({ length: Math.max(capacity.limit, capacity.holding) });

  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        capacity.limited ? "border-warn/40 bg-tint-amber" : "border-ink-200 bg-white"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5" aria-label={`${capacity.holding} of ${capacity.limit} slots used`}>
          {slots.map((_, i) => (
            <span
              key={i}
              className={`h-2.5 w-7 rounded-full ${
                i < capacity.holding ? "bg-ink-900" : "bg-ink-200"
              }`}
            />
          ))}
        </div>
        <span className="text-sm font-medium text-ink-900">
          {capacity.holding} of {capacity.limit} {capacity.limit === 1 ? "slot" : "slots"} in use
        </span>

        {capacity.limited ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-warn">
            <AlertTriangle className="size-3.5" />
            Limited
          </span>
        ) : capacity.nextTierAt !== null ? (
          <span className="inline-flex items-center gap-1 text-xs text-ink-500">
            <TrendingUp className="size-3.5" />
            {capacity.nextTierAt} more to unlock a slot
          </span>
        ) : null}

        {capacity.reviewedCount > 0 && (
          <span className="ml-auto text-xs tabular-nums text-ink-500">
            {Math.round(capacity.approvalRate * 100)}% approved
          </span>
        )}
      </div>

      <p className={`mt-1.5 text-xs ${capacity.limited ? "text-warn" : "text-ink-500"}`}>
        {capacity.reason}
      </p>
    </div>
  );
}
