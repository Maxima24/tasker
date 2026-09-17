import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { r2, r2Configured, videoBucket } from '../common/r2';
import { isProduction } from '../common/production-config';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'video');
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

/**
 * The most one response carries. A player asking for "bytes=0-" gets the first
 * slice, then asks for the next as it plays - so the file arrives as a stream
 * of pieces, never as one download that can be saved whole.
 */
const CHUNK_BYTES = 2 * 1024 * 1024;

/** A playback link lives this long. Long enough for a slow watch, not for sharing. */
const LINK_TTL_SEC = 6 * 60 * 60;
/**
 * Expiry is rounded to this, so the same person gets the SAME link for an hour.
 * A link that changed on every refetch would restart the video under them.
 */
const LINK_BUCKET_SEC = 60 * 60;

/** Where a request for the file comes from, per the browser. Only players may stream. */
const REFUSED_DESTINATIONS = new Set(['document', 'iframe', 'frame', 'embed', 'object']);

export interface StoredVideo {
  provider: 'r2' | 'local';
  /** An internal locator (r2:<key> or local:<name>). Never a public address. */
  url: string;
  storageRef: string;
  durationSeconds: number;
}

type Source =
  | { kind: 'r2'; key: string }
  | { kind: 'local'; name: string }
  | { kind: 'remote'; url: string };

interface Located {
  source: Source;
  size: number;
  contentType: string;
}

/**
 * Where tutorial videos live, and how they reach a player.
 *
 * Files go to a Cloudflare R2 bucket. The bucket is public on Cloudflare's
 * side, but its address never reaches a browser: every response names a
 * tutorial by id, and playback runs through a signed, per-person, expiring
 * stream route on this API that hands the file over in small ranges. Object
 * keys are random, so the bucket cannot be walked either.
 *
 * Without R2 keys the service stores on this API's disk and streams the same
 * way, and the Videos page says so rather than failing an upload in front of a
 * non-technical admin.
 */
@Injectable()
export class VideoStorageService {
  private readonly log = new Logger(VideoStorageService.name);
  private readonly sizes = new Map<string, { size: number; contentType: string; at: number }>();

  get configured(): boolean {
    return r2Configured();
  }

  private get bucket(): string {
    return videoBucket();
  }

  /** The bucket's public address, when one is set. Read from here, never handed out. */
  private get publicBase(): string | null {
    const base = process.env.R2_PUBLIC_URL?.trim();
    return base ? base.replace(/\/+$/, '') : null;
  }

  private s3() {
    return r2();
  }

  describe() {
    return {
      provider: this.configured ? ('r2' as const) : ('local' as const),
      bucket: this.configured ? this.bucket : null,
      // Every video streams through the API either way. Surfaced so the
      // Videos page can say it in a sentence.
      streaming: true,
      publicUrlSet: Boolean(this.publicBase),
    };
  }

  // --- upload --------------------------------------------------------

  /**
   * Accepts the file multer wrote to a temp path. Large videos are streamed to
   * R2 in parts rather than held in memory.
   */
  async store(file: {
    path?: string;
    buffer?: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
  }): Promise<StoredVideo> {
    if (!file || (!file.path && !file.buffer?.length)) {
      throw new BadRequestException('No video received.');
    }
    try {
      if (file.size > MAX_VIDEO_BYTES) {
        throw new BadRequestException('That video is over 500MB. Trim it or lower the quality.');
      }
      if (!file.mimetype?.startsWith('video/')) {
        throw new BadRequestException('That file is not a video.');
      }

      // On a server whose disk is wiped every deploy, a local copy is a video
      // that silently disappears. Say so instead of pretending it worked.
      if (isProduction()) {
        if (!this.configured) {
          throw new BadRequestException(
            'Video storage is not set up on this server yet. Ask whoever runs it to add the Cloudflare R2 keys.',
          );
        }
        return await this.toR2(file);
      }

      if (this.configured) {
        try {
          return await this.toR2(file);
        } catch (e: any) {
          // On a laptop, falling back beats losing the upload.
          this.log.warn(`R2 upload failed, storing locally: ${e?.message}`);
        }
      }
      return await this.toDisk(file);
    } finally {
      if (file.path) await fsp.rm(file.path, { force: true }).catch(() => undefined);
    }
  }

