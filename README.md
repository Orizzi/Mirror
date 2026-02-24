# Mirror (Orizzi)

Private allowlisted web mirroring service (server-side fetch + rewritten proxy rendering) for `mirror.orizzi.io`.

## Goals (phase 1)
- Private usage behind nginx Basic Auth
- Strict domain allowlist
- SSRF protection (private IP / localhost / metadata blocked)
- GET/HEAD-only mirrored navigation
- Path-based mirror URLs: `/m/:slug/...`
- Internal token-protected ops endpoints for Dashboard integration

## Why not `zmirror`
`zmirror` is the closest OSS reference for website mirroring/reverse proxying, but it is archived and not maintained. This project uses a modern Node/TypeScript stack inspired by the same idea.

## Endpoints (phase 1)
- `GET /` launcher UI
- `POST /api/resolve` create/reuse a mirror slug for an allowlisted URL
- `GET|HEAD /m/:slug/*` mirrored content
- `GET /health` basic health (still protected by nginx Basic Auth in prod)
- `GET|POST /internal/*` internal ops endpoints (token required)

## Dev
```bash
cp .env.example .env
# set MIRROR_INTERNAL_TOKEN in .env
npm install
npm run dev
```

## Smoke test
```bash
MIRROR_INTERNAL_TOKEN=testtoken PORT=8085 npm run build && node dist/server.js
curl -s http://127.0.0.1:8085/health
curl -s -X POST http://127.0.0.1:8085/api/resolve -H 'content-type: application/json' -d '{"url":"https://example.com"}'
```

## Notes
- Local TLS CA issues on some dev machines may break `https` upstream fetches. Prod OVH should use the system CA store.
- Upstream login/cookies are intentionally unsupported in phase 1.
