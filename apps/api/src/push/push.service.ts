import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.guard';

export interface PushPayload {
  title: string;
  body: string;
  /** Where tapping the notification lands, relative to the console. */
  url: string;
  /** Same tag replaces the earlier notification instead of stacking another. */
  tag: string;
  urgent?: boolean;
  /** Buzz again even though a notification with this tag is already showing. */
  renotify?: boolean;
  ticketId?: string;
  claimable?: boolean;
}

/**
 * Web Push to the admin's and sub-admins' own devices - a phone or a laptop
 * browser - so an urgent ticket reaches them even with the console closed and
 * Telegram out of reach. It runs beside the Telegram alerts, never instead of
 * them.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly log = new Logger(PushService.name);
  private ready = false;

  constructor(private readonly db: PrismaService) {}

  onModuleInit() {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) {
      this.log.warn('VAPID keys are not set; push notifications are off');
      return;
    }
    try {
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:admin@tasker.dev',
        publicKey,
        privateKey,
      );
      this.ready = true;
    } catch (e: any) {
      this.log.warn(`VAPID keys rejected; push notifications are off: ${e?.message}`);
    }
  }

  get configured() {
    return this.ready;
  }

  async config(user: AuthUser) {
    return {
      configured: this.ready,
      publicKey: this.ready ? process.env.VAPID_PUBLIC_KEY : null,
      devices: await this.db.pushSubscription.count({ where: { userId: user.id } }),
    };
  }

  async subscribe(
    user: AuthUser,
    body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } },
    userAgent?: string,
  ) {
    const endpoint = body?.endpoint;
    const p256dh = body?.keys?.p256dh;
    const auth = body?.keys?.auth;
    if (!endpoint?.startsWith('https://') || !p256dh || !auth) {
      throw new BadRequestException('That device did not send a usable subscription.');
    }
    // An endpoint belongs to one browser. If somebody else signed in on it
    // before, the device now alerts whoever is signed in today.
    await this.db.pushSubscription.upsert({
      where: { endpoint },
      create: { userId: user.id, endpoint, p256dh, auth, userAgent: userAgent?.slice(0, 300) },
      update: { userId: user.id, p256dh, auth, userAgent: userAgent?.slice(0, 300) },
    });
    return { ok: true };
  }

  async unsubscribe(user: AuthUser, endpoint: string) {
    await this.db.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
    return { ok: true };
  }

  /** A test the person can hear, so "notifications on" is proven, not assumed. */
  test(user: AuthUser) {
    return this.sendToUsers([user.id], {
      title: 'Notifications are on',
      body: 'Urgent tickets will reach this device, even with the console closed.',
      url: '/tickets',
      tag: 'tasker-test',
      urgent: true,
    });
  }

  /** Everyone on the hook for tickets: the admin and every active sub-admin. */
  async sendToResponders(payload: PushPayload, topic?: string) {
    if (!this.ready) return { sent: 0, failed: 0 };
    const users = await this.db.user.findMany({
      where: { role: { in: ['ADMIN', 'SUB_ADMIN'] }, status: 'active' },
      select: { id: true },
    });
    return this.sendToUsers(
      users.map((u) => u.id),
      payload,
      topic,
    );
  }

  async sendToUsers(userIds: string[], payload: PushPayload, topic?: string) {
    if (!this.ready || userIds.length === 0) return { sent: 0, failed: 0 };
    const subs = await this.db.pushSubscription.findMany({ where: { userId: { in: userIds } } });

    let sent = 0;
    let failed = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(payload),
            {
              TTL: 60 * 60,
              urgency: payload.urgent ? 'high' : 'normal',
              // A newer reminder for the same ticket replaces one still queued
              // for an offline phone, rather than delivering six at once.
              ...(topic ? { topic: topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } : {}),
            },
          );
          sent++;
          await this.db.pushSubscription
            .update({ where: { id: s.id }, data: { lastSuccessAt: new Date() } })
            .catch(() => undefined);
        } catch (e: any) {
          failed++;
          // 404/410: the browser dropped the subscription. Forget the device.
          if (e?.statusCode === 404 || e?.statusCode === 410) {
            await this.db.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
          } else {
            this.log.warn(`push failed (${e?.statusCode ?? 'network'}): ${e?.body || e?.message}`);
          }
        }
      }),
    );
    return { sent, failed };
  }
}
