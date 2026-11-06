/* ---------- run data ----------
   Runs come from TETR.IO's public TETRA CHANNEL API for the username the player types:
   straight from ch.tetr.io when the browser allows it, otherwise through the optional relay set in
   config.js (see worker/). If neither answers, the player can paste the API pages by hand. */
const DATA_KEY = 'sl.data';
const CFG = Object.assign({ proxy: '' }, window.SPRINTLAB_CONFIG || {});
const USER_RE = /^[a-z0-9_-]{3,16}$/;
const PAGE = 100, MAX_PAGES = 100;      // up to 10,000 runs
const GAP_MS = 1100;                     // TETR.IO asks for about one request a second
const AUTO_MS = 12 * 3600e3;             // refresh on a visit when the last fetch is older than this
let runData = LS.get(DATA_KEY, null);
if (!runData || !Array.isArray(runData.runs)) runData = null;
let route = LS.get('sl.route', null);    // 'direct' | 'proxy' | 'paste': whatever answered last time
let fetchCtl = null, pasteCursor = null;
const sessionId = 'sl-' + Math.random().toString(36).slice(2, 12);
const cleanUser = v => String(v || '').trim().toLowerCase();
const apiPath = (user, after) => '/api/users/' + encodeURIComponent(user) + '/records/40l/recent?limit=' + PAGE + (after && /^[0-9.:-]+$/.test(after) ? '&after=' + after : '');
const apiUrl = (user, after) => 'https://ch.tetr.io' + apiPath(user, after);
const wait = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Stopped', 'AbortError')); }, { once: true });
});
function saveData(D) {
  runData = D;
  try { localStorage.setItem(DATA_KEY, JSON.stringify(D)); } catch (e) { /* the runs still show for this visit */ }
}
// One API entry -> [ts, time_s, pieces, lines, inputs, holds, faults, perfect, singles, doubles, triples, quads]
function entryToRow(e) {
  const st = e && e.results && e.results.stats;
  const ts = String(e && e.ts || '').slice(0, 16);
  if (!st || !(st.finaltime > 0) || (st.lines || 0) < 40 || ts.length < 16) return null;
  const c = st.clears || {}, f = st.finesse || {};
  return [ts, +(st.finaltime / 1000).toFixed(3), +st.piecesplaced || 0, +st.lines || 40, +st.inputs || 0, +st.holds || 0, +f.faults || 0, +f.perfectpieces || 0, +c.singles || 0, +c.doubles || 0, +c.triples || 0, +c.quads || 0];
}
const cursorOf = entries => {
  const last = entries[entries.length - 1];
  return entries.length >= PAGE && last && last.p ? last.p.pri + ':' + last.p.sec + ':' + last.p.ter : null;
};
function mergeEntries(D, entries) {
  const have = new Set(D.runs.map(r => r[0] + '|' + r[1]));
  let added = 0, seen = 0;
  for (const e of entries) {
    const row = entryToRow(e);
    if (!row) continue;
    const k = row[0] + '|' + row[1];
    if (have.has(k)) { seen++; continue; }
    have.add(k); D.runs.push(row); added++;
  }
  D.runs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { added, seen };
}

function onRunData(D) {
  histData = D;
  RL = D && D.runs && D.runs.length ? analyse(D) : null;
  renderPbChip(); renderImport();
  if (RL) { renderLogTab(); renderPlan(); }
  else {
    $('#logBody').innerHTML = '';
    $('#planBody').innerHTML = '<div class="card plan-empty"><div><h3>Your plan starts with your runs</h3><p class="muted">Fetch your TETR.IO 40L history and this tab sets a next PB goal and a typical-run goal, and points at the skill that will cut the most time.</p></div><button type="button" class="btn" data-go="log">Fetch your runs</button></div>';
    $('#goalCard').hidden = true;
    const few = D && D.runs && D.runs.length;
    $('#logNote').textContent = few ? 'You need at least 10 finished runs for stats (' + D.runs.length + ' so far).' : 'Enter your TETR.IO username below to pull in your 40L runs, trends and a plan.';
    $('#planNote').textContent = 'Fetch your runs in the Run log to get a plan built from them.';
  }
  renderSprintContext(); renderAiCard();
}
function setImp(t, cls) { const m = $('#impMsg'); m.className = 'upd-msg imp-msg' + (cls ? ' ' + cls : ''); m.textContent = t; }
function renderImport() {
  const u = cleanUser($('#impUser').value);
  const ok = USER_RE.test(u);
  const busy = !!fetchCtl;
  const has = !!(runData && runData.runs.length);
  const mine = has && runData.user === u;
  $('#impGo').textContent = busy ? 'Fetching…' : mine ? 'Check for new runs' : 'Fetch my runs';
  $('#impGo').disabled = busy;
  $('#impUser').disabled = busy;
  $('#impStop').hidden = !busy;
  $('#impProg').hidden = !busy;
  $('#impTitle').textContent = has ? runData.user + '\'s TETR.IO runs' : 'Your TETR.IO runs';
  $('#impVia').textContent = route === 'proxy' ? 'via the site relay' : route === 'direct' ? 'straight from TETR.IO' : 'from TETR.IO\'s public stats';
  const link = $('#impLink');
  link.href = ok ? apiUrl(u) : '#';
  link.classList.toggle('disabled', !ok);
  link.setAttribute('aria-disabled', String(!ok));
  link.textContent = ok ? 'Open ' + u + '\'s latest 100 runs' : 'Open your latest 100 runs';
  $('#impMore').hidden = !(pasteCursor && ok);
  if (pasteCursor && ok) $('#impNext').href = apiUrl(u, pasteCursor);
  $('#impFoot').hidden = !has || busy;
  if (has) $('#impFootText').textContent = runData.runs.length + ' runs saved in this browser, last updated ' + (runData.fetchedAt ? whenStr(new Date(runData.fetchedAt)) : 'on an earlier visit') + '.' + (runData.full ? '' : ' Older runs may be missing; fetch again to fill them in.');
}

