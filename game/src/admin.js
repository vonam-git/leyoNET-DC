// Admin-Board (Plan v4 F, Konzept Kap. 9): eigene Seite fuer Lehrpersonen. Spricht nur mit ./api/ (server/app.cjs).
// Anmeldung nur in diesem Tab (sessionStorage), nie localStorage oder Cookies. Alle Texte ueber textContent (kein innerHTML mit Daten).
import { qrMatrix, qrPath } from '../../vendor/leyonet/src/ui/qr.ts';
import favicon from '../../vendor/leyonet/branding/favicon.svg?url';
import { VERSION } from './info.js';
import { statsPanel } from './admin-statistik.js';
import { verbundPanel } from './admin-verbund.js';
import { drawPlan, fitView, planModel, THEME } from './netplan.js';
import { formatTime } from './timer.js';
import './style.css';
import './admin.css';

const KEY = 'leyonet-dc.admin';
const app = document.getElementById('app');
let token = null;
try { token = sessionStorage.getItem(KEY); } catch { /* gesperrt */ }
let me = null;
let view = { name: 'klassen' };
let poll = null;

const ERR = { login: 'Bitte neu anmelden.', loginWrong: 'Anmeldung stimmt nicht.', locked: 'Zu viele Fehlversuche – in 15 Minuten wieder.', inviteUnknown: 'Diese Einladung gilt nicht (mehr).',
  codeWrong: 'Der Code stimmt nicht.', setupExpired: 'Zu lange gewartet – bitte neu beginnen.', exists: 'Gibt es schon.', tooMany: 'Zu viele Anfragen – kurz warten.', forbidden: 'Dafür fehlt die Berechtigung.',
  'invalid:password': 'Das Passwort braucht mindestens 12 Zeichen.', 'invalid:label': 'Bezeichnung: 1–30 Zeichen, z.B. INF22a.', 'invalid:until': 'Das Datum liegt in der Vergangenheit oder zu weit weg.',
  'invalid:user': 'Kürzel: 2–20 Kleinbuchstaben, Ziffern, Punkt oder Strich.', classUnknown: 'Diese Klasse gibt es nicht mehr.', noTask: 'Keine Aufgabe freigegeben.', taskUnknown: 'Diese Aufgabe kennt der Server nicht – Server aktualisieren.', busy: 'Der Server ist ausgelastet – gleich nochmals versuchen.', offline: 'Der Server ist nicht erreichbar.' };
const errText = (e) => ERR[e.message] ?? `Fehler (${e.message})`;

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

