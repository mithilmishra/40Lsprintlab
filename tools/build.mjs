// Builds the deployable site from src/: minified, content-hashed script and stylesheet, index.html
// with a strict Content-Security-Policy, and a versioned service worker. Run: npm run build
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_URL = 'https://mithilmishra.github.io/40Lsprintlab/';
const src = f => readFileSync(join(ROOT, 'src', f), 'utf8');
const hash = (s, n = 10) => createHash('sha256').update(s).digest('hex').slice(0, n);
const put = (s, a, b) => { if (!s.includes(a)) throw new Error('missing placeholder ' + a); return s.split(a).join(b); };

// 1. script: engine + app + modules, all inside the app's single closure
let js = src('app.js');
js = put(js, '/*__ENGINE__*/', src('engine.js'));
js = put(js, '/*__DATA__*/', src('data.js'));
js = put(js, '/*__PLAN__*/', src('plan.js'));
js = put(js, '/*__SITE__*/', src('site.js'));
const jsMin = (await esbuild.transform(js, { loader: 'js', minify: true, target: 'es2020', legalComments: 'none' })).code;

// 2. styles
const cssMin = (await esbuild.transform(src('styles.css'), { loader: 'css', minify: true, target: ['chrome100', 'firefox100', 'safari15'] })).code;

// 3. content-hashed file names, so browsers and the CDN can cache them forever
const jsName = 'app.' + hash(jsMin) + '.js';
const cssName = 'app.' + hash(cssMin) + '.css';
for (const f of readdirSync(join(ROOT, 'assets'))) if (/^app\.[0-9a-f]+\.(js|css)$/.test(f)) unlinkSync(join(ROOT, 'assets', f));
writeFileSync(join(ROOT, 'assets', jsName), jsMin);
writeFileSync(join(ROOT, 'assets', cssName), cssMin);

// 4. index.html, with the tiny theme script inlined and allowed by its hash in the CSP
const boot = (await esbuild.transform(src('boot.js'), { loader: 'js', minify: true, target: 'es2015' })).code.trim();
const bootHash = 'sha256-' + createHash('sha256').update(boot).digest('base64');
let html = src('index.html');
html = put(html, '{{BODY}}', src('body.html').trim());
html = put(html, '{{BOOT}}', boot);
html = put(html, '{{BOOT_HASH}}', bootHash);
html = put(html, '{{CSS}}', cssName);
html = put(html, '{{JS}}', jsName);
html = put(html, '{{SITE_URL}}', SITE_URL);
writeFileSync(join(ROOT, 'index.html'), html);

// 5. service worker: precache the app shell; a new VERSION makes open tabs offer a reload
const fonts = readdirSync(join(ROOT, 'assets', 'fonts')).filter(f => f.endsWith('.woff2')).map(f => 'assets/fonts/' + f);
const shell = ['./', 'config.js', 'manifest.webmanifest', 'assets/' + jsName, 'assets/' + cssName, ...fonts,
  'icons/icon.svg', 'icons/favicon-32.png', 'icons/icon-192.png', 'icons/apple-touch-icon.png'].filter(p => p === './' || existsSync(join(ROOT, p)));
const version = hash(jsMin + cssMin + html, 12);
let sw = src('sw.js');
sw = put(sw, '{{VERSION}}', version);
sw = put(sw, '{{PRECACHE}}', JSON.stringify(shell));
writeFileSync(join(ROOT, 'sw.js'), (await esbuild.transform(sw, { loader: 'js', minify: true, target: 'es2020' })).code);

const kb = s => (Buffer.byteLength(s) / 1024).toFixed(1) + ' KB';
console.log('Built version ' + version);
console.log('  index.html  ' + kb(html));
console.log('  ' + jsName + '  ' + kb(jsMin) + ' (from ' + kb(js) + ')');
console.log('  ' + cssName + '  ' + kb(cssMin) + ' (from ' + kb(src('styles.css')) + ')');
console.log('  sw.js precaches ' + shell.length + ' files');
