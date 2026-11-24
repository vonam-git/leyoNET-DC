// Willkommen, Einstellungen, Hilfe, Spielstaende, Zugangscode (2026-11-24). Fenster im Stil von ui.js.
import { el } from './ui.js';
import { ACTIONS, QUALITY, assignable } from './settings.js';
import { FREI, HILFE, WILLKOMMEN } from './hilfe.js';
import { LINKS, VERSION } from './info.js';
import { saveDate } from './saves.js';
import { formatTime } from './timer.js';

const btn = (label, sub, fn, primary = false) => el('button', { class: `menu-btn ${primary ? 'primary' : ''}`, onclick: fn }, el('b', {}, label), el('span', {}, sub));
const back = (fn) => (fn ? [el('div', { class: 'row' }, el('button', { class: 'btn secondary', onclick: fn }, 'Zurück'))] : []);

/** «Text mit {shop}» -> Text + Tastenkappen */
export function rich(settings, text) {
  const ids = new Set(ACTIONS.map((a) => a.id));
  return text.split(/(\{\w+\})/).map((t) => { const id = /^\{(\w+)\}$/.exec(t)?.[1]; return ids.has(id) ? el('kbd', {}, settings.key(id)) : t; });
}

/** Schalter mit Erklaerung */
function toggle(label, help, value, onChange) {
  const i = el('input', { type: 'checkbox' });
  i.checked = value;
  i.addEventListener('change', () => onChange(i.checked));
  return el('label', { class: 'opt' }, i, el('span', {}, el('b', {}, label), el('small', {}, ...[help].flat())));
}

// ---------- Willkommen ----------
export function openWelcome(ui, { settings, levels, open, openSettings, openHelp }) {
  const W = WILLKOMMEN;
  const hero = el('div', { class: 'menu-hero' }, el('h1'), el('p', {}, W.titel));
  hero.firstChild.innerHTML = 'leyo<span>NET</span> DC';
  const body = () => el('div', { class: 'ui-doc welcome' }, hero,
    el('p', { class: 'lead' }, W.lead), el('p', {}, W.text),
    el('div', { class: 'menu-grid' }, btn('Level wählen', 'loslegen', levels, true), btn('Spielstand öffnen', 'dort weiter, wo du aufgehört hast', open),
      btn('Einstellungen', 'Tasten, Grafik, Anzeige', openSettings), btn('Hilfe', 'kurze Anleitungen', openHelp),
      el('a', { class: 'menu-btn', href: LINKS.patreon, target: '_blank', rel: 'noopener' }, el('b', {}, 'Projekt unterstützen'), el('span', {}, 'patreon.com/leyonet – freiwillig'))),
    el('h3', {}, 'So geht es'), el('ol', {}, ...W.schritte.map((t) => el('li', {}, ...rich(settings, t)))),
    el('h3', {}, 'Tastenhinweise'),
    toggle('Tastenhinweise einblenden', rich(settings, W.hinweis), settings.hints, (v) => settings.set('hints', v)),
    el('p', { class: 'muted' }, W.touch));
  const w = ui._win('Willkommen', { Willkommen: body }, { icon: 'ly', sub: `${W.titel} · ${VERSION}` });
  ui._show(w.win);
  w.select('Willkommen');
}

// ---------- Hilfe ----------
export function openHelp(ui, settings, { onBack = null, tab = 'Start' } = {}) {
  const page = (blocks) => el('div', { class: 'ui-doc' }, ...blocks.map((b) => (b.h ? el('h3', {}, b.h) : el('p', {}, ...rich(settings, b.p)))), ...back(onBack));
  const keys = () => el('div', { class: 'ui-doc' }, keyTable(settings), el('p', {}, 'Fest belegt: Maus umsehen, Linksklick benutzen, rechte Maustaste zoomen, 1–9 und Mausrad Hand, Esc Menü.'), ...back(onBack));
  const w = ui._win('Hilfe', { ...Object.fromEntries(Object.entries(HILFE).map(([k, v]) => [k, () => page(v)])), Tasten: keys }, { icon: '?', sub: 'Kurze Anleitungen' });
  ui._show(w.win);
  w.select(tab);
}
const keyTable = (settings) => el('table', {}, el('tbody', {}, ...ACTIONS.map((a) => el('tr', {}, el('td', {}, el('kbd', {}, settings.key(a.id))), el('td', {}, el('b', {}, a.label)), el('td', {}, a.help)))));

