import { cn } from "@/lib/utils";

export type TaskState =
  | "DRAFT"
  | "OPEN"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "IN_REVIEW"
  | "PENDING_VERIFICATION"
  | "REWORK"
  | "PAUSED"
  | "CLOSED"
  | "CANCELLED"
  | "EXPIRED";

/**
 * One chip per state, and the label says what is WAITING rather than what the
 * enum is called. "Awaiting review" tells a reader what to do about it;
 * IN_REVIEW makes them translate first.
 */
const LABEL: Record<TaskState, string> = {
  DRAFT: "Draft",
  OPEN: "Open to pool",
  ASSIGNED: "Awaiting acceptance",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  IN_REVIEW: "Awaiting review",
  PENDING_VERIFICATION: "Awaiting verdict",
  REWORK: "Sent back",
  PAUSED: "Paused",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

const STYLE: Record<TaskState, string> = {
  DRAFT: "bg-tint-grey text-state-draft",
  OPEN: "bg-tint-blue text-state-open",
  ASSIGNED: "bg-tint-blue text-state-assigned",
  IN_PROGRESS: "bg-tint-green text-state-in_progress",
  SUBMITTED: "bg-tint-green text-state-submitted",
  IN_REVIEW: "bg-tint-amber text-state-in_review",
  PENDING_VERIFICATION: "bg-tint-amber text-state-pending_verification",
  REWORK: "bg-tint-orange text-state-rework",
  PAUSED: "bg-tint-violet text-state-paused",
  CLOSED: "bg-tint-green text-state-closed",
  CANCELLED: "bg-tint-grey text-state-cancelled",
  EXPIRED: "bg-tint-red text-state-expired",
};

export function StateBadge({ state, className }: { state: TaskState; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        STYLE[state] ?? STYLE.DRAFT,
        className,
      )}
    >
      {LABEL[state] ?? state}
    </span>
  );
}

export function stateLabel(state: TaskState): string {
  return LABEL[state] ?? state;
}

const ACCOUNT_STYLE: Record<string, string> = {
  HEALTHY: "bg-tint-green text-state-closed",
  COOLDOWN: "bg-tint-blue text-state-open",
  CHALLENGED: "bg-tint-amber text-state-in_review",
  SUSPENDED: "bg-tint-red text-state-expired",
  RETIRED: "bg-tint-grey text-state-cancelled",
};

export function AccountBadge({ state }: { state: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        ACCOUNT_STYLE[state] ?? ACCOUNT_STYLE.RETIRED,
      )}
    >
      {state.charAt(0) + state.slice(1).toLowerCase()}
    </span>
  );
}
