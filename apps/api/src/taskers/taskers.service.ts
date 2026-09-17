import crypto from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../common/settings.service';
import { CapacityService } from './capacity.service';
import { Page, paginate, pageResult } from '../common/pagination';

/**
 * Section 8 - the productivity filter. Approval rate and speed pull against
 * each other; a flat average quietly rewards rushing, which is why approval
 * carries the most weight by default. Weights are configuration, not code.
 */
@Injectable()
export class TaskersService {
  constructor(
    private readonly db: PrismaService,
    private readonly settings: SettingsService,
    private readonly capacity: CapacityService,
  ) {}

  /**
   * The certified pool for a spec version, ranked. Taskers below the minimum
   * closed-task count are returned UNRANKED and separately, so new taskers are
   * not permanently starved by a score they have no way to earn.
   */
  async pool(specVersionId?: string, minScore?: number) {
    const certifiedIds = specVersionId
      ? (
          await this.db.certification.findMany({
            where: { specVersionId, supersededAt: null },
            select: { taskerId: true },
          })
        ).map((c) => c.taskerId)
      : undefined;

    const taskers = await this.db.user.findMany({
      where: {
        role: 'TASKER',
        status: 'active',
        ...(certifiedIds ? { id: { in: certifiedIds } } : {}),
      },
      include: {
        stats: true,
        tasks: { where: { state: { in: ['IN_PROGRESS', 'REWORK'] } }, select: { id: true } },
        accountAssignments: {
          where: { collectedAt: null },
          orderBy: { assignedAt: 'asc' },
          include: { account: { select: { id: true, ref: true, label: true, accessType: true } } },
        },
      },
      orderBy: { name: 'asc' },
    });

    const minClosed = await this.settings.get('productivity.minClosedToRank');

    const mapped = taskers.map((t) => ({
      id: t.id,
      name: t.name,
      email: t.email,
      score: t.stats?.score ?? 0,
      approvalRate: t.stats?.approvalRate ?? 0,
      closedCount: t.stats?.closedCount ?? 0,
      medianSubmitMinutes: t.stats?.medianSubmitMinutes ?? 0,
      reworkRate: t.stats?.reworkRate ?? 0,
      busy: t.tasks.length > 0,
      // The People tab, per person: which account they have and since when.
      accounts: t.accountAssignments.map((a) => ({
        accountId: a.account.id,
        ref: a.account.ref,
        label: a.account.label,
        accessType: a.account.accessType,
        role: a.role,
        assignedAt: a.assignedAt,
      })),
      ranked: (t.stats?.closedCount ?? 0) >= minClosed,
    }));

    const ranked = mapped
      .filter((t) => t.ranked && (minScore == null || t.score >= minScore))
      .sort((a, b) => b.score - a.score);
    const unranked = mapped.filter((t) => !t.ranked);

    return { ranked, unranked, minClosedToRank: minClosed };
  }

  async recomputeStats(taskerId: string) {
    const weights = await this.settings.get('productivity.weights');
    const windowDays = await this.settings.get('productivity.windowDays');
    const since = new Date(Date.now() - windowDays * 86_400_000);

    const tasks = await this.db.task.findMany({
      where: { assigneeId: taskerId, createdAt: { gte: since } },
      include: { reviews: true },
    });

    const closed = tasks.filter((t) => t.state === 'CLOSED');
    const reviewed = tasks.filter((t) => t.reviews.length > 0);
    const approved = reviewed.filter((t) => t.reviews.every((r) => r.outcome === 'PASS'));
    const reworked = tasks.filter((t) => t.reworkCount > 0);

    const submitMinutes = closed
      .filter((t) => t.acceptedAt && t.submittedAt)
      .map((t) => (t.submittedAt!.getTime() - t.acceptedAt!.getTime()) / 60_000)
      .sort((a, b) => a - b);
    const median = submitMinutes.length
      ? Math.round(submitMinutes[Math.floor(submitMinutes.length / 2)])
      : 0;

    const approvalRate = reviewed.length ? approved.length / reviewed.length : 0;
    const reworkRate = tasks.length ? reworked.length / tasks.length : 0;

    // Normalise each input to 0..1 before weighting, and invert the two where
    // lower is better, so the configured weights mean what they say.
    const closedNorm = Math.min(closed.length / 20, 1);
    const speedNorm = median > 0 ? Math.max(0, 1 - median / 480) : 0;
    const reworkNorm = 1 - reworkRate;

    const score =
      weights.approvalRate * approvalRate +
      weights.closedCount * closedNorm +
      weights.medianSubmitMinutes * speedNorm +
      weights.reworkRate * reworkNorm;

    return this.db.taskerStats.upsert({
      where: { taskerId },
      create: {
        taskerId,
        approvalRate,
        closedCount: closed.length,
        medianSubmitMinutes: median,
        reworkRate,
        score: Number(score.toFixed(4)),
        windowDays,
      },
      update: {
        approvalRate,
        closedCount: closed.length,
        medianSubmitMinutes: median,
        reworkRate,
        score: Number(score.toFixed(4)),
        windowDays,
        computedAt: new Date(),
      },
    });
  }