// ---------- Einstellungen ----------
/** stats(): { fps, ms, width, height, calls } ; aaNow: Kantenglaettung dieser Sitzung */
export function openSettings(ui, settings, { onBack = null, stats, aaNow, timer = null, tab = 'Tasten' } = {}) {
  let capture = null; // laufende Tastenwahl
  const stop = () => { if (capture) { removeEventListener('keydown', capture, true); capture = null; } };
  const keysTab = () => {
    const box = el('div', { class: 'ui-doc' });
    const msg = el('div', { class: 'ui-msg', role: 'status' });
    const render = () => {
      stop();
      const groups = [...new Set(ACTIONS.map((a) => a.group))];
      box.replaceChildren(el('p', {}, 'Auf eine Taste klicken und die neue Taste drücken. Ist sie schon vergeben, tauschen die beiden Aktionen ihre Tasten. Esc bricht ab.'), msg,
        ...groups.flatMap((g) => [el('h3', {}, g), el('div', { class: 'keys-list' }, ...ACTIONS.filter((a) => a.group === g).map(row))]),
        el('p', { class: 'muted' }, 'Fest belegt: Linksklick benutzen, rechte Maustaste zoomen, 1–9 und Mausrad Hand, Esc Menü.'),
        el('div', { class: 'row' }, el('button', { class: 'btn secondary', onclick: () => { settings.resetKeys(); say('Alle Tasten stehen wieder auf Standard.'); render(); } }, 'Standard wiederherstellen')), ...back(onBack));
    };
    const say = (t, err = false) => { msg.className = `ui-msg ${err ? 'err' : 'ok'}`; msg.textContent = t; };
    const row = (a) => {
      const b = el('button', { class: 'key-btn', 'aria-label': `${a.label}: ${settings.key(a.id)}, ändern` }, settings.key(a.id));
      b.addEventListener('click', () => {
        if (capture) { render(); return; }
        b.textContent = 'Taste drücken …';
        b.classList.add('on');
        capture = (e) => {
          if (!box.isConnected) { stop(); return; }
          e.preventDefault();
          e.stopImmediatePropagation();
          if (e.repeat) return;
          if (e.code === 'Escape') { render(); return; }
          if (!assignable(e.code) || e.ctrlKey || e.altKey || e.metaKey) { say('Diese Taste geht nicht: Strg, Alt, Tab, F-Tasten und 1–9 sind vergeben.', true); return; }
          const r = settings.bind(a.id, e.code);
          say(r.swapped ? `${a.label}: ${settings.key(a.id)}. Getauscht mit «${r.swapped}».` : `${a.label}: ${settings.key(a.id)}`);
          render();
        };
        addEventListener('keydown', capture, true);
      });
      return el('div', { class: 'key-row' }, el('span', {}, el('b', {}, a.label), el('small', {}, a.help)), b);
    };
    render();
    return box;
  };
  const gfxTab = () => {
    stop();
    const live = el('div', { class: 'fps-live' });
    const note = el('div', { class: 'ui-msg' });
    const draw = () => {
      const s = stats();
      live.replaceChildren(el('b', {}, `${Math.round(s.fps)} FPS`), el('span', {}, `${s.ms.toFixed(1)} ms je Bild · ${s.width} × ${s.height} Bildpunkte · ${s.calls} Zeichenaufrufe`));
      const need = QUALITY[settings.quality].aa !== aaNow;
      note.textContent = need ? `Die Kantenglättung wird beim nächsten Laden der Seite ${aaNow ? 'aus' : 'ein'}geschaltet, der Rest gilt sofort. Vorher speichern!` : '';
    };
    const opts = Object.entries(QUALITY).map(([k, q]) => {
      const i = el('input', { type: 'radio', name: 'quality', value: k });
      i.checked = settings.quality === k;
      i.addEventListener('change', () => { settings.set('quality', k); draw(); });
      return el('label', { class: 'opt' }, i, el('span', {}, el('b', {}, q.label), el('small', {}, q.help)));
    });
    draw();
    const t = setInterval(() => { if (live.isConnected) draw(); else clearInterval(t); }, 500);
    return el('div', { class: 'ui-doc' }, el('h3', {}, 'Jetzt gerade'), live,
      el('p', { class: 'muted' }, 'FPS = Bilder pro Sekunde. Ab 30 spielt es sich angenehm, 60 ist sehr flüssig.'),
      el('h3', {}, 'Qualität'), ...opts, note,
      el('h3', {}, 'Anzeige'), toggle('FPS im Spiel anzeigen', 'Kleine Zahl unten links, auch während des Spielens.', settings.fps, (v) => settings.set('fps', v)), ...back(onBack));
  };
  const viewTab = () => {
    stop();
    return el('div', { class: 'ui-doc' },
      toggle('Tastenhinweise einblenden', ['Die Leiste unten im Bild. Taste im Spiel: ', el('kbd', {}, settings.key('hints'))], settings.hints, (v) => settings.set('hints', v)),
      toggle('FPS im Spiel anzeigen', 'Bilder pro Sekunde, unten links.', settings.fps, (v) => settings.set('fps', v)),
      ...(timer && timer.force === null ? [toggle('Speedrun-Timer', ['Stoppt die Zeit bis zum letzten Ziel. Taste im Spiel: ', el('kbd', {}, settings.key('timer'))], timer.enabled, (v) => timer.toggle(v))] : []),
      el('p', { class: 'muted' }, 'Einstellungen bleiben in diesem Browser gespeichert, nicht auf dem Server.'), ...back(onBack));
  };
  const w = ui._win('Einstellungen', { Tasten: keysTab, Grafik: gfxTab, Anzeige: viewTab }, { icon: '⚙', sub: 'Tastenbelegung, Grafik, Anzeige' });
  ui._show(w.win);
  ui.onceClosed = stop;
  w.select(tab);
}

