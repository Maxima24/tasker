import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Section 24 assumption 3 - acceptance window, idle threshold and grace window
 * are configuration with sensible defaults, not hardcoded. Section 8 - the
 * productivity weights are configuration too.
 */
export const DEFAULTS = {
  'productivity.weights': {
    approvalRate: 0.4,
    closedCount: 0.2,
    medianSubmitMinutes: 0.2,
    reworkRate: 0.2,
  },
  'productivity.windowDays': 60,
  'productivity.minClosedToRank': 5,
  'window.acceptanceMinutes': 30,
  'window.idleMinutes': 45,
  'window.graceMinutes': 10,
  'hours.medianMultipleFlag': 2.5,
  'rework.maxCycles': 3,

  // Earned concurrency. Everyone starts at one task. Each threshold of closed
  // work raises the ceiling by one; falling under the approval floor drops it
  // back until the record is rebuilt. Capacity is a consequence of a tasker's
  // record, not a setting somebody edits per person.
  'concurrency.base': 1,
  'concurrency.max': 5,
  'concurrency.tiers': [1, 5, 15, 30],
  'concurrency.approvalFloor': 0.75,
  'concurrency.limitedTo': 1,
  // Below this many reviewed tasks the ratio is noise, so it cannot penalise.
  'concurrency.minReviewedToPenalise': 4,
};

export type SettingKey = keyof typeof DEFAULTS;

@Injectable()
export class SettingsService {
  constructor(private readonly db: PrismaService) {}

  async get<K extends SettingKey>(key: K): Promise<(typeof DEFAULTS)[K]> {
    const row = await this.db.setting.findUnique({ where: { key } });
    return (row?.value as any) ?? DEFAULTS[key];
  }

  async all() {
    const rows = await this.db.setting.findMany();
    const overrides = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return { ...DEFAULTS, ...overrides };
  }

  async set(key: SettingKey, value: any) {
    return this.db.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
}
