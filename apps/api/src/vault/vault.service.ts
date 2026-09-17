import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountState, Channel, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.guard';
import { CURRENT_KEY_VERSION, decryptCredential, encryptCredential } from './crypto';
import { Page, paginate, pageResult } from '../common/pagination';

/**
 * The login fields an account can carry, in the order a person reads them.
 * They are encrypted together as one JSON object; only the NAMES of the ones
 * present are stored in the clear, so a card can say "username, password and
 * 2FA codes are on file" without anybody revealing anything.
 */
export const LOGIN_FIELDS = [
  'username',
  'email',
  'password',
  'phone',
  'twoFactor',
  'recoveryEmail',
  'extra',
] as const;
export type LoginField = (typeof LOGIN_FIELDS)[number];
export type LoginDetails = Partial<Record<LoginField, string>>;

const ACCOUNT_STATES: AccountState[] = ['HEALTHY', 'COOLDOWN', 'CHALLENGED', 'SUSPENDED', 'RETIRED'];

export interface AccountInput {
  ref?: string;
  label?: string | null;
  platform?: string | null;
  loginUrl?: string | null;
  notes?: string | null;
  credentials?: LoginDetails;
  /** Field names to delete from the stored login details. */
  removeFields?: LoginField[];
}

/** Keeps known keys with non-empty values. Everything else is dropped. */
function cleanDetails(input: unknown): LoginDetails {
  const out: LoginDetails = {};
  if (!input || typeof input !== 'object') return out;
  for (const key of LOGIN_FIELDS) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) out[key] = value.trim();
  }
  return out;
}

/** Rows written before details were structured hold a bare string. */
function parseDetails(plaintext: string): LoginDetails {
  try {
    const parsed = JSON.parse(plaintext);
    if (parsed && typeof parsed === 'object') return cleanDetails(parsed);
  } catch {
    // not JSON - a legacy free-text credential
  }
  return plaintext.trim() ? { extra: plaintext.trim() } : {};
}

function fieldsOf(details: LoginDetails): LoginField[] {
  return LOGIN_FIELDS.filter((k) => details[k]);
}

function optionalText(value: string | null | undefined, max: number, what: string) {
  if (value === undefined) return undefined;
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    throw new BadRequestException(`${what} is too long. Keep it under ${max} characters.`);
  }
  return trimmed;
}

/** "instagram.com/login" is what people type. Store something clickable. */
function normalizeUrl(value: string | null | undefined) {
  const text = optionalText(value, 500, 'The sign-in link');
  if (!text) return text;
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
    return url.toString();
  } catch {
    throw new BadRequestException('That sign-in link does not look like a web address.');
  }
}

const PUBLIC_INCLUDE = {
  addedBy: { select: { id: true, name: true, preferredName: true } },
  secret: { select: { fields: true, updatedAt: true, keyVersion: true } },
} satisfies Prisma.AccountInclude;

type PublicRow = Prisma.AccountGetPayload<{ include: typeof PUBLIC_INCLUDE }>;

/**
 * Section 10. The vault is its own module with its own key material, not a
 * table inside the task schema. Credentials are never rendered on page load,
 * never sent out through Telegram, and never included in a response by default.
 */
@Injectable()
export class VaultService {
  constructor(private readonly db: PrismaService) {}

  private get secret(): string {
    return process.env.VAULT_KEY_SECRET || '';
  }

  /**
   * Everything about an account that is safe to show without a reveal. Used by
   * the console, the bot, and the card on a tasker's task page, so the three
   * can never disagree about what an account looks like.
   */
  static publicShape(a: PublicRow) {
    return {
      id: a.id,
      ref: a.ref,
      label: a.label,
      platform: a.platform,
      loginUrl: a.loginUrl,
      notes: a.notes,
      state: a.state,
      cooldownUntil: a.cooldownUntil,
      fields: (a.secret?.fields ?? []) as LoginField[],
      addedBy: a.addedBy
        ? { id: a.addedBy.id, name: a.addedBy.preferredName || a.addedBy.name }
        : null,
      addedVia: a.addedVia,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      detailsUpdatedAt: a.secret?.updatedAt ?? null,
    };
  }

  static readonly publicInclude = PUBLIC_INCLUDE;

