import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TicketCategory, TicketPriority, TicketStatus } from '@prisma/client';
import { TicketsService } from './tickets.service';
import { TicketAlertsService } from './ticket-alerts.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser, RequireCapability, RequireRoles } from '../auth/auth.guard';
import { parsePage } from '../common/pagination';

@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly alerts: TicketAlertsService,
  ) {}

  /** A tasker's own tickets. Assigners get the whole queue. */
  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.tickets.list(
      {
        status: status ? (status.split(',') as TicketStatus[]) : undefined,
        taskerId: user.role === 'TASKER' ? user.id : undefined,
      },
      parsePage(page, limit),
    );
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tickets.get(user, id);
  }

  @Post()
  @RequireRoles('TASKER')
  async raise(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      category: TicketCategory;
      priority?: TicketPriority;
      subject: string;
      body: string;
      taskId?: string;
    },
  ) {
    const ticket = await this.tickets.raise(user, body);
    // Fire and forget: a Telegram outage must not fail the tasker's ticket.
    this.alerts.announce(ticket.id).catch(() => undefined);
    return ticket;
  }

  @Post(':id/claim')
  @RequireCapability('review.internal')
  async claim(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const result = await this.tickets.claim(user, id);
    if (result.won) {
      this.alerts.announceClaimed(id, user.name).catch(() => undefined);
    }
    return result;
  }

  @Post(':id/reply')
  reply(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body('body') body: string,
  ) {
    return this.tickets.reply(user, id, body);
  }

  @Post(':id/resolve')
  @RequireCapability('review.internal')
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body('resolution') resolution: string,
  ) {
    return this.tickets.resolve(user, id, resolution);
  }
}
