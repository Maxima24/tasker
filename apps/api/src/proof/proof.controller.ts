import {
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { MAX_PROOF_BYTES, ProofService } from './proof.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser, RequireRoles } from '../auth/auth.guard';

@Controller()
export class ProofController {
  constructor(private readonly proof: ProofService) {}

  /** One slot per call. Per-slot upload is what makes a dropped connection survivable. */
  @Post('tasks/:id/proof')
  @RequireRoles('TASKER')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PROOF_BYTES } }))
  async upload(
    @CurrentUser() user: AuthUser,
    @Param('id') taskId: string,
    @Body('checklistKey') checklistKey: string,
    @UploadedFile() file: any,
  ) {
    if (!file) throw new BadRequestException('No file received.');
    return this.proof.upload(user.id, taskId, checklistKey, file);
  }

  @Get('tasks/:id/proof')
  async forTask(@CurrentUser() user: AuthUser, @Param('id') taskId: string) {
    await this.proof.assertCanView(user, taskId);
    return this.proof.forTask(taskId);
  }

  /**
   * Section 15 - file_id is cached on the proof record on first send and
   * reused after, so paging back and forth costs Telegram one upload total.
   * Scope is the bot token: rotating the token invalidates every cached id.
   */
  @Post('proof/:id/telegram-file-id')
  @RequireRoles('ADMIN', 'SUB_ADMIN')
  setTelegramFileId(@Param('id') id: string, @Body('fileId') fileId: string) {
    return this.proof.setTelegramFileId(id, fileId);
  }

  /**
   * Screenshots show real accounts. Signed-in only, the task's own tasker or an
   * assigner, and served so that nothing in the file can run as the console.
   */
  @Get('proof/:id/file')
  async file(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const { buffer, mimeType } = await this.proof.file(user, id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.send(buffer);
  }
}
