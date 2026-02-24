import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { loadConfig } from './config.js';
import { MirrorDb } from './db/sqlite.js';
import { AllowlistStore } from './security/allowlist.js';
import { FileCache } from './cache/file-cache.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerInternalRoutes } from './routes/internal.js';
import type { AppServices } from './server-context.js';

const config = loadConfig();
dns.setDefaultResultOrder('ipv4first');
const app = Fastify({ logger: true, trustProxy: true });

await app.register(cors, { origin: false });
await app.register(rateLimit, {
  global: false,
  keyGenerator: (request) => {
    const fwd = request.headers['cf-connecting-ip'];
    if (typeof fwd === 'string' && fwd) return fwd;
    return request.ip;
  }
});

fs.mkdirSync(path.dirname(config.MIRROR_DB_PATH), { recursive: true });
fs.mkdirSync(config.MIRROR_CACHE_DIR, { recursive: true });

const db = new MirrorDb(config.MIRROR_DB_PATH);
const allowlist = new AllowlistStore(config.MIRROR_ALLOWLIST_PATH);
const cache = new FileCache(
  config.MIRROR_CACHE_DIR,
  config.MIRROR_CACHE_TTL_SECONDS,
  config.MIRROR_CACHE_MAX_BYTES
);

const services: AppServices = {
  config,
  db,
  allowlist,
  cache,
  state: {
    serviceDisabled: config.MIRROR_DISABLE_SERVICE,
    startedAtMs: Date.now()
  },
  logger: app.log
};

if (config.MIRROR_LOG_FILE) {
  fs.mkdirSync(path.dirname(config.MIRROR_LOG_FILE), { recursive: true });
  const originalLogEvent = db.logEvent.bind(db);
  db.logEvent = ((params: Parameters<typeof originalLogEvent>[0]) => {
    const event = originalLogEvent(params);
    try {
      fs.appendFileSync(config.MIRROR_LOG_FILE!, JSON.stringify(event) + '\n');
    } catch {
      // best effort only
    }
    return event;
  }) as typeof db.logEvent;
}

app.addHook('onRequest', async (request, reply) => {
  reply.header('x-robots-tag', 'noindex, nofollow');
  if (request.method === 'POST' && (request.url.startsWith('/api/resolve') || request.url.startsWith('/internal/actions/test-resolve'))) {
    await (app as any).rateLimit({ max: 10, timeWindow: '1 minute' })(request, reply);
    if (reply.sent) return;
  }
  if (request.method === 'POST' && request.url.startsWith('/internal/')) {
    await (app as any).rateLimit({ max: 60, timeWindow: '1 minute' })(request, reply);
    if (reply.sent) return;
  }
});

await registerPublicRoutes(app, services);
await registerInternalRoutes(app, services);

app.setNotFoundHandler(async (_request, reply) => {
  reply.code(404).send({ ok: false, error: 'not_found' });
});

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, 'Unhandled mirror error');
  if (reply.sent) return;
  const code = (error as any).statusCode && Number.isInteger((error as any).statusCode)
    ? (error as any).statusCode
    : 500;
  reply.code(code).send({
    ok: false,
    error: code === 500 ? 'internal_error' : error instanceof Error ? error.message : 'request_failed'
  });
});

await app.listen({ port: config.PORT, host: config.HOST });
