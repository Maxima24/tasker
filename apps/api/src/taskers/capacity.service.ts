import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../common/settings.service';
import { HOLDING_STATES } from '../tasks/state-machine';

export interface Capacity {
  /** How many tasks this tasker may hold at once, right now. */
  limit: number;
  /** How many they are holding. */
  holding: number;
  canClaim: boolean;
  /** Closed work behind the current ceiling. */
  closedCount: number;
  reviewedCount: number;
  approvalRate: number;
  /** True when the approval floor has pulled the ceiling down. */
  limited: boolean;
  /** How many more closed tasks until the ceiling rises, null once at max. */
  nextTierAt: number | null;
  /** Said plainly, because a tasker who cannot claim deserves to know why. */
  reason: string;
}

/**
 * Concurrency is EARNED, not configured per person.
 *
 * Everyone starts at one task. Submitting work that gets approved raises the
 * ceiling in steps. Letting the approval ratio fall under the floor drops it
 * back until the record is rebuilt. The whole rule is derived from the
 * tasker's own history, so nobody has to be trusted to set it fairly.
 */
@Injectable()
export class CapacityService {
  constructor(
    private readonly db: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async forTasker(taskerId: string): Promise<Capacity> {
    const [base, max, tiers, floor, limitedTo, minReviewed] = await Promise.all([
      this.settings.get('concurrency.base'),
      this.settings.get('concurrency.max'),
      this.settings.get('concurrency.tiers'),
      this.settings.get('concurrency.approvalFloor'),
      this.settings.get('concurrency.limitedTo'),
      this.settings.get('concurrency.minReviewedToPenalise'),
    ]);

    const tasks = await this.db.task.findMany({
      where: { assigneeId: taskerId },
      select: { state: true, reviews: { select: { outcome: true } } },
    });

    const closedCount = tasks.filter((t) => t.state === 'CLOSED').length;
    const holding = tasks.filter((t) => HOLDING_STATES.includes(t.state)).length;

    // A task counts as approved only if nothing ever failed it - a task that
    // passed on its third attempt is not the same as one that passed first time.
    const reviewed = tasks.filter((t) => t.reviews.length > 0);
    const approved = reviewed.filter((t) => t.reviews.every((r) => r.outcome === 'PASS'));
    const reviewedCount = reviewed.length;
    const approvalRate = reviewedCount > 0 ? approved.length / reviewedCount : 1;

    let limit = base;
    for (const threshold of tiers) {
      if (closedCount >= threshold) limit += 1;
    }
    limit = Math.min(limit, max);

    const earnedLimit = limit;
    const limited = reviewedCount >= minReviewed && approvalRate < floor;
    if (limited) limit = Math.min(limitedTo, earnedLimit);

    const nextThreshold = tiers.find((t) => closedCount < t) ?? null;
    const nextTierAt = limit >= max || nextThreshold === null ? null : nextThreshold - closedCount;

    return {
      limit,
      holding,
      canClaim: holding < limit,
      closedCount,
      reviewedCount,
      approvalRate,
      limited,
      nextTierAt,
      reason: this.explain({
        limit,
        holding,
        limited,
        approvalRate,
        floor,
        nextTierAt,
        closedCount,
        max,
      }),
    };
  }

  private explain(x: {
    limit: number;
    holding: number;
    limited: boolean;
    approvalRate: number;
    floor: number;
    nextTierAt: number | null;
    closedCount: number;
    max: number;
  }): string {
    if (x.limited) {
      return `Your approval rate is ${Math.round(x.approvalRate * 100)}%, under the ${Math.round(
        x.floor * 100,
      )}% floor, so you are back to ${x.limit} task at a time until it recovers.`;
    }
    if (x.holding >= x.limit) {
      return `You are holding ${x.holding} of ${x.limit}. Submit one to free a slot.`;
    }
    if (x.closedCount === 0) {
      return 'Everyone starts with one task. Submit it and get it approved to unlock a second.';
    }
    if (x.nextTierAt !== null) {
      return `You can hold ${x.limit} at once. ${x.nextTierAt} more approved ${
        x.nextTierAt === 1 ? 'task' : 'tasks'
      } raises that to ${x.limit + 1}.`;
    }
    return `You are at the maximum of ${x.max} tasks at a time.`;
  }
}
