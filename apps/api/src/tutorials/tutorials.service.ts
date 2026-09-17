import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
}

/**
 * A tasker becomes certified on a (task_type, spec_version) pair by watching
 * that version's tutorial to the end. Playback progress is tracked here, which
 * is the whole reason tutorials live on the website rather than in Telegram.
 *
 * The Quiz model is still in the schema but no longer gates a claim - watching
 * is the gate. Reinstating it means checking a passed attempt alongside the
 * completion flag in one place, below.
 */
/** The most a single heartbeat can move the watermark. Heartbeats are every 5s. */
const MAX_STEP_SECONDS = 15;

@Injectable()
export class TutorialsService {
  constructor(private readonly db: PrismaService) {}

  /** What this tasker still needs to qualify for, and what lapsed under them. */
  async myCertifications(taskerId: string) {
    const certs = await this.db.certification.findMany({
      where: { taskerId },
      include: {
        specVersion: {
          include: { taskType: true, tutorial: true, quiz: true },
        },
      },
      orderBy: { certifiedAt: 'desc' },
    });

    // Anything published that this tasker is not currently certified on.
    const available = await this.db.specVersion.findMany({
      where: {
        publishedAt: { not: null },
        certifications: { none: { taskerId, supersededAt: null } },
      },
      include: { taskType: true, tutorial: true, quiz: true },
    });

    const progress = await this.db.tutorialProgress.findMany({ where: { taskerId } });
    const byTutorial = new Map(progress.map((p) => [p.tutorialId, p]));

    return {
      certified: certs
        .filter((c) => !c.supersededAt)
        .map((c) => ({
          id: c.id,
          taskType: c.specVersion.taskType.name,
          version: c.specVersion.version,
          certifiedAt: c.certifiedAt,
        })),
      // Requalification: they held this once, a new version replaced it.
      requalify: certs
        .filter((c) => c.supersededAt)
        .map((c) => ({
          taskType: c.specVersion.taskType.name,
          version: c.specVersion.version,
          supersededAt: c.supersededAt,
        })),
      available: available.map((s) => ({
        specVersionId: s.id,
        taskType: s.taskType.name,
        taskTypeId: s.taskTypeId,
        version: s.version,
        tutorial: s.tutorial
          ? {
              id: s.tutorial.id,
              title: s.tutorial.title,
              videoUrl: s.tutorial.videoUrl,
              durationSeconds: s.tutorial.durationSeconds,
              furthestSeconds: byTutorial.get(s.tutorial.id)?.furthestSeconds ?? 0,
              completed: byTutorial.get(s.tutorial.id)?.completed ?? false,
            }
          : null,
        quizId: s.quizId,
      })),
    };
  }

