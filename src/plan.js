/* ---------- custom plan from Claude, written with the player's own Anthropic API key ----------
   The browser calls the Anthropic Messages API directly. The key is kept in sessionStorage, or in
   localStorage when the player ticks Remember, and is sent only to api.anthropic.com. */
const AI_KEY = 'sl.ai.plan', KEY_STORE = 'sl.ai.key', MODEL_STORE = 'sl.ai.model';
const MODELS = [
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (recommended)'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 (cheapest)'],
  ['claude-opus-5-5', 'Claude Opus 5.5 (most thorough)'],
];
const KEY_RE = /^sk-ant-[A-Za-z0-9_-]{20,}$/;
const store = {
  get(k) { try { return sessionStorage.getItem(k) || localStorage.getItem(k) || ''; } catch (e) { return ''; } },
  remembered(k) { try { return !!localStorage.getItem(k); } catch (e) { return false; } },
  set(k, v, remember) {
    try { sessionStorage.setItem(k, v); } catch (e) { /* session storage off */ }
    try { if (remember) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* storage off */ }
  },
  drop(k) { try { sessionStorage.removeItem(k); } catch (e) { /* */ } try { localStorage.removeItem(k); } catch (e) { /* */ } },
};
let apiKey = store.get(KEY_STORE);
let aiCtl = null, aiSaved = LS.get(AI_KEY, null);
let aiModel = LS.get(MODEL_STORE, MODELS[0][0]);
if (!MODELS.some(m => m[0] === aiModel)) aiModel = MODELS[0][0];
const r2 = (k, v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : v);
function aiSummary() {
  const n = RL.now, pick = s => ({ time_s: s.t, pps: s.pps, keys_per_second: s.kps, keys_per_piece: s.kpp, finesse_faults: s.ff, holds: s.hd, pieces: s.pc });
  let down = 0, total = 0;
  const slow = [], miss = [];
  for (const p of PIECES) for (const tg of targets[p]) {
    total++;
    const st = masteryOf(tg);
    if (st === 'mastered') down++; else if (st === 'slow') slow.push(tg.label); else if (st === 'miss') miss.push(tg.label);
  }
  return {
    player: histData.user, runs_analysed: RL.S.length, slow_practice_runs_left_out: RL.R.length - RL.S.length,
    personal_best_s: RL.pbRun.t, personal_best_date: RL.pbRun.ts.slice(0, 10),
    typical_last_25_s: RL.typ, typical_previous_25_s: isFinite(RL.typPrev) ? RL.typPrev : null, last_5_average_s: mean(RL.last5.map(d => d.t)),
    last_150_runs_medians: { ...pick(n), perfect_finesse_share: n.perf, lines_from_tetrises_share: n.quad },
    fastest_runs_medians: pick(RL.T), middle_half_medians: pick(RL.M),
    share_of_run_to_run_difference_pct: { key_speed: RL.shKps, pieces_used: RL.shPc, keys_per_piece: RL.shKpp },
    estimated_seconds_to_gain: RL.lev.map(l => ({ area: { pauses: 'pauses (reach fastest-run key speed)', finesse: 'halve finesse faults', pieces: 'finish with fewer pieces', holds: 'halve holds' }[l.key], seconds: l.s })),
    by_month: RL.MS.map(x => ({ month: x.m, runs: x.n, best_s: x.best, typical_s: x.t, pps: x.pps, keys_per_second: x.kps, keys_per_piece: x.kpp, finesse_faults: x.ff, holds: x.hd })),
    handling_frames: { das: handling.das, arr: handling.arr, dcd: handling.dcd },
    trainer_on_this_site: { placements_total: total, down_pat: down, clean_but_slow: slow.slice(0, 8), recent_mistakes: miss.slice(0, 8) },
    last_sprint_on_this_site: spLast ? { time_s: spLast.t, pps: spLast.pps, keys_per_piece: spLast.kpp, finesse_faults: spLast.faultN, long_pauses: spLast.pauseN, seconds_lost_to_pauses: spLast.pauseCost, matched_coach_pct: spLast.matchPct } : null,
  };
}
const PLAN_TOOL = {
  name: 'write_plan',
  description: 'Record the one-week practice plan for this player.',
  input_schema: {
    type: 'object',
    properties: {
      headline: { type: 'string', description: 'One sentence naming the single biggest thing to change.' },
      focus: {
        type: 'array', minItems: 2, maxItems: 3, description: 'The 2 or 3 areas to work on, most valuable first.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short title.' },
            why: { type: 'string', description: 'One or two sentences citing the player\'s own numbers.' },
            drills: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'string' }, description: 'Concrete drills.' },
          },
          required: ['title', 'why', 'drills'],
        },
      },
      week: {
        type: 'array', minItems: 7, maxItems: 7, description: 'Exactly seven days, Mon to Sun.',
        items: { type: 'object', properties: { day: { type: 'string' }, minutes: { type: 'integer' }, plan: { type: 'string', description: 'One line.' } }, required: ['day', 'minutes', 'plan'] },
      },
      checkpoint: { type: 'string', description: 'The number to check at the end of the week and its target.' },
    },
    required: ['headline', 'focus', 'week', 'checkpoint'],
  },
};
function aiMessages(note) {
  return [{
    role: 'user',
    content: 'Write a one-week practice plan for this TETR.IO 40 LINES player from the stats below. Use only these numbers and do not invent any.\n\n' +
      'The player practises on a site with: "Trainer" (finesse drill that times every placement and repeats weak ones), "Sprint" (40-line practice where a coach outlines a good spot for each piece and a chart shows pauses), "Finesse chart" (fewest key presses for every spot), plus real TETR.IO runs.\n\n' +
      'Player\'s note: ' + (note || 'none') + '\n\nStats (JSON):\n' + JSON.stringify(aiSummary(), r2) + '\n\nRecord the plan with the write_plan tool.',
  }];
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
function renderAiPlan(plan) {
  const out = $('#aiOut');
  out.innerHTML = '';
  if (!plan || typeof plan !== 'object') return;
  if (plan.headline) out.appendChild(el('p', 'ai-head', plan.headline));
  const focus = Array.isArray(plan.focus) ? plan.focus.slice(0, 4) : [];
  if (focus.length) {
    const ol = el('ol', 'focus');
    focus.forEach((f, i) => {
      const li = el('li');
      const head = el('div', 'f-head'); head.appendChild(el('span', 'no', i + 1)); head.appendChild(el('b', null, f && f.title || '')); li.appendChild(head);
      if (f && f.why) li.appendChild(el('p', null, f.why));
      if (f && Array.isArray(f.drills) && f.drills.length) { const ul = el('ul', 'ai-drills'); f.drills.slice(0, 5).forEach(d => ul.appendChild(el('li', null, d))); li.appendChild(ul); }
      ol.appendChild(li);
    });
    out.appendChild(ol);
  }
  const week = Array.isArray(plan.week) ? plan.week.slice(0, 7) : [];
  if (week.length) {
    const wrap = el('div', 'table-scroll'), tbl = el('table', 'data-table'), tb = el('tbody');
    const hr = el('tr'); ['Day', 'Minutes', 'Plan'].forEach(h => hr.appendChild(el('th', null, h)));
    const th = el('thead'); th.appendChild(hr); tbl.appendChild(th);
    week.forEach(w => { const tr = el('tr'); tr.appendChild(el('td', null, w && w.day || '')); tr.appendChild(el('td', 'mono', w && w.minutes != null ? w.minutes : '')); tr.appendChild(el('td', 'wrap', w && w.plan || '')); tb.appendChild(tr); });
    tbl.appendChild(tb); wrap.appendChild(tbl); out.appendChild(wrap);
  }
  if (plan.checkpoint) out.appendChild(el('p', 'insight', 'Check at the end of the week: ' + plan.checkpoint));
}
function setAi(t, cls) { const m = $('#aiStatus'); m.className = 'upd-msg' + (cls ? ' ' + cls : ''); m.textContent = t; }
function renderAiCard() {
  const hasKey = !!apiKey;
  $('#aiKeyForm').hidden = hasKey;
  $('#aiKeySet').hidden = !hasKey;
  $('#aiOpts').hidden = !hasKey || !RL;
  if (hasKey) $('#aiKeyTail').textContent = '…' + apiKey.slice(-4);
  const btn = $('#aiBtn');
  btn.disabled = !hasKey || !RL || !!aiCtl;
  btn.textContent = aiSaved && aiSaved.user === (histData && histData.user) ? 'Write a new plan' : 'Write my plan';
  if (!aiCtl) {
    if (!RL) setAi('Fetch your runs in the Run log first.');
    else if (!hasKey) setAi('Add an API key above to turn this on.');
    else if (!$('#aiStatus').textContent || /^(Fetch your runs|Add an API key)/.test($('#aiStatus').textContent)) setAi('');
  }
  if (aiSaved && aiSaved.user === (histData && histData.user) && !$('#aiOut').childElementCount) {
    renderAiPlan(aiSaved.plan);
    if (!aiCtl) setAi('Written ' + whenStr(new Date(aiSaved.at)) + (aiSaved.model ? ' with ' + (MODELS.find(m => m[0] === aiSaved.model) || [0, aiSaved.model])[1].replace(/ \(.*\)$/, '') : '') + '.');
  }
}
function aiError(status, body) {
  const type = body && body.error && body.error.type || '';
  const msg = body && body.error && body.error.message || '';
  if (status === 401 || type === 'authentication_error') return 'Anthropic didn\'t accept that key. Check it in the Anthropic Console, then forget it here and paste it again.';
  if (status === 403 || type === 'permission_error') return 'That key isn\'t allowed to use this model. Try another model or check the key\'s permissions.';
  if (status === 404 || type === 'not_found_error') return 'That model isn\'t available to your key. Pick another model and try again.';
  if (status === 429 || type === 'rate_limit_error') return 'Your API key hit a rate limit. Wait a minute, then try again.';
  if (status === 529 || type === 'overloaded_error') return 'Anthropic is busy right now. Try again in a minute.';
  if (/credit balance/i.test(msg)) return 'Your Anthropic account is out of credit. Add credit in the Anthropic Console, then try again.';
  if (status >= 500) return 'Anthropic had a problem answering. Try again in a minute.';
  return 'Anthropic turned the request down' + (msg ? ': ' + msg : '.');
}
async function writeAiPlan() {
  if (!apiKey || !RL || aiCtl) return;
  aiCtl = new AbortController();
  const ctl = aiCtl;
  $('#aiBtn').disabled = true; $('#aiStop').hidden = false;
  setAi('Claude is writing your plan… this usually takes under a minute.');
  const model = aiModel;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctl.signal, credentials: 'omit',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model, max_tokens: 3000,
        system: 'You coach players of TETR.IO\'s 40 LINES sprint mode. You are direct and specific, and every claim you make points at one of the player\'s own numbers.',
        messages: aiMessages($('#aiNote').value.trim().slice(0, 200)),
        tools: [PLAN_TOOL], tool_choice: { type: 'tool', name: 'write_plan' },
      }),
    });
    let body = null;
    try { body = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) { setAi(aiError(res.status, body), 'err'); return; }
    const use = body && Array.isArray(body.content) ? body.content.find(c => c.type === 'tool_use' && c.name === 'write_plan') : null;
    const plan = use && use.input;
    if (!plan || typeof plan !== 'object' || (!plan.headline && !Array.isArray(plan.focus))) { setAi('Claude\'s answer came back in an unexpected shape. Try again.', 'err'); return; }
    aiSaved = { at: Date.now(), user: histData.user, model, plan };
    LS.set(AI_KEY, aiSaved);
    renderAiPlan(plan);
    const u = body.usage || {};
    setAi('Written just now from your ' + RL.S.length + ' runs' + (u.input_tokens ? ' (' + u.input_tokens.toLocaleString() + ' input and ' + (u.output_tokens || 0).toLocaleString() + ' output tokens)' : '') + '.', 'ok');
  } catch (e) {
    if (e && e.name === 'AbortError') setAi('Stopped.');
    else setAi('Couldn\'t reach Anthropic. Check your connection or any blocker extension, then try again.', 'err');
  } finally {
    aiCtl = null; $('#aiStop').hidden = true; renderAiCard();
  }
}
$('#aiModel').innerHTML = MODELS.map(m => '<option value="' + m[0] + '">' + m[1] + '</option>').join('');
$('#aiModel').value = aiModel;
$('#aiModel').addEventListener('change', e => { aiModel = e.target.value; LS.set(MODEL_STORE, aiModel); });
$('#aiRemember').checked = store.remembered(KEY_STORE);
$('#aiKeyForm').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('#aiKey').value.trim();
  if (!KEY_RE.test(v)) { setAi('That doesn\'t look like an Anthropic API key. Keys start with sk-ant-.', 'err'); $('#aiKey').focus(); return; }
  apiKey = v; store.set(KEY_STORE, v, $('#aiRemember').checked);
  $('#aiKey').value = '';
  setAi($('#aiRemember').checked ? 'Key saved on this device.' : 'Key saved until you close this tab.', 'ok');
  renderAiCard();
});
$('#aiForget').addEventListener('click', () => { apiKey = ''; store.drop(KEY_STORE); setAi('Key forgotten.'); renderAiCard(); $('#aiKey').focus(); });
$('#aiBtn').addEventListener('click', writeAiPlan);
$('#aiStop').addEventListener('click', () => { if (aiCtl) aiCtl.abort(); });
