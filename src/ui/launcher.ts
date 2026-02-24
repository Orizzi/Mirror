import type { MirrorRecord } from '../types.js';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderLauncherPage(params: {
  recentMirrors: MirrorRecord[];
  serviceDisabled: boolean;
  allowlistHosts: string[];
}) {
  const { recentMirrors, serviceDisabled, allowlistHosts } = params;
  const recentList = recentMirrors
    .slice(0, 12)
    .map((item) => {
      const label = escapeHtml(item.targetOrigin);
      return `<li><a href="/m/${encodeURIComponent(item.slug)}">${label}</a><span class="meta">${escapeHtml(item.slug)}</span></li>`;
    })
    .join('');

  const allowlist = allowlistHosts.map((host) => `<code>${escapeHtml(host)}</code>`).join(' ');

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Mirror Orizzi</title>
  <style>
    :root { --bg:#0b1220; --panel:#101a2f; --line:#24334d; --fg:#e8eefc; --muted:#9fb0d1; --accent:#7dd3fc; --danger:#fca5a5; }
    *{box-sizing:border-box} body{margin:0;font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,sans-serif;background:radial-gradient(circle at top,#13203e 0%,#0b1220 55%);color:var(--fg)}
    .wrap{max-width:980px;margin:0 auto;padding:28px 16px 56px}
    .hero{border:1px solid var(--line);background:linear-gradient(180deg,#111d37,#0f182c);border-radius:16px;padding:18px}
    h1{margin:0 0 8px;font-size:28px}.muted{color:var(--muted)}
    form{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
    input{flex:1;min-width:260px;background:#0a1324;color:var(--fg);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
    button{background:#0ea5e9;color:#06111f;border:none;padding:12px 16px;border-radius:10px;font-weight:700;cursor:pointer}
    button[disabled]{opacity:.55;cursor:not-allowed}
    .status{margin-top:10px;min-height:22px;font-size:14px}
    .danger{color:var(--danger)} .ok{color:var(--accent)}
    .grid{display:grid;grid-template-columns:1.35fr .65fr;gap:16px;margin-top:16px}
    .card{border:1px solid var(--line);background:rgba(16,26,47,.85);border-radius:16px;padding:16px;min-width:0}
    ul{list-style:none;padding:0;margin:8px 0 0} li{display:flex;justify-content:space-between;gap:8px;border-top:1px solid rgba(159,176,209,.12);padding:10px 0}
    li:first-child{border-top:none;padding-top:0}
    a{color:#bfdbfe;text-decoration:none} a:hover{text-decoration:underline}
    .meta{color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    code{background:#0a1324;border:1px solid var(--line);border-radius:8px;padding:2px 6px;margin:2px;display:inline-block}
    .banner{border-radius:12px;padding:10px 12px;margin-top:12px;border:1px solid var(--line);background:#0a1324}
    @media (max-width: 860px){ .grid{grid-template-columns:1fr} }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>Mirror privé — Orizzi</h1>
      <p class="muted">Le serveur charge le site cible (allowlisté) et renvoie une version mirrorrée sous <code>/m/&lt;slug&gt;</code>.</p>
      <div class="banner">Domaines allowlistés: ${allowlist || '<span class="muted">aucun (configure via Dashboard / internal API)</span>'}</div>
      ${serviceDisabled ? '<div class="banner danger">Le service est actuellement désactivé (mode maintenance).</div>' : ''}
      <form id="resolve-form">
        <input id="url" type="url" placeholder="https://example.com/path" required />
        <button id="submit" type="submit" ${serviceDisabled ? 'disabled' : ''}>Ouvrir le mirror</button>
      </form>
      <div class="status muted" id="status"></div>
    </section>

    <div class="grid">
      <section class="card">
        <h2 style="margin:0 0 8px;font-size:18px">Mirrors récents</h2>
        <p class="muted" style="margin:0 0 10px;font-size:14px">Raccourcis vers les cibles déjà résolues.</p>
        <ul>${recentList || '<li><span class="muted">Aucun mirror récent.</span></li>'}</ul>
      </section>
      <section class="card">
        <h2 style="margin:0 0 8px;font-size:18px">Règles phase 1</h2>
        <ul>
          <li><span>Accès</span><span class="meta">Basic Auth (nginx)</span></li>
          <li><span>Méthodes</span><span class="meta">GET / HEAD uniquement</span></li>
          <li><span>Auth upstream</span><span class="meta">non supporté</span></li>
          <li><span>Indexation</span><span class="meta">noindex / nofollow</span></li>
          <li><span>Protection</span><span class="meta">allowlist + SSRF guard</span></li>
        </ul>
      </section>
    </div>
  </div>
  <script>
    const form = document.getElementById('resolve-form');
    const input = document.getElementById('url');
    const statusEl = document.getElementById('status');
    const submit = document.getElementById('submit');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!input.value) return;
      statusEl.textContent = 'Validation et résolution en cours...';
      statusEl.className = 'status muted';
      submit.disabled = true;
      try {
        const res = await fetch('/api/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: input.value })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.error || ('HTTP ' + res.status));
        }
        statusEl.textContent = 'Mirror prêt, redirection...';
        statusEl.className = 'status ok';
        window.location.href = data.launchUrl;
      } catch (err) {
        statusEl.textContent = 'Erreur: ' + (err && err.message ? err.message : String(err));
        statusEl.className = 'status danger';
      } finally {
        submit.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}
