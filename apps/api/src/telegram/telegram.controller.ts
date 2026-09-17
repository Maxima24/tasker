import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser, Public } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';

@Controller('telegram')
export class TelegramController {
  constructor(
    private readonly telegram: TelegramService,
    private readonly auth: AuthService,
  ) {}

  @Post('link')
  mint(@CurrentUser() user: AuthUser) {
    return this.telegram.mintNonce(user.id);
  }

  @Post('unbind')
  unbind(@CurrentUser() user: AuthUser) {
    return this.telegram.unbind(user.id);
  }

  /**
   * The bot exchanges a nonce for a binding, then exchanges a telegram id for a
   * session token. Both are guarded by the shared internal secret - this is a
   * service-to-service route, never reachable from a browser session.
   */
  @Public()
  @Post('resolve')
  async resolve(
    @Headers('x-internal-secret') secret: string,
    @Body() body: { nonce: string; telegramUserId: string },
  ) {
    this.assertInternal(secret);
    return this.telegram.resolveNonce(body.nonce, body.telegramUserId);
  }

  @Public()
  @Post('session')
  async session(
    @Headers('x-internal-secret') secret: string,
    @Body() body: { telegramUserId: string },
  ) {
    this.assertInternal(secret);
    const user = await this.telegram.userForTelegramId(body.telegramUserId);
    // Null, not an error: the bot stays silent for unknown senders.
    if (!user) return { linked: false };
    return {
      linked: true,
      user,
      sessionToken: await this.auth.sign({ id: user.id, role: user.role, name: user.name }),
    };
  }

  private assertInternal(secret: string) {
    const expected =
      process.env.INTERNAL_API_SECRET ||
      (process.env.NODE_ENV === 'production' ? '' : 'dev-internal-secret-change-me');
    if (!expected || secret !== expected) throw new UnauthorizedException();
  }
}
