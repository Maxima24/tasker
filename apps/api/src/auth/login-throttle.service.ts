import { HttpException, HttpStatus, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

const WINDOW_SEC = 15 * 60;
/** Wrong passwords for one email before that email is paused. */
const PER_EMAIL = 8;
/** Wrong passwords from one address, across any emails, before it is paused. */
const PER_IP = 40;

/**
 * Slows password guessing. Counts failures per email and per address in Redis
 * for fifteen minutes; a correct password clears the email's count.
 *
 * If Redis is unreachable the check lets people through rather than locking
 * everybody out of the console - a login outage is worse than a slower attack.
 */
@Injectable()
export class LoginThrottleService implements OnModuleDestroy {
  private readonly log = new Logger(LoginThrottleService.name);
  private readonly redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6380', {
    lazyConnect: true,
    connectTimeout: 3000,
    maxRetriesPerRequest: 1,
  });

  private keys(email: string, ip?: string) {
    return {
      email: `login:fail:email:${email}`,
      ip: ip ? `login:fail:ip:${ip}` : null,
    };
  }

  private async ready() {
    if (this.redis.status === 'wait' || this.redis.status === 'end') await this.redis.connect();
  }

  async assertAllowed(email: string, ip?: string) {
    const k = this.keys(email, ip);
    let counts: (string | null)[];
    try {
      await this.ready();
      counts = await this.redis.mget(k.email, k.ip ?? k.email);
    } catch (e: any) {
      this.log.warn(`login throttle unavailable: ${e?.message}`);
      return;
    }
    if (Number(counts[0] ?? 0) >= PER_EMAIL || (k.ip && Number(counts[1] ?? 0) >= PER_IP)) {
      throw new HttpException(
        'Too many wrong passwords. Wait 15 minutes, then try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async recordFailure(email: string, ip?: string) {
    const k = this.keys(email, ip);
    try {
      await this.ready();
      const multi = this.redis.multi().incr(k.email).expire(k.email, WINDOW_SEC, 'NX');
      if (k.ip) multi.incr(k.ip).expire(k.ip, WINDOW_SEC, 'NX');
      await multi.exec();
    } catch (e: any) {
      this.log.warn(`login throttle unavailable: ${e?.message}`);
    }
  }

  async clear(email: string) {
    try {
      await this.ready();
      await this.redis.del(this.keys(email).email);
    } catch {
      // Nothing to clear if Redis is down.
    }
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }
}
