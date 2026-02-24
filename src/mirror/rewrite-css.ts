import postcss from 'postcss';
import valueParser from 'postcss-value-parser';

function buildMirrorPath(slug: string, url: URL) {
  const path = url.pathname === '/' ? '' : url.pathname;
  return `/m/${encodeURIComponent(slug)}${path}${url.search}`;
}

function maybeRewriteCssUrl(raw: string, baseUrl: URL, targetOrigin: URL, slug: string) {
  const value = raw.trim().replace(/^['"]|['"]$/g, '');
  if (!value) return raw;
  if (value.startsWith('data:') || value.startsWith('#')) return raw;
  try {
    const resolved = new URL(value, baseUrl);
    if (resolved.origin !== targetOrigin.origin) return raw;
    return buildMirrorPath(slug, resolved);
  } catch {
    return raw;
  }
}

export async function rewriteCssText(params: {
  css: string;
  baseUrl: URL;
  targetOrigin: URL;
  slug: string;
}) {
  const { css, baseUrl, targetOrigin, slug } = params;
  const root = postcss.parse(css);

  root.walkDecls((decl) => {
    if (!decl.value || !decl.value.includes('url(')) return;
    const parsed = valueParser(decl.value);
    parsed.walk((node) => {
      if (node.type !== 'function' || node.value !== 'url' || !node.nodes?.length) return;
      const original = valueParser.stringify(node.nodes);
      const rewritten = maybeRewriteCssUrl(original, baseUrl, targetOrigin, slug);
      if (rewritten !== original) {
        node.nodes = [{ type: 'word', value: rewritten } as any];
      }
    });
    decl.value = parsed.toString();
  });

  root.walkAtRules('import', (rule) => {
    const parsed = valueParser(rule.params);
    parsed.walk((node) => {
      if (node.type === 'string' || node.type === 'word') {
        const rewritten = maybeRewriteCssUrl(node.value, baseUrl, targetOrigin, slug);
        node.value = rewritten;
      }
      if (node.type === 'function' && node.value === 'url' && node.nodes?.length) {
        const original = valueParser.stringify(node.nodes);
        const rewritten = maybeRewriteCssUrl(original, baseUrl, targetOrigin, slug);
        node.nodes = [{ type: 'word', value: rewritten } as any];
      }
    });
    rule.params = parsed.toString();
  });

  return root.toString();
}
