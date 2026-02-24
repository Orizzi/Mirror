import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../server-context.js';
import { resolveTargetUrl } from '../mirror/proxy.js';

function isAuthorized(request: FastifyRequest, token: string) {
  const header = request.headers.authorization;
  const xToken = request.headers['x-internal-token'];
  if (typeof xToken === 'string' && xToken === token) return true;
  if (typeof header === 'string' && header === `Bearer ${token}`) return true;
  return false;
}

async function requireInternalAuth(request: FastifyRequest, reply: FastifyReply, services: AppServices) {
  if (isAuthorized(request, services.config.MIRROR_INTERNAL_TOKEN)) return;
  reply.code(401).send({ ok: false, error: 'unauthorized' });
}

const allowlistCreateSchema = z.object({
  id: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/),
  host: z.string().min(1).max(255),
  allowSubdomains: z.boolean().default(false),
  schemes: z.array(z.enum(['https', 'http'])).default(['https']),
  enabled: z.boolean().default(true),
  label: z.string().max(120).optional()
});

const allowlistPatchSchema = allowlistCreateSchema.partial().omit({ id: true });

export async function registerInternalRoutes(app: FastifyInstance, services: AppServices) {
  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/internal/')) return;
    await requireInternalAuth(request, reply, services);
  });

  app.get('/internal/health', async () => ({
    ok: true,
    uptimeSec: Math.floor((Date.now() - services.state.startedAtMs) / 1000),
    serviceDisabled: services.state.serviceDisabled,
    version: services.config.appVersion
  }));

  app.get('/internal/summary', async () => ({
    ok: true,
    serviceDisabled: services.state.serviceDisabled,
    uptimeSec: Math.floor((Date.now() - services.state.startedAtMs) / 1000),
    version: services.config.appVersion,
    authMode: 'basic-auth',
    allowlist: {
      count: services.allowlist.list().length,
      enabledCount: services.allowlist.enabledCount(),
      entries: services.allowlist.list()
    },
    cache: services.cache.stats(),
    mirrors: {
      total: services.db.countMirrors(),
      recent: services.db.listMirrorsRecent(20)
    },
    recentEvents: services.db.listEventsRecent(50),
    security: {
      methods: [...services.config.methodsAllowed],
      noindex: true,
      ssrfGuard: true,
      localBindExpected: '127.0.0.1:8085'
    }
  }));

  app.get('/internal/config', async () => ({
    ok: true,
    publicBaseUrl: services.config.MIRROR_PUBLIC_BASE_URL,
    allowHttp: services.config.MIRROR_ENABLE_HTTP,
    cacheTtlSeconds: services.config.MIRROR_CACHE_TTL_SECONDS,
    cacheMaxBytes: services.config.MIRROR_CACHE_MAX_BYTES,
    upstreamTimeoutMs: services.config.MIRROR_UPSTREAM_TIMEOUT_MS,
    serviceDisabled: services.state.serviceDisabled
  }));

  app.get('/internal/allowlist', async () => ({ ok: true, items: services.allowlist.list() }));

  app.post('/internal/allowlist', async (request, reply) => {
    const parsed = allowlistCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ ok: false, error: 'invalid_body' });
      return;
    }
    const item = services.allowlist.upsert(parsed.data);
    services.db.logEvent({ level: 'info', kind: 'admin-action', message: 'Allowlist entry upserted', meta: { id: item.id, host: item.host } });
    reply.send({ ok: true, item });
  });

  app.patch('/internal/allowlist/:id', async (request, reply) => {
    const parsed = allowlistPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400).send({ ok: false, error: 'invalid_body' });
      return;
    }
    const { id } = request.params as { id: string };
    const item = services.allowlist.patch(id, parsed.data);
    if (!item) {
      reply.code(404).send({ ok: false, error: 'not_found' });
      return;
    }
    services.db.logEvent({ level: 'info', kind: 'admin-action', message: 'Allowlist entry updated', meta: { id: item.id } });
    reply.send({ ok: true, item });
  });

  app.delete('/internal/allowlist/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const removed = services.allowlist.remove(id);
    if (!removed) {
      reply.code(404).send({ ok: false, error: 'not_found' });
      return;
    }
    services.db.logEvent({ level: 'info', kind: 'admin-action', message: 'Allowlist entry deleted', meta: { id } });
    reply.send({ ok: true, id });
  });

  app.post('/internal/actions/reload', async () => {
    services.allowlist.reload();
    services.db.logEvent({ level: 'info', kind: 'admin-action', message: 'Config reloaded' });
    return { ok: true };
  });

  app.post('/internal/actions/restart-soft', async () => {
    services.db.logEvent({ level: 'info', kind: 'admin-action', message: 'Restart soft requested (no-op phase1)' });
    return { ok: true, message: 'no-op phase1' };
  });

  app.post('/internal/actions/disable', async () => {
    services.state.serviceDisabled = true;
    services.db.logEvent({ level: 'warn', kind: 'admin-action', message: 'Service disabled' });
    return { ok: true, serviceDisabled: true };
  });

  app.post('/internal/actions/enable', async () => {
    services.state.serviceDisabled = false;
    services.db.logEvent({ level: 'info', kind: 'admin-action', message: 'Service enabled' });
    return { ok: true, serviceDisabled: false };
  });

  app.post('/internal/actions/cache/purge', async () => {
    const removed = services.cache.purgeAll();
    services.db.logEvent({ level: 'info', kind: 'cache-purge', message: 'Cache purged', meta: { removed } });
    return { ok: true, removed };
  });

  app.post('/internal/actions/cache/purge/:slug', async (request) => {
    const { slug } = request.params as { slug: string };
    const removed = services.cache.purgeBySlug(slug);
    services.db.logEvent({ level: 'info', kind: 'cache-purge', message: 'Cache purged by slug', slug, meta: { removed } });
    return { ok: true, slug, removed };
  });

  app.get('/internal/logs/recent', async () => ({ ok: true, items: services.db.listEventsRecent(200) }));
  app.get('/internal/mirrors/recent', async () => ({ ok: true, items: services.db.listMirrorsRecent(100) }));

  app.post('/internal/actions/test-resolve', async (request, reply) => {
    const body = (request.body ?? {}) as { url?: string };
    if (!body.url) {
      reply.code(400).send({ ok: false, error: 'missing_url' });
      return;
    }
    try {
      const result = await resolveTargetUrl(services, body.url);
      reply.send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'resolve_failed';
      reply.code(400).send({ ok: false, error: message });
    }
  });
}
