import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.guard';
import { ChecklistItem } from '../tasks/tasks.service';
import { VideoStorageService } from '../tutorials/video-storage.service';

@Injectable()
export class TaskTypesService {
  constructor(
    private readonly db: PrismaService,
    private readonly video: VideoStorageService,
  ) {}

  /** Tutorials leave as playback links for the person asking, never as file locations. */
  private withPlayback<T extends { specVersions: { tutorial: any }[] }>(type: T, userId: string): T {
    return {
      ...type,
      specVersions: type.specVersions.map((v) => ({
        ...v,
        tutorial: v.tutorial ? this.video.playable(v.tutorial, userId) : null,
      })),
    };
  }

  async list(userId: string) {
    const types = await this.db.taskType.findMany({
      include: {
        specVersions: {
          orderBy: { version: 'desc' },
          include: {
            tutorial: true,
            quiz: true,
            // Names, not just a count: the spec sheet has to answer "who can
            // actually be given this work" without a second request.
            certifications: {
              where: { supersededAt: null },
              select: { tasker: { select: { id: true, name: true } } },
            },
            _count: { select: { certifications: true, tasks: true } },
          },
        },
        _count: { select: { tasks: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return types.map((t) => this.withPlayback(t, userId));
  }

  async getForUser(id: string, userId: string) {
    return this.withPlayback(await this.get(id), userId);
  }

  async get(id: string) {
    const type = await this.db.taskType.findUnique({
      where: { id },
      include: {
        specVersions: {
          orderBy: { version: 'desc' },
          include: { tutorial: true, quiz: true },
        },
      },
    });
    if (!type) throw new NotFoundException('No such task type.');
    return type;
  }

  async create(user: AuthUser, input: { name: string; category: 'STANDARD' | 'CRITICAL' }) {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('Give the task type a name.');
    const clash = await this.db.taskType.findUnique({ where: { name } });
    if (clash) throw new BadRequestException(`There is already a task type called "${name}".`);
    // A new type starts in draft and cannot be dispatched. The bot says this
    // plainly at intake rather than letting an admin create an unusable task.
    return this.db.taskType.create({
      data: { name, category: input.category, createdById: user.id },
    });
  }

  async createSpecVersion(
    id: string,
    input: {
      checklist: ChecklistItem[];
      tutorial?: {
        title: string;
        description?: string;
        videoUrl: string;
        durationSeconds: number;
        provider?: string;
        storageRef?: string;
      };
      /** Carry the previous version's video forward instead of re-uploading. */
      reuseTutorialId?: string;
      quiz?: { questions: any[]; passPercent?: number };
    },
  ) {
    const type = await this.get(id);
    const nextVersion = (type.specVersions[0]?.version ?? 0) + 1;

    if (!input.checklist?.length) {
      throw new BadRequestException('Add at least one step to the checklist.');
    }

    const keys = input.checklist.map((c) => c.key);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException('Two steps share the same key. Each one needs its own.');
    }
    if (input.checklist.some((c) => !c.label?.trim())) {
      throw new BadRequestException('Every step needs a label.');
    }

    // A version may point at the previous version's video. Tutorials are
    // immutable records, so sharing one is safe: certification is keyed to the
    // SPEC VERSION, not the video, and watching it still certifies per version.
    let tutorialId: string | undefined = input.reuseTutorialId;
    if (tutorialId) {
      const exists = await this.db.tutorial.findUnique({ where: { id: tutorialId } });
      if (!exists) throw new BadRequestException('That tutorial no longer exists.');
      // A tutorial is one-to-one with a spec version, so carrying one forward
      // means copying the record rather than stealing it from the old version.
      const copy = await this.db.tutorial.create({
        data: {
          kind: 'TASK',
          title: exists.title,
          description: exists.description,
          videoUrl: exists.videoUrl,
          durationSeconds: exists.durationSeconds,
          provider: exists.provider,
          storageRef: exists.storageRef,
        },
      });
      tutorialId = copy.id;
    }

    const tutorial =
      !tutorialId && input.tutorial
        ? await this.db.tutorial.create({ data: { kind: 'TASK', ...input.tutorial } })
        : null;
    if (tutorial) tutorialId = tutorial.id;
    const quiz = input.quiz
      ? await this.db.quiz.create({
          data: {
            questionsJson: input.quiz.questions as any,
            passPercent: input.quiz.passPercent ?? 70,
          },
        })
      : null;

    // Editing a spec creates a new version; it never mutates an existing one.
    return this.db.specVersion.create({
      data: {
        taskTypeId: id,
        version: nextVersion,
        checklist: input.checklist as any,
        tutorialId,
        quizId: quiz?.id,
      },
      include: { tutorial: true, quiz: true },
    });
  }

  /**
   * What publishing this version would cost, so the console can warn before the
   * click rather than report after it. Publishing de-certifies everybody on the
   * previous version, and that is not something to discover afterwards.
   */
  async publishImpact(specVersionId: string) {
    const spec = await this.db.specVersion.findUnique({
      where: { id: specVersionId },
      include: { taskType: true },
    });
    if (!spec) throw new NotFoundException('No such spec version.');

    const affected = await this.db.certification.findMany({
      where: {
        taskTypeId: spec.taskTypeId,
        specVersionId: { not: specVersionId },
        supersededAt: null,
      },
      include: { tasker: { select: { id: true, name: true, preferredName: true } } },
    });

    const inFlight = await this.db.task.count({
      where: {
        taskTypeId: spec.taskTypeId,
        specVersionId: { not: specVersionId },
        state: { notIn: ['CLOSED', 'CANCELLED', 'EXPIRED'] },
      },
    });

    return {
      taskType: spec.taskType.name,
      version: spec.version,
      ready: Boolean(spec.tutorialId),
      missing: spec.tutorialId ? [] : ['tutorial'],
      willRequalify: affected.map((c) => c.tasker.preferredName || c.tasker.name),
      // Invariant 5: these keep running on the version they started on.
      inFlightUnaffected: inFlight,
    };
  }

  /**
   * Section 9. Publishing is the one action that reaches backwards: it
   * supersedes every certification on the previous version, so nobody is
   * assigned work they trained for under different requirements.
   * Tasks already dispatched are deliberately untouched (invariant 5).
   */
  async publish(specVersionId: string) {
    const spec = await this.db.specVersion.findUnique({
      where: { id: specVersionId },
      include: { taskType: true },
    });
    if (!spec) throw new NotFoundException('No such spec version.');

    // Invariant 2 - a spec is not publishable until it is complete. Complete
    // now means "has a tutorial", because watching it is what certifies a tasker.
    if (!spec.tutorialId) {
      throw new BadRequestException(
        'Attach a tutorial before publishing this version. Taskers qualify by watching it.',
      );
    }

    return this.db.$transaction(async (tx) => {
      const published = await tx.specVersion.update({
        where: { id: specVersionId },
        data: { publishedAt: new Date() },
      });

      const superseded = await tx.certification.updateMany({
        where: {
          taskTypeId: spec.taskTypeId,
          specVersionId: { not: specVersionId },
          supersededAt: null,
        },
        data: { supersededAt: new Date() },
      });

      await tx.taskType.update({
        where: { id: spec.taskTypeId },
        data: { currentSpecVersionId: specVersionId, status: 'active' },
      });

      return {
        specVersion: published,
        // Surfaced so the console can say "14 taskers must requalify" rather
        // than silently locking people out of work they had yesterday.
        supersededCertifications: superseded.count,
      };
    });
  }
}
