/* ---------- site: storage check, welcome, theme, effects, backups, offline + updates ---------- */
const STORE_OK = (() => { try { localStorage.setItem('sl.__t', '1'); localStorage.removeItem('sl.__t'); return true; } catch (e) { return false; } })();
function toast(text, action) {
  const t = $('#toast');
  $('#toastText').textContent = text;
  $('#toastBtn').hidden = !action;
  $('#toastBtn').onclick = action || null;
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toast.timer);
  if (!action) toast.timer = setTimeout(hideToast, 6000);
}
function hideToast() { const t = $('#toast'); t.classList.remove('show'); setTimeout(() => { if (!t.classList.contains('show')) t.hidden = true; }, 220); }
function initSite() {
  $('#storeNote').hidden = STORE_OK;
  if (window.matchMedia && matchMedia('(pointer: coarse)').matches) $('#ovTitle').textContent = $('#ovTitle').textContent.replace(/^Click/, 'Tap');

  // first-visit welcome
  // (index.html adds .first-visit before first paint, so the box doesn't pop in late)
  const root = document.documentElement;
  root.classList.toggle('first-visit', !LS.get('sl.welcomed', false) && !runData);
  const closeWelcome = () => { root.classList.remove('first-visit'); LS.set('sl.welcomed', true); };
  $('#wClose').addEventListener('click', closeWelcome);
  document.addEventListener('click', e => {
    const go = e.target.closest && e.target.closest('[data-go]');
    if (!go) return;
    e.preventDefault();
    if (go.closest('#welcome')) closeWelcome();
    showTab(go.dataset.go, true);
    window.scrollTo({ top: 0, behavior: RM.matches ? 'auto' : 'smooth' });
    if (go.dataset.go === 'log' && !runData) setTimeout(() => { try { $('#impUser').focus({ preventScroll: true }); } catch (err) { /* */ } }, 50);
  });

  // theme: System / Light / Dark (applied before first paint by the inline script in index.html)
  const applyTheme = v => {
    if (v === 'light' || v === 'dark') document.documentElement.setAttribute('data-theme', v);
    else document.documentElement.removeAttribute('data-theme');
    document.querySelectorAll('#themeSeg [data-theme-set]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeSet === (v || 'system'))));
    const bar = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
    if (bar) document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.content = bar; });
  };
  applyTheme(LS.get('sl.theme', 'system'));
  $('#themeSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-theme-set]');
    if (!b) return;
    LS.set('sl.theme', b.dataset.themeSet);
    applyTheme(b.dataset.themeSet);
  });
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(LS.get('sl.theme', 'system'))); } catch (e) { /* old browser */ }

  // visual effects
  const fx = $('#optFx');
  fx.checked = opts.fx !== false;
  fx.addEventListener('change', () => { opts.fx = fx.checked; saveOpts(); });

  // backups (everything except the API key)
  const msg = $('#wipeMsg');
  const say = (t, cls) => { msg.className = 'upd-msg about-msg' + (cls ? ' ' + cls : ''); msg.textContent = t; };
  $('#backupBtn').addEventListener('click', () => {
    const data = {};
    try { Object.keys(localStorage).filter(k => k.startsWith('sl.') && k !== KEY_STORE).forEach(k => { data[k] = localStorage.getItem(k); }); } catch (e) { /* */ }
    const blob = new Blob([JSON.stringify({ app: '40L Sprint Lab', version: 1, saved: new Date().toISOString(), data }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '40l-sprint-lab-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    say('Backup downloaded. It holds your settings, keys, Trainer progress and runs, but not your API key.', 'ok');
  });
  $('#restoreFile').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!j || j.app !== '40L Sprint Lab' || !j.data || typeof j.data !== 'object') throw new Error('not a backup');
      const keys = Object.keys(j.data).filter(k => k.startsWith('sl.') && k !== KEY_STORE && typeof j.data[k] === 'string');
      if (!keys.length) throw new Error('empty');
      keys.forEach(k => localStorage.setItem(k, j.data[k]));
      say('Restored ' + keys.length + ' saved items. Reloading…', 'ok');
      setTimeout(() => location.reload(), 600);
    } catch (err) {
      say(err && err.name === 'QuotaExceededError' ? 'This browser ran out of storage space while restoring.' : 'That file isn\'t a 40L Sprint Lab backup.', 'err');
    }
  });

  // erase everything
  const wipe = $('#wipeBtn');
  let armed = 0, disarm = null;
  wipe.addEventListener('click', () => {
    if (Date.now() - armed > 6000) {
      armed = Date.now();
      wipe.textContent = 'Press again to erase';
      say('This clears your settings, keys, Trainer progress, runs, saved plan and API key from this browser.', 'err');
      clearTimeout(disarm);
      disarm = setTimeout(() => { armed = 0; wipe.textContent = 'Erase everything saved here'; say(''); }, 6000);
      return;
    }
    clearTimeout(disarm);
    try { Object.keys(localStorage).filter(k => k.startsWith('sl.')).forEach(k => localStorage.removeItem(k)); } catch (err) { /* */ }
    try { Object.keys(sessionStorage).filter(k => k.startsWith('sl.')).forEach(k => sessionStorage.removeItem(k)); } catch (err) { /* */ }
    wipe.disabled = true;
    say('Erased. Reloading…', 'ok');
    setTimeout(() => location.reload(), 500);
  });

  // offline support and update notice
  $('#toastClose').addEventListener('click', hideToast);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then(reg => {
        const offer = w => toast('A new version of 40L Sprint Lab is ready.', () => { $('#toastBtn').disabled = true; w.postMessage('skip-waiting'); });
        if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (!w) return;
          w.addEventListener('statechange', () => {
            if (w.state !== 'installed') return;
            if (navigator.serviceWorker.controller) offer(w);
            else toast('40L Sprint Lab now works offline too.');
          });
        });
        // look for a new version when the player comes back to the tab
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
      }).catch(() => { /* offline support is optional */ });
    });
  }

  onRunData(runData);
  autoRefresh();
  window.addEventListener('online', autoRefresh);
}
