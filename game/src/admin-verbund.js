// Verbundsaufgaben im Admin-Board: Aufgabe freigeben, Dashboard fuer den Beamer (wie das Verbund-Dashboard von leyoNET:
// vendor/leyonet/src/ui/components/VerbundDashboard.svelte + VerbundMap.svelte, hier ohne Svelte), Abnahme.
// Alle Stufen und Ziele rechnet der Server (er spielt die Standorte nach) - diese Seite zeigt nur an.
import { drawPlan, fitView, planModel, THEME } from './netplan.js';
import { formatTime } from './timer.js';

const NS = 'http://www.w3.org/2000/svg';
const LEVEL = { offline: 'nicht verbunden', connected: 'angeschlossen', online: 'online', services: 'Dienste erreichbar', done: 'fertig' };
const RANK = { offline: 0, connected: 1, online: 2, services: 3, done: 4 };
const REASON = { httpFailed: 'keine Antwort der Webseite', pingFailed: 'Ping kommt nicht an', pingFailedTo: 'Ping kommt nicht an', pingReached: 'Ping geht durch (sollte nicht)', noLease: 'keine Adresse per DHCP', wrongLease: 'falsche Adresse per DHCP', wrongLeaseDns: 'falscher DNS per DHCP',
  noVerbund: 'Übergabe nicht an Router/Firewall', noAddress: 'keine Adresse', verbundUnreachable: 'von der Zentrale nicht erreichbar', addressMissing: 'Adresse fehlt oder falsch', defaultRouteMissing: 'Standardroute fehlt', deviceMissing: 'Gerät fehlt noch', noTrunk: 'kein Trunk mit diesen VLANs',
  wrongHostVlan: 'falsches VLAN', hostOnTrunk: 'hängt an einem Trunk', noSwitchPort: 'nicht am Switch', notConnected: 'nicht verbunden', linkDown: 'Link down', noRoute: 'Route nicht gelernt', tooFewNeighbors: 'keine Nachbarschaft', configNotSaved: 'nicht gespeichert', configChanged: 'nach dem Speichern geändert', noGateway: 'kein Gateway' };
const clock = (ms) => new Date(ms).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const short = (ms) => formatTime(ms).replace(/\.\d$/, '');
const stars = (n) => '★'.repeat(n);

