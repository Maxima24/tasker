import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import os from 'node:os';
import { TutorialsService } from './tutorials.service';
import { OnboardingService } from './onboarding.service';
import { MAX_VIDEO_BYTES, VideoStorageService } from './video-storage.service';
import { CapacityService } from '../taskers/capacity.service';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser, RequireCapability, RequireRoles } from '../auth/auth.guard';

@Controller()
export class TutorialsController {
  constructor(
    private readonly tutorials: TutorialsService,
    private readonly onboarding: OnboardingService,
    private readonly capacity: CapacityService,
    private readonly video: VideoStorageService,
    private readonly db: PrismaService,
  ) {}

  /** The platform gate: the onboarding series and how far through it they are. */
  @Get('onboarding')
  @RequireRoles('TASKER')
  async onboardingState(@CurrentUser() user: AuthUser) {
    const state = await this.onboarding.forTasker(user.id);
    return { ...state, steps: state.steps.map((s) => this.video.playable(s, user.id)) };
  }

  /** How many tasks they may hold right now, and why that number. */
  @Get('me/capacity')
  @RequireRoles('TASKER')
  myCapacity(@CurrentUser() user: AuthUser) {
    return this.capacity.forTasker(user.id);
  }

  @Get('me/certifications')
  async mine(@CurrentUser() user: AuthUser) {
    const data = await this.tutorials.myCertifications(user.id);
    return {
      ...data,
      available: data.available.map((a) => ({
        ...a,
        tutorial: a.tutorial ? this.video.playable(a.tutorial, user.id) : null,
      })),
    };
  }

  @Post('tutorials/:id/progress')
  @RequireRoles('TASKER')
  progress(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { positionSeconds: number },
  ) {
    return this.tutorials.reportProgress(user.id, id, body.positionSeconds);
  }

  /**
   * Playback, in ranges. Needs a signed-in session AND a link minted for this
   * person, so a copied address plays nothing for anyone else and nothing
   * after it lapses. The file itself is handed over a slice at a time.
   */
  @Get('tutorials/:id/stream')
  async stream(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.video.verify(id, user.id, exp, sig);
    const tutorial = await this.db.tutorial.findUnique({
      where: { id },
      select: { videoUrl: true, provider: true, storageRef: true },
    });
    if (!tutorial) throw new NotFoundException('That video no longer exists.');
    await this.video.stream(tutorial, req, res);
  }

  // --- video management, for the console -----------------------------

  /**
   * One upload endpoint for both kinds of video. The file is written to a temp
   * path rather than held in memory, then streamed on to storage. Duration
   * comes from the browser, which has already decoded the file to show a
   * preview - the server has no decoder and refuses to guess.
   */
  @Post('tutorials/upload')
  @RequireCapability('taskType.create')
  @UseInterceptors(
    FileInterceptor('file', { dest: os.tmpdir(), limits: { fileSize: MAX_VIDEO_BYTES } }),
  )
  async upload(@UploadedFile() file: any, @Body('durationSeconds') durationSeconds?: string) {
    const stored = await this.video.store(file);
    const reported = Number(durationSeconds ?? 0);
    return {
      provider: stored.provider,
      url: stored.url,
      storageRef: stored.storageRef,
      durationSeconds: stored.durationSeconds || Math.round(reported) || 0,
    };
  }

  @Get('tutorials/storage')
  @RequireCapability('taskType.create')
  storage() {
    return this.video.describe();
  }

  @Get('onboarding/videos')
  @RequireCapability('taskType.create')
  async listOnboarding(@CurrentUser() user: AuthUser) {
    const videos = await this.onboarding.listForAdmin();
    return videos.map((v) => this.video.playable(v, user.id));
  }

  @Post('onboarding/videos')
  @RequireCapability('taskType.create')
  async createOnboarding(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      title: string;
      description?: string;
      videoUrl: string;
      durationSeconds: number;
      provider?: string;
      storageRef?: string;
    },
  ) {
    if (!body.title?.trim()) throw new BadRequestException('Give the video a title.');
    if (!body.videoUrl) throw new BadRequestException('Upload the video first.');
    const created = await this.onboarding.create(body);
    return this.video.playable(created, user.id);
  }

  @Post('onboarding/videos/reorder')
  @RequireCapability('taskType.create')
  reorder(@Body('ids') ids: string[]) {
    return this.onboarding.reorder(ids);
  }

  @Post('onboarding/videos/:id')
  @RequireCapability('taskType.create')
  async updateOnboarding(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { title?: string; description?: string; order?: number },
  ) {
    const updated = await this.onboarding.update(id, body);
    return this.video.playable(updated, user.id);
  }

  @Delete('onboarding/videos/:id')
  @RequireCapability('taskType.create')
  async removeOnboarding(@Param('id') id: string) {
    const video = await this.db.tutorial.findUnique({ where: { id }, select: { videoUrl: true } });
    const result = await this.onboarding.remove(id);
    // A carried-forward task tutorial can share this file. Only delete it once
    // nothing points at it any more.
    if (video) {
      const stillUsed = await this.db.tutorial.count({ where: { videoUrl: video.videoUrl } });
      if (!stillUsed) await this.video.remove(video.videoUrl);
    }
    return result;
  }
}
