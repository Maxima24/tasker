import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

export const ALERT_CHANNEL = 'tasker.alerts';

export interface Alert {
  type: 'ticket.raised' | 'ticket.reminder' | 'ticket.claimed' | 'ticket.resolved';
  ticketCode: string;
  ticketId: string;
  /** Telegram ids to deliver to, resolved here so the bot stays a dumb sink. */
  telegramIds: string[];
  title: string;
  lines: string[];
  urgent?: boolean;
  claimable?: boolean;
}

/**
 * Publishes to Redis; the bot subscribes and delivers.
 *
 * Ported from SwiftHum's notification loop, which already proved a supervised
 * subscriber is the cheap way to push into Telegram without the API knowing
 * anything about chat ids or bot tokens.
 */
@Injectable()
export class NotifierService implements OnModuleDestroy {
  private readonly redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6380');

  async publish(alert: Alert): Promise<void> {
    if (alert.telegramIds.length === 0) return;
    try {
      await this.redis.publish(ALERT_CHANNEL, JSON.stringify(alert));
    } catch {
      // A missed notification must never fail the write that caused it. The
      // ticket still exists and still shows up in the console.
    }
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }
}
