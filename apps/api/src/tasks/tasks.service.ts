import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Channel, Prisma, TaskState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../common/settings.service';
import { Page, paginate, pageResult } from '../common/pagination';
import { CapacityService } from '../taskers/capacity.service';
import { OnboardingService } from '../tutorials/onboarding.service';
import { VideoStorageService } from '../tutorials/video-storage.service';
import { VaultService } from '../vault/vault.service';
import { AuthUser } from '../auth/auth.guard';
import {
  HOLDING_STATES,
  afterSubmit,
  assertTransition,
  IllegalTransitionError,
} from './state-machine';

export interface ChecklistItem {
  key: string;
  label: string;
  requiresProof: boolean;
}

interface Actor {
  id: string | null;
  onBehalfOfId?: string | null;
  channel: Channel;
}

function actorOf(user: AuthUser, channel: Channel): Actor {
  return { id: user.id, onBehalfOfId: user.onBehalfOfId ?? null, channel };
}

const SYSTEM: Actor = { id: null, onBehalfOfId: null, channel: 'SYSTEM' };

@Injectable()
export class TasksService {
  constructor(
    private readonly db: PrismaService,
    private readonly settings: SettingsService,
    private readonly capacity: CapacityService,
    private readonly onboarding: OnboardingService,
    private readonly video: VideoStorageService,
  ) {}