  /** Pool health. Credentials are structurally absent from this shape. */
  async list(page?: Page, search?: string) {
    const q = search?.trim();
    const where: Prisma.AccountWhereInput = q
      ? {
          OR: [
            { ref: { contains: q, mode: 'insensitive' } },
            { label: { contains: q, mode: 'insensitive' } },
            { platform: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {};

    const [total, accounts, free] = await Promise.all([
      this.db.account.count({ where }),
      this.db.account.findMany({
        where,
        include: {
          ...PUBLIC_INCLUDE,
          holds: {
            where: { releasedAt: null },
            include: {
              tasker: { select: { id: true, name: true } },
              task: { select: { id: true, code: true, state: true } },
            },
          },
          _count: { select: { reveals: true } },
        },
        orderBy: { ref: 'asc' },
        ...paginate(page),
      }),
      // Across the whole pool, not just this page - "3 free" must not quietly
      // mean "3 free on page one".
      this.db.account.count({
        where: {
          state: 'HEALTHY',
          holds: { none: { releasedAt: null } },
          OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: new Date() } }],
        },
      }),
    ]);

    const items = accounts.map((a) => ({
      ...VaultService.publicShape(a),
      revealCount: a._count.reveals,
      heldBy: this.holdShape(a.holds[0]),
    }));

    const result = page
      ? pageResult(items, total, page)
      : { items, total, page: 1, limit: total, pageCount: 1 };
    return { ...result, free };
  }

  /** One account by id or by its reference (ACC-002) - the bot works in refs. */
  async get(idOrRef: string) {
    const account = await this.db.account.findFirst({
      where: { OR: [{ id: idOrRef }, { ref: { equals: idOrRef.trim(), mode: 'insensitive' } }] },
      include: {
        ...PUBLIC_INCLUDE,
        holds: {
          where: { releasedAt: null },
          include: {
            tasker: { select: { id: true, name: true } },
            task: { select: { id: true, code: true, state: true } },
          },
        },
        _count: { select: { reveals: true, tasks: true } },
      },
    });
    if (!account) throw new NotFoundException(`No account called ${idOrRef}.`);

    return {
      ...VaultService.publicShape(account),
      revealCount: account._count.reveals,
      taskCount: account._count.tasks,
      heldBy: this.holdShape(account.holds[0]),
      recentReveals: await this.revealLog(account.id, 5),
    };
  }

  async create(user: AuthUser, channel: Channel, input: AccountInput) {
    const ref = input.ref?.trim().toUpperCase();
    if (!ref) throw new BadRequestException('Give the account a reference, like ACC-006.');
    if (ref.length > 40) throw new BadRequestException('Keep the reference under 40 characters.');

    const clash = await this.db.account.findFirst({
      where: { ref: { equals: ref, mode: 'insensitive' } },
      select: { id: true },
    });
    if (clash) throw new ConflictException(`There is already an account called ${ref}.`);

    const details = cleanDetails(input.credentials);
    if (!details.password && !details.username && !details.email && !details.extra) {
      throw new BadRequestException(
        'Add the login details - at least a username or email, and usually a password.',
      );
    }

    const { ciphertext, keyVersion } = encryptCredential(JSON.stringify(details), this.secret);
    const created = await this.db.account.create({
      data: {
        ref,
        label: optionalText(input.label, 80, 'The label') ?? null,
        platform: optionalText(input.platform, 60, 'The platform name') ?? null,
        loginUrl: normalizeUrl(input.loginUrl) ?? null,
        notes: optionalText(input.notes, 2000, 'The notes') ?? null,
        addedById: user.id,
        addedVia: channel,
        secret: { create: { ciphertext, keyVersion, fields: fieldsOf(details) } },
      },
      include: PUBLIC_INCLUDE,
    });
    return VaultService.publicShape(created);
  }

  /**
   * Edits merge rather than replace. A blank login field means "leave it as it
   * is", so correcting a typo in the notes never wipes a password nobody
   * re-typed. Deleting a field is explicit, through removeFields.
   */
  async update(user: AuthUser, idOrRef: string, input: AccountInput) {
    const account = await this.db.account.findFirst({
      where: { OR: [{ id: idOrRef }, { ref: { equals: idOrRef.trim(), mode: 'insensitive' } }] },
      include: { secret: true },
    });
    if (!account) throw new NotFoundException(`No account called ${idOrRef}.`);

    const data: Prisma.AccountUpdateInput = {
      label: optionalText(input.label, 80, 'The label'),
      platform: optionalText(input.platform, 60, 'The platform name'),
      loginUrl: normalizeUrl(input.loginUrl),
      notes: optionalText(input.notes, 2000, 'The notes'),
    };

    const incoming = cleanDetails(input.credentials);
    const removing = (input.removeFields ?? []).filter((f) => LOGIN_FIELDS.includes(f));

    if (Object.keys(incoming).length || removing.length) {
      const current = account.secret
        ? parseDetails(
            decryptCredential(account.secret.ciphertext, this.secret, account.secret.keyVersion),
          )
        : {};
      const merged: LoginDetails = { ...current, ...incoming };
      for (const f of removing) delete merged[f];

      if (!merged.password && !merged.username && !merged.email && !merged.extra) {
        throw new BadRequestException(
          'That would leave the account with no way to sign in. Keep a username or email.',
        );
      }

      // Re-encrypting under the current key version also completes a pending
      // rotation for this row as a side effect.
      const { ciphertext, keyVersion } = encryptCredential(JSON.stringify(merged), this.secret);
      data.secret = {
        upsert: {
          create: { ciphertext, keyVersion, fields: fieldsOf(merged) },
          update: { ciphertext, keyVersion, fields: fieldsOf(merged) },
        },
      };
    }

    const updated = await this.db.account.update({
      where: { id: account.id },
      data,
      include: PUBLIC_INCLUDE,
    });
    return VaultService.publicShape(updated);
  }

