import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginThrottleService } from './login-throttle.service';

export const MIN_PASSWORD_LENGTH = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly db: PrismaService,
    private readonly jwt: JwtService,
    private readonly throttle: LoginThrottleService,
  ) {}

  /** Invite-only for every role (section 22). There is no public signup path. */
  async login(email: string, password: string, ip?: string) {
    const normalized = (email ?? '').toLowerCase().trim();
    await this.throttle.assertAllowed(normalized, ip);

    const user = await this.db.user.findUnique({ where: { email: normalized } });
    const ok =
      !!user?.passwordHash &&
      user.status === 'active' &&
      (await bcrypt.compare(password ?? '', user.passwordHash));
    if (!ok || !user) {
      await this.throttle.recordFailure(normalized, ip);
      throw new UnauthorizedException('Those credentials do not match an active account.');
    }

    await this.throttle.clear(normalized);
    return { user: this.publicUser(user), token: await this.sign(user) };
  }

  /**
   * `pwc` marks a session that may do nothing but choose a new password. The
   * guard enforces it, so skipping the screen in the browser gains nothing.
   */
  async sign(user: { id: string; role: string; name: string; mustChangePassword?: boolean }) {
    return this.jwt.signAsync({
      sub: user.id,
      role: user.role,
      name: user.name,
      ...(user.mustChangePassword ? { pwc: true } : {}),
    });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) throw new UnauthorizedException('Account not found.');

    if (!(await bcrypt.compare(currentPassword ?? '', user.passwordHash))) {
      throw new BadRequestException('Your current password is not right.');
    }
    const next = newPassword ?? '';
    if (next.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    if (next === currentPassword) {
      throw new BadRequestException('Choose a password different from the current one.');
    }
    if (next.toLowerCase().includes(user.email.split('@')[0].toLowerCase())) {
      throw new BadRequestException('Do not use your email name in the password.');
    }

    const updated = await this.db.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(next, 10), mustChangePassword: false },
    });
    return { user: this.publicUser(updated), token: await this.sign(updated) };
  }

  async me(id: string) {
    const user = await this.db.user.findUnique({ where: { id } });
    if (!user) throw new UnauthorizedException('Account not found.');
    return this.publicUser(user);
  }

  private publicUser(u: any) {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      telegramLinked: u.telegramUserId != null,
      mustChangePassword: !!u.mustChangePassword,
    };
  }
}
