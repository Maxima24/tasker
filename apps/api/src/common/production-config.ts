/**
 * Refuses to start a production server on development defaults.
 *
 * Every secret below has a "dev-...-change-me" fallback so the app runs on a
 * laptop with no setup. On a real server those fallbacks would sign sessions
 * and encrypt account passwords with keys printed in this repository, so the
 * process stops at boot and names what is missing instead.
 */
const DEV_DEFAULTS = [
  'dev-tasker-jwt-secret-change-me',
  'dev-tasker-vault-key-change-me',
  'dev-internal-secret-change-me',
];

export const isProduction = () => process.env.NODE_ENV === 'production';

export function assertProductionConfig(): void {
  if (!isProduction()) return;

  const problems: string[] = [];
  const secret = (key: string, minLength: number) => {
    const value = process.env[key];
    if (!value) problems.push(`${key} is not set`);
    else if (DEV_DEFAULTS.includes(value)) problems.push(`${key} is still the development default`);
    else if (value.length < minLength) problems.push(`${key} is shorter than ${minLength} characters`);
  };

  if (!process.env.DATABASE_URL) problems.push('DATABASE_URL is not set');
  if (!process.env.REDIS_URL) problems.push('REDIS_URL is not set');
  secret('JWT_SECRET', 32);
  // Losing or changing this makes every stored account password unreadable.
  secret('VAULT_KEY_SECRET', 32);
  secret('INTERNAL_API_SECRET', 24);

  if (problems.length) {
    throw new Error(
      `Refusing to start in production:\n  - ${problems.join('\n  - ')}\nSet these in the service's environment and deploy again.`,
    );
  }

  // Not fatal: the console still works without file storage. Uploads are
  // refused with a plain message rather than written to a disk that Render
  // wipes on every deploy.
  const r2 = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
  const missing = r2.filter((k) => !process.env[k]);
  if (missing.length) {
    console.warn(
      `[storage] ${missing.join(', ')} not set. Video and screenshot uploads are disabled until Cloudflare R2 is configured.`,
    );
  }
}
