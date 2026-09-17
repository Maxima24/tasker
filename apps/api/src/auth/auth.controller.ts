import { Body, Controller, Get, Ip, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { AllowDuringPasswordChange, AuthUser, Public } from './auth.guard';

function setSession(res: Response, token: string) {
  // httpOnly cookie: the console is a browser surface and must not hold the
  // token anywhere script can read it. Sessions are short-lived (section 22).
  res.cookie('tasker_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000,
    path: '/',
  });
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  async login(
    @Body() body: { email: string; password: string },
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, token } = await this.auth.login(body.email, body.password, ip);
    setSession(res, token);
    return { user, token };
  }

  @Post('logout')
  @Public()
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('tasker_session', { path: '/' });
    return { ok: true };
  }

  @Get('me')
  @AllowDuringPasswordChange()
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  /** Also how a session made with a temporary password becomes a normal one. */
  @Post('password')
  @AllowDuringPasswordChange()
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() body: { currentPassword: string; newPassword: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user: updated, token } = await this.auth.changePassword(
      user.id,
      body.currentPassword,
      body.newPassword,
    );
    setSession(res, token);
    return { user: updated };
  }
}
