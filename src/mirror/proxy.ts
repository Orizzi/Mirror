import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { fetch, Headers } from 'undici';
import { rewriteHtmlDocument } from './rewrite-html.js';
import { rewriteCssText } from './rewrite-css.js';
import { assertSafeUrl } from '../security/ssrf-guard.js';
import type { AppServices } from '../server-context.js';

function slugifyHost(host: string) {
  return host
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'site';
}

function ensureUniqueSlug(base: string, exists: (slug: string) => boolean) {
  if (!exists(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const next = `${base}-${i}`;
    if (!exists(next)) return next;
  }
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

function sanitizeOutgoingHeaders(request: FastifyRequest) {
  const headers = new Headers();
  const userAgent = request.headers['user-agent'];
  if (typeof userAgent === 'string') headers.set('user-agent', userAgent);
  const accept = request.headers.accept;
  if (typeof accept === 'string') headers.set('accept', accept);
  const acceptLanguage = request.headers['accept-language'];
  if (typeof acceptLanguage === 'string') headers.set('accept-language', acceptLanguage);
  headers.set('cache-control', 'no-cache');
  headers.set('pragma', 'no-cache');
  return headers;
}

function copySafeHeaders(reply: FastifyReply, headers: Headers, opts: { rewrittenBody: boolean }) {
  const hopByHop = new Set([
    'connection', 'transfer-encoding', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailers', 'upgrade'
  ]);
  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();
    if (hopByHop.has(lower)) continue;
    if (lower === 'content-security-policy') continue; // upstream CSP may break rewritten paths
    if (lower === 'set-cookie') continue; // phase 1 no upstream login/session support
    if (opts.rewrittenBody && (lower === 'content-length' || lower === 'content-encoding' || lower === 'etag')) continue;
    reply.header(key, value);
  }
  reply.header('x-robots-tag', 'noindex, nofollow');
}

async function fetchWithRedirectValidation(params: {
  request: FastifyRequest;
  upstreamUrl: URL;
  services: AppServices;
  method: 'GET' | 'HEAD';
}) {
  const { request, services, method } = params;
  const { config, allowlist } = services;
  let current = new URL(params.upstreamUrl.toString());
  const headers = sanitizeOutgoingHeaders(request);
  for (let hop = 0; hop < 5; hop += 1) {
    await assertSafeUrl(current, config.MIRROR_ENABLE_HTTP);
    const match = allowlist.match(current);
    if (!match) {
      throw new Error('domain_not_allowed');
    }

    const response = await fetch(current, {
      method,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(config.MIRROR_UPSTREAM_TIMEOUT_MS)
    });

    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      const next = new URL(response.headers.get('location')!, current);
      await assertSafeUrl(next, config.MIRROR_ENABLE_HTTP);
      if (!allowlist.match(next)) {
        throw new Error('domain_not_allowed');
      }
      current = next;
      continue;
    }

    return { response, finalUrl: current };
  }
  throw new Error('too_many_redirects');
}

export function resolveOrCreateMirrorForUrl(services: AppServices, url: URL) {
  const targetOrigin = `${url.protocol}//${url.host}`;
  const existing = services.db.findMirrorByOrigin(targetOrigin);
  if (existing) {
    services.db.touchMirror(existing.slug, url.pathname + url.search);
    return { created: false, mirror: existing };
  }
  const baseSlug = slugifyHost(url.hostname);
  const slug = ensureUniqueSlug(baseSlug, (candidate) => Boolean(services.db.findMirrorBySlug(candidate)));
  const mirror = services.db.createMirror(slug, targetOrigin, url.pathname + url.search);
  return { created: true, mirror };
}

function buildLaunchUrl(slug: string, url: URL) {
  const path = url.pathname === '/' ? '' : url.pathname;
  return `/m/${encodeURIComponent(slug)}${path}${url.search}`;
}

export async function resolveTargetUrl(services: AppServices, rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('invalid_url');
  }
  await assertSafeUrl(parsed, services.config.MIRROR_ENABLE_HTTP);
  if (!services.allowlist.isAllowed(parsed)) {
    throw new Error('domain_not_allowed');
  }
  const { created, mirror } = resolveOrCreateMirrorForUrl(services, parsed);
  services.db.logEvent({
    level: 'info',
    kind: 'resolve',
    slug: mirror.slug,
    message: 'Mirror resolved',
    meta: { url: parsed.toString(), created }
  });
  return {
    ok: true as const,
    slug: mirror.slug,
    targetOrigin: mirror.targetOrigin,
    launchUrl: buildLaunchUrl(mirror.slug, parsed),
    created
  };
}