/* fetching */
async function getPage(user, after, signal) {
  const order = route === 'proxy' ? ['proxy', 'direct'] : ['direct', 'proxy'];
  let lastErr = null;
  for (const r of order) {
    if (r === 'proxy' && !CFG.proxy) continue;
    const base = r === 'proxy' ? String(CFG.proxy).replace(/\/+$/, '') : 'https://ch.tetr.io';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // Direct requests stay "simple" (no custom headers) so the browser needs no preflight.
        const res = await fetch(base + apiPath(user, after), { signal, headers: r === 'proxy' ? { 'X-Session-ID': sessionId } : undefined, credentials: 'omit' });
        if (res.status === 429 && attempt === 0) { await wait(4000, signal); continue; }
        let j = null;
        try { j = await res.json(); } catch (e) { /* not JSON */ }
        if (!j) throw new Error('bad response ' + res.status);
        if (route !== r) { route = r; LS.set('sl.route', r); }
        return j;
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        lastErr = e;
        break;
      }
    }
  }
  throw lastErr || new Error('unreachable');
}
async function fetchRuns(user, auto) {
  if (fetchCtl || !USER_RE.test(user)) return;
  const ctl = fetchCtl = new AbortController();
  const same = !!(runData && runData.user === user);
  const D = same ? { ...runData, runs: runData.runs.slice() } : { user, source: 'TETR.IO public API', runs: [] };
  const startN = D.runs.length;
  let after = null, pages = 0, added = 0, reachedEnd = false;
  renderImport();
  setImp(auto ? 'Checking TETR.IO for new runs…' : 'Asking TETR.IO for ' + user + '\'s runs…');
  const finish = () => { D.fetchedAt = new Date().toISOString(); saveData(D); onRunData(D); };
  try {
    while (pages < MAX_PAGES) {
      if (pages) await wait(GAP_MS, ctl.signal);
      const j = await getPage(user, after, ctl.signal);
      if (j.success === false) {
        const msg = String(j.error && (j.error.msg || j.error) || '');
        throw Object.assign(new Error(msg), { player: /no such user|not found/i.test(msg) || !msg });
      }
      const entries = j.data && Array.isArray(j.data.entries) ? j.data.entries : [];
      pages++;
      const m = mergeEntries(D, entries);
      added += m.added;
      after = cursorOf(entries);
      if (!after) { reachedEnd = true; break; }
      // an update can stop at the first page that overlaps runs already saved, once the full history is in
      if (same && runData.full && m.seen > 0) break;
      setImp('Fetched ' + D.runs.length + ' runs so far… (TETR.IO asks for one page a second)');
    }
    if (reachedEnd) D.full = true;
    if (!D.runs.length) {
      setImp(user + ' has no finished 40L runs on TETR.IO yet.', 'err');
      return;
    }
    finish();
    setImp(added ? 'Added ' + added + ' ' + plural(added, 'run') + '. ' + D.runs.length + ' in total.' : 'No new runs since your last update.', 'ok');
  } catch (e) {
    if (e && e.name === 'AbortError') {
      if (added) finish();
      setImp(added ? 'Stopped. Kept the ' + added + ' new ' + plural(added, 'run') + ' fetched so far.' : 'Stopped.');
    } else if (e && e.player) {
      setImp('TETR.IO has no player called "' + user + '". Check the spelling and try again.', 'err');
    } else {
      if (added) finish();
      if (!auto) {
        route = 'paste'; LS.set('sl.route', 'paste');
        $('#impPasteBox').open = true;
        setImp('This browser couldn\'t reach TETR.IO' + (CFG.proxy ? ' or the site relay' : '') + '. Use the copy-and-paste steps below instead; they take about a minute.', 'err');
      } else setImp('');
    }
  } finally {
    fetchCtl = null;
    renderImport();
    if (D.runs.length > startN && !auto) $('#impUser').blur();
  }
}

