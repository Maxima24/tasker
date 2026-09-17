import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TaskersService } from './taskers.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser, RequireCapability, RequireRoles } from '../auth/auth.guard';
import { SettingsService } from '../common/settings.service';
import { parsePage } from '../common/pagination';

@Controller()
export class TaskersController {
  constructor(
    private readonly taskers: TaskersService,
    private readonly settings: SettingsService,
  ) {}

  @Get('taskers')
  pool(@Query('certifiedFor') certifiedFor?: string, @Query('minScore') minScore?: string) {
    return this.taskers.pool(certifiedFor, minScore ? Number(minScore) : undefined);
  }

  @Get('taskers/:id')
  @RequireCapability('tasker.viewAny')
  detail(@Param('id') id: string) {
    return this.taskers.detail(id);
  }

  /** Everything this person submitted, with the evidence attached. */
  @Get('taskers/:id/submissions')
  @RequireCapability('tasker.viewAny')
  submissions(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.taskers.submissions(id, parsePage(page, limit));
  }

  /** The accounts a tasker has been given, with the date each was assigned. */
  @Get('me/accounts')
  @RequireRoles('TASKER')
  myAccounts(@CurrentUser() user: AuthUser) {
    return this.taskers.myAccounts(user.id);
  }

  /** A tasker keeping their own contact details current. */
  @Post('me/profile')
  @RequireRoles('TASKER')
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body() body: { preferredName?: string; phone?: string },
  ) {
    return this.taskers.updateProfile(user.id, body);
  }

  @Post('taskers/invite')
  @RequireCapability('tasker.manage')
  invite(
    @Body()
    body: {
      name: string;
      preferredName?: string;
      email: string;
      phone?: string;
      role?: 'TASKER' | 'SUB_ADMIN';
    },
  ) {
    return this.taskers.invite(body);
  }

  @Post('taskers/recompute-stats')
  recompute() {
    return this.taskers.recomputeAll();
  }

  @Post('work-requests')
  @RequireRoles('TASKER')
  request(@CurrentUser() user: AuthUser) {
    return this.taskers.requestWork(user.id);
  }

  @Get('work-requests')
  open() {
    return this.taskers.openWorkRequests();
  }

  @Get('settings')
  all() {
    return this.settings.all();
  }

  @Post('settings')
  @RequireCapability('weights.edit')
  set(@Body() body: { key: any; value: any }) {
    return this.settings.set(body.key, body.value);
  }
}