// ---------- Spielstaende ----------
/**
 * a: { current: { title, steps } | null (nichts zu speichern), why: Grund, canServer, list(), store() -> { text, err }, download(), openServer(id), openFile(file), remove(id), onBack }
 */
export function openSaves(ui, a) {
  const msg = el('div', { class: 'ui-msg', role: 'status' });
  const say = (t, err = false) => { msg.className = `ui-msg ${err ? 'err' : 'ok'}`; msg.textContent = t; };
  const list = el('div', { class: 'saves' });
  let busy = false;
  const run = async (fn) => { if (busy) return; busy = true; try { await fn(); } catch (e) { say(e.message, true); } finally { busy = false; } };
  const loadList = async () => {
    if (!a.canServer) { list.replaceChildren(el('p', { class: 'muted' }, 'Spielstände auf dem Server gibt es mit einer Klasse (Menü → Klasse). Ohne Klasse speicherst du als Datei.')); return; }
    list.replaceChildren(el('p', { class: 'muted' }, 'wird geladen …'));
    try { draw(await a.list()); } catch (e) { list.replaceChildren(el('p', { class: 'muted' }, e.message)); }
  };
  const draw = ({ saves, max }) => list.replaceChildren(el('p', { class: 'muted' }, `${saves.length} von ${max} belegt`), ...saves.map((s) => {
    let sure = false;
    const del = el('button', { class: 'btn secondary', onclick: () => { if (!sure) { sure = true; del.textContent = 'Wirklich löschen?'; return; } run(async () => { draw(await a.remove(s.id)); say('Spielstand gelöscht.'); }); } }, 'Löschen');
    return el('div', { class: 'save-row' }, el('span', {}, el('b', {}, a.title(s)), el('small', {}, `${saveDate(s.saved)} · ${s.steps} Schritte${s.ms ? ` · ${formatTime(s.ms)}` : ''}${s.elapsed === null ? ' · zählt nicht für die Klasse' : ''}`)),
      el('button', { class: 'btn', onclick: () => run(() => a.openServer(s.id)) }, 'Öffnen'), del);
  }));
  const file = el('input', { type: 'file', accept: '.json,application/json', hidden: '' });
  file.addEventListener('change', () => { const f = file.files[0]; file.value = ''; if (f) run(() => a.openFile(f)); });
  const saveBox = a.current ? [el('p', {}, `${a.current.title} · ${a.current.steps} Schritte`),
    el('div', { class: 'row' },
      el('button', { class: 'btn', onclick: () => run(async () => { const r = await a.store(); say(r.text, r.err); if (r.saves) draw(r); }) }, a.canServer ? 'Auf dem Server speichern' : 'Als Datei speichern'),
      ...(a.canServer ? [el('button', { class: 'btn secondary', onclick: () => run(async () => say(a.download())) }, 'Als Datei herunterladen')] : []))]
    : [el('p', { class: 'muted' }, a.why)];
  const body = () => el('div', { class: 'ui-doc' }, el('h3', {}, 'Speichern'), ...saveBox,
    ...(a.canServer ? [el('p', { class: 'muted' }, 'Ist der Spielstand zu gross oder der Server nicht erreichbar, wird er stattdessen heruntergeladen.')] : []), msg,
    el('h3', {}, 'Öffnen'), el('p', {}, 'Der aktuelle Stand wird dabei verlassen.'),
    el('div', { class: 'row' }, el('button', { class: 'btn secondary', onclick: () => file.click() }, 'Datei öffnen …'), file), list, ...back(a.onBack));
  const w = ui._win('Spielstand', { Spielstand: body }, { icon: 'SAV', sub: 'speichern und öffnen' });
  ui._show(w.win);
  w.select('Spielstand');
  loadList();
}