  // ------------------------------------------------------------------
  // transition - the single write path for state. Invariant 6 lives here:
  // no transition exists without an event carrying actor, authority and
  // channel, including automated ones, which record the system as actor.
  // ------------------------------------------------------------------
  private async transition(
    tx: Prisma.TransactionClient,
    task: { id: string; state: TaskState; version: number },
    to: TaskState,
    actor: Actor,
    data: Prisma.TaskUncheckedUpdateManyInput = {},
    reason?: string,
  ) {
    assertTransition(task.state, to);

    // Optimistic concurrency: the version guard turns a lost update into a
    // refusal instead of a silent overwrite, and it is what makes a stale
    // Telegram callback detectable (section 15).
    const updated = await tx.task.updateMany({
      where: { id: task.id, version: task.version },
      data: { ...(data as any), state: to, version: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw new ConflictException('That task changed while you were looking at it.');
    }

    await tx.taskEvent.create({
      data: {
        taskId: task.id,
        fromState: task.state,
        toState: to,
        actorId: actor.id,
        onBehalfOfId: actor.onBehalfOfId ?? null,
        channel: actor.channel,
        reason,
      },
    });

    return tx.task.findUniqueOrThrow({ where: { id: task.id } });
  }

  private async load(id: string) {
    const task = await this.db.task.findUnique({
      where: { id },
      include: { specVersion: true, taskType: true, account: true, assignee: true, proofs: true },
    });
    if (!task) throw new NotFoundException('No such task.');
    return task;
  }

  /** Accepts either a cuid or a human task code (TSK-4471) - the bot uses codes. */
  async findByIdOrCode(user: AuthUser, idOrCode: string) {
    const byCode = idOrCode.toUpperCase().startsWith('TSK-');
    const task = await this.db.task.findFirst({
      where: byCode ? { code: idOrCode.toUpperCase() } : { id: idOrCode },
      include: {
        specVersion: { include: { tutorial: true } },
        taskType: true,
        account: { include: VaultService.publicInclude },
        assignee: true,
        proofs: { orderBy: { receivedAt: 'asc' } },
        reviews: { orderBy: { decidedAt: 'desc' } },
        events: { orderBy: { at: 'desc' }, take: 25 },
      },
    });
    if (!task) throw new NotFoundException('No such task.');
    // A tasker reads their own work only. Assigners read anything.
    if (user.role === 'TASKER' && task.assigneeId !== user.id) {
      throw new ForbiddenException('That task is not yours.');
    }
    const tutorial = task.specVersion.tutorial;
    return {
      ...task,
      assignee: task.assignee
        ? {
            id: task.assignee.id,
            name: task.assignee.name,
            preferredName: task.assignee.preferredName,
            email: task.assignee.email,
            phone: task.assignee.phone,
          }
        : null,
      account: task.account ? VaultService.publicShape(task.account) : null,
      specVersion: {
        ...task.specVersion,
        tutorial: tutorial ? this.video.playable(tutorial, user.id) : null,
      },
    };
  }

  // ------------------------------------------------------------------
  // Invariant 1 - the certification gate.
  // ------------------------------------------------------------------
  private async certifiedTaskerIds(specVersionId: string, candidateIds: string[]) {
    if (candidateIds.length === 0) return [];
    const certs = await this.db.certification.findMany({
      where: { specVersionId, supersededAt: null, taskerId: { in: candidateIds } },
      select: { taskerId: true },
    });
    return certs.map((c) => c.taskerId);
  }

  private async assertCertified(specVersionId: string, taskerIds: string[]) {
    const certified = await this.certifiedTaskerIds(specVersionId, taskerIds);
    const missing = taskerIds.filter((id) => !certified.includes(id));
    if (missing.length > 0) {
      const names = await this.db.user.findMany({
        where: { id: { in: missing } },
        select: { name: true },
      });
      const list = names.map((n) => n.name).join(', ');
      throw new ForbiddenException(
        `Not qualified on this spec version: ${list}. They have to watch its tutorial through first - that is what certifies them on it.`,
      );
    }
  }

  // ------------------------------------------------------------------
  // create
  // ------------------------------------------------------------------
  async create(
    user: AuthUser,
    channel: Channel,
    input: { taskTypeId: string; dueAt?: string | null },
  ) {
    const taskType = await this.db.taskType.findUnique({
      where: { id: input.taskTypeId },
      include: { specVersions: { where: { publishedAt: { not: null } }, orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!taskType) throw new NotFoundException('No such task type.');

    // Invariant 2 - the spec completeness gate. A task type with no published
    // spec, tutorial and quiz cannot produce a dispatchable task.
    const spec = taskType.specVersions[0];
    if (!spec) {
      throw new BadRequestException(
        `"${taskType.name}" has no published spec version yet. Attach a checklist and a tutorial on the console first.`,
      );
    }
    if (!spec.tutorialId) {
      throw new BadRequestException(
        `Spec v${spec.version} of "${taskType.name}" has no tutorial, so nobody can qualify for it. Attach one before dispatching.`,
      );
    }

    const code = await this.nextCode();
    const task = await this.db.task.create({
      data: {
        code,
        taskTypeId: taskType.id,
        // Invariant 5 - the task carries this spec version for its entire life.
        specVersionId: spec.id,
        category: taskType.category,
        state: 'DRAFT',
        createdById: user.id,
        createdVia: channel,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
      },
    });

    await this.db.taskEvent.create({
      data: {
        taskId: task.id,
        fromState: null,
        toState: 'DRAFT',
        actorId: user.id,
        onBehalfOfId: user.onBehalfOfId ?? null,
        channel,
      },
    });

    return task;
  }

  private async nextCode(): Promise<string> {
    // Sequential and human-sayable: an admin reads a code aloud from a phone.
    const count = await this.db.task.count();
    return `TSK-${4000 + count + 1}`;
  }

  // ------------------------------------------------------------------
  // assign / broadcast
  // ------------------------------------------------------------------
  async assign(user: AuthUser, channel: Channel, taskId: string, taskerId: string) {
    const task = await this.load(taskId);
    await this.assertCertified(task.specVersionId, [taskerId]);

    return this.db.$transaction(async (tx) => {
      const updated = await this.transition(
        tx,
        task,
        'ASSIGNED',
        actorOf(user, channel),
        { assigneeId: taskerId },
      );
      await tx.taskOffer.upsert({
        where: { taskId_taskerId: { taskId, taskerId } },
        create: { taskId, taskerId },
        update: { offeredAt: new Date(), respondedAt: null, outcome: null },
      });
      return updated;
    });
  }

  /**
   * Put a task in the open queue for every onboarded tasker. There is no
   * certification check here on purpose: taskers qualify by watching the
   * tutorial FROM the queue, so demanding certified taskers before a task can
   * appear there would leave every new task type unreachable. The gates still
   * hold - claiming checks onboarding and the watched tutorial.
   */
  async openToQueue(user: AuthUser, channel: Channel, taskId: string) {
    const task = await this.load(taskId);
    if (task.state === 'OPEN') return task;
    return this.db.$transaction((tx) =>
      this.transition(tx, task, 'OPEN', actorOf(user, channel), { assigneeId: null }, 'opened to queue'),
    );
  }

  async broadcast(user: AuthUser, channel: Channel, taskId: string, taskerIds: string[]) {
    const task = await this.load(taskId);
    if (taskerIds.length === 0) {
      throw new BadRequestException('Nobody is in that broadcast set.');
    }
    // Every tasker in the set must hold a valid certification for this exact
    // spec version - the gate is on the whole set, not on whoever accepts.
    await this.assertCertified(task.specVersionId, taskerIds);

    return this.db.$transaction(async (tx) => {
      const updated = await this.transition(tx, task, 'OPEN', actorOf(user, channel), {
        assigneeId: null,
      });
      for (const taskerId of taskerIds) {
        await tx.taskOffer.upsert({
          where: { taskId_taskerId: { taskId, taskerId } },
          create: { taskId, taskerId },
          update: { offeredAt: new Date(), respondedAt: null, outcome: null },
        });
      }
      return updated;
    });
  }

  /**
   * First acceptance wins. A single conditional UPDATE decides the race - a
   * check-then-write here would hand the same account to two taskers.
   * Zero rows affected means somebody else won, which is not an error.
   */
  async accept(user: AuthUser, channel: Channel, taskId: string) {
    const task = await this.load(taskId);

    // Gate 1 - the platform gate. Nothing is claimable until the onboarding
    // series has been watched through.
    await this.onboarding.assertComplete(user.id);

    // Gate 2 - the task gate. Watching this spec version's tutorial is what
    // certifies them on it, so an uncertified claim means an unwatched video.
    const certified = await this.db.certification.findFirst({
      where: { taskerId: user.id, specVersionId: task.specVersionId, supersededAt: null },
    });
    if (!certified) {
      throw new ForbiddenException(
        'Watch the tutorial for this task before claiming it. It shows how the work is done.',
      );
    }

    if (task.state === 'ASSIGNED' && task.assigneeId !== user.id) {
      // Losing a broadcast race is not an error. If this tasker was offered the
      // task, somebody else simply got there first and the card just goes away.
      // Only a tasker who was never offered it gets told off.
      await this.db.taskOffer.updateMany({
        where: { taskId, taskerId: user.id },
        data: { respondedAt: new Date(), outcome: 'lost' },
      });
      return { won: false, reason: 'already-taken' as const, task };
    }
    if (task.state !== 'OPEN' && task.state !== 'ASSIGNED') {
      return { won: false, reason: 'already-taken' as const, task };
    }

    // Invariant 4, checked BEFORE the claim. Claiming first and discovering the
    // tasker is already busy afterwards would strand the task in ASSIGNED under
    // somebody who cannot work it, which is worse than refusing up front.
    await this.assertHasCapacity(user.id, taskId);

    // The atomic claim. state is in the WHERE clause, so exactly one racer wins.
    const claimed = await this.db.task.updateMany({
      where: { id: taskId, state: task.state },
      data: {
        state: 'ASSIGNED',
        assigneeId: user.id,
        version: { increment: 1 },
      },
    });

    if (claimed.count === 0) {
      await this.db.taskOffer.updateMany({
        where: { taskId, taskerId: user.id },
        data: { respondedAt: new Date(), outcome: 'lost' },
      });
      return { won: false, reason: 'already-taken' as const, task };
    }

    await this.db.taskEvent.create({
      data: {
        taskId,
        fromState: task.state,
        toState: 'ASSIGNED',
        actorId: user.id,
        channel,
        reason: 'accepted',
      },
    });
    await this.db.taskOffer.updateMany({
      where: { taskId, taskerId: user.id },
      data: { respondedAt: new Date(), outcome: 'accepted' },
    });
    // Everyone else in the broadcast set lost the race.
    await this.db.taskOffer.updateMany({
      where: { taskId, taskerId: { not: user.id }, respondedAt: null },
      data: { respondedAt: new Date(), outcome: 'lost' },
    });

    // Acceptance and start are one gesture for the tasker: claim, then check out.
    try {
      const started = await this.start(user, channel, taskId);
      return { won: true, task: started };
    } catch (e) {
      // Checkout can still fail on something the pre-check cannot see - no free
      // account, or another racer taking the last one. Give the task back
      // rather than leaving it claimed by a tasker who never started it.
      await this.db.task.updateMany({
        where: { id: taskId, state: 'ASSIGNED', assigneeId: user.id },
        data: { state: task.state, assigneeId: task.assigneeId, version: { increment: 1 } },
      });
      await this.db.taskOffer.updateMany({
        where: { taskId, taskerId: user.id },
        data: { respondedAt: null, outcome: null },
      });
      await this.db.taskEvent.create({
        data: {
          taskId,
          fromState: 'ASSIGNED',
          toState: task.state,
          actorId: null,
          channel: 'SYSTEM',
          reason: 'checkout failed, acceptance reverted',
        },
      });
      throw e;
    }
  }

  /**
   * The hold limit is EARNED, not fixed. A tasker starts at one task and the
   * ceiling rises with approved work, so this asks CapacityService rather than
   * counting to one. The refusal quotes the rule back at them.
   */
  private async assertHasCapacity(taskerId: string, exceptTaskId: string) {
    const capacity = await this.capacity.forTasker(taskerId);
    const holdingOther = await this.db.task.count({
      where: { assigneeId: taskerId, state: { in: HOLDING_STATES }, id: { not: exceptTaskId } },
    });
    if (holdingOther >= capacity.limit) {
      throw new ConflictException(capacity.reason);
    }
  }

  // ------------------------------------------------------------------
  // start - checks out the account
  // ------------------------------------------------------------------
  async start(user: AuthUser, channel: Channel, taskId: string) {
    const task = await this.load(taskId);
    if (task.assigneeId !== user.id) {
      throw new ForbiddenException('That task is not yours.');
    }

    await this.assertHasCapacity(user.id, taskId);

    const account = await this.pickAccount();

    return this.db.$transaction(async (tx) => {
      const updated = await this.transition(
        tx,
        task,
        'IN_PROGRESS',
        actorOf(user, channel),
        { acceptedAt: new Date(), accountId: account.id },
      );
      try {
        // Invariant 3 - exclusivity is the partial unique index's job. If a
        // second hold slips through a race, the INSERT fails and we say so.
        await tx.accountHold.create({
          data: { accountId: account.id, taskId, taskerId: user.id },
        });
      } catch (e: any) {
        if (e?.code === 'P2002') {
          throw new ConflictException('That account was just checked out by somebody else.');
        }
        throw e;
      }
      return updated;
    });
  }

  /** An account with no open hold, not cooling down, healthy. */
  private async pickAccount() {
    const account = await this.db.account.findFirst({
      where: {
        state: 'HEALTHY',
        OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: new Date() } }],
        holds: { none: { releasedAt: null } },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!account) {
      throw new ConflictException('No account is free right now. An assigner needs to free one up.');
    }
    return account;
  }

  // ------------------------------------------------------------------
  // submit
  // ------------------------------------------------------------------
  async submit(
    user: AuthUser,
    channel: Channel,
    taskId: string,
    input: { hoursReported?: number | null },
  ) {
    const task = await this.load(taskId);
    if (task.assigneeId !== user.id) throw new ForbiddenException('That task is not yours.');

    const checklist = (task.specVersion.checklist as unknown as ChecklistItem[]) ?? [];
    const required = checklist.filter((c) => c.requiresProof).map((c) => c.key);
    const filled = new Set(task.proofs.map((p) => p.checklistKey));
    const missing = required.filter((k) => !filled.has(k));

    if (missing.length > 0) {
      // Name the slots. A submission refused without saying which slot is empty
      // is the same as a disabled button - it explains nothing.
      const labels = checklist.filter((c) => missing.includes(c.key)).map((c) => c.label);
      throw new BadRequestException({
        message: `Missing proof for: ${labels.join(', ')}`,
        missingKeys: missing,
      });
    }

    let hoursFlagged = false;
    let hoursFlagReason: string | null = null;

    if (task.category === 'STANDARD') {
      if (input.hoursReported == null) {
        throw new BadRequestException('Enter the hours you worked.');
      }
      const flags = await this.evaluateHours(task, input.hoursReported);
      hoursFlagged = flags.flagged;
      hoursFlagReason = flags.reason;
    }

    const next = afterSubmit(task.category);

    return this.db.$transaction(async (tx) => {
      const submitted = await this.transition(tx, task, 'SUBMITTED', actorOf(user, channel), {
        submittedAt: new Date(),
        hoursReported: input.hoursReported ?? null,
        hoursFlagged,
        hoursFlagReason,
      });

      // Standard closes immediately and automatically: no human acts on it
      // after submission, so the system is the actor on that transition.
      if (next === 'CLOSED') {
        await this.releaseHold(tx, taskId);
        return this.transition(tx, submitted, 'CLOSED', SYSTEM, {}, 'standard task auto-closed');
      }
      return this.transition(tx, submitted, 'IN_REVIEW', SYSTEM, {}, 'awaiting internal review');
    });
  }

  /**
   * Section 13 - both mitigations are advisory. A flagged submission still
   * closes; the flag surfaces in the record rather than introducing the
   * approval step the category exists to avoid.
   */
  private async evaluateHours(task: { acceptedAt: Date | null; taskTypeId: string }, hours: number) {
    if (task.acceptedAt) {
      const elapsedHours = (Date.now() - task.acceptedAt.getTime()) / 3_600_000;
      if (hours > elapsedHours) {
        return {
          flagged: true,
          reason: `Reported ${hours}h but only ${elapsedHours.toFixed(1)}h elapsed since acceptance.`,
        };
      }
    }
    const multiple = await this.settings.get('hours.medianMultipleFlag');
    const recent = await this.db.task.findMany({
      where: { taskTypeId: task.taskTypeId, hoursReported: { not: null }, state: 'CLOSED' },
      select: { hoursReported: true },
      take: 50,
      orderBy: { submittedAt: 'desc' },
    });
    if (recent.length >= 5) {
      const values = recent.map((r) => Number(r.hoursReported)).sort((a, b) => a - b);
      const median = values[Math.floor(values.length / 2)];
      if (median > 0 && hours > median * multiple) {
        return {
          flagged: true,
          reason: `Reported ${hours}h against a ${median}h median for this task type.`,
        };
      }
    }
    return { flagged: false, reason: null };
  }

  // ------------------------------------------------------------------
  // review - internal gate
  // ------------------------------------------------------------------
  async review(
    user: AuthUser,
    channel: Channel,
    taskId: string,
    input: { outcome: 'PASS' | 'FAIL'; note?: string; citedProofId?: string; reason?: string },
  ) {
    const task = await this.load(taskId);
    if (task.state !== 'IN_REVIEW') {
      throw new BadRequestException(`That task is ${task.state}, not awaiting internal review.`);
    }

    return this.db.$transaction(async (tx) => {
      await tx.review.create({
        data: {
          taskId,
          stage: 'INTERNAL',
          outcome: input.outcome,
          actorId: user.id,
          onBehalfOfId: user.onBehalfOfId ?? null,
          channel,
          note: input.note,
          citedProofId: input.citedProofId,
          reason: input.reason,
        },
      });

      if (input.outcome === 'PASS') {
        // The hold counter releases here, not at close, so review lag never
        // blocks the tasker from picking up their next task.
        await this.releaseHold(tx, taskId);
        return this.transition(
          tx,
          task,
          'PENDING_VERIFICATION',
          actorOf(user, channel),
          {},
          input.note,
        );
      }
      return this.sendBack(tx, task, actorOf(user, channel), input.reason ?? input.note);
    });
  }

  // ------------------------------------------------------------------
  // verify - external gate
  // ------------------------------------------------------------------
  async verify(
    user: AuthUser,
    channel: Channel,
    taskId: string,
    input: { outcome: 'PASS' | 'FAIL'; reason?: string; citedProofId?: string; note?: string },
  ) {
    const task = await this.load(taskId);
    if (task.state !== 'PENDING_VERIFICATION') {
      throw new BadRequestException(`That task is ${task.state}, not awaiting an external verdict.`);
    }
    if (input.outcome === 'FAIL' && !input.reason) {
      throw new BadRequestException('A failed verdict needs a reason.');
    }

    return this.db.$transaction(async (tx) => {
      await tx.review.create({
        data: {
          taskId,
          stage: 'EXTERNAL',
          outcome: input.outcome,
          actorId: user.id,
          onBehalfOfId: user.onBehalfOfId ?? null,
          channel,
          reason: input.reason,
          citedProofId: input.citedProofId,
          note: input.note,
        },
      });

      if (input.outcome === 'PASS') {
        await this.releaseHold(tx, taskId);
        return this.transition(tx, task, 'CLOSED', actorOf(user, channel), {}, input.note);
      }

      // Interrupting rework (section 8): the tasker may already hold a new
      // task. The rework takes priority and the current one is displaced.
      if (task.assigneeId) {
        const active = await tx.task.findFirst({
          where: {
            assigneeId: task.assigneeId,
            state: { in: HOLDING_STATES },
            id: { not: taskId },
          },
        });
        if (active) {
          await this.transition(
            tx,
            active,
            'PAUSED',
            SYSTEM,
            { pausedForTaskId: taskId },
            `displaced by rework on ${task.code}`,
          );
          // Its account hold is deliberately retained - this is the one case
          // where a tasker holds two accounts, and the account view must show it.
        }
      }

      return this.sendBack(tx, task, actorOf(user, channel), input.reason);
    });
  }

  /** Back to the same tasker, on the same account. */
  private async sendBack(
    tx: Prisma.TransactionClient,
    task: { id: string; state: TaskState; version: number; accountId: string | null; assigneeId: string | null; reworkCount: number },
    actor: Actor,
    reason?: string,
  ) {
    const max = await this.settings.get('rework.maxCycles');
    if (task.reworkCount >= max) {
      throw new ConflictException(
        `This task has already been reworked ${task.reworkCount} times. Cancel it and respecify instead.`,
      );
    }

    // Re-open the hold if internal review released it.
    if (task.accountId && task.assigneeId) {
      const open = await tx.accountHold.findFirst({
        where: { taskId: task.id, releasedAt: null },
      });
      if (!open) {
        await tx.accountHold.create({
          data: { accountId: task.accountId, taskId: task.id, taskerId: task.assigneeId },
        });
      }
    }

    return this.transition(
      tx,
      task,
      'REWORK',
      actor,
      { reworkCount: { increment: 1 } },
      reason,
    );
  }

  /** The tasker acknowledges a rework and resumes on the same account. */
  async acknowledgeRework(user: AuthUser, channel: Channel, taskId: string) {
    const task = await this.load(taskId);
    if (task.assigneeId !== user.id) throw new ForbiddenException('That task is not yours.');
    return this.db.$transaction((tx) =>
      this.transition(tx, task, 'IN_PROGRESS', actorOf(user, channel), {}, 'rework acknowledged'),
    );
  }

  // ------------------------------------------------------------------
  // release / cancel
  // ------------------------------------------------------------------
  async release(
    user: AuthUser,
    channel: Channel,
    taskId: string,
    input: { reason: string; progressNote?: string },
  ) {
    const task = await this.load(taskId);
    if (task.assigneeId !== user.id) throw new ForbiddenException('That task is not yours.');

    // Blameless by construction: releasing records a reason and returns the
    // account immediately. Partial proof stays attached to the task.
    return this.db.$transaction(async (tx) => {
      await this.releaseHold(tx, taskId);
      return this.transition(
        tx,
        task,
        'OPEN',
        actorOf(user, channel),
        {
          assigneeId: null,
          accountId: null,
          releaseReason: input.reason,
          acceptedAt: null,
        },
        input.progressNote ? `${input.reason}: ${input.progressNote}` : input.reason,
      );
    });
  }

  async cancel(user: AuthUser, channel: Channel, taskId: string, reason?: string) {
    const task = await this.load(taskId);
    return this.db.$transaction(async (tx) => {
      await this.releaseHold(tx, taskId);
      return this.transition(tx, task, 'CANCELLED', actorOf(user, channel), {}, reason);
    });
  }

  private async releaseHold(tx: Prisma.TransactionClient, taskId: string) {
    await tx.accountHold.updateMany({
      where: { taskId, releasedAt: null },
      data: { releasedAt: new Date() },
    });
  }

  // ------------------------------------------------------------------
  // queries
  // ------------------------------------------------------------------
  async list(
    filter: { state?: TaskState[]; assigneeId?: string; taskTypeId?: string },
    page?: Page,
  ) {
    const where = {
        ...(filter.state?.length ? { state: { in: filter.state } } : {}),
        ...(filter.assigneeId ? { assigneeId: filter.assigneeId } : {}),
      ...(filter.taskTypeId ? { taskTypeId: filter.taskTypeId } : {}),
    };

    const [items, total] = await Promise.all([
      this.db.task.findMany({
        where,
        include: {
          taskType: true,
          assignee: { select: { id: true, name: true } },
          account: { select: { id: true, ref: true, state: true } },
          specVersion: { select: { version: true } },
          _count: { select: { proofs: true } },
        },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
        ...paginate(page),
      }),
      this.db.task.count({ where }),
    ]);

    return page ? pageResult(items, total, page) : { items, total, page: 1, limit: total, pageCount: 1 };
  }

  /**
   * What a tasker sees before claiming: the work, the steps it involves, and
   * the video that unlocks it. One call, because the claim screen should not
   * have to stitch three responses together to decide whether to show a button.
   */
  async previewForTasker(taskerId: string, taskId: string) {
    const task = await this.db.task.findUnique({
      where: { id: taskId },
      include: {
        taskType: true,
        specVersion: { include: { tutorial: true } },
        assignee: { select: { id: true, name: true } },
      },
    });
    if (!task) throw new NotFoundException('No such task.');

    const tutorial = task.specVersion.tutorial;
    const [progress, certified, capacity, onboarding] = await Promise.all([
      tutorial
        ? this.db.tutorialProgress.findUnique({
            where: { taskerId_tutorialId: { taskerId, tutorialId: tutorial.id } },
          })
        : Promise.resolve(null),
      this.db.certification.findFirst({
        where: { taskerId, specVersionId: task.specVersionId, supersededAt: null },
      }),
      this.capacity.forTasker(taskerId),
      this.onboarding.forTasker(taskerId),
    ]);

    const watched = !!certified || (progress?.completed ?? false);
    const takenByOther = task.assigneeId != null && task.assigneeId !== taskerId;

    return {
      id: task.id,
      code: task.code,
      state: task.state,
      category: task.category,
      dueAt: task.dueAt,
      taskType: { id: task.taskTypeId, name: task.taskType.name },
      specVersion: { id: task.specVersionId, version: task.specVersion.version },
      checklist: (task.specVersion.checklist as any[]) ?? [],
      mine: task.assigneeId === taskerId,
      takenByOther,
      tutorial: tutorial
        ? {
            id: tutorial.id,
            title: tutorial.title,
            description: tutorial.description,
            streamUrl: this.video.playbackPath(tutorial.id, taskerId),
            durationSeconds: tutorial.durationSeconds,
            furthestSeconds: progress?.furthestSeconds ?? 0,
            completed: watched,
          }
        : null,
      capacity,
      onboardingComplete: onboarding.complete,
      canClaim:
        onboarding.complete && watched && capacity.canClaim && !takenByOther && task.state === 'OPEN',
      blockedBy: !onboarding.complete
        ? ('onboarding' as const)
        : takenByOther || task.state !== 'OPEN'
          ? ('taken' as const)
          : !watched
            ? ('tutorial' as const)
            : !capacity.canClaim
              ? ('capacity' as const)
              : null,
    };
  }

  /**
   * A tasker's own history, paginated - with totals computed across ALL of it,
   * not just the page. Totals that quietly mean "this page" would be wrong on
   * the one screen where somebody checks what they are owed.
   */
  async historyForTasker(taskerId: string, page: Page) {
    const where = {
      assigneeId: taskerId,
      state: { in: ['SUBMITTED', 'IN_REVIEW', 'PENDING_VERIFICATION', 'CLOSED', 'CANCELLED', 'EXPIRED'] as TaskState[] },
    };

    const [items, total, closed, hours, flagged] = await Promise.all([
      this.db.task.findMany({
        where,
        include: {
          taskType: { select: { name: true } },
          specVersion: { select: { version: true } },
        },
        orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
        ...paginate(page),
      }),
      this.db.task.count({ where }),
      this.db.task.count({ where: { assigneeId: taskerId, state: 'CLOSED' } }),
      this.db.task.aggregate({
        where: { assigneeId: taskerId, hoursReported: { not: null } },
        _sum: { hoursReported: true },
      }),
      this.db.task.count({ where: { assigneeId: taskerId, hoursFlagged: true } }),
    ]);

    return {
      ...pageResult(items, total, page),
      totals: {
        finished: closed,
        hours: Number(hours._sum.hoursReported ?? 0),
        flagged,
      },
    };
  }

  /** Everything this tasker is currently holding. The ceiling is earned. */
  async activeTasksForTasker(taskerId: string) {
    const tasks = await this.db.task.findMany({
      where: {
        assigneeId: taskerId,
        state: { in: ['ASSIGNED', 'IN_PROGRESS', 'REWORK', 'PAUSED'] },
      },
      include: {
        taskType: true,
        specVersion: { include: { tutorial: true } },
        // The details the admin loaded, minus the login values themselves -
        // those stay behind a reveal that writes an audit row.
        account: { include: VaultService.publicInclude },
        proofs: true,
        reviews: { orderBy: { decidedAt: 'desc' }, take: 3 },
      },
      orderBy: [{ state: 'asc' }, { dueAt: 'asc' }],
    });

    return tasks.map((t) => ({
      ...t,
      account: t.account ? VaultService.publicShape(t.account) : null,
      specVersion: {
        ...t.specVersion,
        tutorial: t.specVersion.tutorial
          ? this.video.playable(t.specVersion.tutorial, taskerId)
          : null,
      },
    }));
  }

  /**
   * The task queue. Every unclaimed task is visible to every onboarded tasker,
   * plus anything pushed directly to them. Each row carries its own gate state
   * so the surface can show WHY a task is not claimable yet rather than hiding
   * it - a hidden task looks like no work available.
   */
  async availableForTasker(taskerId: string) {
    const [tasks, certs, progress, capacity, onboarding] = await Promise.all([
      this.db.task.findMany({
        where: {
          OR: [
            { state: 'OPEN' },
            { state: 'ASSIGNED', assigneeId: taskerId },
          ],
        },
        include: {
          taskType: true,
          specVersion: { include: { tutorial: true } },
        },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
      }),
      this.db.certification.findMany({
        where: { taskerId, supersededAt: null },
        select: { specVersionId: true },
      }),
      this.db.tutorialProgress.findMany({ where: { taskerId } }),
      this.capacity.forTasker(taskerId),
      this.onboarding.forTasker(taskerId),
    ]);

    const certified = new Set(certs.map((c) => c.specVersionId));
    const watched = new Map(progress.map((p) => [p.tutorialId, p]));

    return {
      capacity,
      onboarding: { complete: onboarding.complete, remaining: onboarding.totalCount - onboarding.completedCount },
      tasks: tasks.map((t) => {
        const tutorial = t.specVersion.tutorial;
        const p = tutorial ? watched.get(tutorial.id) : undefined;
        const tutorialWatched = certified.has(t.specVersionId) || (p?.completed ?? false);

        return {
          id: t.id,
          code: t.code,
          state: t.state,
          category: t.category,
          dueAt: t.dueAt,
          taskType: { id: t.taskTypeId, name: t.taskType.name },
          specVersion: { id: t.specVersionId, version: t.specVersion.version },
          checklistLength: ((t.specVersion.checklist as any[]) ?? []).length,
          // Pushed to them by an assigner rather than open to everyone.
          forYou: t.state === 'ASSIGNED',
          tutorial: tutorial
            ? {
                id: tutorial.id,
                title: tutorial.title,
                durationSeconds: tutorial.durationSeconds,
                furthestSeconds: p?.furthestSeconds ?? 0,
                watched: tutorialWatched,
              }
            : null,
          canClaim: onboarding.complete && tutorialWatched && capacity.canClaim,
          blockedBy: !onboarding.complete
            ? ('onboarding' as const)
            : !tutorialWatched
              ? ('tutorial' as const)
              : !capacity.canClaim
                ? ('capacity' as const)
                : null,
        };
      }),
    };
  }

  handleError(e: unknown) {
    if (e instanceof IllegalTransitionError) throw new BadRequestException(e.message);
    throw e;
  }
}
