// Regenerates the PNG icons and the link-preview image from icons/icon.svg and a small HTML card.
// Only needed if you change the logo. Needs Playwright: npm i -D playwright && npx playwright install chromium
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(ROOT, 'icons', 'icon.svg'), 'utf8');
const font = f => 'data:font/woff2;base64,' + readFileSync(join(ROOT, 'assets', 'fonts', f)).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function icon(size, file, { maskable = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  const inner = maskable
    ? '<div style="width:100%;height:100%;background:#17142b;display:grid;place-items:center"><div style="width:72%;height:72%">' + svg.replace('<rect width="64" height="64" rx="14" fill="#17142b"/>', '') + '</div></div>'
    : svg;
  await page.setContent('<style>html,body{margin:0;width:100%;height:100%;background:transparent}svg{display:block;width:100%;height:100%}</style>' + inner);
  await page.screenshot({ path: join(ROOT, 'icons', file), omitBackground: !maskable });
}
await icon(32, 'favicon-32.png');
await icon(180, 'apple-touch-icon.png', { maskable: true });
await icon(192, 'icon-192.png');
await icon(512, 'icon-512.png');
await icon(512, 'maskable-512.png', { maskable: true });

// Link preview, 1200 x 630
const COLORS = { I: '#2fb8cc', O: '#e9b92c', T: '#9a4fd0', S: '#58b342', Z: '#dc3f4a', J: '#4561d6', L: '#ec8226' };
const stack = [
  '..........', '..........', '..........', '..........', '..........', '..........', '..........', '..........',
  '..........', '..........', '..........', '..........', '..........', '..........',
  '.......OO.', 'JJ...LLOO.', 'JSS..LZZ.I', 'JSSTTLLZZI', 'IIIITLLOOI', 'JJJTTZZOOI',
];
const target = [[2, 15], [3, 15], [3, 16], [4, 16]]; // where the falling Z belongs
const cs = 26, bw = cs * 10, bh = cs * 20;
let cells = '';
stack.forEach((row, y) => [...row].forEach((ch, x) => {
  if (ch !== '.') cells += `<rect x="${x * cs + 1.5}" y="${y * cs + 1.5}" width="${cs - 3}" height="${cs - 3}" rx="2" fill="${COLORS[ch]}"/><rect x="${x * cs + 1.5}" y="${y * cs + 1.5}" width="${cs - 3}" height="4" rx="1" fill="#fff" fill-opacity=".28"/>`;
}));
const piece = [[3, 2], [4, 2], [4, 3], [5, 3]].map(([x, y]) => `<rect x="${x * cs + 1.5}" y="${y * cs + 1.5}" width="${cs - 3}" height="${cs - 3}" rx="2" fill="${COLORS.Z}"/><rect x="${x * cs + 1.5}" y="${y * cs + 1.5}" width="${cs - 3}" height="4" rx="1" fill="#fff" fill-opacity=".3"/>`).join('');
const outline = target.map(([x, y]) => `<rect x="${x * cs + 3}" y="${y * cs + 3}" width="${cs - 6}" height="${cs - 6}" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="2.5" stroke-dasharray="5 3"/>`).join('');
let grid = '';
for (let x = 1; x < 10; x++) grid += `<line x1="${x * cs}" y1="0" x2="${x * cs}" y2="${bh}" stroke="#242044"/>`;
for (let y = 1; y < 20; y++) grid += `<line x1="0" y1="${y * cs}" x2="${bw}" y2="${y * cs}" stroke="#242044"/>`;
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<style>
@font-face{font-family:Chakra;src:url(${font('chakra-petch-latin-700-normal.woff2')})}
@font-face{font-family:Plex;src:url(${font('ibm-plex-sans-latin-400-normal.woff2')})}
@font-face{font-family:PlexM;src:url(${font('ibm-plex-mono-latin-500-normal.woff2')})}
html,body{margin:0}
.card{width:1200px;height:630px;box-sizing:border-box;background:#0f0d18;color:#ebe8f6;display:grid;grid-template-columns:1fr ${bw + 2}px;gap:72px;align-items:center;padding:0 96px 0 88px;font-family:Plex,sans-serif}
.logo{display:grid;grid-template-columns:repeat(3,22px);grid-template-rows:repeat(2,22px);gap:4px;margin-bottom:34px}
.logo i{background:#a78dff;border-radius:4px}.logo i:first-child{grid-column:2}.logo i:nth-child(2){grid-column:1}
h1{font:700 82px/1 Chakra,sans-serif;margin:0 0 22px;letter-spacing:.005em}
p{font-size:29px;line-height:1.4;color:#a29cbc;margin:0 0 34px;max-width:620px;text-wrap:balance}
.chips{display:flex;gap:10px;flex-wrap:wrap}
.chips span{font:500 19px PlexM,monospace;border:1.5px solid #2d2944;border-radius:999px;padding:6px 14px;color:#ebe8f6}
.board{border:1px solid #2e2956;border-radius:10px;background:#17142b;overflow:hidden;height:${bh}px}
</style><div class="card"><div>
<div class="logo"><i></i><i></i><i></i><i></i></div>
<h1>40L Sprint Lab</h1>
<p>Practice tools for TETR.IO 40 lines. Drill finesse, play coached sprints and track every run.</p>
<div class="chips"><span>Finesse trainer</span><span>Coached sprints</span><span>Run log</span><span>Plan</span></div>
</div><div class="board"><svg width="${bw}" height="${bh}" viewBox="0 0 ${bw} ${bh}">${grid}${cells}${outline}${piece}</svg></div></div>`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(ROOT, 'og-image.png') });
await browser.close();
writeFileSync(join(ROOT, 'icons', '.generated'), new Date().toISOString() + '\n');
console.log('Icons and og-image.png written.');
