import { S3Client } from '@aws-sdk/client-s3';

/**
 * One Cloudflare R2 client for everything the API stores: tutorial videos and
 * proof screenshots. Render wipes a service's disk on every deploy, so in
 * production these are the only place files survive.
 */
let client: S3Client | undefined;

export function r2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  );
}

export function r2(): S3Client {
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return client;
}

export function videoBucket(): string {
  return process.env.R2_BUCKET!;
}

/**
 * Screenshots show real accounts, so they can live in a separate PRIVATE
 * bucket. Without R2_PROOF_BUCKET they share the video bucket, under random
 * keys that are only ever read through the API.
 */
export function proofBucket(): string {
  return process.env.R2_PROOF_BUCKET || process.env.R2_BUCKET!;
}
