import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Channel, TaskState } from '@prisma/client';
import { TasksService } from './tasks.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser, RequireCapability, RequireRoles } from '../auth/auth.guard';
import { ViaChannel } from '../common/channel.decorator';
import { parsePage } from '../common/pagination';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(
    @Query('state') state?: string,
    @Query('assignee') assignee?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.tasks.list(
      {
        state: state ? (state.split(',') as TaskState[]) : undefined,
        assigneeId: assignee,
        taskTypeId: type,
      },
      parsePage(page, limit),
    );
  }

  @Get('mine/active')
  @RequireRoles('TASKER')
  active(@CurrentUser() user: AuthUser) {
    return this.tasks.activeTasksForTasker(user.id);
  }

  /** Their own finished work, with totals across all of it. */
  @Get('mine/history')
  @RequireRoles('TASKER')
  history(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.tasks.historyForTasker(user.id, parsePage(page, limit));
  }

  /** The browsable queue, with each row's gate state attached. */
  @Get('mine/queue')
  @RequireRoles('TASKER')
  queue(@CurrentUser() user: AuthUser) {
    return this.tasks.availableForTasker(user.id);
  }

  /** The claim screen's single source: work, steps, video, and gate state. */
  @Get(':id/preview')
  @RequireRoles('TASKER')
  preview(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.previewForTasker(user.id, id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.findByIdOrCode(user, id);
  }

  @Post()
  @RequireCapability('task.create')
  create(
    @CurrentUser() user: AuthUser,
    @ViaChannel() channel: Channel,
    @Body() body: { taskTypeId: string; dueAt?: string },
  ) {
    return this.tasks.create(user, channel, body);
  }

  @Post(':id/assign')
  @RequireCapability('task.assign')
  assign(
    @CurrentUser() user: AuthUser,
    @ViaChannel() channel: Channel,
    @Param('id') id: string,
    @Body() body: { taskerId: string },
  ) {
    return this.tasks.assign(user, channel, id, body.taskerId);
  }

  /** Into the open queue, for anyone onboarded to claim. */
  @Post(':id/open')
  @RequireCapability('task.assign')
  open(@CurrentUser() user: AuthUser, @ViaChannel() channel: Channel, @Param('id') id: string) {
    return this.tasks.openToQueue(user, channel, id);
  }

  @Post(':id/broadcast')
  @RequireCapability('task.assign')
  broadcast(
    @CurrentUser() user: AuthUser,
    @ViaChannel() channel: Channel,
    @Param('id') id: string,
    @Body() body: { taskerIds: string[] },
  ) {
    return this.tasks.broadcast(user, channel, id, body.taskerIds);
  }

  @Post(':id/accept')
  @RequireRoles('TASKER')
  accept(@CurrentUser() user: AuthUser, @ViaChannel() channel: Channel, @Param('id') id: string) {
    return this.tasks.accept(user, channel, id);
  }

  @Post(':id/claim')
  @RequireRoles('TASKER')
  claim(@CurrentUser() user: AuthUser, @ViaChannel() channel: Channel, @Param('id') id: string) {
    return this.tasks.accept(user, channel, id);
  }

  @Post(':id/submit')
  @RequireRoles('TASKER')
  submit(
    @CurrentUser() user: AuthUser,
    @ViaChannel() channel: Channel,
    @Param('id') id: string,
    @Body() body: { hoursReported?: number },
  ) {
    return this.tasks.submit(user, channel, id, body);
  }

  @Post(':id/rework/ack')
  @RequireRoles('TASKER')
  ackRework(@CurrentUser() user: AuthUser, @ViaChannel() channel: Channel, @Param('id') id: string) {
    return this.tasks.acknowledgeRework(user, channel, id);
  }

  @Post(':id/release')
  @RequireRoles('TASKER')
  release(
    @CurrentUser() user: AuthUser,
    @ViaChannel() channel: Channel,
    @Param('id') id: string,
    @Body() body: { reason: string; progressNote?: string },
  ) {
    return this.tasks.release(user, channel, id, body);
  }

  @Post(':id/review')
  @RequireCapability('review.internal')
  review(
    @CurrentUser() user: AuthUser,
    @ViaChannel() channel: Channel,
    @Param('id') id: string,
    @Body() body: { outcome: 'PASS' | 'FAIL'; note?: string; citedProofId?: string; reason?: string },
  ) {
    return this.tasks.review(user, channel, id, body);
  }

  @Post(':id/verify')
  @RequireCapability('verdict.external')
  verify(
    @CurrentUser() user: AuthUser,
    @ViaChannel() channel: Channel,
    @Param('id') id: string,
    @Body() body: { outcome: 'PASS' | 'FAIL'; reason?: string; citedProofId?: string; note?: string },
  ) {
    return this.tasks.verify(user, channel, id, body);
  }

  @Post(':id/cancel')
  @RequireCapability('task.cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @ViaChannel() channel: Channel,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.tasks.cancel(user, channel, id, body?.reason);
  }
}
