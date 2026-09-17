import { BadRequestException, Injectable } from '@nestjs/common';
import crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Section 15 - identity binding. Bind by numeric Telegram user id, never by
 * username or phone number: both are mutable and recyclable.
 */
@Injectable()
export class TelegramService {
  constructor(private readonly db: PrismaService) {}

  /** Minted on the web console, carried through a t.me deep link. */
  async mintNonce(userId: string) {
    const nonce = crypto.randomBytes(16).toString('hex');
    await this.db.telegramLinkNonce.create({
      data: { nonce, userId, expiresAt: new Date(Date.now() + 10 * 60_000) },
    });
    const botName = process.env.TELEGRAM_BOT_USERNAME || 'your_bot';
    return { nonce, url: `https://t.me/${botName}?start=${nonce}`, expiresInSeconds: 600 };
  }

  /** The bot exchanges the nonce for a binding. Guarded by the internal secret. */
  async resolveNonce(nonce: string, telegramUserId: string) {
    const row = await this.db.telegramLinkNonce.findUnique({ where: { nonce } });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw new BadRequestException('That link has expired. Request a new one from the console.');
    }

    const id = BigInt(telegramUserId);

    await this.db.$transaction([
      // A telegram id binds to exactly one user; rebinding moves it.
      this.db.user.updateMany({
        where: { telegramUserId: id, id: { not: row.userId } },
        data: { telegramUserId: null },
      }),
      this.db.user.update({ where: { id: row.userId }, data: { telegramUserId: id } }),
      this.db.telegramLinkNonce.update({ where: { nonce }, data: { usedAt: new Date() } }),
    ]);

    const user = await this.db.user.findUniqueOrThrow({ where: { id: row.userId } });
    return { userId: user.id, name: user.name, role: user.role };
  }

  /**
   * Resolve a Telegram id to a session. Unknown senders get null and the bot
   * stays silent - a bot that replies "you are not authorised" has told a
   * stranger it is worth probing.
   */
  async userForTelegramId(telegramUserId: string) {
    const user = await this.db.user.findUnique({
      where: { telegramUserId: BigInt(telegramUserId) },
    });
    if (!user || user.status !== 'active') return null;
    if (user.role === 'TASKER') return null; // Taskers never appear on Telegram.
    return { id: user.id, name: user.name, role: user.role };
  }

  /** Break-glass for section 25 question 1 - unbind immediately from the console. */
  async unbind(userId: string) {
    await this.db.user.update({ where: { id: userId }, data: { telegramUserId: null } });
    return { ok: true };
  }
}