  async recomputeAll() {
    const taskers = await this.db.user.findMany({ where: { role: 'TASKER' }, select: { id: true } });
    for (const t of taskers) await this.recomputeStats(t.id);
    return { recomputed: taskers.length };
  }

  async detail(id: string) {
    const tasker = await this.db.user.findUnique({
      where: { id },
      include: {
        stats: true,
        certifications: { include: { specVersion: { include: { taskType: true } } } },
        incidents: true,
        tasks: {
          include: { taskType: true },
          orderBy: { createdAt: 'desc' },
          take: 25,
        },
      },
    });
    if (!tasker) throw new NotFoundException('No such tasker.');
    const { passwordHash, ...safe } = tasker as any;
    return safe;
  }

  /**
   * One person's record, audit-shaped: every task they submitted, the evidence
   * they attached, and what each gate decided. This is the answer to "what has
   * this person actually done", which is the question an admin opens a phone to ask.
   */
  async submissions(taskerId: string, page?: Page) {
    const tasker = await this.db.user.findUnique({
      where: { id: taskerId },
      select: { id: true, name: true, email: true, createdAt: true },
    });
    if (!tasker) throw new NotFoundException('No such tasker.');

    const tasks = await this.db.task.findMany({
      where: {
        assigneeId: taskerId,
        state: { in: ['SUBMITTED', 'IN_REVIEW', 'PENDING_VERIFICATION', 'REWORK', 'CLOSED'] },
      },
      include: {
        taskType: true,
        specVersion: { select: { version: true } },
        account: { select: { ref: true } },
        proofs: { orderBy: { receivedAt: 'asc' } },
        reviews: { orderBy: { decidedAt: 'asc' } },
      },
      orderBy: { submittedAt: 'desc' },
      ...paginate(page),
    });

    const total = await this.db.task.count({
      where: {
        assigneeId: taskerId,
        state: { in: ['SUBMITTED', 'IN_REVIEW', 'PENDING_VERIFICATION', 'REWORK', 'CLOSED'] },
      },
    });

    const [capacity, assignments] = await Promise.all([
      this.capacity.forTasker(taskerId),
      this.db.accountAssignment.findMany({
        where: { taskerId },
        orderBy: [{ collectedAt: { sort: 'desc', nulls: 'first' } }, { assignedAt: 'desc' }],
        include: { account: { select: { id: true, ref: true, label: true, accessType: true } } },
      }),
    ]);

    return {
      tasker,
      capacity,
      // Every account this person has been given, current first - their rows
      // from the People tab.
      accounts: assignments.map((a) => ({
        assignmentId: a.id,
        accountId: a.account.id,
        ref: a.account.ref,
        label: a.account.label,
        accessType: a.account.accessType,
        role: a.role,
        active: a.collectedAt === null,
        assignedAt: a.assignedAt,
        collectedAt: a.collectedAt,
      })),
      totals: {
        submitted: tasks.length,
        closed: tasks.filter((t) => t.state === 'CLOSED').length,
        reworked: tasks.filter((t) => t.reworkCount > 0).length,
        hours: tasks.reduce((sum, t) => sum + Number(t.hoursReported ?? 0), 0),
        flaggedHours: tasks.filter((t) => t.hoursFlagged).length,
      },
      page: page ? pageResult([], total, page) : null,
      submissions: tasks.map((t) => ({
        id: t.id,
        code: t.code,
        state: t.state,
        category: t.category,
        taskType: t.taskType.name,
        specVersion: t.specVersion.version,
        account: t.account?.ref ?? null,
        submittedAt: t.submittedAt,
        acceptedAt: t.acceptedAt,
        hoursReported: t.hoursReported,
        hoursFlagged: t.hoursFlagged,
        hoursFlagReason: t.hoursFlagReason,
        reworkCount: t.reworkCount,
        evidence: t.proofs.map((p) => ({
          id: p.id,
          checklistKey: p.checklistKey,
          url: `/proof/${p.id}/file`,
          receivedAt: p.receivedAt,
          duplicateOfId: p.duplicateOfId,
        })),
        gates: t.reviews.map((r) => ({
          stage: r.stage,
          outcome: r.outcome,
          reason: r.reason,
          note: r.note,
          decidedAt: r.decidedAt,
          // Who actually pressed the button, and on whose authority.
          actorId: r.actorId,
          onBehalfOfId: r.onBehalfOfId,
          channel: r.channel,
        })),
      })),
    };
  }

