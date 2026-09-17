import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequireCapability } from '../auth/auth.guard';
import { pageResult, parsePage } from '../common/pagination';

/**
 * The two work queues plus the one-screen summary the bot's /today renders.
 * Oldest first in both queues: age is the thing that hurts here.
 */
@Controller()
export class QueuesController {
  constructor(private readonly db: PrismaService) {}

  @Get('queues/review')
  @RequireCapability('review.internal')
  review() {
    return this.db.task.findMany({
      where: { state: 'IN_REVIEW' },
      include: {
        taskType: true,
        assignee: { select: { id: true, name: true } },
        specVersion: { select: { version: true } },
        _count: { select: { proofs: true } },
      },
      orderBy: { submittedAt: 'asc' },
    });
  }

  @Get('queues/verification')
  @RequireCapability('verdict.external')
  verification() {
    return this.db.task.findMany({
      where: { state: 'PENDING_VERIFICATION' },
      include: {
        taskType: true,
        assignee: { select: { id: true, name: true } },
        account: { select: { ref: true } },
        reviews: { where: { stage: 'INTERNAL' }, orderBy: { decidedAt: 'desc' }, take: 1 },
      },
      orderBy: { submittedAt: 'asc' },
    });
  }

  @Get('today')
  async today() {
    const [inReview, pendingVerification, inProgress, open, overdue, requests, flagged, freeAccounts] =
      await Promise.all([
        this.db.task.count({ where: { state: 'IN_REVIEW' } }),
        this.db.task.count({ where: { state: 'PENDING_VERIFICATION' } }),
        this.db.task.count({ where: { state: { in: ['IN_PROGRESS', 'REWORK'] } } }),
        this.db.task.count({ where: { state: { in: ['OPEN', 'ASSIGNED'] } } }),
        this.db.task.count({
          where: { dueAt: { lt: new Date() }, state: { notIn: ['CLOSED', 'CANCELLED', 'EXPIRED'] } },
        }),
        this.db.workRequest.count({ where: { resolvedAt: null } }),
        this.db.task.count({ where: { hoursFlagged: true } }),
        this.db.account.count({ where: { state: 'HEALTHY', holds: { none: { releasedAt: null } } } }),
      ]);

    return {
      inReview,
      pendingVerification,
      inProgress,
      open,
      overdue,
      workRequests: requests,
      hoursFlagged: flagged,
      freeAccounts,
    };
  }

  @Get('audit')
  async audit(@Query('page') page?: string, @Query('limit') limit?: string) {
    const p = parsePage(page, limit);
    const [items, total] = await Promise.all([
      this.db.taskEvent.findMany({
        include: { task: { select: { code: true, taskType: { select: { name: true } } } } },
        orderBy: { at: 'desc' },
        skip: (p.page - 1) * p.limit,
        take: p.limit,
      }),
      this.db.taskEvent.count(),
    ]);
    return pageResult(items, total, p);
  }
}
