// 40L Sprint Lab relay for TETR.IO's public API (TETRA CHANNEL), as a Cloudflare Worker.
//
// Browsers only let a page read another site's data when that site allows it (CORS). If ch.tetr.io
// doesn't allow your GitHub Pages address, this relay fetches the same public data and adds the
// permission header. It only forwards the read-only 40L endpoints the site uses, only for your own
// site's address, and caches answers for a minute to keep load on TETR.IO low.
//
// Deploy: see README.md ("Optional: the TETR.IO relay"). Free-plan limits are far above what one site needs.

const UPSTREAM = 'https://ch.tetr.io';
const DEFAULT_ORIGINS = 'https://mithilmishra.github.io';
// /api/users/<name>/records/40l/recent and /api/users/<name>/summaries/40l, nothing else
const ALLOWED_PATH = /^\/api\/users\/([a-z0-9_-]{3,16}|[0-9a-f]{24})\/(records\/40l\/recent|summaries\/40l)$/;
const PRISECTER = /^-?[0-9.]+:-?[0-9.]+:-?[0-9.]+$/;

export default {
  async fetch(request, env, ctx) {
    const origins = String(env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map(s => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin') || '';
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const allowed = origins.includes(origin) || local;
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : origins[0] || 'null',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'X-Session-ID',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const reply = (status, obj, extra) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors, ...extra } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return reply(405, { success: false, error: { msg: 'Only GET is allowed.' } });
    if (origin && !allowed) return reply(403, { success: false, error: { msg: 'This relay only serves its own site.' } });

    const url = new URL(request.url);
    const path = url.pathname.toLowerCase();
    if (!ALLOWED_PATH.test(path)) return reply(404, { success: false, error: { msg: 'Not a path this relay forwards.' } });

    // keep only the query parameters the API documents, with sane values
    const qs = new URLSearchParams();
    const limit = Number(url.searchParams.get('limit'));
    if (limit >= 1 && limit <= 100) qs.set('limit', String(Math.floor(limit)));
    for (const k of ['after', 'before']) {
      const v = url.searchParams.get(k);
      if (v && PRISECTER.test(v)) { qs.set(k, v); break; }
    }
    const target = UPSTREAM + path + (qs.toString() ? '?' + qs.toString() : '');

    // one-minute shared cache, keyed on the upstream URL only
    const cache = caches.default;
    const cacheKey = new Request(target, { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) return new Response(hit.body, { status: hit.status, headers: { ...Object.fromEntries(hit.headers), ...cors, 'X-Relay-Cache': 'hit' } });

    const headers = { 'Accept': 'application/json', 'User-Agent': '40LSprintLab-relay (+https://github.com/mithilmishra/40Lsprintlab)' };
    const sid = request.headers.get('X-Session-ID');
    if (sid && /^[A-Za-z0-9_-]{1,64}$/.test(sid)) headers['X-Session-ID'] = sid;

    let upstream;
    try {
      upstream = await fetch(target, { headers });
    } catch (e) {
      return reply(502, { success: false, error: { msg: 'TETR.IO could not be reached.' } });
    }
    const body = await upstream.text();
    const res = new Response(body, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', ...cors, 'X-Relay-Cache': 'miss' },
    });
    if (upstream.ok) ctx.waitUntil(cache.put(cacheKey, new Response(body, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } })));
    return res;
  },
};