  /** Invite-only (section 22). The temporary password is shown once to the inviter. */
  async invite(input: {
    name: string;
    preferredName?: string;
    email: string;
    phone?: string;
    role?: 'TASKER' | 'SUB_ADMIN';
  }) {
    const email = input.email.toLowerCase().trim();
    const existing = await this.db.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException(`${email} is already on the team.`);
    }
    // Unambiguous characters only: it is read out or typed from a message.
    const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const tempPassword = Array.from(crypto.randomBytes(12), (b) => alphabet[b % alphabet.length]).join('');
    const user = await this.db.user.create({
      data: {
        name: input.name.trim(),
        preferredName: input.preferredName?.trim() || null,
        phone: input.phone?.trim() || null,
        email,
        role: input.role ?? 'TASKER',
        passwordHash: await bcrypt.hash(tempPassword, 10),
        mustChangePassword: true,
      },
      select: { id: true, name: true, preferredName: true, email: true, phone: true, role: true },
    });
    // Shown once to whoever invited them; never stored in readable form.
    return { ...user, tempPassword };
  }

  /**
   * The accounts given to this tasker right now, and since when. Only what they
   * need: which account, how they get in, its state. Login details stay behind
   * the reveal on their task.
   */
  async myAccounts(taskerId: string) {
    const rows = await this.db.accountAssignment.findMany({
      where: { taskerId, collectedAt: null },
      orderBy: { assignedAt: 'asc' },
      include: {
        account: {
          select: {
            id: true,
            ref: true,
            label: true,
            platform: true,
            accessType: true,
            state: true,
            cooldownUntil: true,
            secret: { select: { fields: true } },
          },
        },
      },
    });
    return rows.map((a) => ({
      accountId: a.account.id,
      ref: a.account.ref,
      label: a.account.label,
      platform: a.account.platform,
      accessType: a.account.accessType,
      state: a.account.state,
      cooldownUntil: a.account.cooldownUntil,
      hasLoginDetails: (a.account.secret?.fields.length ?? 0) > 0,
      role: a.role,
      assignedAt: a.assignedAt,
    }));
  }

  /** A tasker keeping their own contact details current. */
  async updateProfile(userId: string, input: { preferredName?: string; phone?: string }) {
    return this.db.user.update({
      where: { id: userId },
      data: {
        preferredName: input.preferredName?.trim() || null,
        phone: input.phone?.trim() || null,
      },
      select: { id: true, name: true, preferredName: true, email: true, phone: true },
    });
  }

  /** Section 8 - a request notifies assigners. It does not assign anything. */
  async requestWork(taskerId: string) {
    const windowStart = new Date(Date.now() - 60 * 60_000);
    const existing = await this.db.workRequest.findFirst({
      where: { taskerId, resolvedAt: null, requestedAt: { gte: windowStart } },
    });
    // Repeated requests inside the window collapse into one notification.
    if (existing) return { ...existing, collapsed: true };
    const created = await this.db.workRequest.create({ data: { taskerId } });
    return { ...created, collapsed: false };
  }

  openWorkRequests() {
    return this.db.workRequest.findMany({
      where: { resolvedAt: null },
      include: { tasker: { select: { id: true, name: true } } },
      orderBy: { requestedAt: 'asc' },
    });
  }
}