async function api(method, path, body) {
  let r;
  try {
    r = await fetch(`./api/${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit' });
  } catch { throw new Error('offline'); }
  if (r.ok && !/json/.test(r.headers.get('content-type') ?? '')) {
    const text = await r.text();
    if (/text\/csv/.test(r.headers.get('content-type') ?? '')) return text;
    throw new Error('offline'); // statische Seite ohne Server
  }
  const j = await r.json().catch(() => null);
  if (r.ok && j) return j;
  if (r.status === 401 && token) { setToken(null); start(); }
  throw new Error(j?.error ?? 'offline');
}
const get = (p) => api('GET', `admin/${p}`);
const post = (p, b = {}) => api('POST', `admin/${p}`, b);
function setToken(t) {
  token = t;
  me = t ? me : null;
  try { if (t) sessionStorage.setItem(KEY, t); else sessionStorage.removeItem(KEY); } catch { /* gesperrt */ }
}

// ---------- Bausteine ----------
const field = (label, attrs = {}) => {
  const input = el('input', { autocomplete: 'off', ...attrs });
  return { input, root: el('label', { class: 'field' }, el('span', {}, label), input) };
};
const button = (label, fn, cls = '') => el('button', { class: `btn ${cls}`, type: 'button', onclick: fn }, label);
/** Knopf, der erst beim zweiten Klick ausfuehrt */
function sure(label, question, fn, cls = 'secondary') {
  const b = button(label, () => {
    if (b.dataset.sure) { fn(); return; }
    b.dataset.sure = '1';
    b.textContent = question;
    setTimeout(() => { delete b.dataset.sure; b.textContent = label; }, 4000);
  }, cls);
  return b;
}
const msg = () => el('div', { class: 'ui-msg', role: 'status' });
const show = (m, text, ok = false) => { m.className = `ui-msg ${ok ? 'ok' : 'err'}`; m.textContent = text; };
const day = (d) => (d ? d.split('-').reverse().join('.') : '–');

function dialog(title, ...kids) {
  const close = () => { box.remove(); document.removeEventListener('keydown', esc); box.onclosed?.(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  const box = el('div', { class: 'ui-overlay', onmousedown: (e) => { if (e.target === box) close(); } },
    el('div', { class: 'ui-win adm-dialog', role: 'dialog', 'aria-label': title }, el('div', { class: 'ui-head' }, el('div', { class: 't' }, title), el('span', { class: 'sp' }),
      el('button', { class: 'ui-close', title: 'Schliessen (Esc)', onclick: close }, '✕')), el('div', { class: 'ui-body' }, ...kids)));
  document.body.append(box);
  return { box, close };
}

// ---------- Anmeldung ----------
function brand() { return el('div', { class: 'adm-brand' }, el('img', { src: favicon, alt: '' }), el('div', {}, el('b', {}, 'leyo', el('span', {}, 'NET'), ' DC'), el('small', {}, 'Admin-Board'))); }
function card(...kids) { clearInterval(poll); app.replaceChildren(el('main', { class: 'adm-login' }, brand(), ...kids)); }

function loginView(text = '') {
  const user = field('Kürzel', { autocomplete: 'username', autocapitalize: 'none' });
  const pw = field('Passwort', { type: 'password', autocomplete: 'current-password' });
  const code = field('Code aus der Authenticator-App (oder Wiederherstellungscode)', { autocomplete: 'one-time-code', inputmode: 'text' });
  const m = msg();
  if (text) show(m, text);
  const form = el('form', { class: 'ui-form', onsubmit: async (e) => {
    e.preventDefault();
    try {
      const r = await post('login', { user: user.input.value, password: pw.input.value, code: code.input.value });
      setToken(r.token);
      start();
    } catch (x) { show(m, errText(x)); code.input.value = ''; }
  } }, user.root, pw.root, code.root, el('div', { class: 'row' }, el('button', { class: 'btn' }, 'Anmelden'), button('Ich habe eine Einladung', () => activateView(), 'secondary')), m);
  card(el('h1', {}, 'Anmelden'), form);
  user.input.focus();
}

function activateView() {
  const inv = field('Einladung');
  const pw = field('Neues Passwort (mindestens 12 Zeichen)', { type: 'password', autocomplete: 'new-password' });
  const pw2 = field('Passwort wiederholen', { type: 'password', autocomplete: 'new-password' });
  const m = msg();
  const form = el('form', { class: 'ui-form', onsubmit: async (e) => {
    e.preventDefault();
    if (pw.input.value !== pw2.input.value) { show(m, 'Die Passwörter sind nicht gleich.'); return; }
    try { totpView(await post('activate', { invite: inv.input.value, password: pw.input.value })); } catch (x) { show(m, errText(x)); }
  } }, inv.root, pw.root, pw2.root, el('div', { class: 'row' }, el('button', { class: 'btn' }, 'Weiter'), button('Zurück', () => loginView(), 'secondary')), m);
  card(el('h1', {}, 'Zugang einrichten'), form);
  inv.input.focus();
}

function totpView(a) {
  const { d, size } = qrPath(qrMatrix(a.uri));
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'adm-qr');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR-Code für die Authenticator-App');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  const code = field('Sechsstelliger Code aus der App', { inputmode: 'numeric', autocomplete: 'one-time-code' });
  const m = msg();
  const form = el('form', { class: 'ui-form', onsubmit: async (e) => {
    e.preventDefault();
    try {
      const r = await post('confirm', { pending: a.pending, code: code.input.value });
      setToken(r.token);
      recoveryView(r.recovery);
    } catch (x) { show(m, errText(x)); }
  } }, el('p', {}, `Kürzel: ${a.user}. Scanne den Code mit einer Authenticator-App (z.B. Aegis, 2FAS, Google Authenticator) oder tippe den Schlüssel ein:`),
  svg, el('code', { class: 'adm-secret' }, a.secret.replace(/(.{4})/g, '$1 ').trim()), code.root, el('div', {}, el('button', { class: 'btn' }, 'Bestätigen')), m);
  card(el('h1', {}, 'Zwei-Faktor einrichten'), form);
  code.input.focus();
}

function recoveryView(list) {
  card(el('h1', {}, 'Wiederherstellungscodes'), el('p', {}, 'Handy verloren? Jeder Code ersetzt einmal den Code der App. Drucke sie aus oder lege sie in den Passwort-Manager – sie erscheinen nur jetzt.'),
    el('pre', { class: 'adm-codes' }, list.join('\n')), el('div', {}, button('Codes sind abgelegt', () => start())));
}

// ---------- Rahmen ----------
async function start() {
  clearInterval(poll);
  if (!token) { loginView(); return; }
  try { me = await get('me'); } catch (e) { if (!token) loginView(errText(e)); else loginView(errText(e)); return; }
  render();
}

function frame(content) {
  clearInterval(poll);
  const nav = (name, label) => el('button', { class: view.name === name || (name === 'klassen' && view.name === 'klasse') ? 'on' : '', onclick: () => { view = { name }; render(); } }, label);
  app.replaceChildren(el('header', { class: 'adm-top' }, brand(), el('nav', {}, nav('klassen', 'Klassen'), nav('statistik', 'Statistik'), me.role === 'admin' ? nav('konten', 'Konten') : null, nav('protokoll', 'Protokoll'), nav('hilfe', 'Erste Schritte')),
    el('span', { class: 'sp' }), el('span', { class: 'muted' }, `${me.user} · ${me.role === 'admin' ? 'Admin' : 'Lehrperson'} · v${VERSION}`),
    button('Abmelden', async () => { try { await post('logout'); } catch { /* egal */ } setToken(null); loginView(); }, 'secondary')), el('main', { class: 'adm-main' }, content));
  return content;
}
function render() {
  ({ klassen: classesView, klasse: classView, konten: accountsView, protokoll: auditView, hilfe: helpView, statistik: statsView })[view.name]();
}
const loading = () => frame(el('p', { class: 'muted' }, 'Wird geladen …'));

// ---------- Klassen ----------
async function classesView() {
  loading();
  let list;
  try { list = (await get('classes')).classes; } catch (e) { frame(el('p', {}, errText(e))); return; }
  const label = field('Bezeichnung (z.B. INF22a – keine Namen)', { maxlength: '30' });
  const until = field('Semesterende', { type: 'date', value: semesterEnd() });
  const m = msg();
  const form = el('form', { class: 'adm-new', onsubmit: async (e) => {
    e.preventDefault();
    try { const c = await post('classes', { label: label.input.value.trim(), until: until.input.value }); view = { name: 'klasse', id: c.id }; render(); } catch (x) { show(m, errText(x)); }
  } }, label.root, until.root, el('button', { class: 'btn' }, 'Klasse eröffnen'));
  frame(el('div', {}, el('h1', {}, 'Klassen'), form, m,
    list.length ? el('table', { class: 'adm-table' }, el('thead', {}, el('tr', {}, ['Klasse', 'Code', 'Lernende', 'online', 'Zustand', 'Semesterende', me.role === 'admin' ? 'Lehrperson' : null].filter(Boolean).map((h) => el('th', {}, h)))),
      el('tbody', {}, list.map((c) => el('tr', { class: 'click', tabindex: '0', onclick: () => { view = { name: 'klasse', id: c.id }; render(); }, onkeydown: (e) => { if (e.key === 'Enter') e.currentTarget.click(); } },
        el('td', {}, el('b', {}, c.label)), el('td', {}, el('code', {}, c.code)), el('td', {}, String(c.players)), el('td', {}, String(c.online)), el('td', {}, stateText(c)), el('td', {}, day(c.until)),
        me.role === 'admin' ? el('td', {}, c.owner) : null))))
      : el('p', { class: 'muted' }, 'Noch keine Klasse. Eröffne eine und gib den Klassencode weiter.')));
}
const stateText = (c) => (!c.open ? 'geschlossen' : c.settings.paused ? 'angehalten' : 'offen');
/** Vorschlag: naechstes Semesterende (31. Januar / 31. Juli) */
function semesterEnd(d = new Date()) {
  const y = d.getFullYear();
  const iso = d.toISOString().slice(5, 10);
  return iso <= '01-31' ? `${y}-01-31` : iso <= '07-31' ? `${y}-07-31` : `${y + 1}-01-31`;
}

async function classView() {
  const id = view.id;
  const table = el('div', {}, el('p', { class: 'muted' }, 'Wird geladen …'));
  const head = el('div');
  const m = msg();
  const panel = verbundPanel({ el, button, sure, get, post, show, msg, errText, dialog, tasks: me.verbund ?? [], id });
  const root = frame(el('div', {}, head, m, panel, table));
  const levels = me.levels.filter((l) => l.goals);
  let c = null;
  const act = async (fn, text) => { try { const r = await fn(); if (text) show(m, text, true); await load(true); return r; } catch (e) { show(m, errText(e)); return null; } };
  const settings = (s, text) => act(() => post(`classes/${id}/settings`, s), text);
  const load = async (full = false) => {
    try { c = await get(`classes/${id}`); } catch (e) { if (root.isConnected) show(m, errText(e)); return; }
    if (!root.isConnected) return;
    if (full) drawHead();
    drawTable();
  };
  const drawHead = () => {
    const toggle = (key, label) => { const i = el('input', { type: 'checkbox', checked: c.settings[key], onchange: () => settings({ [key]: i.checked }, 'Gespeichert.') }); return el('label', { class: 'adm-check' }, i, label); };
    const timer = el('select', { onchange: () => settings({ timer: timer.value }, 'Gespeichert.') }, [['frei', 'Timer: frei wählbar'], ['ein', 'Timer: für alle ein'], ['aus', 'Timer: für alle aus']].map(([v, t]) => el('option', { value: v, selected: c.settings.timer === v }, t)));
    const until = el('input', { type: 'date', value: c.until, onchange: () => settings({ until: until.value }, 'Gespeichert.') });
    const open = new Set(c.settings.levels ?? me.levels.map((l) => l.id));
    const lv = me.levels.map((l) => { const i = el('input', { type: 'checkbox', checked: open.has(l.id), onchange: () => { if (i.checked) open.add(l.id); else open.delete(l.id); settings({ levels: open.size === me.levels.length ? null : [...open] }, 'Gespeichert.'); } }); return el('label', { class: 'adm-check', title: l.title }, i, l.id); });
    head.replaceChildren(el('div', { class: 'adm-head' }, el('div', {}, el('button', { class: 'adm-back', onclick: () => { view = { name: 'klassen' }; render(); } }, '← Klassen'), el('h1', {}, c.label),
      el('p', { class: 'muted' }, `${stateText(c)} · Daten werden am ${day(c.deleted)} gelöscht`)), el('div', { class: 'adm-code' }, el('small', {}, 'Klassencode'), el('b', {}, c.code))),
    el('div', { class: 'row' }, button('Klassenstart', () => act(() => post(`classes/${id}/preset`, { preset: 'start' }), 'Die Klasse ist offen.')),
      button('Zwischenstopp', () => act(() => post(`classes/${id}/preset`, { preset: 'stopp' }), 'Alle sind angehalten.'), 'secondary'),
      button('Schluss', () => act(() => post(`classes/${id}/preset`, { preset: 'schluss' }), 'Die Klasse ist geschlossen.'), 'secondary'),
      button('CSV herunterladen', async () => { try { save(`${c.label}.csv`, await get(`classes/${id}/csv`)); } catch (e) { show(m, errText(e)); } }, 'secondary'),
      sure('Klasse löschen', 'Wirklich alles löschen?', async () => { try { await post(`classes/${id}/delete`); view = { name: 'klassen' }; render(); } catch (e) { show(m, errText(e)); } })),
    el('details', { class: 'adm-set' }, el('summary', {}, 'Einstellungen'), el('div', { class: 'row' }, timer, toggle('leaderboard', 'Rangliste für die Klasse (Pseudonyme)'), el('label', { class: 'adm-check' }, 'Semesterende ', until)),
      el('div', { class: 'row' }, el('span', { class: 'muted' }, 'Offene Levels:'), ...lv)));
  };
  const drawTable = () => {
    if (!c.table.length) { table.replaceChildren(el('p', {}, 'Noch niemand beigetreten. Im Spiel: Esc → Klasse → Code ', el('code', {}, c.code), ' eingeben.')); return; }
    // schnellste bestaetigte Zeit je Level: Heatmap von dort aus
    const keys = levels.flatMap((l) => (l.plan && c.table.some((p) => p.results[`${l.id}+`]) ? [l.id, `${l.id}+`] : [l.id]));
    const best = Object.fromEntries(keys.map((k) => [k, Math.min(...c.table.map((p) => p.results[k]?.best || Infinity))]));
    const cell = (p, k) => {
      const r = p.results[k];
      const now = p.online && p.level && `${p.level}${p.ready ? '+' : ''}` === k;
      const heat = r?.best ? Math.max(0.25, Math.min(1, best[k] / r.best)) : 0;
      return el('td', { class: `heat ${now ? 'now' : ''}`, style: r ? `--h:${heat.toFixed(2)}` : null, title: r ? `${r.count}× gelöst, zuletzt ${day(r.day)}` : null },
        now && p.total ? el('small', {}, `${p.done}/${p.total}`) : null, r ? (r.best ? formatTime(r.best) : '✓') : '');
    };
    table.replaceChildren(el('div', { class: 'adm-scroll' }, el('table', { class: 'adm-table' }, el('thead', {}, el('tr', {}, ['', 'Pseudonym', 'Status', ...keys, 'zuletzt', ''].map((h) => el('th', {}, h)))),
      el('tbody', {}, c.table.map((p) => el('tr', { class: p.locked ? 'locked' : '' },
        el('td', {}, el('i', { class: `dot ${p.online ? 'on' : ''}`, title: p.online ? 'online' : 'nicht online' })), el('td', {}, el('b', {}, p.name)),
        el('td', {}, p.locked ? 'gesperrt' : p.online ? (p.level ? `${p.level}${p.ready ? ' (fertig aufgebaut)' : ''}${p.since !== null ? ` · ${formatTime(p.since).replace(/\.\d$/, '')}` : ''}` : 'im Menü') : '–'),
        ...keys.map((k) => cell(p, k)), el('td', {}, day(p.day)), el('td', {}, el('button', { class: 'adm-more', 'aria-label': `Aktionen für ${p.name}`, onclick: () => playerDialog(p) }, '⋯'))))))),
    el('p', { class: 'muted' }, `${c.table.filter((p) => p.online).length} von ${c.table.length} online. Zeiten sind vom Server geprüft; dunkler = näher an der Bestzeit. «+» = fertig aufgebaut gestartet. Die Zahl x/y zeigt den laufenden Versuch.`));
  };
  const playerDialog = (p) => {
    const u = `classes/${id}/players/${p.id}`;
    const out = msg();
    const run = async (action, text) => { try { const r = await post(u, { action }); show(out, r.code ? `Neuer Code: ${r.code} (gilt ab sofort, der alte nicht mehr)` : text, true); await load(); } catch (e) { show(out, errText(e)); } };
    const d = dialog(p.name, el('div', { class: 'row' }, button('Live zuschauen', () => { d.close(); observe(p); }), p.locked ? button('Freigeben', () => run('unlock', 'Freigegeben.'), 'secondary') : button('Sperren', () => run('lock', 'Gesperrt.'), 'secondary'),
      button('Lauf beenden', () => run('close', 'Der laufende Versuch zählt nicht mehr.'), 'secondary'), button('Neuer Code', () => run('code'), 'secondary'),
      sure('Löschen', 'Wirklich löschen?', async () => { await run('delete', 'Gelöscht.'); d.close(); })),
    el('p', { class: 'muted' }, '«Neuer Code» hilft, wenn jemand den eigenen Code verloren hat. Beim Zuschauen sieht die Person einen Hinweis.'), out);
  };
  const observe = (p) => {
    const canvas = el('canvas');
    const info = el('p', { class: 'muted' }, 'Verbindung wird aufgebaut …');
    const d = dialog(`${p.name} · live`, info, el('div', { class: 'plan-box adm-plan' }, canvas));
    let on = true;
    d.box.onclosed = () => { on = false; };
    const dark = matchMedia('(prefers-color-scheme: dark)');
    const tick = async () => {
      if (!on) return;
      try {
        const r = await post(`classes/${id}/players/${p.id}`, { action: 'observe' });
        info.textContent = !r.online ? 'Nicht online.' : r.plan ? `${r.level ?? ''} · ${r.done} von ${r.total} Zielen · Stand vor ${Math.round(r.age / 1000)} s` : 'Wartet auf den nächsten Stand (bis 15 s) …';
        if (r.plan) {
          const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(devicePixelRatio, 2);
          canvas.width = w * dpr;
          canvas.height = h * dpr;
          const g = canvas.getContext('2d');
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          const plan = planModel(r.plan);
          drawPlan(g, plan, fitView(plan, w, h), { w, h, theme: dark.matches ? THEME.dark : THEME.light, empty: 'Noch nichts gebaut.' });
        }
      } catch (e) { info.textContent = ERR[e.message] ? errText(e) : 'Der Stand lässt sich nicht anzeigen.'; }
      setTimeout(tick, 3000);
    };
    tick();
  };
  await load(true);
  poll = setInterval(() => { if (!document.hidden && root.isConnected) load(); }, 5000);
}
function save(name, text) {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name.replace(/[^\p{L}\p{N}._-]/gu, '_') });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- Konten ----------
async function accountsView() {
  loading();
  let list;
  try { list = (await get('accounts')).accounts; } catch (e) { frame(el('p', {}, errText(e))); return; }
  const user = field('Kürzel der Lehrperson (kein voller Name)', { maxlength: '20', autocapitalize: 'none' });
  const m = msg();
  const invite = (r) => dialog(`Einladung für ${r.user}`, el('p', {}, 'Gib die Einladung persönlich weiter. Sie gilt 7 Tage, einmal, und erscheint nur jetzt. Einrichten unter /admin.html → «Ich habe eine Einladung».'), el('p', { class: 'code-big' }, r.invite));
  const act = async (fn) => { try { const r = await fn(); await accountsView(); if (r.invite) invite(r); } catch (e) { show(m, errText(e)); } };
  frame(el('div', {}, el('h1', {}, 'Konten'), el('form', { class: 'adm-new', onsubmit: (e) => { e.preventDefault(); act(() => post('accounts', { user: user.input.value.trim().toLowerCase() })); } }, user.root, el('button', { class: 'btn' }, 'Konto anlegen')), m,
    el('table', { class: 'adm-table' }, el('thead', {}, el('tr', {}, ['Kürzel', 'Rolle', 'Zustand', 'Klassen', 'letzte Anmeldung', ''].map((h) => el('th', {}, h)))), el('tbody', {}, list.map((a) => el('tr', {}, el('td', {}, el('b', {}, a.user)),
      el('td', {}, a.role === 'admin' ? 'Admin' : 'Lehrperson'), el('td', {}, a.active ? 'aktiv' : `eingeladen bis ${day(a.inviteUntil)}`), el('td', {}, String(a.classes)), el('td', {}, day(a.last)),
      el('td', {}, a.role === 'admin' ? null : el('div', { class: 'row' }, sure('Zurücksetzen', 'Neu einladen?', () => act(() => post(`accounts/${a.id}/reset`))), sure('Löschen', 'Wirklich löschen?', () => act(() => post(`accounts/${a.id}/delete`)))))))))));
}

// ---------- Statistik ----------
async function statsView() {
  loading();
  const root = frame(el('div'));
  const load = async () => {
    try { const d = await get('stats'); if (root.isConnected) root.replaceChildren(statsPanel({ el, formatTime, day }, d)); } catch (e) { if (root.isConnected && !root.childElementCount) root.replaceChildren(el('p', {}, errText(e))); }
  };
  await load();
  poll = setInterval(() => { if (!document.hidden && root.isConnected && !root.contains(document.activeElement) && !root.querySelector('.st-col:hover')) load(); }, 30_000);
}

// ---------- Protokoll ----------
const ACTION = { login: 'Anmeldung', 'login.recovery': 'Anmeldung mit Wiederherstellungscode', 'account.activated': 'Zugang eingerichtet', 'account.create': 'Konto angelegt', 'account.reset': 'Konto zurückgesetzt', 'account.delete': 'Konto gelöscht',
  'class.create': 'Klasse eröffnet', 'class.settings': 'Klasse eingestellt', 'class.start': 'Klassenstart', 'class.stopp': 'Zwischenstopp', 'class.schluss': 'Schluss', 'class.delete': 'Klasse gelöscht', 'class.expired': 'Klasse abgelaufen, gelöscht', 'class.csv': 'CSV heruntergeladen',
  'player.lock': 'gesperrt', 'player.unlock': 'freigegeben', 'player.close': 'Lauf beendet', 'player.delete': 'Pseudonym gelöscht', 'player.code': 'neuer Code', 'player.observe': 'live zugeschaut', 'verbund.open': 'Verbundaufgabe freigegeben', 'verbund.close': 'Verbundaufgabe geschlossen', 'verbund.reopen': 'Verbundaufgabe wieder geöffnet', 'verbund.end': 'Verbundaufgabe beendet', 'verbund.abnahme': 'Verbund-Abnahme', 'admin.reset': 'Admin zurückgesetzt' };
async function auditView() {
  loading();
  try {
    const { audit } = await get('audit');
    frame(el('div', {}, el('h1', {}, 'Protokoll'), el('p', { class: 'muted' }, 'Wer hat wann was getan. Wird nach zwei Jahren gelöscht.'), el('table', { class: 'adm-table' }, el('thead', {}, el('tr', {}, ['Zeit', 'Konto', 'Aktion', 'Betrifft'].map((h) => el('th', {}, h)))),
      el('tbody', {}, audit.map((r) => el('tr', {}, el('td', {}, new Date(r.t).toLocaleString('de-CH')), el('td', {}, r.who), el('td', {}, ACTION[r.action] ?? r.action), el('td', {}, r.target)))))));
  } catch (e) { frame(el('p', {}, errText(e))); }
}

// ---------- Erste Schritte ----------
function helpView() {
  frame(el('div', { class: 'ui-doc' }, el('h1', {}, 'Erste Schritte'), el('ol', {}, ['Klasse eröffnen: nur eine Bezeichnung wie INF22a, dazu das Semesterende.', 'Den Klassencode an die Wand schreiben. Die Lernenden öffnen das Spiel: Esc → Klasse → Code eingeben.',
    'Jede Person bekommt ein Pseudonym und einen eigenen Code. Notiere auf Papier oder in deiner eigenen Liste, wer welches Pseudonym hat – der Server erfährt es nie.',
    'Klassenstart öffnet die Klasse, Zwischenstopp hält alle an, Schluss beendet die Lektion.', 'Die Tabelle zeigt geprüfte Zeiten. Über ⋯ kannst du live zuschauen, sperren, einen neuen Code geben oder löschen.'].map((t) => el('li', {}, t))),
  el('h3', {}, 'Verbundaufgaben'), el('ol', {}, ['In der Klasse eine der fünf Aufgaben (★ bis ★★★★★) freigeben. Wer den Klassencode eingegeben hat, sieht sie sofort im Spiel (Taste J).', 'Jeder Platz bekommt einen Standort mit eigenen Adressen; abgeschriebene Konfigurationen funktionieren nicht.',
    'Das Dashboard auf den Beamer legen: Der Server spielt jeden Standort nach und setzt den ganzen Verbund zusammen. Grün wird nur, was wirklich läuft.', '«Abnahme starten» prüft alle Anforderungen frisch und hält das Ergebnis fest (auch im CSV). Ein Klick auf einen Standort zeigt Ziele, Netzplan und Musterlösung.'].map((t) => el('li', {}, t))),
  el('h3', {}, 'Was geprüft ist'), el('p', {}, 'Ein Level zählt erst, wenn der Server die Spielschritte im selben Simulator nachgespielt hat; auch die Zeit misst der Server. Die Anzeige x/y des laufenden Versuchs meldet dagegen das Spiel selbst.'),
  el('h3', {}, 'Statistik'), el('p', {}, 'Zahlen zu Spielern, Levels und Verbundaufgaben deiner Klassen. Der Admin sieht zusätzlich Spielstarts und Summen des ganzen Servers. Wer ohne Klasse spielt, wird nur als Spielstart gezählt.'),
  el('h3', {}, 'Datenschutz'), el('p', {}, 'Keine Namen, keine E-Mail-Adressen, keine IP-Adressen. Trage auch in Bezeichnungen keine Personennamen ein. Alles wird drei Monate nach dem Semesterende gelöscht.'),
  el('p', { class: 'muted' }, `Du hast noch ${me.recovery} Wiederherstellungscodes.`)));
}

start();