function svg(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

/** Abschnitt in der Klassenansicht. ctx: { el, button, sure, get, post, dialog, show, msg, errText, tasks, id } */
export function verbundPanel(ctx) {
  const { el, button, sure, get, post, show, errText, tasks, id } = ctx;
  const root = el('section', { class: 'vbp' });
  const m = ctx.msg();
  let v = null;
  const act = async (body, text) => { try { v = await post(`classes/${id}/verbund`, body); draw(); if (text) show(m, text, true); } catch (e) { show(m, errText(e)); } };
  const draw = () => {
    const cur = v?.verbund;
    const t = cur && tasks.find((x) => x.id === cur.task);
    const done = v?.rows.filter((r) => r.level === 'done').length ?? 0;
    root.replaceChildren(el('h2', {}, 'Verbundaufgabe'),
      t ? el('div', { class: `vbp-now ${cur.open ? 'open' : ''}` }, el('div', {}, el('span', { class: 'vb-stars' }, stars(t.sterne)), el('b', {}, t.titel), el('span', { class: 'muted' }, `${cur.open ? 'freigegeben' : 'geschlossen'} · ${v.rows.length} Plätze · ${done} fertig${cur.abnahme ? ` · Abnahme ${clock(cur.abnahme)}` : ''}`)),
        el('div', { class: 'row' }, button('Dashboard öffnen', () => dashboard(ctx, t)), cur.open ? button('Schliessen', () => act({ action: 'close' }, 'Geschlossen: neue Schritte zählen nicht mehr.'), 'secondary') : button('Wieder öffnen', () => act({ action: 'reopen' }, 'Wieder offen.'), 'secondary'),
          sure('Beenden', 'Standorte verwerfen?', () => act({ action: 'end' }, 'Beendet. Abnahmen bleiben gespeichert.')))) : el('p', { class: 'muted' }, 'Gib eine Aufgabe frei: Alle in der Klasse (Klassencode) sehen sie sofort im Spiel, bekommen einen Platz mit eigenen Adressen und bauen ihren Standort.'),
      el('div', { class: 'vbp-cards' }, tasks.map((x) => el('article', { class: `vbp-card ${t?.id === x.id ? 'on' : ''}` }, el('div', { class: 'vb-stars' }, stars(x.sterne), el('span', {}, stars(5 - x.sterne))), el('h3', {}, x.titel), el('p', {}, x.story),
        el('p', { class: 'muted' }, `${x.dauer} min · ${x.goals.length} Ziele · ${x.themen.join(', ')}`),
        t?.id === x.id ? el('span', { class: 'muted' }, 'läuft') : cur ? sure('Freigeben', 'Laufende Aufgabe ersetzen?', () => act({ action: 'open', task: x.id }, `Freigegeben: ${x.titel}`)) : button('Freigeben', () => act({ action: 'open', task: x.id }, `Freigegeben: ${x.titel}`)), el('details', {}, el('summary', {}, 'Ziele'), el('ul', {}, x.goals.map((g) => el('li', {}, g.text, g.gemeinsam ? ' (gemeinsam)' : ''))), el('p', { class: 'muted' }, `Material: ${x.bedarf}. Adressen im Beispiel: Platz 1.`))))), m);
  };
  const load = async () => { try { v = await get(`classes/${id}/verbund`); draw(); } catch (e) { show(m, errText(e)); } };
  load();
  return root;
}

// ---------- Karte ----------
const W = 1000, H = 640, CX = W / 2, CY = H / 2 + 8;
function drawMap(rows, onselect) {
  const n = Math.max(rows.length, 1);
  const k = n <= 14 ? 1 : n <= 20 ? 0.8 : n <= 28 ? 0.68 : 0.52;
  const two = n > 14;
  const pos = new Map(rows.map((s, i) => {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    const inner = two && i % 2 ? 0.66 : 1;
    return [s.seat, { x: CX + Math.cos(a) * 412 * inner, y: CY + Math.sin(a) * 266 * inner }];
  }));
  const up = rows.filter((s) => RANK[s.level] >= 2).length;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'vbd-map', role: 'img', 'aria-label': `${up} von ${rows.length} Standorten online` },
    svg('defs', {}, svg('radialGradient', { id: 'vbd-hub', cx: '50%', cy: '40%', r: '60%' }, svg('stop', { offset: '0%', 'stop-color': '#7dd3fc' }), svg('stop', { offset: '100%', 'stop-color': '#1d4ed8' })),
      svg('pattern', { id: 'vbd-dots', width: 28, height: 28, patternUnits: 'userSpaceOnUse' }, svg('circle', { cx: 2, cy: 2, r: 1, fill: '#22304d' }))), svg('rect', { width: W, height: H, fill: 'url(#vbd-dots)' }));
  // Partner, die sich wirklich sehen
  for (const s of rows) if (s.partnerReal && s.partner > s.seat && pos.has(s.partner)) {
    const a = pos.get(s.seat), b = pos.get(s.partner);
    root.append(svg('path', { class: 'partner', d: `M${a.x},${a.y} Q${CX + ((a.x + b.x) / 2 - CX) * 0.55},${CY + ((a.y + b.y) / 2 - CY) * 0.55} ${b.x},${b.y}` }));
  }
  for (const s of rows) {
    const q = pos.get(s.seat);
    root.append(svg('line', { class: `link ${s.level}`, x1: CX, y1: CY, x2: q.x, y2: q.y }));
    if (RANK[s.level] >= 2) root.append(svg('line', { class: `flow ${s.level}`, x1: q.x, y1: q.y, x2: CX, y2: CY }));
  }
  root.append(svg('g', { class: 'hub', transform: `translate(${CX} ${CY})` }, svg('circle', { class: 'ring', r: 56 }), svg('circle', { class: 'ring r2', r: 56 }), svg('circle', { r: 50, fill: 'url(#vbd-hub)' }),
    svg('text', { class: 'hub-name', y: -2 }, 'Zentrale'), svg('text', { class: 'hub-count', y: 20 }, `${up} / ${rows.length}`)));
  for (const s of rows) {
    const q = pos.get(s.seat);
    const done = s.goals.filter((g) => g.done).length;
    root.append(svg('g', { class: `site ${s.level}`, transform: `translate(${q.x} ${q.y}) scale(${k}) translate(-82 -32)`, role: 'button', tabindex: 0, 'aria-label': `${s.name}: ${LEVEL[s.level]}`, onclick: () => onselect(s), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onselect(s); } } },
      svg('rect', { class: 'card', width: 164, height: 64, rx: 10 }), svg('circle', { class: 'led', cx: 20, cy: 21, r: 12 }), svg('text', { class: 'seat', x: 20, y: 26 }, String(s.seat)), svg('text', { class: 'name', x: 38, y: 24 }, s.name.length > 15 ? `${s.name.slice(0, 14)}…` : s.name),
      svg('text', { class: 'state', x: 38, y: 42 }, `${s.level === 'services' ? 'Dienste' : LEVEL[s.level]}${s.online ? ' · ●' : ''}`), s.goals.length ? svg('rect', { class: 'bar', x: 14, y: 50, width: 136, height: 6, rx: 3 }) : null, s.goals.length ? svg('rect', { class: 'fill', x: 14, y: 50, width: (136 * done) / s.goals.length, height: 6, rx: 3 }) : null,
      s.result ? svg('text', { class: `stamp ${s.result.passed ? 'ok' : ''}`, x: 154, y: 45 }, s.result.passed ? stars(s.result.sterne) : `${s.result.done}/${s.result.total}`) : null));
  }
  return root;
}

