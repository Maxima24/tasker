import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { TaskTypesService } from './task-types.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser, RequireCapability, RequireRoles } from '../auth/auth.guard';

@Controller()
export class TaskTypesController {
  constructor(private readonly types: TaskTypesService) {}

  @Get('task-types')
  @RequireRoles('ADMIN', 'SUB_ADMIN')
  list(@CurrentUser() user: AuthUser) {
    return this.types.list(user.id);
  }

  @Get('task-types/:id')
  @RequireRoles('ADMIN', 'SUB_ADMIN')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.types.getForUser(id, user.id);
  }

  @Post('task-types')
  @RequireCapability('taskType.create')
  create(@CurrentUser() user: AuthUser, @Body() body: { name: string; category: 'STANDARD' | 'CRITICAL' }) {
    return this.types.create(user, body);
  }

  @Post('task-types/:id/spec-versions')
  @RequireCapability('taskType.create')
  createSpec(@Param('id') id: string, @Body() body: any) {
    return this.types.createSpecVersion(id, body);
  }

  /** Read before publishing: who has to requalify, and what keeps running. */
  @Get('spec-versions/:id/publish-impact')
  @RequireCapability('taskType.create')
  impact(@Param('id') id: string) {
    return this.types.publishImpact(id);
  }

  @Post('spec-versions/:id/publish')
  @RequireCapability('specVersion.publish')
  publish(@Param('id') id: string) {
    return this.types.publish(id);
  }
}