// ---------- Zugangscode fuers freie Bauen ----------
export function openUnlock(ui, { unlock, title, onOk, onBack = null }) {
  const msg = el('div', { class: 'ui-msg', role: 'status' });
  const i = el('input', { autocomplete: 'off', spellcheck: 'false', maxlength: '80', type: 'password' });
  const b = el('button', { class: 'btn', onclick: async () => {
    b.disabled = true;
    msg.className = 'ui-msg';
    msg.textContent = 'wird geprüft …';
    const e = await unlock.enter(i.value);
    b.disabled = false;
    if (e) { msg.className = 'ui-msg err'; msg.textContent = e; return; }
    onOk();
  } }, 'Freischalten');
  i.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); if (e.key === 'Enter' && !b.disabled) b.click(); });
  const body = () => el('div', { class: 'ui-doc' }, el('p', {}, FREI.text),
    el('div', { class: 'row' }, el('label', { class: 'field' }, el('span', {}, 'Zugangscode'), i), el('div', { style: 'align-self:end' }, b)), msg,
    el('h3', {}, 'Woher bekomme ich einen Code?'), el('p', {}, FREI.woher),
    el('div', { class: 'row' }, el('a', { class: 'btn secondary', href: LINKS.patreon, target: '_blank', rel: 'noopener' }, 'leyoNET auf Patreon')), ...back(onBack));
  const w = ui._win(FREI.titel, { Code: body }, { icon: '∞', sub: title });
  ui._show(w.win);
  w.select('Code');
}