// ---------- Dashboard ----------
export function dashboard(ctx, task) {
  const { el, get, post, id, errText, dialog } = ctx;
  let view = 'alles';
  let v = null;
  let on = true;
  let sig = '';
  let before = null; // Platz -> Stufe
  let events = [];
  let lastExam = null;
  const opener = document.activeElement;
  const event = (text, kind) => { events = [{ t: Date.now(), text, kind }, ...events].slice(0, 40); };
  const $ = (cls, ...k) => el('div', { class: cls }, ...k);
  const title = el('p');
  const counters = $('vbd-counters');
  const bar = el('i');
  const note = el('p', { class: 'vbd-problem', role: 'status', hidden: true });
  const main = el('main', { class: 'alles' });
  const ticker = el('ol', { class: 'vbd-ticker', 'aria-live': 'polite' });
  const meta = el('span', { class: 'vbd-meta' });
  const seg = $('vbd-seg', ...[['karte', 'Karte'], ['kacheln', 'Kacheln'], ['matrix', 'Anforderungen'], ['alles', 'Alles']].map(([k, t]) => el('button', { 'data-v': k, onclick: () => { view = k; sig = ''; draw(); } }, t)));
  const exam = el('button', { class: 'vbd-exam', onclick: async () => { try { v = await post(`classes/${id}/verbund/abnahme`); event('Abnahme gestartet', 'exam'); draw(); } catch (e) { problem(errText(e)); } } }, 'Abnahme starten');
  const root = el('div', { class: 'vbd', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Verbund-Dashboard' },
    el('header', {}, $('vbd-title', el('div', { class: 'vbd-logo' }, 'ly'), el('div', {}, el('h2', {}, el('span', {}, stars(task.sterne)), ` ${task.titel}`), title)), counters,
      $('vbd-tools', seg, exam, el('button', { title: 'Vollbild', 'aria-label': 'Vollbild', onclick: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()) }, '⛶'), el('button', { title: 'Schliessen (Esc)', 'aria-label': 'Schliessen', onclick: () => close() }, '✕'))),
    el('div', { class: 'vbd-progress' }, bar), note, main, el('footer', {}, ticker, meta));
  const key = (e) => { if (e.key === 'Escape' && !document.fullscreenElement && !document.querySelector('.adm-dialog')) close(); };
  const close = () => { on = false; root.remove(); document.removeEventListener('keydown', key); opener?.focus?.(); };
  const problem = (t) => { note.hidden = !t; note.textContent = t ?? ''; };
  document.addEventListener('keydown', key);
  document.body.append(root);

  const select = (s) => detail(ctx, task, s);
  const tiles = (rows) => el('section', { class: 'vbd-tiles' }, rows.map((s) => {
    const done = s.goals.filter((g) => g.done).length;
    return el('button', { class: `vbd-tile ${s.level}`, onclick: () => select(s) }, el('span', { class: 'seat' }, String(s.seat)), el('b', {}, s.name), el('span', { class: 'state' }, el('i'), LEVEL[s.level], s.online ? '' : ' · weg'),
      el('span', { class: 'goals', 'aria-label': `${done} von ${task.goals.length} Zielen` }, task.goals.map((g) => el('i', { class: s.goals.find((x) => x.id === g.id)?.done ? 'on' : '' }))),
      el('span', { class: 'sub' }, `${done}/${task.goals.length}`, s.solved !== null ? ` · gelöst in ${short(s.solved)}` : s.since !== null ? ` · ${short(s.since)}` : '', s.partnerReal ? ` · ⇄ ${s.partner}` : ''),
      s.result ? el('span', { class: `stamp ${s.result.passed ? 'ok' : ''}` }, s.result.passed ? `Abnahme ${stars(s.result.sterne)}` : `Abnahme ${s.result.done}/${s.result.total}`) : null);
  }), rows.length ? null : el('p', { class: 'empty' }, 'Noch niemand hat begonnen. Klassencode: ', el('b', {}, v.code)));
  const matrix = (rows) => el('section', { class: 'vbd-matrix' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Standort'), task.goals.map((g, i) => el('th', { title: g.text }, String(i + 1))), el('th', {}, ''))),
    el('tbody', {}, rows.map((s) => el('tr', { tabindex: 0, onclick: () => select(s), onkeydown: (e) => { if (e.key === 'Enter') select(s); } }, el('th', {}, `${s.seat} `, s.name), task.goals.map((g) => { const x = s.goals.find((y) => y.id === g.id); return el('td', { class: x ? (x.done ? 'on' : 'off') : '', title: `${s.name}: ${g.text}` }, x?.done ? '✓' : ''); }), el('td', { class: 'sum' }, `${s.goals.filter((g) => g.done).length}`)))),
    el('tfoot', {}, el('tr', {}, el('th', {}, 'erfüllt'), task.goals.map((g) => el('td', {}, String(rows.filter((s) => s.goals.find((x) => x.id === g.id)?.done).length))), el('td')))), el('ol', {}, task.goals.map((g) => el('li', {}, g.text, g.gemeinsam ? ' (gemeinsam)' : ''))));

  const draw = () => {
    if (!v) return;
    for (const b of seg.children) b.classList.toggle('on', b.dataset.v === view);
    const rows = v.rows;
    const num = (min) => rows.filter((r) => RANK[r.level] >= min).length;
    title.textContent = `${v.label} · Klassencode ${v.code} · ${v.verbund?.open ? 'freigegeben' : 'geschlossen'} · ${clock(Date.now())}`;
    counters.replaceChildren(...[[num(1), 'angeschlossen', ''], [num(2), 'online', 'on'], ...(task.sterne > 2 ? [[num(3), 'Dienste', 'svc']] : []), [num(4), 'fertig', 'gold'], [rows.length, `von ${v.players} dabei`, '']].map(([n, t, c]) => $(`counter ${c}`, el('strong', {}, String(n)), el('span', {}, t))));
    const all = rows.length * task.goals.length;
    const have = rows.reduce((s, r) => s + r.goals.filter((g) => g.done).length, 0);
    bar.style.width = `${all ? (100 * have) / all : 0}%`;
    exam.disabled = v.abnahmeLaeuft;
    exam.textContent = v.abnahmeLaeuft ? `Prüfe ${v.progress ? `${v.progress[0]}/${v.progress[1]}` : '…'}` : 'Abnahme starten';
    meta.textContent = v.checking ? 'prüft …' : v.age !== null ? `geprüft vor ${Math.round(v.age / 1000)} s${v.ms ? ` (${(v.ms / 1000).toFixed(1)} s)` : ''}` : '';
    ticker.replaceChildren(...events.slice(0, 6).map((e) => el('li', { class: e.kind }, el('time', {}, clock(e.t)), ` ${e.text}`)));
    // nur neu zeichnen, wenn sich etwas geaendert hat (sonst laufen die Animationen ruckelig)
    const next = JSON.stringify([view, rows.map((r) => [r.seat, r.name, r.online, r.level, r.goals.map((g) => g.done), r.partnerReal, r.result?.at, Math.floor((r.since ?? 0) / 60_000)])]);
    if (next === sig) return;
    sig = next;
    main.className = view;
    const top = main.querySelector('.vbd-tiles')?.scrollTop ?? 0;
    main.replaceChildren(...(view === 'karte' ? [el('section', { class: 'vbd-mapbox' }, drawMap(rows, select))] : view === 'kacheln' ? [tiles(rows)] : view === 'matrix' ? [matrix(rows)] : [el('section', { class: 'vbd-mapbox' }, drawMap(rows, select)), tiles(rows)]));
    const t = main.querySelector('.vbd-tiles');
    if (t) t.scrollTop = top;
  };
  const results = () => {
    const rows = v.rows.filter((r) => r.result).sort((a, b) => b.result.done - a.result.done || a.result.ms - b.result.ms);
    const ok = rows.filter((r) => r.result.passed).length;
    event(`Abnahme: ${ok} von ${rows.length} Standorten bestanden`, 'exam');
    dialog(`Abnahme · ${ok} von ${rows.length} bestanden`, el('table', { class: 'adm-table' }, el('thead', {}, el('tr', {}, ['Platz', 'Pseudonym', 'Ziele', '', 'Zeit', 'Es fehlt'].map((h) => el('th', {}, h)))), el('tbody', {}, rows.map((r) => el('tr', {}, el('td', {}, String(r.seat)), el('td', {}, el('b', {}, r.name)), el('td', {}, `${r.result.done}/${r.result.total}`),
      el('td', {}, r.result.passed ? el('span', { class: 'vb-stars' }, stars(r.result.sterne)) : ''), el('td', {}, short(r.result.ms)), el('td', {}, r.result.missing.map((k) => task.goals.find((g) => g.id === k)?.text ?? k).join(' · ') || '–'))))));
  };
  const tick = async () => {
    if (!on) return;
    try {
      const n = await get(`classes/${id}/verbund`);
      if (!on) return;
      if (!n.verbund || n.verbund.task !== task.id) { problem('Diese Aufgabe ist beendet.'); return; }
      const running = v?.abnahmeLaeuft;
      v = n;
      for (const r of v.rows) {
        const b = before?.get(r.seat);
        if (before && b === undefined) event(`${r.name} ist auf Platz ${r.seat} dabei`, 'join');
        else if (b !== undefined && b !== r.level) event(RANK[r.level] > RANK[b] ? `${r.name} ist jetzt ${LEVEL[r.level]}` : `${r.name} fällt zurück: ${LEVEL[r.level]}`, r.level === 'done' ? 'done' : RANK[r.level] > RANK[b] ? 'up' : 'down');
      }
      before = new Map(v.rows.map((r) => [r.seat, r.level]));
      problem(v.abnahmeFehler ? 'Der Server war ausgelastet – Abnahme bitte wiederholen.' : null);
      draw();
      if (lastExam === null) lastExam = v.verbund.abnahme ?? 0;
      if (running && !v.abnahmeLaeuft && v.verbund.abnahme && v.verbund.abnahme !== lastExam) { lastExam = v.verbund.abnahme; results(); }
    } catch (e) { problem(errText(e)); }
    if (on) setTimeout(tick, v?.abnahmeLaeuft ? 1000 : 3000);
  };
  tick();
}

