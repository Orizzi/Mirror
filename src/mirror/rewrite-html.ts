import { load } from 'cheerio';

function buildMirrorPath(slug: string, url: URL) {
  const path = url.pathname === '/' ? '' : url.pathname;
  return `/m/${encodeURIComponent(slug)}${path}${url.search}`;
}

function maybeRewriteUrl(raw: string | undefined, baseUrl: URL, targetOrigin: URL, slug: string) {
  if (!raw) return raw;
  const value = raw.trim();
  if (!value) return raw;
  if (
    value.startsWith('#') ||
    value.startsWith('data:') ||
    value.startsWith('mailto:') ||
    value.startsWith('tel:') ||
    value.startsWith('javascript:')
  ) {
    return raw;
  }
  try {
    const resolved = new URL(value, baseUrl);
    if (resolved.origin !== targetOrigin.origin) {
      return raw;
    }
    return buildMirrorPath(slug, resolved);
  } catch {
    return raw;
  }
}

function rewriteSrcset(raw: string | undefined, baseUrl: URL, targetOrigin: URL, slug: string) {
  if (!raw) return raw;
  const parts = raw.split(',').map((item) => item.trim()).filter(Boolean);
  const rewritten = parts.map((item) => {
    const [urlPart, descriptor] = item.split(/\s+/, 2);
    const next = maybeRewriteUrl(urlPart, baseUrl, targetOrigin, slug) ?? urlPart;
    return descriptor ? `${next} ${descriptor}` : next;
  });
  return rewritten.join(', ');
}

export function rewriteHtmlDocument(params: {
  html: string;
  baseUrl: URL;
  targetOrigin: URL;
  slug: string;
}) {
  const { html, baseUrl, targetOrigin, slug } = params;
  const $ = load(html);

  $('base').remove();

  const attrSelectors: Array<[string, string[]]> = [
    ['a', ['href']],
    ['link', ['href']],
    ['script', ['src']],
    ['img', ['src']],
    ['img', ['srcset']],
    ['source', ['src', 'srcset']],
    ['video', ['src', 'poster']],
    ['audio', ['src']],
    ['iframe', ['src']],
    ['form', ['action']]
  ];

  for (const [selector, attrs] of attrSelectors) {
    $(selector).each((_, el) => {
      for (const attr of attrs) {
        const current = $(el).attr(attr);
        if (!current) continue;
        if (attr === 'srcset') {
          const next = rewriteSrcset(current, baseUrl, targetOrigin, slug);
          if (next) $(el).attr(attr, next);
          continue;
        }
        const next = maybeRewriteUrl(current, baseUrl, targetOrigin, slug);
        if (next) $(el).attr(attr, next);
      }
    });
  }

  // Hide robots indexing; nginx also enforces X-Robots-Tag.
  if ($('head meta[name="robots"]').length === 0) {
    $('head').prepend('<meta name="robots" content="noindex,nofollow">');
  }

  return $.html();
}
