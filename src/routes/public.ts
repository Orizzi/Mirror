import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { renderLauncherPage } from '../ui/launcher.js';
import { handleMirrorRequest, resolveTargetUrl } from '../mirror/proxy.js';
import type { AppServices } from '../server-context.js';

const resolveBodySchema = z.object({
  url: z.string().min(1).max(2000)
});

export async function registerPublicRoutes(app: FastifyInstance, services: AppServices) {
  app.get('/', async (_request, reply) => {
    const html = renderLauncherPage({
      recentMirrors: services.db.listMirrorsRecent(20),
      serviceDisabled: services.state.serviceDisabled,
      allowlistHosts: services.allowlist
        .list()
        .filter((entry) => entry.enabled)
        .map((entry) => entry.host)
    });
    reply.type('text/html; charset=utf-8');
    reply.header('x-robots-tag', 'noindex, nofollow');
    return html;
  });

  app.get('/health', async (_request, reply) => {
    reply.header('x-robots-tag', 'noindex, nofollow');
    return {
      ok: true,
      serviceDisabled: services.state.serviceDisabled,
      uptimeSec: Math.floor((Date.now() - services.state.startedAtMs) / 1000)
    };
  });

  app.post('/api/resolve', async (request, reply) => {
    if (services.state.serviceDisabled) {
      reply.code(503).send({ ok: false, error: 'service_disabled' });
      return;
    }
    const parse = resolveBodySchema.safeParse(request.body);
    if (!parse.success) {
      reply.code(400).send({ ok: false, error: 'invalid_url' });
      return;
    }
    try {
      const result = await resolveTargetUrl(services, parse.data.url);
      reply.send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'resolve_failed';
      const status =
        message === 'invalid_url' || message === 'invalid_scheme' ? 400 :
        message === 'domain_not_allowed' || message === 'ssrf_blocked' ? 403 :
        message === 'rate_limited' ? 429 : 400;
      services.db.logEvent({
        level: 'warn',
        kind: 'resolve-fail',
        message: 'Resolve failed',
        meta: { error: message, url: parse.data.url }
      });
      reply.code(status).send({ ok: false, error: message });
    }
  });

  app.route({
    method: ['GET', 'HEAD'],
    url: '/m/:slug',
    handler: async (request, reply) => {
      const anyRequest = request as any;
      anyRequest.params['*'] = '';
      return handleMirrorRequest({ services, request: anyRequest, reply });
    }
  });

  app.route({
    method: ['GET', 'HEAD'],
    url: '/m/:slug/*',
    handler: async (request, reply) => {
      return handleMirrorRequest({ services, request: request as any, reply });
    }
  });
}