/* pasting, for when fetching isn't possible */
function handlePaste(text) {
  const raw = String(text || '').trim();
  if (!raw) return;
  const user = cleanUser($('#impUser').value);
  if (!USER_RE.test(user)) { setImp('Enter your TETR.IO username above first, so the runs are filed under the right name.', 'err'); $('#impUser').focus(); return; }
  let j;
  try { const a = raw.indexOf('{'), b = raw.lastIndexOf('}'); j = JSON.parse(a >= 0 && b > a ? raw.slice(a, b + 1) : raw); }
  catch (e) { setImp('That doesn\'t look like the TETR.IO page. Select everything on it (Ctrl+A or ⌘A), copy, and paste again. In Firefox, click Raw Data first.', 'err'); return; }
  if (j && j.success === false) { setImp('TETR.IO couldn\'t find runs for that page. Check the username and open the link again.', 'err'); return; }
  const entries = j && j.data && Array.isArray(j.data.entries) ? j.data.entries : null;
  if (!entries) { setImp('That page isn\'t a list of 40L runs. Use the link in step 1 and paste that page.', 'err'); return; }
  pasteCursor = cursorOf(entries);
  if (!entries.length) { renderImport(); setImp('That page has no runs on it. If it was the first page, check the username; otherwise you have reached your oldest run.'); return; }
  const replacing = runData && runData.user !== user ? runData.user : null;
  const D = runData && runData.user === user ? { ...runData, runs: runData.runs.slice() } : { user, source: 'TETR.IO public API', runs: [] };
  const m = mergeEntries(D, entries);
  if (!pasteCursor) D.full = true;
  if (!m.added) { renderImport(); setImp('Those runs are already here.' + (pasteCursor ? ' Open the next page to go further back.' : '')); return; }
  D.fetchedAt = new Date().toISOString();
  saveData(D); onRunData(D);
  setImp((replacing ? 'Started a new log for ' + user + ' (replaced ' + replacing + '\'s runs). ' : '') + 'Added ' + m.added + ' ' + plural(m.added, 'run') + '. ' + D.runs.length + ' in total.' + (pasteCursor ? ' For older runs, open the next page below and paste it too.' : ''), 'ok');
}

$('#impUser').value = runData ? runData.user : '';
$('#impUser').addEventListener('input', () => { pasteCursor = null; renderImport(); });
$('#impForm').addEventListener('submit', e => {
  e.preventDefault();
  const u = cleanUser($('#impUser').value);
  if (!USER_RE.test(u)) { setImp('Usernames are 3 to 16 letters, numbers, dashes or underscores.', 'err'); $('#impUser').focus(); return; }
  if (runData && runData.user !== u && !$('#impGo').dataset.confirm) {
    $('#impGo').dataset.confirm = '1';
    setImp('This replaces the ' + runData.runs.length + ' runs saved for ' + runData.user + '. Press Fetch again to continue.', 'err');
    setTimeout(() => { delete $('#impGo').dataset.confirm; }, 8000);
    return;
  }
  delete $('#impGo').dataset.confirm;
  fetchRuns(u, false);
});
$('#impStop').addEventListener('click', () => { if (fetchCtl) fetchCtl.abort(); });
$('#impLink').addEventListener('click', e => { if ($('#impLink').classList.contains('disabled')) { e.preventDefault(); setImp('Enter your TETR.IO username first.', 'err'); $('#impUser').focus(); } });
$('#impPaste').addEventListener('paste', e => {
  const text = e.clipboardData ? e.clipboardData.getData('text') : '';
  if (text) { e.preventDefault(); handlePaste(text); }
});
let impTimer = 0;
$('#impPaste').addEventListener('input', () => {
  clearTimeout(impTimer);
  impTimer = setTimeout(() => { const el = $('#impPaste'); if (el.value.trim().length > 20) { handlePaste(el.value); el.value = ''; } }, 300);
});
$('#impClear').addEventListener('click', e => {
  const b = e.currentTarget;
  if (!b.classList.contains('armed')) {
    b.classList.add('armed'); b.textContent = 'Click again to remove all saved runs';
    setTimeout(() => { if (b.isConnected) { b.classList.remove('armed'); b.textContent = 'Remove imported runs'; } }, 3000);
    return;
  }
  b.classList.remove('armed'); b.textContent = 'Remove imported runs';
  runData = null; pasteCursor = null;
  try { localStorage.removeItem(DATA_KEY); } catch (err) { /* nothing stored */ }
  onRunData(null);
  setImp('Saved runs removed from this browser.');
});
// Quietly pick up new runs on a visit, at most every 12 hours, once a fetch has worked before.
function autoRefresh() {
  if (!runData || !USER_RE.test(runData.user) || route === 'paste' || !navigator.onLine) return;
  const age = Date.now() - (Date.parse(runData.fetchedAt) || 0);
  if (age > AUTO_MS) setTimeout(() => fetchRuns(runData.user, true), 1500);
}
