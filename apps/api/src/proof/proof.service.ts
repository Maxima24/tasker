import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { ChecklistItem } from '../tasks/tasks.service';
import { AuthUser } from '../auth/auth.guard';
import { proofBucket, r2, r2Configured } from '../common/r2';
import { isProduction } from '../common/production-config';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
export const MAX_PROOF_BYTES = 15 * 1024 * 1024;

/**
 * Raster screenshots only. SVG is refused: it is a document that can carry
 * script, and these files are served from the console's own address.
 */
const PROOF_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
};

/**
 * Section 11. Proof is slotted against the checklist, never uploaded as an
 * unordered batch, so review is a comparison rather than an excavation.
 */
@Injectable()
export class ProofService {
  constructor(private readonly db: PrismaService) {}

  async upload(
    taskerId: string,
    taskId: string,
    checklistKey: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ) {
    const task = await this.db.task.findUnique({
      where: { id: taskId },
      include: { specVersion: true },
    });
    if (!task) throw new NotFoundException('No such task.');
    if (task.assigneeId !== taskerId) throw new BadRequestException('That task is not yours.');

    const checklist = (task.specVersion.checklist as unknown as ChecklistItem[]) ?? [];
    const item = checklist.find((c) => c.key === checklistKey);
    if (!item) throw new BadRequestException('That checklist slot does not exist on this spec.');
    if (!item.requiresProof) {
      throw new BadRequestException('That checklist item does not take proof.');
    }
    const ext = PROOF_TYPES[file.mimetype];
    if (!ext) {
      throw new BadRequestException('Upload a screenshot image: PNG, JPG or WebP.');
    }
    if (file.size > MAX_PROOF_BYTES) {
      throw new BadRequestException('That image is over 15MB. Take the screenshot again or crop it.');
    }

    const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const phash = perceptualHash(file.buffer);
    const storageKey = await this.store(taskId, checklistKey, ext, file);

    // Check this tasker's own history first, then everyone else's. A match is a
    // note on the frame, never an auto-rejection: legitimate repeats exist.
    const duplicate = await this.findDuplicate(taskerId, sha256, phash, taskId);

    const proof = await this.db.proof.upsert({
      where: { taskId_checklistKey: { taskId, checklistKey } },
      create: {
        taskId,
        checklistKey,
        storageKey,
        sha256,
        phash,
        byteSize: file.size,
        mimeType: file.mimetype,
        duplicateOfId: duplicate?.id ?? null,
      },
      update: {
        storageKey,
        sha256,
        phash,
        byteSize: file.size,
        mimeType: file.mimetype,
        receivedAt: new Date(),
        duplicateOfId: duplicate?.id ?? null,
        telegramFileId: null,
      },
    });

    return {
      ...proof,
      duplicateNote: duplicate
        ? {
            proofId: duplicate.id,
            taskCode: duplicate.task.code,
            sameTasker: duplicate.task.assigneeId === taskerId,
            exact: duplicate.sha256 === sha256,
          }
        : null,
    };
  }

  private async findDuplicate(taskerId: string, sha256: string, phash: string, exceptTaskId: string) {
    const own = await this.db.proof.findFirst({
      where: {
        taskId: { not: exceptTaskId },
        OR: [{ sha256 }, { phash }],
        task: { assigneeId: taskerId },
      },
      include: { task: { select: { code: true, assigneeId: true } } },
      orderBy: { receivedAt: 'desc' },
    });
    if (own) return own;

    return this.db.proof.findFirst({
      where: { taskId: { not: exceptTaskId }, OR: [{ sha256 }, { phash }] },
      include: { task: { select: { code: true, assigneeId: true } } },
      orderBy: { receivedAt: 'desc' },
    });
  }

  /** The submission screen renders one slot per checklist item that needs proof. */
  async forTask(taskId: string) {
    const task = await this.db.task.findUnique({
      where: { id: taskId },
      include: {
        specVersion: true,
        proofs: { include: { duplicateOf: { include: { task: { select: { code: true } } } } } },
      },
    });
    if (!task) throw new NotFoundException('No such task.');

    const checklist = (task.specVersion.checklist as unknown as ChecklistItem[]) ?? [];
    const byKey = new Map(task.proofs.map((p) => [p.checklistKey, p]));

    const slots = checklist.map((item) => {
      const proof = byKey.get(item.key);
      return {
        ...item,
        proof: proof
          ? {
              id: proof.id,
              url: `/proof/${proof.id}/file`,
              receivedAt: proof.receivedAt,
              byteSize: proof.byteSize,
              duplicateOf: proof.duplicateOf
                ? { proofId: proof.duplicateOf.id, taskCode: proof.duplicateOf.task.code }
                : null,
            }
          : null,
      };
    });

    return {
      slots,
      // Section 11 - server receipt time is the only trusted timestamp, and the
      // SPREAD across one submission is the honest signal. Twelve files in nine
      // seconds after three silent hours says something no file metadata can.
      receiptSpread: receiptSpread(task.proofs.map((p) => p.receivedAt)),
    };
  }

