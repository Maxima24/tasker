import { Controller, Get, OnModuleDestroy, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/auth.guard';

const STARTED = Date.now();

/**
 * Proves the back end is alive: the process answers and Redis answers a ping.
 * The keep-alive job in .github/workflows hits this every few minutes, which
 * keeps the Render service awake and doubles as an alarm - a failing check
 * fails the job, and GitHub emails the repository owner.
 *
 * The database is only queried with ?deep=1. It sleeps when idle and bills for
 * time awake, so a check every few minutes must not be what keeps it up.
 *
 * Public on purpose, and says nothing an outsider could use.
 */
@Controller()
export class HealthController implements OnModuleDestroy {
  private readonly redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6380', {
    lazyConnect: true,
    connectTimeout: 3000,
    maxRetriesPerRequest: 1,
  });

  constructor(private readonly db: PrismaService) {}

  @Public()
  @Get('health')
  async health(@Query('deep') deep: string | undefined, @Res() res: Response) {
    const [db, redis] = await Promise.all([
      deep ? this.check(() => this.db.$queryRaw`SELECT 1`) : Promise.resolve('skipped' as const),
      this.check(async () => {
        if (this.redis.status === 'wait' || this.redis.status === 'end') await this.redis.connect();
        await this.redis.ping();
      }),
    ]);
    const ok = db !== 'down' && redis === 'ok';

    res.setHeader('Cache-Control', 'no-store');
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      db,
      redis,
      uptimeSeconds: Math.round((Date.now() - STARTED) / 1000),
    });
  }

  private async check(probe: () => Promise<unknown>): Promise<'ok' | 'down'> {
    try {
      await Promise.race([
        probe(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ]);
      return 'ok';
    } catch {
      return 'down';
    }
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }
}