  private extensionFor(file: { originalname: string; mimetype: string }) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (/^\.[a-z0-9]{2,5}$/.test(ext)) return ext;
    return file.mimetype === 'video/quicktime' ? '.mov' : '.mp4';
  }

  private async toR2(file: {
    path?: string;
    buffer?: Buffer;
    originalname: string;
    mimetype: string;
  }): Promise<StoredVideo> {
    const month = new Date().toISOString().slice(0, 7);
    // Random, not derived from the name: nobody can guess their way to a file.
    const key = `videos/${month}/${crypto.randomBytes(16).toString('hex')}${this.extensionFor(file)}`;

    await new Upload({
      client: this.s3(),
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: file.path ? fs.createReadStream(file.path) : file.buffer,
        ContentType: file.mimetype,
        ContentDisposition: 'inline',
      },
      partSize: 8 * 1024 * 1024,
      queueSize: 4,
    }).done();

    return { provider: 'r2', url: `r2:${key}`, storageRef: key, durationSeconds: 0 };
  }

  private async toDisk(file: {
    path?: string;
    buffer?: Buffer;
    originalname: string;
    mimetype: string;
  }): Promise<StoredVideo> {
    await fsp.mkdir(UPLOAD_DIR, { recursive: true });
    const name = `${crypto.randomBytes(16).toString('hex')}${this.extensionFor(file)}`;
    const target = path.join(UPLOAD_DIR, name);
    if (file.path) {
      await fsp.copyFile(file.path, target);
    } else {
      await fsp.writeFile(target, file.buffer!);
    }
    // Duration is read from the file in the browser and sent alongside; the
    // server has no decoder and will not guess.
    return { provider: 'local', url: `local:${name}`, storageRef: name, durationSeconds: 0 };
  }

  /** Deletes the underlying file. Callers check nothing else still points at it. */
  async remove(videoUrl: string) {
    const source = this.locate({ videoUrl });
    try {
      if (source.kind === 'r2' && this.configured) {
        await this.s3().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: source.key }));
      } else if (source.kind === 'local') {
        await fsp.rm(path.join(UPLOAD_DIR, source.name), { force: true });
      }
    } catch (e: any) {
      // An orphaned file costs storage, not correctness. Never fail the delete.
      this.log.warn(`could not delete ${videoUrl}: ${e?.message}`);
    }
  }

  // --- playback links ------------------------------------------------

  private sign(tutorialId: string, userId: string, exp: number): string {
    const secret = process.env.JWT_SECRET || 'dev-tasker-jwt-secret-change-me';
    return crypto
      .createHmac('sha256', `media:${secret}`)
      .update(`${tutorialId}.${userId}.${exp}`)
      .digest('base64url');
  }

  /**
   * The only address a browser is ever given for a video: this person, this
   * tutorial, for a few hours. Copy it into another account or another day and
   * it plays nothing.
   */
  playbackPath(tutorialId: string, userId: string): string {
    const now = Math.floor(Date.now() / 1000);
    const exp = Math.ceil((now + LINK_TTL_SEC) / LINK_BUCKET_SEC) * LINK_BUCKET_SEC;
    return `/tutorials/${tutorialId}/stream?exp=${exp}&sig=${this.sign(tutorialId, userId, exp)}`;
  }

  verify(tutorialId: string, userId: string, exp: string, sig: string) {
    const expires = Number(exp);
    if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) {
      throw new ForbiddenException('This video link has expired. Reload the page to keep watching.');
    }
    const expected = Buffer.from(this.sign(tutorialId, userId, expires));
    const given = Buffer.from(String(sig ?? ''));
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
      throw new ForbiddenException('This video link is not valid for your account.');
    }
  }

  /**
   * Swaps the internal locator on a tutorial for a playback link. Every
   * response that carries a tutorial goes through here, so no surface can leak
   * where the file actually lives.
   */
  playable<T extends { id: string; videoUrl?: string; storageRef?: string | null; provider?: string }>(
    tutorial: T,
    userId: string,
  ): Omit<T, 'videoUrl' | 'storageRef'> & { streamUrl: string } {
    const { videoUrl: _url, storageRef: _ref, ...rest } = tutorial;
    return { ...rest, streamUrl: this.playbackPath(tutorial.id, userId) };
  }

  // --- streaming -----------------------------------------------------

  private locate(t: { videoUrl: string; provider?: string | null; storageRef?: string | null }): Source {
    const url = t.videoUrl ?? '';
    if (url.startsWith('r2:')) return { kind: 'r2', key: url.slice(3) };
    if (url.startsWith('local:')) return { kind: 'local', name: path.basename(url.slice(6)) };
    // Rows written before streaming: served from disk by file name.
    if (url.startsWith('/tutorials/file/')) return { kind: 'local', name: path.basename(url) };
    if (t.provider === 'r2' && t.storageRef) return { kind: 'r2', key: t.storageRef };
    if (/^https:\/\//i.test(url)) return { kind: 'remote', url };
    throw new NotFoundException('That video has no file behind it.');
  }

  private r2PublicUrl(key: string): string | null {
    const base = this.publicBase;
    return base ? `${base}/${key.split('/').map(encodeURIComponent).join('/')}` : null;
  }

  /** Size and type, cached briefly so every chunk does not cost a HEAD request. */
  private async probe(source: Source): Promise<Located> {
    const cacheKey = JSON.stringify(source);
    const hit = this.sizes.get(cacheKey);
    if (hit && Date.now() - hit.at < 10 * 60_000) {
      return { source, size: hit.size, contentType: hit.contentType };
    }

    let size = 0;
    let contentType = 'video/mp4';

    if (source.kind === 'local') {
      const stat = await fsp.stat(path.join(UPLOAD_DIR, source.name)).catch(() => null);
      if (!stat) throw new NotFoundException('That video file is missing.');
      size = stat.size;
      if (source.name.endsWith('.mov')) contentType = 'video/quicktime';
      if (source.name.endsWith('.webm')) contentType = 'video/webm';
    } else if (source.kind === 'r2' && this.configured) {
      const head = await this.s3()
        .send(new HeadObjectCommand({ Bucket: this.bucket, Key: source.key }))
        .catch(() => null);
      if (!head?.ContentLength) throw new NotFoundException('That video file is missing.');
      size = head.ContentLength;
      contentType = head.ContentType || contentType;
    } else {
      const url = source.kind === 'r2' ? this.r2PublicUrl(source.key) : source.url;
      if (!url) throw new NotFoundException('Video storage is not configured on this server.');
      const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
      const total = res.headers.get('content-range')?.split('/')[1];
      size = Number(total ?? res.headers.get('content-length') ?? 0);
      contentType = res.headers.get('content-type') || contentType;
      await res.body?.cancel().catch(() => undefined);
      if (!res.ok || !size) throw new NotFoundException('That video file is missing.');
    }

    this.sizes.set(cacheKey, { size, contentType, at: Date.now() });
    return { source, size, contentType };
  }

  /**
   * Answers one range request from a player. Refuses to act as a download:
   * no Range header, or a request the browser itself labels as a page or a
   * frame rather than a video element, gets nothing.
   */
  async stream(
    tutorial: { videoUrl: string; provider?: string | null; storageRef?: string | null },
    req: Request,
    res: Response,
  ) {
    const dest = String(req.headers['sec-fetch-dest'] ?? '').toLowerCase();
    if (REFUSED_DESTINATIONS.has(dest)) {
      throw new ForbiddenException('Videos play inside the app. They cannot be opened or saved directly.');
    }
    const range = String(req.headers.range ?? '');
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match || (!match[1] && !match[2])) {
      throw new ForbiddenException('Videos play inside the app. They cannot be downloaded.');
    }

    const located = await this.probe(this.locate(tutorial));
    const { size } = located;

    let start: number;
    let end: number;
    if (!match[1]) {
      // bytes=-500: the last 500 bytes (players read the index at the tail).
      const suffix = Math.min(Number(match[2]), size);
      start = size - suffix;
      end = size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : size - 1;
    }
    end = Math.min(end, size - 1, start + CHUNK_BYTES - 1);

    if (start >= size || start > end) {
      res.status(416).setHeader('Content-Range', `bytes */${size}`);
      res.end();
      return;
    }

    const upstream = await this.open(located.source, start, end);

    res.status(206);
    res.setHeader('Content-Type', located.contentType);
    res.setHeader('Content-Length', String(end - start + 1));
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    // A player that seeks abandons the request it was reading. Stop pulling
    // from storage the moment it does.
    res.on('close', () => upstream.destroy());
    upstream.on('error', (e) => {
      this.log.warn(`stream interrupted: ${e.message}`);
      res.destroy(e);
    });
    upstream.pipe(res);
  }

  private async open(source: Source, start: number, end: number): Promise<Readable> {
    if (source.kind === 'local') {
      return fs.createReadStream(path.join(UPLOAD_DIR, source.name), { start, end });
    }

    const publicUrl = source.kind === 'r2' ? this.r2PublicUrl(source.key) : source.url;

    // Prefer the bucket's public address when there is one: no signing per
    // read, and Cloudflare can serve repeat ranges from its edge.
    if (publicUrl) {
      const res = await fetch(publicUrl, { headers: { Range: `bytes=${start}-${end}` } });
      if (res.ok && res.body) return Readable.fromWeb(res.body as any);
      await res.body?.cancel().catch(() => undefined);
      if (source.kind === 'remote' || !this.configured) {
        throw new NotFoundException('That video could not be loaded.');
      }
    }

    if (source.kind === 'r2' && this.configured) {
      const out = await this.s3().send(
        new GetObjectCommand({ Bucket: this.bucket, Key: source.key, Range: `bytes=${start}-${end}` }),
      );
      return out.Body as Readable;
    }
    throw new NotFoundException('Video storage is not configured on this server.');
  }
}
