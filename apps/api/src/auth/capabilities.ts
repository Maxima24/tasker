import { Role } from '@prisma/client';

/**
 * PRD section 14, as data. Sub-admin is defined by its deny list, and every
 * refused action returns a message naming who CAN perform it - nobody is left
 * guessing why a button did nothing.
 */
export type Capability =
  | 'task.create'
  | 'taskType.create'
  | 'specVersion.publish'
  | 'task.assign'
  | 'review.internal'
  | 'verdict.external'
  | 'task.cancel'
  | 'account.create'
  | 'account.updateCredentials'
  | 'account.reveal'
  | 'tasker.manage'
  | 'tasker.viewAny'
  | 'weights.edit';

const MATRIX: Record<Capability, Role[]> = {
  'task.create': ['ADMIN', 'SUB_ADMIN'],
  'taskType.create': ['ADMIN', 'SUB_ADMIN'],
  'specVersion.publish': ['ADMIN'],
  'task.assign': ['ADMIN', 'SUB_ADMIN'],
  'review.internal': ['ADMIN', 'SUB_ADMIN'],
  'verdict.external': ['ADMIN', 'SUB_ADMIN'],
  'task.cancel': ['ADMIN', 'SUB_ADMIN'],
  // Widened from the PRD on the owner's instruction: sub-admins load and
  // maintain accounts too, from the console or from Telegram.
  'account.create': ['ADMIN', 'SUB_ADMIN'],
  'account.updateCredentials': ['ADMIN', 'SUB_ADMIN'],
  // Taskers may reveal, but only for the account on their own active task -
  // that narrowing is enforced in the vault service, not here.
  'account.reveal': ['ADMIN', 'SUB_ADMIN', 'TASKER'],
  'tasker.manage': ['ADMIN'],
  'tasker.viewAny': ['ADMIN', 'SUB_ADMIN'],
  'weights.edit': ['ADMIN'],
};

const HUMAN: Record<Role, string> = {
  ADMIN: 'the admin',
  SUB_ADMIN: 'a sub-admin',
  TASKER: 'a tasker',
};

export function can(role: Role, capability: Capability): boolean {
  return MATRIX[capability]?.includes(role) ?? false;
}

/** "Only the admin can publish a spec version." - never a bare 403. */
export function denialMessage(capability: Capability): string {
  const allowed = MATRIX[capability] ?? [];
  if (allowed.length === 0) return 'Nobody can perform this action.';
  const names = allowed.map((r) => HUMAN[r]);
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  return `Only ${list} can perform this action.`;
}