  async setTelegramFileId(proofId: string, fileId: string) {
    await this.db.proof.update({ where: { id: proofId }, data: { telegramFileId: fileId } });
    return { ok: true };
  }

  /**
   * Where a screenshot is written. R2 when it is configured, and always in
   * production - Render wipes local disk on every deploy, which would quietly
   * delete evidence somebody is paid on.
   */
  private async store(
    taskId: string,
    checklistKey: string,
    ext: string,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<string> {
    // A random name: knowing one screenshot's key says nothing about another.
    const safeKey = checklistKey.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'step';
    const name = `${safeKey}-${crypto.randomBytes(12).toString('hex')}${ext}`;

    if (r2Configured()) {
      const key = `proofs/${taskId}/${name}`;
      await r2().send(
        new PutObjectCommand({
          Bucket: proofBucket(),
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );
      return `r2:${key}`;
    }
    if (isProduction()) {
      throw new BadRequestException(
        'Screenshot storage is not set up on this server yet. Tell your admin - nothing was saved.',
      );
    }
    await fs.mkdir(path.join(UPLOAD_DIR, taskId), { recursive: true });
    await fs.writeFile(path.join(UPLOAD_DIR, taskId, name), file.buffer);
    return `${taskId}/${name}`;
  }

  /** Who may look: the tasker whose task it is, and anyone who assigns or reviews. */
  async assertCanView(user: AuthUser, taskId: string) {
    if (user.role !== 'TASKER') return;
    const task = await this.db.task.findUnique({
      where: { id: taskId },
      select: { assigneeId: true },
    });
    if (!task || task.assigneeId !== user.id) {
      throw new ForbiddenException("Those screenshots belong to somebody else's task.");
    }
  }

  async file(user: AuthUser, proofId: string) {
    const proof = await this.db.proof.findUnique({ where: { id: proofId } });
    if (!proof) throw new NotFoundException('No such proof.');
    await this.assertCanView(user, proof.taskId);

    if (proof.storageKey.startsWith('r2:')) {
      if (!r2Configured()) throw new NotFoundException('Screenshot storage is not configured.');
      const out = await r2().send(
        new GetObjectCommand({ Bucket: proofBucket(), Key: proof.storageKey.slice(3) }),
      );
      const buffer = Buffer.from(await out.Body!.transformToByteArray());
      return { buffer, mimeType: proof.mimeType };
    }

    // Local files: never let a stored key walk out of the upload directory.
    const local = path.resolve(UPLOAD_DIR, proof.storageKey);
    if (!local.startsWith(UPLOAD_DIR + path.sep)) throw new NotFoundException('No such proof.');
    const buffer = await fs.readFile(local).catch(() => {
      throw new NotFoundException('That screenshot file is missing.');
    });
    return { buffer, mimeType: proof.mimeType };
  }
}

/**
 * Stand-in perceptual hash: a 64-bit signature over the byte-value histogram,
 * which survives recompression of the same screenshot where sha256 does not.
 * A real DCT phash needs image decoding - swap this for one when sharp or
 * jimp is available. The call sites and the stored column do not change.
 */
function perceptualHash(buffer: Buffer): string {
  const buckets = new Array(64).fill(0);
  for (let i = 0; i < buffer.length; i++) {
    buckets[buffer[i] >> 2] += 1;
  }
  const mean = buffer.length / 64;
  let bits = '';
  for (const count of buckets) bits += count > mean ? '1' : '0';
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
}

function receiptSpread(times: Date[]) {
  if (times.length < 2) return null;
  const sorted = [...times].sort((a, b) => a.getTime() - b.getTime());
  const seconds = (sorted[sorted.length - 1].getTime() - sorted[0].getTime()) / 1000;
  return {
    count: sorted.length,
    spreadSeconds: Math.round(seconds),
    firstAt: sorted[0],
    lastAt: sorted[sorted.length - 1],
    // A whole submission arriving inside a minute is worth a reviewer's glance.
    burst: seconds < 60,
  };
}
