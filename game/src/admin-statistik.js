// Statistik im Admin-Board: Kennzahlen, Verlauf 30 Tage, Levels, Verbund, Klassen. Nur Zahlen vom Server (GET admin/stats).
const NF = new Intl.NumberFormat('de-CH');
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)} %` : '–');
const size = (n) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function statsPanel({ el, formatTime, day }, d) {
  const tile = (label, value, sub = '') => el('div', { class: 'st-tile' }, el('span', {}, label), el('b', {}, typeof value === 'number' ? NF.format(value) : value), el('small', {}, sub));
  const s = d.server;
  const tiles = el('div', { class: 'st-tiles' },
    ...(s ? [tile('Spieler insgesamt', s.total.joins, `je beigetreten, auch gelöschte (seit ${day(s.since)})`)] : []),
    tile('Spieler jetzt', d.players.now, s ? `registriert, Platz für ${NF.format(s.capacity)}` : 'in deinen Klassen'),
    tile('Online', d.players.online, 'in diesem Moment'),
    tile('Aktiv, 7 Tage', d.players.active7, `beigetreten oder Level geschafft · 30 Tage: ${NF.format(d.players.active30)}`),
    tile('Mit geschafftem Level', d.players.solved, `${pct(d.players.solved, d.players.now)} der Spieler`),
    tile('Klassen', d.classes.total, `${NF.format(d.classes.open)} offen`),
    ...(s ? [tile('Spielstarts', s.total.starts, `alle, auch ohne Klasse (seit ${day(s.since)})`), tile('Levels geschafft', s.total.levels, 'vom Server bestätigt, insgesamt'),
      tile('Abnahmen bestanden', s.total.verbund, 'Verbundaufgaben, insgesamt'), tile('Lehrpersonen', s.teachers, 'mit eingerichtetem Konto'),
      tile('Spielstände', s.saves.players, `Spieler mit Spielstand · ${size(s.saves.bytes)} von ${size(s.saves.max)}`)] : []));
  const charts = s ? el('div', { class: 'st-charts' }, columns(el, 'Spielstarts pro Tag', s.days, 'starts', day), columns(el, 'Levels geschafft pro Tag', s.days, 'levels', day),
    columns(el, 'Neue Spieler pro Tag', s.days, 'joins', day), columns(el, 'Höchstens gleichzeitig online', s.days, 'peak', day)) : null;
  const t = (x) => (x ? formatTime(x) : '–');
  const bar = (n, of) => el('div', { class: 'st-bar', title: `${NF.format(n)} von ${NF.format(of)} (${pct(n, of)})` }, el('i', { style: `width:${of ? (100 * n) / of : 0}%` }));
  const table = (head, rows) => el('div', { class: 'adm-scroll' }, el('table', { class: 'adm-table st-table' }, el('thead', {}, el('tr', {}, head.map((h) => el('th', {}, h)))), el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c) => el('td', {}, c)))))));
  const n = d.players.now;
  return el('div', {}, el('h1', {}, 'Statistik'), el('p', { class: 'muted' }, s ? 'Alle Klassen dieses Servers. Nur Zahlen, keine Namen und keine Adressen; aktualisiert sich alle 30 Sekunden.' : 'Deine Klassen. Nur Zahlen, keine Namen; aktualisiert sich alle 30 Sekunden.'),
    tiles, charts,
    el('h2', {}, 'Levels'), table(['Level', 'geschafft von', '', 'Abschlüsse', 'Bestzeit selbst gebaut', 'Median', 'Bestzeit fertig aufgebaut', 'Median'],
      d.levels.map((l) => [el('b', {}, l.title.replace(/^Level (\d+) - /, '$1 · ')), `${NF.format(l.players)} (${pct(l.players, n)})`, bar(l.players, n), NF.format(l.count), t(l.self.best), t(l.self.median), t(l.ready?.best), t(l.ready?.median)])),
    el('h2', {}, 'Verbundaufgaben'), table(['Aufgabe', 'Abnahme versucht', 'bestanden', ''], d.verbund.map((v) => [el('b', {}, `${'★'.repeat(v.sterne)} ${v.titel}`), NF.format(v.tried), `${NF.format(v.passed)} (${pct(v.passed, v.tried)})`, bar(v.passed, v.tried)])),
    el('h2', {}, 'Klassen'), d.byClass.length ? table(['Klasse', ...(s ? ['Lehrperson'] : []), 'Zustand', 'Spieler', 'online', 'aktiv 7 Tage', 'Levels je Spieler', 'Abnahmen'],
      d.byClass.map((c) => [el('b', {}, c.label), ...(s ? [c.owner] : []), c.open ? 'offen' : 'geschlossen', NF.format(c.players), NF.format(c.online), NF.format(c.active7), c.players ? (c.levels / c.players).toFixed(1) : '–', NF.format(c.verbund)]))
      : el('p', { class: 'muted' }, 'Noch keine Klasse.'),
    ...(s ? [el('p', { class: 'muted st-foot' }, `Server läuft seit ${uptime(s.uptime)} · Musterlösungen ${s.solutions ? 'hinterlegt' : 'nicht hinterlegt'} · Zählung seit ${day(s.since)}, Tageswerte 400 Tage`),
      el('p', { class: 'muted st-foot' }, 'Spielstarts zählen geladene Spielseiten, nicht Personen: Wer neu lädt, zählt nochmals. Spieler ohne Klasse lassen sich nicht einzeln zählen, weil der Server nichts über sie speichert.')] : []));
}
const uptime = (sec) => (sec >= 86400 ? `${Math.floor(sec / 86400)} Tagen` : sec >= 3600 ? `${Math.floor(sec / 3600)} Std.` : `${Math.max(1, Math.floor(sec / 60))} Min.`);

/** runde Obergrenze der Achse */
export function niceMax(v) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 4, 5, 10].map((k) => k * p).find((x) => x >= v);
}

/** Saeulen, eine Reihe, 30 Tage: Tooltip je Tag (Maus + Tastatur), Tabelle zum Aufklappen */
function columns(el, title, days, key, day) {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 560, H = 170, L = 40, B = 24, T = 14, max = niceMax(Math.max(...days.map((x) => x[key])));
  const svg = document.createElementNS(NS, 'svg');
  const add = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text !== undefined) e.textContent = text; svg.append(e); return e; };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', title);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  for (const v of [0, max / 2, max]) { add('line', { x1: L, x2: W, y1: y(v), y2: y(v), class: v ? 'st-grid' : 'st-axis' }); add('text', { x: L - 6, y: y(v) + 4, class: 'st-tick', 'text-anchor': 'end' }, NF.format(v)); }
  const step = (W - L) / days.length, w = Math.min(14, step - 4);
  const tip = el('div', { class: 'st-tip', hidden: true });
  days.forEach((x, i) => {
    const v = x[key], cx = L + step * i + step / 2, top = y(v), h = y(0) - top;
    if (v) { const r = Math.min(4, h, w / 2); add('path', { class: 'st-mark', d: `M${cx - w / 2},${y(0)}V${top + r}Q${cx - w / 2},${top} ${cx - w / 2 + r},${top}H${cx + w / 2 - r}Q${cx + w / 2},${top} ${cx + w / 2},${top + r}V${y(0)}Z` }); }
    const hit = add('rect', { class: 'st-col', x: L + step * i, y: T, width: step, height: H - T - B, tabindex: v ? 0 : -1, 'aria-label': `${day(x.d)}: ${NF.format(v)}` });
    const on = () => { tip.replaceChildren(el('b', {}, NF.format(v)), el('span', {}, day(x.d))); tip.hidden = false; tip.style.left = `${Math.min(88, Math.max(12, (100 * cx) / W))}%`; };
    const off = () => { tip.hidden = true; };
    hit.addEventListener('pointerenter', on); hit.addEventListener('pointerleave', off); hit.addEventListener('focus', on); hit.addEventListener('blur', off);
    if (i % 7 === 1 || i === days.length - 1) add('text', { x: cx, y: H - 6, class: 'st-tick', 'text-anchor': i === days.length - 1 ? 'end' : 'middle' }, day(x.d).slice(0, 6));
  });
  const sum = days.reduce((a, x) => a + x[key], 0);
  return el('figure', { class: 'st-chart' }, el('figcaption', {}, el('b', {}, title), el('span', {}, key === 'peak' ? `30 Tage, höchster Wert ${NF.format(Math.max(...days.map((x) => x.peak)))}` : `30 Tage, zusammen ${NF.format(sum)}`)), el('div', { class: 'st-plot' }, svg, tip),
    el('details', {}, el('summary', {}, 'Als Tabelle'), el('table', { class: 'adm-table' }, el('tbody', {}, days.filter((x) => x[key]).reverse().map((x) => el('tr', {}, el('td', {}, day(x.d)), el('td', {}, NF.format(x[key]))))))));
}