  /**
   * Revealing is an explicit action returning a short-lived payload, and every
   * reveal writes a row. A tasker may only reveal the account on their own
   * active task - the matrix allows the capability, this narrows it.
   */
  async reveal(user: AuthUser, accountId: string, ip?: string) {
    const account = await this.db.account.findUnique({
      where: { id: accountId },
      include: { secret: true, holds: { where: { releasedAt: null }, include: { task: true } } },
    });
    if (!account?.secret) throw new NotFoundException('That account has no stored login details.');

    const openHold = account.holds[0];

    if (user.role === 'TASKER') {
      if (!openHold || openHold.taskerId !== user.id) {
        throw new ForbiddenException('You can only reveal the account on your own active task.');
      }
    }

    const details = parseDetails(
      decryptCredential(account.secret.ciphertext, this.secret, account.secret.keyVersion),
    );

    await this.db.credentialReveal.create({
      data: {
        accountId,
        taskId: openHold?.taskId ?? null,
        actorId: user.id,
        ip: ip ?? null,
      },
    });

    return {
      ref: account.ref,
      details,
      fields: fieldsOf(details),
      // The client shows a countdown and clears the values. The audit row is
      // already written either way.
      expiresInSeconds: 60,
      keyVersion: account.secret.keyVersion,
      rotationPending: account.secret.keyVersion !== CURRENT_KEY_VERSION,
    };
  }

  async setState(accountId: string, state: AccountState, cooldownMinutes?: number) {
    if (!ACCOUNT_STATES.includes(state)) {
      throw new BadRequestException('That is not an account state.');
    }
    if (state === 'COOLDOWN' && !(Number(cooldownMinutes) > 0)) {
      throw new BadRequestException('Say how long the account should rest.');
    }
    const updated = await this.db.account.update({
      where: { id: accountId },
      data: {
        state,
        cooldownUntil:
          state === 'COOLDOWN' ? new Date(Date.now() + Number(cooldownMinutes) * 60_000) : null,
      },
      include: PUBLIC_INCLUDE,
    });
    return VaultService.publicShape(updated);
  }

  /** Who looked, on which task, and when - with names, not bare ids. */
  async revealLog(accountId: string, take = 50) {
    const rows = await this.db.credentialReveal.findMany({
      where: { accountId },
      orderBy: { revealedAt: 'desc' },
      take,
    });
    const [actors, tasks] = await Promise.all([
      this.db.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.actorId))] } },
        select: { id: true, name: true, preferredName: true, role: true },
      }),
      this.db.task.findMany({
        where: { id: { in: rows.map((r) => r.taskId).filter((x): x is string => !!x) } },
        select: { id: true, code: true },
      }),
    ]);
    const actorById = new Map(actors.map((a) => [a.id, a]));
    const codeById = new Map(tasks.map((t) => [t.id, t.code]));

    return rows.map((r) => {
      const actor = actorById.get(r.actorId);
      return {
        id: r.id,
        revealedAt: r.revealedAt,
        actorName: actor ? actor.preferredName || actor.name : 'Unknown',
        actorRole: actor?.role ?? null,
        taskCode: r.taskId ? (codeById.get(r.taskId) ?? null) : null,
      };
    });
  }

  private holdShape(
    hold:
      | {
          heldAt: Date;
          tasker: { id: string; name: string };
          task: { id: string; code: string; state: string };
        }
      | undefined,
  ) {
    if (!hold) return null;
    return {
      taskerId: hold.tasker.id,
      taskerName: hold.tasker.name,
      taskCode: hold.task.code,
      taskState: hold.task.state,
      heldAt: hold.heldAt,
      // A paused task keeps its hold - the one legitimate case of a tasker
      // holding two accounts. Flagged so it does not read as a bug.
      displacedByRework: hold.task.state === 'PAUSED',
    };
  }
}