  /**
   * Playback heartbeat. We store the FURTHEST point reached, never a running
   * total: a cumulative counter is inflated by seeking and by re-watching, so
   * it cannot answer "did they actually watch this".
   */
  async reportProgress(taskerId: string, tutorialId: string, positionSeconds: number) {
    const tutorial = await this.db.tutorial.findUnique({ where: { id: tutorialId } });
    if (!tutorial) throw new NotFoundException('No such tutorial.');

    const existing = await this.db.tutorialProgress.findUnique({
      where: { taskerId_tutorialId: { taskerId, tutorialId } },
    });

    // The watermark moves at playback speed, enforced HERE - the player's own
    // cap is a courtesy a direct API call can skip. Each heartbeat may advance
    // it by the time since the last one (doubled, for 2x playback), and never
    // by more than MAX_STEP. Scrubbing to the end therefore gains one step.
    const previous = existing?.furthestSeconds ?? 0;
    const elapsed = existing
      ? Math.max(0, (Date.now() - existing.lastHeartbeat.getTime()) / 1000)
      : 0;
    const allowance = Math.min(MAX_STEP_SECONDS, elapsed * 2 + 2);
    const reported = Math.max(0, Math.floor(Number(positionSeconds) || 0));
    const furthest = Math.max(previous, Math.min(reported, Math.floor(previous + allowance)));
    // 90% counts as watched - trailing credits and a paused last frame should
    // not stand between a tasker and the quiz.
    const completed = furthest >= tutorial.durationSeconds * 0.9;

    const saved = await this.db.tutorialProgress.upsert({
      where: { taskerId_tutorialId: { taskerId, tutorialId } },
      create: { taskerId, tutorialId, furthestSeconds: furthest, completed },
      update: { furthestSeconds: furthest, completed, lastHeartbeat: new Date() },
    });

    // Watching IS the qualification. Finishing a task tutorial certifies the
    // tasker on that exact spec version, which is what the assignment and claim
    // gates check. Onboarding videos certify nothing - they unlock the queue.
    if (completed) {
      const spec = await this.db.specVersion.findFirst({
        where: { tutorialId },
        select: { id: true, taskTypeId: true },
      });
      if (spec) {
        await this.db.certification.upsert({
          where: { taskerId_specVersionId: { taskerId, specVersionId: spec.id } },
          create: { taskerId, taskTypeId: spec.taskTypeId, specVersionId: spec.id },
          update: { certifiedAt: new Date(), supersededAt: null },
        });
      }
    }

    return { ...saved, certified: completed };
  }

  async getQuiz(specVersionId: string) {
    const spec = await this.db.specVersion.findUnique({
      where: { id: specVersionId },
      include: { quiz: true, tutorial: true, taskType: true },
    });
    if (!spec?.quiz) throw new NotFoundException('That spec version has no quiz.');

    const questions = spec.quiz.questionsJson as unknown as QuizQuestion[];
    return {
      quizId: spec.quiz.id,
      passPercent: spec.quiz.passPercent,
      taskType: spec.taskType.name,
      version: spec.version,
      // The answer key never leaves the server.
      questions: questions.map((q) => ({ id: q.id, question: q.question, options: q.options })),
    };
  }

  /**
   * Grading and certification in one call. The gate is deliberately strict:
   * the tutorial must be watched before an attempt counts, because a quiz on
   * its own certifies guessing, not training.
   */
  async attemptQuiz(taskerId: string, specVersionId: string, answers: Record<string, number>) {
    const spec = await this.db.specVersion.findUnique({
      where: { id: specVersionId },
      include: { quiz: true, tutorial: true },
    });
    if (!spec?.quiz) throw new NotFoundException('That spec version has no quiz.');
    if (!spec.publishedAt) throw new BadRequestException('That spec version is not published yet.');

    if (spec.tutorialId) {
      const progress = await this.db.tutorialProgress.findUnique({
        where: { taskerId_tutorialId: { taskerId, tutorialId: spec.tutorialId } },
      });
      if (!progress?.completed) {
        throw new BadRequestException('Watch the tutorial through before taking the quiz.');
      }
    }

    const questions = spec.quiz.questionsJson as unknown as QuizQuestion[];
    const correct = questions.filter((q) => answers[q.id] === q.correctIndex).length;
    const scorePercent = Math.round((correct / questions.length) * 100);
    const passed = scorePercent >= spec.quiz.passPercent;

    await this.db.quizAttempt.create({
      data: {
        taskerId,
        quizId: spec.quiz.id,
        answersJson: answers as any,
        scorePercent,
        passed,
      },
    });

    if (passed) {
      await this.db.certification.upsert({
        where: { taskerId_specVersionId: { taskerId, specVersionId } },
        create: { taskerId, taskTypeId: spec.taskTypeId, specVersionId },
        update: { certifiedAt: new Date(), supersededAt: null },
      });
    }

    return {
      scorePercent,
      passed,
      passPercent: spec.quiz.passPercent,
      correct,
      total: questions.length,
      // Which ones were wrong, so a retake is a learning step and not a lottery.
      wrong: questions.filter((q) => answers[q.id] !== q.correctIndex).map((q) => q.id),
    };
  }
}
