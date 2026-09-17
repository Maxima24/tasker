import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { MIN_PASSWORD_LENGTH } from './auth.service';

/**
 * The first admin on a fresh server, without the demo seed (which empties the
 * database). Runs at startup, does something only while there is no admin at
 * all, and makes that admin choose a new password on first sign-in, so the
 * one in the server's environment stops working the moment it has been used.
 *
 * Set BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME and BOOTSTRAP_ADMIN_PASSWORD.
 */
@Injectable()
export class BootstrapAdminService implements OnApplicationBootstrap {
  private readonly log = new Logger(BootstrapAdminService.name);

  constructor(private readonly db: PrismaService) {}

  async onApplicationBootstrap() {
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase().trim();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    if (!email || !password) return;

    const admins = await this.db.user.count({ where: { role: 'ADMIN' } });
    if (admins > 0) return;

    if (password.length < MIN_PASSWORD_LENGTH) {
      this.log.error(
        `BOOTSTRAP_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters. No admin was created.`,
      );
      return;
    }

    const existing = await this.db.user.findUnique({ where: { email } });
    if (existing) {
      this.log.error(`${email} already exists as a ${existing.role}. No admin was created.`);
      return;
    }

    await this.db.user.create({
      data: {
        email,
        name: process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Admin',
        role: 'ADMIN',
        passwordHash: await bcrypt.hash(password, 10),
        mustChangePassword: true,
      },
    });
    this.log.log(`created the first admin, ${email}. They choose a new password on first sign-in.`);
  }
}