export async function handleMirrorRequest(params: {
  services: AppServices;
  request: FastifyRequest<{ Params: { slug: string; '*': string } }>;
  reply: FastifyReply;
}) {
  const { services, request, reply } = params;
  const method = request.method.toUpperCase();
  if (!services.config.methodsAllowed.includes(method as 'GET' | 'HEAD')) {
    reply.code(405).send({ ok: false, error: 'method_not_allowed' });
    return;
  }
  if (services.state.serviceDisabled) {
    reply.code(503).send({ ok: false, error: 'service_disabled' });
    return;
  }

  const slug = request.params.slug;
  const mirror = services.db.findMirrorBySlug(slug);
  if (!mirror || mirror.disabled) {
    reply.code(404).send({ ok: false, error: 'mirror_not_found' });
    return;
  }

  const tail = (request.params['*'] ?? '').replace(/^\/+/, '');
  const upstreamBase = new URL(mirror.targetOrigin);
  const upstreamUrl = new URL(upstreamBase.toString());
  upstreamUrl.pathname = tail ? `/${tail}` : '/';
  const rawQuery = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
  upstreamUrl.search = rawQuery;

  const cacheKey = services.cache.key(method, upstreamUrl.toString());
  if (method === 'GET') {
    const cached = services.cache.get(slug, cacheKey);
    if (cached) {
      services.db.logEvent({ level: 'info', kind: 'cache-hit', slug, message: 'Cache hit', meta: { url: upstreamUrl.toString() } });
      reply.code(cached.status);
      for (const [k, v] of Object.entries(cached.headers)) reply.header(k, v);
      reply.header('x-cache', 'HIT');
      reply.header('x-robots-tag', 'noindex, nofollow');
      reply.send(cached.body);
      return;
    }
  }
  services.db.logEvent({ level: 'info', kind: 'cache-miss', slug, message: 'Cache miss', meta: { url: upstreamUrl.toString() } });

  try {
    const { response, finalUrl } = await fetchWithRedirectValidation({
      request,
      upstreamUrl,
      services,
      method: method as 'GET' | 'HEAD'
    });

    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    const isHtml = contentType.includes('text/html');
    const isCss = contentType.includes('text/css');
    const textLike = isHtml || isCss || contentType.includes('javascript') || contentType.includes('json') || contentType.startsWith('text/');

    if (method === 'HEAD') {
      reply.code(response.status);
      copySafeHeaders(reply, response.headers, { rewrittenBody: false });
      reply.header('x-cache', 'MISS');
      reply.send();
      return;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (textLike && isHtml && buffer.byteLength > services.config.MIRROR_MAX_HTML_BYTES) {
      reply.code(413).send({ ok: false, error: 'html_too_large' });
      return;
    }
    if (!textLike && buffer.byteLength > services.config.MIRROR_MAX_BINARY_BYTES) {
      reply.code(413).send({ ok: false, error: 'binary_too_large' });
      return;
    }

    let outputBody = buffer;
    let rewritten = false;

    if (isHtml) {
      const html = buffer.toString('utf8');
      const rewrittenHtml = rewriteHtmlDocument({
        html,
        baseUrl: finalUrl,
        targetOrigin: new URL(mirror.targetOrigin),
        slug
      });
      outputBody = Buffer.from(rewrittenHtml);
      rewritten = true;
    } else if (isCss) {
      const css = buffer.toString('utf8');
      const rewrittenCss = await rewriteCssText({
        css,
        baseUrl: finalUrl,
        targetOrigin: new URL(mirror.targetOrigin),
        slug
      });
      outputBody = Buffer.from(rewrittenCss);
      rewritten = true;
    }

    reply.code(response.status);
    copySafeHeaders(reply, response.headers, { rewrittenBody: rewritten });
    reply.header('x-cache', 'MISS');
    if (rewritten) reply.header('content-length', String(outputBody.byteLength));
    reply.send(outputBody);

    if (method === 'GET' && response.status >= 200 && response.status < 300) {
      const headersToCache: Record<string, string> = {};
      for (const [k, v] of reply.getHeaders ? Object.entries(reply.getHeaders() as Record<string, any>) : []) {
        if (typeof v === 'string') headersToCache[k] = v;
      }
      services.cache.set(slug, cacheKey, {
        status: response.status,
        headers: headersToCache,
        body: outputBody,
        contentType,
        cachedAt: Date.now()
      });
    }

    services.db.touchMirror(slug, finalUrl.pathname + finalUrl.search);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    const kind = message === 'ssrf_blocked' ? 'ssrf-blocked' : message.includes('timeout') ? 'upstream-timeout' : 'proxy-error';
    services.db.logEvent({
      level: 'error',
      kind: kind as any,
      slug,
      message: 'Proxy request failed',
      meta: { error: message, path: request.url }
    });
    const status = message === 'domain_not_allowed' || message === 'ssrf_blocked' ? 403 : message === 'invalid_url' ? 400 : 502;
    reply.code(status).send({ ok: false, error: message });
  }
}