/** Ein Standort: Ziele mit Grund, Netzplan (vom Server nachgespielt), Auftragsblatt, Musterloesung */
async function detail(ctx, task, s) {
  const { el, get, id, dialog, errText } = ctx;
  const canvas = el('canvas');
  const body = el('div', { class: 'vbd-detail' }, el('p', { class: 'muted' }, 'Wird geladen …'));
  const d = dialog(`Platz ${s.seat} · ${s.name}`, body);
  let on = true;
  d.box.classList.add('over');
  d.box.onclosed = () => { on = false; };
  let shown = '';
  const tick = async () => {
    if (!on) return;
    try {
      const r = await get(`classes/${id}/verbund/${s.id}`);
      const now = JSON.stringify([r.row.goals, r.row.level, r.row.result]);
      if (now !== shown) {
        const first = !shown;
        shown = now;
        const list = el('div', { class: 'vb-goals' }, task.goals.map((g) => { const x = r.row.goals.find((y) => y.id === g.id); return el('div', { class: `vb-goal ${x?.done ? 'done' : ''}` }, el('i', {}, x?.done ? '✓' : ''), el('span', {}, g.text), el('small', {}, x && !x.done && x.reason ? REASON[x.reason] ?? '' : '')); }));
        if (first) {
          const l = r.loesung;
          const sol = !l ? el('p', { class: 'muted' }, 'Für diesen Server ist keine Musterlösung hinterlegt (docs/VERBUND.md).') : el('details', {}, el('summary', {}, 'Musterlösung für diesen Platz'), el('p', { class: 'muted' }, `Einbau: ${l.einbau.map(([i, u]) => `${i}${u === 'nb' ? '' : ` HE ${u}`}`).join(', ')}`), el('p', { class: 'muted' }, `Kabel: ${l.kabel.map(([a, b]) => `${a} – ${b}`).join(', ')}`),
            Object.entries(l.cli).map(([dev, lines]) => el('div', {}, el('b', {}, dev.toUpperCase()), el('pre', {}, lines.join('\n')))));
          body.replaceChildren(el('div', { class: 'vbd-cols' }, el('div', { 'data-goals': '' }, list), el('div', {}, el('div', { class: 'plan-box adm-plan' }, canvas), el('table', { class: 'vb-blatt' }, el('tbody', {}, r.blatt.zeilen.map(([k, v]) => el('tr', {}, el('th', {}, k), el('td', {}, el('code', {}, v)))))))), sol);
        } else body.querySelector('[data-goals]').replaceChildren(list);
      }
      const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(devicePixelRatio, 2);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const g = canvas.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const plan = planModel(r.plan);
      drawPlan(g, plan, fitView(plan, w, h), { w, h, theme: matchMedia('(prefers-color-scheme: dark)').matches ? THEME.dark : THEME.light, empty: 'Noch nichts gebaut.' });
    } catch (e) { if (!shown) body.replaceChildren(el('p', {}, errText(e))); }
    setTimeout(tick, 4000);
  };
  tick();
}
