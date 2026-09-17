import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { PushService } from './push.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser, RequireRoles } from '../auth/auth.guard';

/** Devices an admin or sub-admin has allowed to receive ticket alerts. */
@Controller('push')
@RequireRoles('ADMIN', 'SUB_ADMIN')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('config')
  config(@CurrentUser() user: AuthUser) {
    return this.push.config(user);
  }

  @Post('subscribe')
  subscribe(
    @CurrentUser() user: AuthUser,
    @Body() body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } },
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.push.subscribe(user, body, userAgent);
  }

  @Post('unsubscribe')
  unsubscribe(@CurrentUser() user: AuthUser, @Body('endpoint') endpoint: string) {
    return this.push.unsubscribe(user, endpoint);
  }

  @Post('test')
  test(@CurrentUser() user: AuthUser) {
    return this.push.test(user);
  }
}
