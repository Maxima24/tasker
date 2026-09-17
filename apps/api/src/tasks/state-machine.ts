import { TaskState, TaskCategory } from '@prisma/client';

/**
 * PRD section 7. The legal transition graph, in one place.
 *
 * This table is the only authority on what may follow what. Services ask it;
 * they never hand-roll a state comparison. Surfaces are not consulted at all -
 * a surface decides what to RENDER, never what is permitted.
 */
const TRANSITIONS: Record<TaskState, TaskState[]> = {
  DRAFT: ['OPEN', 'ASSIGNED', 'CANCELLED'],
  OPEN: ['IN_PROGRESS', 'ASSIGNED', 'CANCELLED', 'EXPIRED'],
  ASSIGNED: ['IN_PROGRESS', 'OPEN', 'CANCELLED', 'EXPIRED'],
  IN_PROGRESS: ['SUBMITTED', 'PAUSED', 'OPEN', 'ASSIGNED', 'CANCELLED'],
  // Standard tasks close automatically from SUBMITTED; critical ones go to review.
  SUBMITTED: ['CLOSED', 'IN_REVIEW', 'CANCELLED'],
  IN_REVIEW: ['PENDING_VERIFICATION', 'REWORK', 'CANCELLED'],
  PENDING_VERIFICATION: ['CLOSED', 'REWORK', 'CANCELLED'],
  REWORK: ['IN_PROGRESS', 'SUBMITTED', 'CANCELLED'],
  PAUSED: ['IN_PROGRESS', 'CANCELLED'],
  CLOSED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: TaskState, to: TaskState): void {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(from, to);
  }
}

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: TaskState,
    public readonly to: TaskState,
  ) {
    super(`A task in ${from} cannot move to ${to}.`);
  }
}

/** Terminal states never transition again and never hold an account. */
export const TERMINAL: TaskState[] = ['CLOSED', 'CANCELLED', 'EXPIRED'];

export function isTerminal(state: TaskState): boolean {
  return TERMINAL.includes(state);
}

/**
 * Invariant 4 - a tasker may hold at most one task in IN_PROGRESS or REWORK.
 * For critical tasks the counter releases on entry to PENDING_VERIFICATION, not
 * at close, so review lag never blocks work.
 */
export const HOLDING_STATES: TaskState[] = ['IN_PROGRESS', 'REWORK'];

/** Where a task goes the moment proof is submitted. Section 6 in one function. */
export function afterSubmit(category: TaskCategory): TaskState {
  // Standard is hours-based: proof is evidence the work happened, not something
  // to judge. No human acts on it after submission.
  return category === 'STANDARD' ? 'CLOSED' : 'IN_REVIEW';
}

/** States in which an account hold must be open. */
export function shouldHoldAccount(state: TaskState): boolean {
  return state === 'IN_PROGRESS' || state === 'REWORK' || state === 'PAUSED';
}
