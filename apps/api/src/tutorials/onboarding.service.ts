import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The platform-level gate. Before a tasker can claim ANYTHING they watch the
 * onboarding series end to end - these carry the information they need to
 * operate on any task at all, so it is deliberately not skippable.
 *
 * Per-task tutorials are a second, narrower gate handled in TutorialsService.
 */
@Injectable()
export class OnboardingService {
  constructor(private readonly db: PrismaService) {}

  async forTasker(taskerId: string) {
    const videos = await this.db.tutorial.findMany({
      where: { kind: 'ONBOARDING' },
      orderBy: { order: 'asc' },
    });

    const progress = await this.db.tutorialProgress.findMany({
      where: { taskerId, tutorialId: { in: videos.map((v) => v.id) } },
    });
    const byId = new Map(progress.map((p) => [p.tutorialId, p]));

    let previousDone = true;
    const steps = videos.map((v) => {
      const p = byId.get(v.id);
      const completed = p?.completed ?? false;
      // Watched in order: the second video assumes the first. Unlocking them
      // all at once invites skipping to the short one.
      const unlocked = previousDone;
      previousDone = previousDone && completed;
      return {
        id: v.id,
        order: v.order,
        title: v.title,
        description: v.description,
        videoUrl: v.videoUrl,
        durationSeconds: v.durationSeconds,
        furthestSeconds: p?.furthestSeconds ?? 0,
        completed,
        unlocked,
      };
    });

    const done = steps.filter((s) => s.completed).length;
    return {
      steps,
      completedCount: done,
      totalCount: steps.length,
      // No videos configured means no gate - an empty series must not lock
      // every tasker out of the platform.
      complete: steps.length === 0 || done === steps.length,
      nextUp: steps.find((s) => !s.completed)?.id ?? null,
    };
  }

  // --- management, for the console -----------------------------------

  /** Every onboarding video, in order, for the admin who maintains them. */
  listForAdmin() {
    return this.db.tutorial.findMany({
      where: { kind: 'ONBOARDING' },
      orderBy: { order: 'asc' },
      include: { _count: { select: { progress: true } } },
    });
  }

  async create(input: {
    title: string;
    description?: string;
    videoUrl: string;
    durationSeconds: number;
    provider?: string;
    storageRef?: string;
  }) {
    const last = await this.db.tutorial.findFirst({
      where: { kind: 'ONBOARDING' },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return this.db.tutorial.create({
      data: {
        kind: 'ONBOARDING',
        order: (last?.order ?? 0) + 1,
        title: input.title,
        description: input.description,
        videoUrl: input.videoUrl,
        durationSeconds: Math.max(1, Math.round(input.durationSeconds)),
        provider: input.provider ?? 'local',
        storageRef: input.storageRef,
      },
    });
  }

  update(id: string, input: { title?: string; description?: string; order?: number }) {
    return this.db.tutorial.update({ where: { id }, data: input });
  }

  /**
   * Removing a video also removes the progress rows against it, so nobody is
   * left permanently short of a video that no longer exists.
   */
  async remove(id: string) {
    await this.db.tutorialProgress.deleteMany({ where: { tutorialId: id } });
    await this.db.tutorial.delete({ where: { id } });
    // Close the gap left in the sequence.
    const rest = await this.db.tutorial.findMany({
      where: { kind: 'ONBOARDING' },
      orderBy: { order: 'asc' },
    });
    for (const [i, v] of rest.entries()) {
      if (v.order !== i + 1) {
        await this.db.tutorial.update({ where: { id: v.id }, data: { order: i + 1 } });
      }
    }
    return { ok: true };
  }

  async reorder(ids: string[]) {
    for (const [i, id] of ids.entries()) {
      await this.db.tutorial.update({ where: { id }, data: { order: i + 1 } });
    }
    return { ok: true };
  }

  /** Throws with the remaining count, so the surface can say what is left. */
  async assertComplete(taskerId: string) {
    const state = await this.forTasker(taskerId);
    if (!state.complete) {
      const left = state.totalCount - state.completedCount;
      throw new ForbiddenException(
        `Finish onboarding first - ${left} ${left === 1 ? 'video' : 'videos'} left to watch.`,
      );
    }
  }
}
