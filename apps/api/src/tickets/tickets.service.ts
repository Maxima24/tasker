import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TicketCategory, TicketPriority, TicketStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.guard';
import { paginate, pageResult, Page } from '../common/pagination';
import { VaultService } from '../vault/vault.service';

/**
 * Tickets carry context, not conversation.
 *
 * A tasker raises one when something blocks them. The ticket automatically
 * picks up the task they are on, the account it is running against, and their
 * own contact details, because an admin who has to ask "which account?" before
 * they can help has already lost the time the ticket was meant to save.
 *
 * What it deliberately does NOT carry is the credential itself. The reference
 * travels; revealing goes through the vault, so the audit row still gets
 * written naming who looked and when.
 */
@Injectable()
export class TicketsService {
  constructor(private readonly db: PrismaService) {}

  private async nextCode(): Promise<string> {
    const count = await this.db.ticket.count();
    return `TKT-${100 + count + 1}`;
  }

  async raise(
    user: AuthUser,
    input: {
      category: TicketCategory;
      priority?: TicketPriority;
      subject: string;
      body: string;
      taskId?: string;
    },
  ) {
    if (!input.subject?.trim()) throw new BadRequestException('Give the ticket a subject.');
    if (!input.body?.trim()) throw new BadRequestException('Describe what went wrong.');

    // Attach whatever they are working on, so the admin does not have to ask.
    const task = input.taskId
      ? await this.db.task.findFirst({
          where: { id: input.taskId, assigneeId: user.id },
          select: { id: true, accountId: true },
        })
      : await this.db.task.findFirst({
          where: {
            assigneeId: user.id,
            state: { in: ['IN_PROGRESS', 'REWORK', 'PAUSED', 'ASSIGNED'] },
          },
          select: { id: true, accountId: true },
          orderBy: { acceptedAt: 'desc' },
        });

    const ticket = await this.db.ticket.create({
      data: {
        code: await this.nextCode(),
        taskerId: user.id,
        taskId: task?.id ?? null,
        accountId: task?.accountId ?? null,
        category: input.category,
        priority: input.priority ?? 'NORMAL',
        subject: input.subject.trim(),
        body: input.body.trim(),
      },
      include: this.fullInclude(),
    });

    return this.shape(ticket);
  }

  async list(filter: { status?: TicketStatus[]; taskerId?: string }, page?: Page) {
    const where: Prisma.TicketWhereInput = {
      ...(filter.status?.length ? { status: { in: filter.status } } : {}),
      ...(filter.taskerId ? { taskerId: filter.taskerId } : {}),
    };

    const [rows, total] = await Promise.all([
      this.db.ticket.findMany({
        where,
        include: this.fullInclude(),
        // Urgent first, then oldest - a queue sorted newest-first buries the
        // thing that has been waiting longest, which is the thing that hurts.
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        ...paginate(page),
      }),
      this.db.ticket.count({ where }),
    ]);

    return pageResult(rows.map((t) => this.shape(t)), total, page ?? { page: 1, limit: rows.length || 1 });
  }

  async get(user: AuthUser, id: string) {
    const ticket = await this.db.ticket.findFirst({
      where: { OR: [{ id }, { code: id.toUpperCase() }] },
      include: this.fullInclude(),
    });
    if (!ticket) throw new NotFoundException('No such ticket.');
    if (user.role === 'TASKER' && ticket.taskerId !== user.id) {
      throw new ForbiddenException('That ticket is not yours.');
    }
    return this.shape(ticket);
  }

  /** Claiming stops the alerts for everyone and says who took it. */
  async claim(user: AuthUser, id: string) {
    const ticket = await this.db.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('No such ticket.');

    // Conditional update: two people tapping Claim at once is a race, and the
    // second one should be told who won rather than silently overwriting them.
    const claimed = await this.db.ticket.updateMany({
      where: { id, status: 'OPEN' },
      data: { status: 'CLAIMED', claimedById: user.id, claimedAt: new Date() },
    });

    if (claimed.count === 0) {
      const current = await this.db.ticket.findUnique({
        where: { id },
        include: { claimedBy: { select: { name: true } } },
      });
      return {
        won: false,
        claimedBy: current?.claimedBy?.name ?? 'somebody else',
        status: current?.status,
      };
    }

    return { won: true };
  }

  async reply(user: AuthUser, id: string, body: string) {
    if (!body?.trim()) throw new BadRequestException('Write something first.');
    const ticket = await this.db.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('No such ticket.');
    if (user.role === 'TASKER' && ticket.taskerId !== user.id) {
      throw new ForbiddenException('That ticket is not yours.');
    }

    return this.db.ticketMessage.create({
      data: { ticketId: id, authorId: user.id, body: body.trim() },
      include: { author: { select: { id: true, name: true, role: true } } },
    });
  }

  async resolve(user: AuthUser, id: string, resolution: string) {
    if (!resolution?.trim()) {
      throw new BadRequestException('Say what fixed it, so the next person can skip the digging.');
    }
    const ticket = await this.db.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('No such ticket.');

    return this.db.ticket.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolution: resolution.trim(),
        claimedById: ticket.claimedById ?? user.id,
        claimedAt: ticket.claimedAt ?? new Date(),
      },
    });
  }

  async openCount() {
    return this.db.ticket.count({ where: { status: 'OPEN' } });
  }

  private fullInclude() {
    return {
      tasker: {
        select: { id: true, name: true, preferredName: true, email: true, phone: true },
      },
      claimedBy: { select: { id: true, name: true } },
      task: {
        select: {
          id: true,
          code: true,
          state: true,
          taskType: { select: { name: true } },
        },
      },
      account: { include: VaultService.publicInclude },
      messages: {
        include: { author: { select: { id: true, name: true, role: true } } },
        orderBy: { createdAt: 'asc' as const },
      },
    };
  }

  /** Flattened for the surfaces, with the credential deliberately absent. */
  private shape(t: any) {
    return {
      id: t.id,
      code: t.code,
      category: t.category,
      priority: t.priority,
      subject: t.subject,
      body: t.body,
      status: t.status,
      createdAt: t.createdAt,
      claimedAt: t.claimedAt,
      claimedBy: t.claimedBy,
      resolvedAt: t.resolvedAt,
      resolution: t.resolution,
      alertCount: t.alertCount,
      // Everything an admin needs to act without asking a single question.
      raisedBy: {
        id: t.tasker.id,
        name: t.tasker.preferredName || t.tasker.name,
        fullName: t.tasker.name,
        email: t.tasker.email,
        phone: t.tasker.phone,
      },
      task: t.task
        ? {
            id: t.task.id,
            code: t.task.code,
            state: t.task.state,
            taskType: t.task.taskType.name,
          }
        : null,
      // Reference only. Revealing runs through the vault and writes its own row.
      account: t.account ? VaultService.publicShape(t.account) : null,
      messages: t.messages ?? [],
    };
  }
}
