import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotifierService, Alert } from '../common/notifier.service';
import { PushService } from '../push/push.service';

const SWEEP_MS = 60_000;
const REMIND_AFTER_MS = 10 * 60_000;
/** An unclaimed ticket stops nudging eventually. Nothing should beep all night. */
const MAX_REMINDERS = 6;

/**
 * An open ticket keeps asking until somebody picks it up.
 *
 * Every alert goes out twice: to Telegram for whoever has it linked, and as a
 * push notification to every device an admin or sub-admin has switched on.
 * The moment one person claims it, the reminders stop for everyone and the
 * others are told who took it - so two people never start the same
 * investigation, and nobody keeps getting buzzed about a problem already in
 * hand.
 */
@Injectable()
export class TicketAlertsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(TicketAlertsService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: PrismaService,
    private readonly notifier: NotifierService,
    private readonly push: PushService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.sweep().catch((e) => this.log.warn(`ticket sweep failed: ${e?.message}`));
    }, SWEEP_MS);
    // Never hold the process open for a reminder loop.
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Who is on the hook on Telegram: the admin and every sub-admin with it bound. */
  private async telegramResponders(): Promise<string[]> {
    const users = await this.db.user.findMany({
      where: {
        role: { in: ['ADMIN', 'SUB_ADMIN'] },
        status: 'active',
        telegramUserId: { not: null },
      },
      select: { telegramUserId: true },
    });
    return users.map((u) => String(u.telegramUserId));
  }

  private describe(ticket: any): string[] {
    const lines = [
      `${ticket.subject}`,
      '',
      `From: ${ticket.tasker.preferredName || ticket.tasker.name}`,
    ];
    if (ticket.tasker.phone) lines.push(`Phone: ${ticket.tasker.phone}`);
    lines.push(`Email: ${ticket.tasker.email}`);
    if (ticket.task) lines.push(`Task: ${ticket.task.code} (${ticket.task.state})`);
    if (ticket.account) lines.push(`Account: ${ticket.account.ref}`);
    lines.push('', ticket.body.slice(0, 400));
    return lines;
  }

  /** A notification is a glance, not a report: who, what, and on which work. */
  private pushBody(ticket: any): string {
    const who = ticket.tasker.preferredName || ticket.tasker.name;
    const context = [ticket.task?.code, ticket.account?.ref].filter(Boolean).join(' · ');
    return `${ticket.subject}\n${who}${context ? ` · ${context}` : ''}`;
  }

  /** Fired the moment a ticket is raised. */
  async announce(ticketId: string) {
    const ticket = await this.load(ticketId);
    if (!ticket) return;

    await this.send(ticket, 'ticket.raised', `New ticket ${ticket.code}`);
    await this.db.ticket.update({
      where: { id: ticketId },
      data: { lastAlertedAt: new Date(), alertCount: 1 },
    });
  }

  async announceClaimed(ticketId: string, byName: string) {
    const ticket = await this.load(ticketId);
    if (!ticket) return;

    const telegramIds = await this.telegramResponders();
    await this.notifier.publish({
      type: 'ticket.claimed',
      ticketCode: ticket.code,
      ticketId: ticket.id,
      telegramIds,
      title: `${ticket.code} picked up`,
      lines: [`${byName} is handling it. You can stop watching this one.`],
      claimable: false,
    });

    // Same tag as the alert, so the buzzing notification on every other phone
    // quietly turns into "somebody has this".
    await this.push
      .sendToResponders(
        {
          title: `${ticket.code} picked up`,
          body: `${byName} is handling it.`,
          url: `/tickets/${ticket.id}`,
          tag: `ticket-${ticket.id}`,
          ticketId: ticket.id,
          urgent: false,
          claimable: false,
        },
        ticket.code,
      )
      .catch((e) => this.log.warn(`push (claimed) failed: ${e?.message}`));
  }

  private async sweep() {
    const cutoff = new Date(Date.now() - REMIND_AFTER_MS);
    const stale = await this.db.ticket.findMany({
      where: {
        status: 'OPEN',
        alertCount: { lt: MAX_REMINDERS },
        OR: [{ lastAlertedAt: null }, { lastAlertedAt: { lt: cutoff } }],
      },
      include: this.include(),
      take: 20,
    });

    for (const ticket of stale) {
      const waited = Math.round((Date.now() - ticket.createdAt.getTime()) / 60_000);
      await this.send(
        ticket,
        'ticket.reminder',
        `${ticket.code} still unclaimed after ${waited}m`,
      );
      await this.db.ticket.update({
        where: { id: ticket.id },
        data: { lastAlertedAt: new Date(), alertCount: { increment: 1 } },
      });
    }
  }

  private async send(ticket: any, type: Alert['type'], title: string) {
    const urgent = ticket.priority === 'URGENT';

    // Each channel fails on its own. A Telegram outage must not cost the push,
    // and a dead push subscription must not cost the Telegram message.
    const telegramIds = await this.telegramResponders();
    if (telegramIds.length) {
      await this.notifier.publish({
        type,
        ticketCode: ticket.code,
        ticketId: ticket.id,
        telegramIds,
        title,
        lines: this.describe(ticket),
        urgent,
        claimable: true,
      });
    }

    await this.push
      .sendToResponders(
        {
          title: urgent ? `Urgent: ${title}` : title,
          body: this.pushBody(ticket),
          url: `/tickets/${ticket.id}`,
          tag: `ticket-${ticket.id}`,
          ticketId: ticket.id,
          urgent,
          // A reminder buzzes again even though the first alert is still showing.
          renotify: type === 'ticket.reminder',
          claimable: true,
        },
        ticket.code,
      )
      .catch((e) => this.log.warn(`push (${type}) failed: ${e?.message}`));
  }

  private load(id: string) {
    return this.db.ticket.findUnique({ where: { id }, include: this.include() });
  }

  private include() {
    return {
      tasker: { select: { name: true, preferredName: true, email: true, phone: true } },
      task: { select: { code: true, state: true } },
      account: { select: { ref: true } },
    };
  }
}
