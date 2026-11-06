// Local preview that mimics GitHub Pages: the site is served under /40Lsprintlab/ with the same 404 page.
// Run: npm run serve, then open http://localhost:8080/40Lsprintlab/
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = '/40Lsprintlab/';
const PORT = Number(process.env.PORT) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/' || path === BASE.slice(0, -1)) { res.writeHead(302, { Location: BASE }); return res.end(); }
  if (!path.startsWith(BASE)) return notFound(res);
  let file = normalize(join(ROOT, path.slice(BASE.length)));
  if (!file.startsWith(ROOT) || /[\\/](node_modules|src|tools|worker)[\\/]/.test(file.slice(ROOT.length))) return notFound(res);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'max-age=600' });
    res.end(body);
  } catch (e) { notFound(res); }
}).listen(PORT, () => console.log('40L Sprint Lab: http://localhost:' + PORT + BASE));

async function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  try { res.end(await readFile(join(ROOT, '404.html'))); } catch (e) { res.end('Not found'); }
}
