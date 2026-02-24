import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(8085),
  HOST: z.string().default('0.0.0.0'),
  MIRROR_PUBLIC_BASE_URL: z.string().url().default('https://mirror.orizzi.io'),
  MIRROR_INTERNAL_TOKEN: z.string().min(8),
  MIRROR_ALLOWLIST_PATH: z.string().default(path.join(process.cwd(), 'config/allowlist.json')),
  MIRROR_DB_PATH: z.string().default(path.join(process.cwd(), 'data/mirror.db')),
  MIRROR_CACHE_DIR: z.string().default(path.join(process.cwd(), 'cache')),
  MIRROR_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(7200),
  MIRROR_CACHE_MAX_BYTES: z.coerce.number().int().positive().default(1073741824),
  MIRROR_UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
  MIRROR_MAX_HTML_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
  MIRROR_MAX_BINARY_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  MIRROR_ENABLE_HTTP: z
    .string()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),
  MIRROR_DISABLE_SERVICE: z
    .string()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),
  MIRROR_LOG_FILE: z.string().optional().default('')
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig() {
  const parsed = envSchema.parse(process.env);
  return {
    ...parsed,
    appVersion: process.env.npm_package_version ?? '0.1.0',
    publicBaseUrl: new URL(parsed.MIRROR_PUBLIC_BASE_URL),
    methodsAllowed: ['GET', 'HEAD'] as const
  };
}
