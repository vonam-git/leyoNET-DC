import * as THREE from 'three';
import { CHANGES, DATENSCHUTZ, IMPRESSUM, LINKS, UEBER, VERSION } from './info.js';
import { drawPlan, fitView, planModel, THEME } from './netplan.js';
import { formatTime } from './timer.js';
import { errorText } from './classroom.js';
import QUELLEN from './herkunft.json'; // erzeugt von scripts/herkunft-bot.mjs
import favicon from '../../vendor/leyonet/branding/favicon.svg?url';

// Bedienoberflaeche (Plan v2): Notebook-Fenster (Netzwerk / Terminal / Konsole), Shop + Inventar,
// Level-Menue, Bildschirm-Texturen der Notebooks. Alles spricht nur ueber Kern-Intents
// (docs/SCENARIO_API.md) - Ergebnisse (IP, Ping, CLI) kommen vom leyoNET-Kern.

// Styles: src/style.css (Designsystem)
const POWER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 3v8"/><path d="M6.3 7.2a8 8 0 1 0 11.4 0"/></svg>';

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of kids) e.append(c);
  return e;
}

/** Terminal-Baustein: Ausgabe + Eingabezeile mit Prompt, Verlauf (Pfeil hoch/runter). */
function terminal({ prompt = '> ', onLine, secret = () => false, onTab = null, title = 'Terminal' }) {
  const out = el('pre');
  const pr = el('span', {}, prompt);
  const input = el('input', { spellcheck: 'false', autocomplete: 'off' });
  const hist = [];
  let hi = 0;
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Escape') e.stopPropagation(); // Tippen bewegt nicht die Figur; Esc schliesst das Fenster
    if (e.key === 'ArrowUp' && hist.length) { hi = Math.max(0, hi - 1); input.value = hist[hi]; e.preventDefault(); }
    if (e.key === 'ArrowDown') { hi = Math.min(hist.length, hi + 1); input.value = hist[hi] ?? ''; e.preventDefault(); }
    if (e.key === 'Tab') {
      e.preventDefault(); // Fokus bleibt in der Eingabe
      const done = onTab ? await onTab(input.value) : null;
      if (done) input.value = done;
      return;
    }
    if (e.key !== 'Enter') return;
    const line = input.value;
    input.value = '';
    const hidden = secret();
    print(`${pr.textContent}${hidden ? '' : line}`);
    if (line.trim() && !hidden) { hist.push(line); hi = hist.length; }
    await onLine(line);
  });
  function print(...lines) {
    out.textContent += `${lines.join('\n')}\n`;
    out.scrollTop = out.scrollHeight;
  }
  // Touch (iPad): Bildschirmtastatur hat weder Tab noch Pfeile
  const key = (label, k) => el('button', { onclick: (e) => { e.stopPropagation(); input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); } }, label);
  const bar = el('div', { class: 'bar' }, el('i'), el('i'), el('i'), el('span', {}, title),
    el('div', { class: 'keys' }, key('Tab', 'Tab'), key('↑', 'ArrowUp'), key('↓', 'ArrowDown')));
  const root = el('div', { class: 'ui-term', onclick: () => input.focus() }, bar, out, el('div', { class: 'in' }, pr, input));
  return { root, print, input, setPrompt: (p) => { pr.textContent = p; input.type = secret() ? 'password' : 'text'; },
    clear: () => { out.textContent = ''; } };
}

export class GameUI {
  /** kern(): aktueller Kern, state(): aktueller Kern-Zustand, level(): aktives Level, onClose(), onLevel(id) */
  constructor({ kern, state, level, levels, onOpen, onClose, onLevel, selected, onSelectItem, levelOpen = () => true, codeOpen = () => true, onLocked = () => {}, onHome = null, settings }) {
    Object.assign(this, { kern, state, level, levels, onOpen, onClose, onLevel, selected, onSelectItem, levelOpen, codeOpen, onLocked, onHome, settings });
    this.overlay = null;
    this.screens = new Map(); // GLB-Node -> { mesh, canvas, tex }
  }

  get open() { return !!this.overlay; }

  _show(win) {
    this.close(true);
    this.overlay = el('div', { class: 'ui-overlay', onmousedown: (e) => { if (e.target === this.overlay) this.close(); } }, win);
    document.body.append(this.overlay);
    this.onOpen?.();
  }

  close(silent = false) {
    if (!this.overlay) return;
    this.overlay.remove();
    this.overlay = null;
    this._renderPlan = null;
    this.onceClosed?.();
    this.onceClosed = null;
    if (!silent) this.onClose?.();
  }

  _win(title, tabs, { icon = '•', sub = '' } = {}) {
    const head = el('div', { class: 'ui-head' }, el('div', { class: 'icon' }, icon === 'ly' ? el('img', { src: favicon, alt: '' }) : icon),
      el('div', {}, el('div', { class: 't' }, title), sub ? el('div', { class: 's' }, sub) : ''), el('span', { class: 'sp' }),
      el('button', { class: 'ui-close', onclick: () => this.close(), title: 'Schliessen (Esc)' }, '✕'));
    const bar = el('div', { class: 'ui-tabs' });
    const body = el('div', { class: 'ui-body' });
    const win = el('div', { class: 'ui-win' }, head, bar, body);
    let current = null;
    const select = (name) => {
      current = name;
      for (const b of bar.children) b.classList.toggle('on', b.dataset.tab === name);
      body.replaceChildren(tabs[name]());
      // Fokus erst nach dem ausloesenden Tastendruck (sonst landet z.B. das "e" von E im IP-Feld)
      // Touch: kein Auto-Fokus, sonst springt die Bildschirmtastatur auf
      if (!document.documentElement.classList.contains('touch')) requestAnimationFrame(() => setTimeout(() => body.querySelector('input:not([type=checkbox], [type=radio], [type=file])')?.focus(), 0));
    };
    for (const name of Object.keys(tabs)) {
      const b = el('button', { onclick: () => select(name) }, name);
      b.dataset.tab = name;
      bar.append(b);
    }
    if (Object.keys(tabs).length < 2) bar.style.display = 'none';
    return { win, select, current: () => current };
  }

  // ---------- Notebook ----------
  async openNotebook(nb, label = nb.toUpperCase()) {
    const kern = this.kern();
    const info = await kern.send({ action: 'device_info', device: nb });
    if (info.power === 'off') return this._bootScreen(nb, label);
    const tabs = {
      Netzwerk: () => this._netTab(nb, info),
      Terminal: () => this._termTab(nb),
      Konsole: () => this._consoleTab(nb),
    };
    const w = this._win(label, tabs, { icon: 'NB', sub: info.ip ? `Notebook · ${info.ip}` : 'Notebook · noch keine IP' });
    // Herunterfahren
    const off = el('button', { class: 'pwr-btn', title: 'Herunterfahren', onclick: async () => {
      await this.kern().send({ action: 'power', device: nb, on: false });
      this.drawScreens();
      this._bootScreen(nb, label);
    } });
    off.innerHTML = POWER_SVG;
    w.win.querySelector('.ui-head .sp').after(off);
    this._show(w.win);
    w.select('Netzwerk');
  }

  /** Notebook ist aus: Einschaltknopf, kurzer Start, dann der Desktop. */
  _bootScreen(nb, label) {
    const box = el('div', { class: 'boot' });
    const idle = () => {
      const btn = el('button', { class: 'pwr', title: 'Einschalten', onclick: start });
      btn.innerHTML = POWER_SVG;
      box.replaceChildren(el('div', {}, btn, el('div', { class: 't' }, `${label} ist ausgeschaltet`),
        el('div', { class: 's' }, 'Einschaltknopf drücken (oder Enter)')));
      setTimeout(() => btn.focus(), 0);
    };
    const start = async () => {
      box.replaceChildren(el('div', {}, el('div', { class: 'spin' }), el('div', { class: 't' }, 'leyoOS wird gestartet …')));
      const r = await this.kern().send({ action: 'power', device: nb, on: true });
      if (r.type !== 'ack') { box.replaceChildren(el('div', { class: 's' }, r.reason)); return; }
      this.drawScreens();
      setTimeout(() => { if (this.overlay?.contains(box)) this.openNotebook(nb, label); }, 900);
    };
    idle();
    const w = this._win(label, { Start: () => box }, { icon: 'NB', sub: 'Notebook · aus' });
    this._show(w.win);
    w.select('Start');
  }

  _netTab(nb, info) {
    const f = (name, value, ph) => el('input', { name, value: value ?? '', placeholder: ph });
    const ip = f('ip', info.ip, '192.168.1.10');
    const mask = f('mask', info.mask || '255.255.255.0', '255.255.255.0');
    const gw = f('gw', info.gateway, '(leer = keins)');
    const msg = el('div', { class: 'ui-msg' });
    const apply = el('button', { class: 'btn', onclick: async () => {
      const r = await this.kern().send({ action: 'set_ip', device: nb, ip: ip.value.trim(), mask: mask.value.trim(), gateway: gw.value.trim() });
      msg.className = `ui-msg ${r.type === 'ack' ? 'ok' : 'err'}`;
      msg.textContent = r.type === 'ack' ? 'Gespeichert.' : r.reason;
      info.ip = ip.value.trim(); info.mask = mask.value.trim(); info.gateway = gw.value.trim();
    } }, 'Übernehmen');
    for (const i of [ip, mask, gw]) {
      i.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); if (e.key === 'Enter') apply.click(); });
    }
    const field = (label, input) => el('label', { class: 'field' }, el('span', {}, label), input);
    return el('div', { class: 'ui-form' },
      el('div', { class: 'lead' }, 'Netzwerkadapter «Ethernet» · Internetprotokoll Version 4 (TCP/IPv4)'),
      field('IPv4-Adresse', ip), field('Subnetzmaske', mask), field('Standardgateway', gw),
      el('div', {}, apply), msg);
  }

  _termTab(nb) {
    let ssh = null; // { session, prompt } nach erfolgreichem ssh
    let pending = null; // { user, target } wartet auf Passwort
    const t = terminal({
      prompt: 'C:\\> ',
      secret: () => !!pending,
      onTab: async (line) => (ssh ? (await this.kern().send({ action: 'console_complete', session: ssh.session, line })).line : null),
      onLine: async (raw) => {
        const kern = this.kern();
        const line = raw.trim();
        if (pending) {
          const p = pending;
          pending = null;
          const r = await kern.send({ action: 'ssh', from: nb, target: p.target, user: p.user, password: raw });
          if (r.type === 'reject') { t.print(r.reason); t.setPrompt('C:\\> '); return; }
          ssh = { session: r.session };
          if (r.lines.length) t.print(...r.lines);
          t.setPrompt(`${r.prompt} `);
          return;
        }
        if (ssh) {
          const r = await kern.send({ action: 'console', session: ssh.session, line: raw });
          if (r.lines?.length) t.print(...r.lines);
          if (r.close || r.type === 'reject') { ssh = null; t.print('Verbindung getrennt.'); t.setPrompt('C:\\> '); }
          else t.setPrompt(`${r.prompt} `);
          return;
        }
        const [cmd, ...args] = line.split(/\s+/);
        if (!cmd) return;
        if (cmd === 'help' || cmd === '?') {
          t.print('Befehle: ipconfig | ping <adresse> | curl <url> | ssh <benutzer>@<adresse> | cls');
        } else if (cmd === 'cls' || cmd === 'clear') {
          t.clear();
        } else if (cmd === 'ipconfig') {
          const i = await kern.send({ action: 'device_info', device: nb });
          t.print('Ethernet-Adapter Ethernet:', `   IPv4-Adresse  . . . . . : ${i.ip || '(keine)'}`,
            `   Subnetzmaske  . . . . . : ${i.mask || '(keine)'}`, `   Standardgateway . . . . : ${i.gateway || ''}`);
        } else if (cmd === 'ping') {
          if (!args[0]) { t.print('Syntax: ping <adresse>'); return; }
          const r = await kern.send({ action: 'host_ping', device: nb, target: args[0] });
          t.print(...(r.lines ?? [r.reason]));
        } else if (cmd === 'curl') {
          if (!args[0]) { t.print('Syntax: curl http://<adresse>/'); return; }
          const r = await kern.send({ action: 'host_http', device: nb, url: args[0] });
          t.print(...(r.lines ?? [r.reason]));
        } else if (cmd === 'ssh') {
          const m = /^([^@\s]+)@(\S+)$/.exec(args[0] ?? '');
          if (!m) { t.print('Syntax: ssh <benutzer>@<adresse>'); return; }
          pending = { user: m[1], target: m[2] };
          t.setPrompt(`${m[1]}@${m[2]}'s password: `);
        } else {
          t.print(`"${cmd}" ist nicht als Befehl bekannt. (help)`);
        }
      },
    });
    t.print('leyoNET-DC Notebook – Eingabeaufforderung. «help» zeigt die Befehle.');
    return t.root;
  }

  _consoleTab(nb) {
    const wrap = el('div', { style: 'height:100%' });
    (async () => {
      const kern = this.kern();
      const info = await kern.send({ action: 'device_info', device: nb });
      if (!info.console) {
        wrap.append(el('div', { class: 'ui-msg err' }, 'Kein Konsolkabel eingesteckt. Konsolkabel (Shop) von der USB-Buchse '
          + 'links am Notebook an den CON-Port eines Switches stecken.'));
        return;
      }
      const r = await kern.send({ action: 'console_open', device: info.console, from: nb });
      if (r.type === 'reject') { wrap.append(el('div', { class: 'ui-msg err' }, r.reason)); return; }
      const session = r.session;
      const t = terminal({
        prompt: `${r.prompt} `,
        title: `Konsole → ${info.console} · 9600 8N1`,
        onTab: async (line) => (await this.kern().send({ action: 'console_complete', session, line })).line,
        onLine: async (line) => {
          const o = await this.kern().send({ action: 'console', session, line });
          if (o.type === 'reject') { t.print(o.reason); return; }
          if (o.lines.length) t.print(...o.lines);
          if (o.close) { t.print('[Sitzung beendet]'); t.input.disabled = true; } else t.setPrompt(`${o.prompt} `);
        },
      });
      t.print(`Konsole ${info.console} (9600 8N1) - leyoNET-Befehlszeile. "?" zeigt die moeglichen Befehle, Tab ergaenzt.`, ...r.lines);
      wrap.append(t.root);
      setTimeout(() => t.input.focus(), 0);
    })();
    return wrap;
  }

  // ---------- KVM / Rack-Konsole ----------
  /** KVM-Schublade: ein Reiter pro Netzgeraet im Rack, jeweils dessen leyoNET-Konsole. */
  openKvm(kvm, devices) {
    const tabs = {};
    for (const d of devices) {
      const label = { sw: 'Switch', cs: 'Core-Switch', rt: 'Router', fw: 'Firewall' }[d.id.slice(0, 2)] ?? d.id;
      tabs[`${label} ${d.id}`] = () => this._kvmTab(kvm, d.id);
    }
    const w = this._win('Rack-Konsole', tabs, { icon: 'KVM', sub: `${kvm.toUpperCase()} · Konsolserver für alle Netzgeräte im Rack` });
    this._show(w.win);
    w.select(Object.keys(tabs)[0]);
  }

  _kvmTab(kvm, device) {
    const wrap = el('div', { style: 'height:100%' });
    (async () => {
      const r = await this.kern().send({ action: 'console_open', device, from: kvm });
      if (r.type === 'reject') { wrap.append(el('div', { class: 'ui-msg err' }, r.reason)); return; }
      const session = r.session;
      const t = terminal({
        prompt: `${r.prompt} `,
        title: `${kvm.toUpperCase()} → ${device}`,
        onTab: async (line) => (await this.kern().send({ action: 'console_complete', session, line })).line,
        onLine: async (line) => {
          const o = await this.kern().send({ action: 'console', session, line });
          if (o.type === 'reject') { t.print(o.reason); return; }
          if (o.lines.length) t.print(...o.lines);
          if (o.close) { t.print('[Sitzung beendet]'); t.input.disabled = true; } else t.setPrompt(`${o.prompt} `);
        },
      });
      t.print(`KVM ${kvm} -> ${device} - leyoNET-Befehlszeile. "?" zeigt die Befehle, Tab ergaenzt.`, ...r.lines);
      wrap.append(t.root);
      setTimeout(() => t.input.focus(), 0);
    })();
    return wrap;
  }

  // ---------- Shop / Inventar ----------
  /** tab: 'Shop' (Taste B) oder 'Inventar' (Taste I) - beide Tabs im selben Fenster. */
  openShop(tab = 'Shop') {
    const w = this._win('Material', { Inventar: () => this._invTab(), Shop: () => this._shopTab() },
      { icon: 'CHF', sub: 'Inventar: Artikel anklicken = in der Hand · Shop: kaufen' });
    w.win.classList.add('shop'); // Hotbar bleibt darueber anklickbar
    this._show(w.win);
    w.select(tab);
  }

  /** Inventar: eigener Bestand als Karten; Klick waehlt den Artikel fuer das naechste Kabel/Modul
   *  (wie Hotbar 1-9). "Auto" = passendes Kabel automatisch. */
  _invTab() {
    const box = el('div');
    const render = () => {
      const st = this.state() ?? {};
      const sel = this.selected?.() ?? null;
      const have = (this.level().scenario.hardware_katalog ?? []).filter((c) => (st.inventory?.[c.item] ?? 0) > 0);
      const pick = (item) => { this.onSelectItem?.(item); render(); };
      const auto = el('div', { class: `card pick ${sel === null ? 'on' : ''}`, onclick: () => pick(null) },
        el('span', { class: 'stock' }, sel === null ? 'in der Hand' : 'Taste 1'),
        el('div', { class: 'art auto' }, 'AUTO'), el('div', { class: 'name' }, 'Automatisch'),
        el('div', { class: 'meta' }, 'kürzestes passendes Kabel aus dem Inventar'));
      const cards = have.map((c, i) => {
        const on = sel === c.item;
        const meta = c.typ === 'rack' ? 'auf einen Rack-Platz' : c.typ === 'geraet' ? `${c.he ?? 1} HE · ins Rack`
        : c.typ === 'notebook' ? 'auf den Tisch' : c.typ === 'sfp' ? `${c.modul} · für SFP-Einschübe` : `${c.laenge} m · ${c.farbe_name}`;
        return el('div', { class: `card pick ${on ? 'on' : ''}`, onclick: () => pick(c.item), title: 'Anklicken: in die Hand nehmen' },
          el('span', { class: 'stock' }, on ? 'in der Hand' : `${st.inventory[c.item]}×`),
          this._art(c), el('div', { class: 'name' }, c.name),
          el('div', { class: 'meta' }, `${meta}${i < 8 ? ` · Taste ${i + 2}` : ''}`));
      });
      const empty = have.length ? '' : el('div', { class: 'ui-msg' }, 'Inventar leer – im Tab „Shop“ kaufen.');
      box.replaceChildren(el('div', { class: 'shop-grid' }, auto, ...cards), empty);
    };
    render();
    this._renderInv = render;
    return box;
  }

  /** Kleines Bild je Artikeltyp (eigene SVGs) */
  _art(c) {
    const col = c.farbe ?? '#8a8f96';
    const svg = {
      patchkabel: `<svg width="120" height="44" viewBox="0 0 120 44"><path d="M8 22 C 40 -6, 80 50, 112 22" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round"/><rect x="0" y="16" width="14" height="12" rx="2" fill="#d8dde3"/><rect x="106" y="16" width="14" height="12" rx="2" fill="#d8dde3"/></svg>`,
      glasfaser: `<svg width="120" height="44" viewBox="0 0 120 44"><path d="M10 18 C 40 -4, 80 44, 110 18" fill="none" stroke="${col}" stroke-width="3.5" stroke-linecap="round"/><path d="M10 26 C 40 4, 80 52, 110 26" fill="none" stroke="${col}" stroke-width="3.5" stroke-linecap="round"/><rect x="0" y="14" width="13" height="16" rx="3" fill="#e9eef2"/><rect x="107" y="14" width="13" height="16" rx="3" fill="#e9eef2"/></svg>`,
      konsolkabel: `<svg width="120" height="44" viewBox="0 0 120 44"><path d="M14 22 C 44 2, 76 42, 106 22" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round"/><rect x="0" y="15" width="16" height="14" rx="3" fill="#3a4654"/><rect x="104" y="16" width="14" height="12" rx="2" fill="#d8dde3"/></svg>`,
      stromkabel: `<svg width="120" height="44" viewBox="0 0 120 44"><path d="M14 22 C 44 0, 76 44, 106 22" fill="none" stroke="#2b2e33" stroke-width="6" stroke-linecap="round"/><rect x="0" y="13" width="17" height="18" rx="3" fill="#15171a"/><rect x="103" y="14" width="17" height="16" rx="2" fill="#15171a"/><rect x="3" y="18" width="2" height="8" fill="#8b96a2"/><rect x="8" y="18" width="2" height="8" fill="#8b96a2"/></svg>`,
      rack: `<svg width="60" height="56" viewBox="0 0 60 56"><rect x="12" y="2" width="36" height="52" rx="2" fill="#3a3f46"/><rect x="16" y="6" width="28" height="44" fill="#15181c"/>${[0, 1, 2, 3, 4, 5].map((k) => `<rect x="18" y="${9 + k * 7}" width="24" height="4" rx="1" fill="#2a2f36"/>`).join('')}</svg>`,
      geraet: `<svg width="130" height="44" viewBox="0 0 130 44"><rect x="4" y="12" width="122" height="20" rx="2" fill="#23272d"/><rect x="4" y="12" width="6" height="20" fill="#3a3f46"/><rect x="120" y="12" width="6" height="20" fill="#3a3f46"/>${Array.from({ length: 12 }, (_, k) => `<rect x="${22 + k * 7}" y="16" width="5" height="5" fill="#0b0c0e"/><rect x="${22 + k * 7}" y="24" width="5" height="5" fill="#0b0c0e"/>`).join('')}<rect x="108" y="18" width="6" height="3" rx="1" fill="${col}"/></svg>`,
      notebook: `<svg width="110" height="50" viewBox="0 0 110 50"><rect x="24" y="4" width="62" height="36" rx="3" fill="#3b4048"/><rect x="28" y="8" width="54" height="28" fill="#0f3b57"/><path d="M14 42 h82 l-6 6 h-70 z" fill="#4a4f58"/></svg>`,
      sfp: `<svg width="90" height="44" viewBox="0 0 90 44"><rect x="10" y="12" width="62" height="20" rx="2" fill="#b9c2cc"/><rect x="66" y="10" width="16" height="24" rx="3" fill="${col}"/><rect x="16" y="18" width="30" height="3" fill="#8b96a2"/></svg>`,
    }[c.typ] ?? '';
    const art = el('div', { class: 'art' });
    art.innerHTML = svg;
    return art;
  }

  _shopTab() {
    const box = el('div');
    const FILTER = { Alle: () => true, Hardware: (c) => ['rack', 'geraet', 'notebook'].includes(c.typ), Kupfer: (c) => c.typ === 'patchkabel', Glasfaser: (c) => c.typ === 'glasfaser',
      Module: (c) => c.typ === 'sfp', Konsole: (c) => c.typ === 'konsolkabel', Strom: (c) => c.typ === 'stromkabel' };
    let filter = 'Alle';
    const render = () => {
      const st = this.state() ?? {};
      const cat = (this.level().scenario.hardware_katalog ?? []).filter(FILTER[filter]);
      const filters = Object.keys(FILTER).map((f) => el('button', { class: `filter ${f === filter ? 'on' : ''}`,
        onclick: () => { filter = f; render(); } }, f));
      const m = this._shopMsg;
      const msg = el('div', { class: `ui-msg ${m ? (m.ok ? 'ok' : 'err') : ''}` }, m?.text ?? '');
      const cards = cat.map((c) => {
        const have = st.inventory?.[c.item] ?? 0;
        const btn = el('button', { class: 'btn', onclick: async () => {
          const r = await this.kern().send({ action: 'buy', item: c.item, qty: 1 });
          this._shopMsg = { ok: r.type === 'ack', text: r.type === 'ack' ? `${c.name} gekauft.` : r.reason };
          setTimeout(render, 0);
        } }, 'Kaufen');
        if (!st.unlimited && (c.preis ?? 0) > (st.budget ?? 0)) btn.disabled = true;
        const meta = c.typ === 'rack' ? '42 HE · 2 PDUs · auf einen Rack-Platz'
          : c.typ === 'geraet' ? `${c.he ?? 1} HE · ins Rack` : c.typ === 'notebook' ? 'auf einen Platz am Tisch'
          : c.typ === 'sfp' ? `${c.modul} · für SFP-Einschübe` : `${c.laenge} m · ${c.farbe_name}`
          + (c.klasse === 'console' ? ' · USB ↔ RJ45' : c.klasse === 'sfp' ? ' · LC-Duplex' : c.klasse === 'power' ? ' · PDU → Netzteil' : ' · RJ45');
        return el('div', { class: 'card' }, el('span', { class: `stock ${have ? '' : 'zero'}` }, `${have}× im Inventar`),
          this._art(c), el('div', { class: 'name' }, c.name), el('div', { class: 'meta' }, meta),
          el('div', { class: 'row' }, el('span', { class: 'price' }, `CHF ${c.preis.toFixed(2)}`), btn));
      });
      box.replaceChildren(
        el('div', { class: 'shop-top' }, ...filters,
          el('div', { class: 'shop-budget' }, 'Budget', el('b', {}, st.unlimited ? '∞ unbeschränkt' : `CHF ${(st.budget ?? 0).toFixed(2)}`))),
        el('div', { class: 'shop-grid' }, ...cards), msg);
    };
    render();
    this._renderShop = render;
    return box;
  }

  /** Nach jedem Kern-Zustand aufrufen: Shop aktualisieren, Notebook-Displays neu zeichnen. */
  refresh() {
    if (this.overlay?.querySelector('.card.pick')) this._renderInv?.();
    else if (this.overlay && this._renderShop && this.overlay.querySelector('.shop-grid')) this._renderShop();
    this._renderPlan?.();
    this.drawScreens();
  }

  // ---------- Netzplan (Plan v4 C) ----------
  openPlan() {
    const canvas = el('canvas');
    const dark = matchMedia('(prefers-color-scheme: dark)');
    let power = false;
    let view = null; // null = alles zeigen (passt sich an), sonst Zoom/Pan des Spielers
    const fit = el('button', { class: 'btn secondary', onclick: () => { view = null; render(); } }, 'Alles zeigen');
    const pw = el('button', { class: 'btn secondary', onclick: () => { power = !power; pw.textContent = power ? 'Strom ausblenden' : 'Strom einblenden'; view = null; render(); } }, 'Strom einblenden');
    const t0 = () => (dark.matches ? THEME.dark : THEME.light);
    const legend = el('div', { class: 'plan-legend' }, ...[['Kupfer', 'cable'], ['Glasfaser', 'fiber'], ['Konsole', 'console'], ['Trunk', 'trunk'], ['Strom', 'power']]
      .map(([n, k]) => el('span', {}, el('i', { style: `border-color:${t0()[k]}` }), n)));
    const size = () => ({ w: canvas.clientWidth, h: canvas.clientHeight });
    const current = () => { const { w, h } = size(); return view ?? fitView(planModel(this.state(), { power }), w, h); };
    const render = () => {
      const { w, h } = size();
      if (!w) return;
      const dpr = Math.min(devicePixelRatio, 2);
      if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
      const g = canvas.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const plan = planModel(this.state(), { power });
      drawPlan(g, plan, view ?? fitView(plan, w, h), { w, h, theme: t0(), empty: this.settings.legacy('Noch nichts gebaut. Im Shop (B) kaufen und einbauen, der Plan zeichnet mit.') });
    };
    const zoom = (f, mx, my) => {
      const v = current();
      const { w, h } = size();
      const s = Math.min(4, Math.max(0.1, v.s * f));
      // Punkt unter dem Zeiger bleibt stehen
      view = { s, x: v.x + (mx - w / 2) * (1 / v.s - 1 / s), y: v.y + (my - h / 2) * (1 / v.s - 1 / s) };
      render();
    };
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY); }, { passive: false });
    const pts = new Map();
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.offsetX, e.offsetY]); });
    canvas.addEventListener('pointermove', (e) => {
      const old = pts.get(e.pointerId);
      if (!old) return;
      const others = [...pts].filter(([id]) => id !== e.pointerId).map(([, q]) => q);
      pts.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (others.length) { // zwei Finger: zoomen
        const [ox, oy] = others[0];
        const d0 = Math.hypot(old[0] - ox, old[1] - oy), d1 = Math.hypot(e.offsetX - ox, e.offsetY - oy);
        if (d0 > 4) zoom(d1 / d0, (ox + e.offsetX) / 2, (oy + e.offsetY) / 2);
        return;
      }
      const v = current();
      view = { s: v.s, x: v.x - (e.offsetX - old[0]) / v.s, y: v.y - (e.offsetY - old[1]) / v.s };
      render();
    });
    for (const n of ['pointerup', 'pointercancel']) canvas.addEventListener(n, (e) => pts.delete(e.pointerId));
    const box = el('div', { class: 'plan-box' }, canvas, el('div', { class: 'plan-tools' }, fit, pw), legend);
    const w = this._win('Netzplan', { Plan: () => box }, { icon: 'NP', sub: `${this.level()?.title ?? ''} · Rad: zoomen · ziehen: verschieben · Esc: zurück` });
    w.win.classList.add('wide');
    this._show(w.win);
    w.select('Plan');
    this._renderPlan = render;
    requestAnimationFrame(render);
  }

  // ---------- Tischdose (Plan v4 D): auf welches Patchpanel ist sie aufgelegt? ----------
  openDeskOutlet(td) {
    const box = el('div', { class: 'ui-doc' });
    const msg = el('div', { class: 'ui-msg' });
    const act = async (intent, text) => {
      const r = await this.kern().send(intent);
      msg.className = `ui-msg ${r.type === 'ack' ? 'ok' : 'err'}`;
      msg.textContent = r.type === 'ack' ? text : r.reason;
      setTimeout(render, 0);
    };
    const render = () => {
      const st = this.state() ?? {};
      const cur = (st.trunks ?? []).find((t) => t.a === td);
      const rackName = (pp) => (pp.rack ?? '').replace('rack_', 'Rack ').replace('bench_1', 'Pult');
      const pps = (st.devices ?? []).filter((d) => d.id.startsWith('pp'));
      if (cur) {
        const pp = pps.find((d) => d.id === cur.b);
        box.replaceChildren(el('h3', {}, `Aufgelegt auf ${cur.b.toUpperCase()} (${rackName(pp ?? {})})`),
          el('p', {}, `Port 1–8 der Tischdose sind fest mit Port ${cur.first}–${cur.first + 7} des Patchpanels verbunden. Im Rack patchst du diese Ports auf den Switch.`),
          el('div', { class: 'row' }, el('button', { class: 'btn secondary', onclick: () => act({ action: 'desk_unpatch', device: td }, 'Leitung gelöst.') }, 'Leitung lösen')), msg);
        return;
      }
      const rows = pps.map((pp) => el('tr', {}, el('td', {}, el('b', {}, pp.id.toUpperCase())), el('td', {}, rackName(pp)),
        ...[1, 9, 17].map((first) => {
          const why = this.kern().deskPatchBlock?.(pp, first) ?? null;
          const b = el('button', { class: 'btn', title: why ?? 'auflegen', onclick: () => act({ action: 'desk_patch', device: td, pp: pp.id, first },
            `Aufgelegt: Tischdose 1–8 ↔ ${pp.id.toUpperCase()} Port ${first}–${first + 7}.`) }, `${first}–${first + 7}`);
          if (why) b.disabled = true;
          return el('td', {}, b, why ? el('div', { class: 'why' }, why) : '');
        })));
      box.replaceChildren(el('p', {}, 'Die 8 Ports der Tischdose gehen durch die Säule und über die Gitterrinnen ins Rack. Wähle das Patchpanel und den Port-Block.'),
        rows.length ? el('table', {}, el('thead', {}, el('tr', {}, ...['Patchpanel', 'Rack', 'Block', 'Block', 'Block'].map((h) => el('th', {}, h)))), el('tbody', {}, ...rows))
          : el('p', {}, this.settings.legacy('Noch kein Patchpanel eingebaut. Kaufe im Shop (B) eines und baue es in ein Rack ein.')), msg);
    };
    const w = this._win('Tischdose', { Dose: () => box }, { icon: 'TD', sub: '8 × RJ45 am Pult' });
    this._show(w.win);
    w.select('Dose');
    render();
  }

  // ---------- Esc-Menue (Plan v4) ----------
  /** actions: { resume, levels, plan } */
  openMenu(actions = {}) {
    const doc = (blocks) => el('div', { class: 'ui-doc' }, ...blocks.map((b) => (b.h ? el('h3', {}, b.h) : el('p', {}, b.p))));
    const ext = (label, href, cls = 'btn secondary') => el('a', { class: cls, href, target: '_blank', rel: 'noopener' }, label);
    const link = (label, sub, href) => {
      const a = ext('', href, 'menu-btn');
      a.append(el('b', {}, label), el('span', {}, sub));
      return a;
    };
    const tabs = {
      Spiel: () => {
        const btn = (label, sub, fn, primary = false) => el('button', { class: `menu-btn ${primary ? 'primary' : ''}`, onclick: fn },
          el('b', {}, label), el('span', {}, sub));
        const lv = this.level();
        const timerBtn = () => {
          const b = btn('', '', () => { actions.timer.toggle(); label(); });
          const label = () => { b.firstChild.textContent = `Speedrun-Timer: ${actions.timer.enabled ? 'ein' : 'aus'}`; b.lastChild.textContent = this.settings.legacy('stoppt die Zeit bis zum letzten Ziel (Taste T)'); b.setAttribute('aria-pressed', actions.timer.enabled); };
          label();
          return b;
        };
        const vb = actions.verbund?.();
        return el('div', { class: 'menu-grid' },
          btn('Weiterspielen', lv ? lv.title : 'zurück ins Rechenzentrum', () => { this.close(); actions.resume?.(); }, true),
          ...(vb ? [btn(`Verbundaufgabe ${'★'.repeat(vb.sterne)}`, this.settings.legacy(`${vb.titel} · Auftragsblatt (J)`), () => actions.openVerbund(), lv?.verbund !== true)] : []),
          btn('Level wählen', 'Levels 1–7, freies Bauen, Demo-Rechenzentrum', () => actions.levels?.()),
          ...(actions.restart && lv ? [btn('Level neu starten', 'alles zurück auf Anfang', () => { this.close(); actions.restart(); })] : []),
          btn('Spielstand speichern', actions.saveHint, () => actions.saves()),
          btn('Spielstand öffnen', 'vom Server oder aus einer Datei', () => actions.saves()),
          ...(actions.timer ? [timerBtn()] : []),
          btn('Einstellungen', 'Tasten, Grafik, Anzeige', () => actions.settings()),
          btn('Hilfe', 'kurze Anleitungen', () => actions.help()),
          btn('Netzplan', 'Geräte und Verbindungen als Plan', () => actions.plan?.()),
          btn('Klasse', actions.classroom?.joined ? `${actions.classroom.me.name} · ${actions.classroom.me.label}` : 'mit einem Klassencode beitreten', () => w.select('Klasse')),
          btn('Admin-Board', 'für Lehrpersonen: Klassen, Statistik, live zuschauen', () => w.select('Admin')),
          link('Unterstützen', 'patreon.com/leyonet – freiwillig, leyoNET bleibt kostenlos', LINKS.patreon));
      },
      Über: () => {
        const d = doc(UEBER);
        d.append(el('div', { class: 'row' }, ext('vonam.ch', LINKS.entwickler, 'btn'), ext('leyonet.ch', LINKS.projekt),
          ext('Auf Patreon unterstützen', LINKS.patreon), ext('Quelltext', LINKS.quelltext)));
        return d;
      },
      Quellen: () => {
        const table = (head, rows) => el('table', {}, el('thead', {}, el('tr', {}, ...head.map((h) => el('th', {}, h)))),
          el('tbody', {}, ...rows.map((r) => el('tr', {}, ...r.map((c) => el('td', {}, c))))));
        return el('div', { class: 'ui-doc' }, el('h3', {}, 'Software und Modelle'),
          table(['Bestandteil', 'Zweck', 'Herkunft', 'Lizenz'], QUELLEN.software.map((r) => [r.was, r.zweck, r.quelle, r.lizenz])),
          el('h3', {}, `Texturen: ${QUELLEN.texturen.quelle.replace('https://', '')} (${QUELLEN.texturen.lizenz})`),
          table(['Set', 'Verwendet für'], QUELLEN.texturen.sets.map((r) => [r.id, r.zweck])),
          el('p', {}, 'Geprüft und erzeugt vom Herkunfts-Bot (scripts/herkunft-bot.mjs).'),
          el('div', { class: 'row' }, ext('Lizenztexte', './lizenzen.txt')));
      },
      Klasse: () => this._classTab(actions.classroom),
      Admin: () => el('div', { class: 'ui-doc' }, el('h3', {}, 'Admin-Board'),
        el('p', {}, actions.classroom?.server ? 'Für Lehrpersonen: Klassen eröffnen, Fortschritt und Zeiten sehen, live zuschauen, anhalten und freigeben. Anmeldung mit Passwort und Authenticator-App.'
          : 'Das Admin-Board braucht den leyoNET-DC-Server. Auf dieser Seite läuft er nicht.'),
        ...(actions.classroom?.server ? [el('div', { class: 'row' }, ext('Admin-Board öffnen', './admin.html', 'btn'))] : []),
        el('p', {}, `Geschaffte Levels in diesem Browser: ${loadWon().size} von ${this.levels.filter((l) => !l.sandbox).length}`)),
      Version: () => el('div', { class: 'ui-doc' }, el('h3', {}, `leyoNET DC ${VERSION}`),
        ...CHANGES.map((c) => el('div', { class: 'ver' }, el('div', { class: 'ver-head' }, el('b', {}, c.v), el('span', {}, c.date)),
          el('ul', {}, ...c.items.map((t) => el('li', {}, t)))))),
      Impressum: () => doc(IMPRESSUM),
      Datenschutz: () => doc(DATENSCHUTZ),
    };
    const w = this._win('Menü', tabs, { icon: 'ly', sub: `leyoNET DC ${VERSION} · Esc: weiterspielen` });
    this._show(w.win);
    w.select('Spiel');
  }

  // ---------- Level-Menue ----------
  openLevels() {
    const won = loadWon();
    const grid = el('div', { class: 'level-grid' });
    this.levels.forEach((l, k) => {
      const card = el('button', { class: `level ${won.has(l.id) ? 'won' : ''}`, onclick: () => this.chooseStart(l), ...(this.levelOpen(l.id) ? {} : { disabled: '', title: 'für deine Klasse noch nicht offen' }) },
        el('div', { class: 'top' }, el('div', { class: 'num' }, won.has(l.id) ? '✓' : String(k + 1)),
          el('div', { class: 'title' }, l.title.replace(/^Level \d+ - /, ''))),
        el('div', { class: 'desc' }, this.settings.legacy(l.text)),
        el('div', { class: 'tags' }, ...(this.codeOpen(l) ? [] : [el('span', { class: 'lock' }, '🔒 mit Zugangscode')]), ...(l.tags ?? []).map((t) => el('span', {}, t))));
      grid.append(card);
    });
    const hero = el('div', { class: 'menu-hero' }, el('h1'), el('p', {}, 'Serverraum bauen, verkabeln und konfigurieren – mit dem leyoNET-Simulationskern.'));
    hero.firstChild.innerHTML = 'leyo<span>NET</span> DC';
    const home = this.onHome ? [el('button', { class: 'btn secondary', style: 'margin-bottom:16px', onclick: () => this.onHome() }, '← Startbildschirm')] : [];
    const w = this._win('Level wählen', { Level: () => el('div', {}, ...home, hero, grid) }, { icon: 'DC', sub: `${won.size} von ${this.levels.filter((l) => !l.sandbox).length} geschafft · freies Bauen + Demo-RZ unten` });
    this._show(w.win);
    w.select('Level');
  }

  /** Plan v4 E: selbst aufbauen oder mit gestelltem Aufbau starten (nur Levels mit Bauplan) */
  chooseStart(level) {
    if (!this.levelOpen(level.id)) { toast('Dieses Level ist für deine Klasse noch nicht offen.', 'err'); return; }
    if (!this.codeOpen(level)) { this.onLocked(level); return; }
    const go = (ready) => { this.close(); this.onLevel(level.id, ready); };
    if (!level.bauplan) { go(false); return; }
    const btn = (label, sub, ready, primary) => el('button', { class: `menu-btn ${primary ? 'primary' : ''}`, onclick: () => go(ready) }, el('b', {}, label), el('span', {}, sub));
    const num = level.id.replace(/^L/, '');
    const w = this._win(level.title.replace(/^Level \d+ - /, ''), { Start: () => el('div', { class: 'ui-doc' }, el('p', {}, this.settings.legacy(level.text)),
      el('div', { class: 'menu-grid' },
        btn('Selbst aufbauen', 'Leerer Raum: einkaufen, einbauen, verkabeln', false, true),
        btn('Fertig aufgebaut', 'Geräte stehen schon, Kabel liegen im Inventar', true, false)),
      el('div', { class: 'row' }, el('button', { class: 'btn secondary', onclick: () => this.openLevels() }, '← Level wählen'))) }, { icon: num, sub: 'Wie möchtest du starten?' });
    this._show(w.win);
    w.select('Start');
    w.win.style.height = 'auto';
  }

  /** Urteil des Servers (Klasse): Zeit bestaetigt, Bestzeit, Rangliste */
  _verdict(promise) {
    const box = el('div', { class: 'verdict' }, 'Der Server prüft dein Ergebnis …');
    promise.then((r) => {
      if (!r) { box.remove(); return; }
      box.className = `verdict ${r.error ? 'err' : 'ok'}`;
      box.replaceChildren(r.error ?? `Vom Server bestätigt: ${formatTime(r.ms)}${r.resumed ? ' – aus einem Spielstand, ohne Bestzeit' : r.record ? ' – deine Bestzeit' : `, deine Bestzeit ${formatTime(r.best)}`}`);
      if (r.top?.length) box.after(el('ol', {}, ...r.top.map((t) => el('li', {}, `${t.name} · ${formatTime(t.ms)}`))));
    });
    return box;
  }

  /** Reiter «Klasse» im Menue */
  _classTab(c) {
    const box = el('div', { class: 'ui-doc' });
    const msg = el('div', { class: 'ui-msg' });
    const fail = (e) => { msg.className = 'ui-msg err'; msg.textContent = errorText(e.message); };
    const p = (t) => el('p', {}, t);
    const codeField = (label, btn, fn) => {
      const i = el('input', { autocomplete: 'off', spellcheck: 'false', maxlength: '14', style: 'text-transform:uppercase' });
      const b = el('button', { class: 'btn', onclick: () => fn(i.value).then(render, fail) }, btn);
      i.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); if (e.key === 'Enter') b.click(); });
      return el('div', { class: 'row' }, el('label', { class: 'field' }, el('span', {}, label), i), el('div', { style: 'align-self:end' }, b));
    };
    const render = () => {
      msg.textContent = '';
      if (!c?.server) { box.replaceChildren(el('h3', {}, 'Klasse'), p('Hier läuft kein Klassen-Server. Du spielst für dich, dein Fortschritt bleibt auf diesem Gerät.')); return; }
      if (!c.joined) {
        box.replaceChildren(el('h3', {}, 'Klasse beitreten'),
          p('Du bekommst ein zufälliges Pseudonym – bitte keinen Namen eingeben. Gespeichert werden Pseudonym, geschaffte Levels und Zeiten; deine Lehrperson sieht sie und kann live zuschauen (das Spiel zeigt es dann an).'),
          codeField('Klassencode', 'Beitreten', (v) => c.join(v)), el('h3', {}, 'Auf einem anderen Gerät weiterspielen'), codeField('Dein eigener Code', 'Weiterspielen', (v) => c.resume(v)), msg);
        return;
      }
      let sure = false;
      const del = el('button', { class: 'btn secondary', onclick: () => {
        if (!sure) { sure = true; del.textContent = 'Wirklich alles löschen?'; return; }
        c.leave().then(render, fail);
      } }, 'Klasse verlassen und Daten löschen');
      const res = Object.entries(c.info.results ?? {});
      const top = c.info.leaderboard ?? {};
      box.replaceChildren(el('h3', {}, `${c.me.name} · ${c.me.label}`), p('Sag deiner Lehrperson dein Pseudonym. Mit deinem eigenen Code spielst du auf einem anderen Gerät weiter:'),
        el('p', { class: 'code-big' }, c.me.code),
        ...(res.length ? [el('h3', {}, 'Vom Server bestätigt'), el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Level'), el('th', {}, 'Bestzeit'), el('th', {}, 'Anzahl'))),
          el('tbody', {}, ...res.sort().map(([k, r]) => el('tr', {}, el('td', {}, k.endsWith('+') ? `${k.slice(0, -1)} (fertig aufgebaut)` : k), el('td', {}, r.best ? formatTime(r.best) : '–'), el('td', {}, String(r.count))))))] : []),
        ...Object.keys(top).sort().flatMap((k) => [el('h3', {}, `Rangliste ${k}`), el('ol', {}, ...top[k].map((t) => el('li', {}, `${t.name} · ${formatTime(t.ms)}`)))]),
        el('div', { class: 'row' }, el('button', { class: 'btn secondary', onclick: () => { c.signOut(); render(); } }, 'Auf diesem Gerät abmelden'), del), msg);
    };
    render();
    if (c?.joined) c.refresh().then(render);
    return box;
  }

  // ---------- Verbundsaufgabe ----------
  /** Freigegeben: beginnen oder weiterbauen. start(fresh) -> Promise<Fehlertext|null> */
  openVerbundStart(v, start) {
    const msg = el('div', { class: 'ui-msg' });
    const go = async (fresh) => { const e = await start(fresh); if (e) { msg.className = 'ui-msg err'; msg.textContent = e; } };
    let sure = false;
    const again = el('button', { class: 'btn secondary', onclick: () => { if (!sure) { sure = true; again.textContent = 'Wirklich alles verwerfen?'; return; } go(true); } }, 'Neu beginnen');
    const w = this._win('Verbundaufgabe', { Start: () => el('div', { class: 'ui-doc vb' }, el('div', { class: 'vb-stars', 'aria-label': `${v.sterne} Sterne` }, '★'.repeat(v.sterne), el('span', {}, '★'.repeat(5 - v.sterne))), el('h2', {}, v.titel),
      el('p', {}, `Deine Klasse baut gemeinsam einen Verbund aus Rechenzentren. Du baust einen Standort, schliesst ihn an und die Lehrperson nimmt ihn ab. Richtzeit ${v.dauer} Minuten.`),
      el('p', {}, v.running ? 'Du hast schon begonnen – dein Stand liegt auf dem Server.' : 'Dein aktuelles Level wird verlassen.'),
      el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => go(false) }, v.running ? 'Weiterbauen' : 'Beginnen'), ...(v.running ? [again] : [])), msg) }, { icon: 'ly', sub: v.seat ? `Platz ${v.seat}` : 'freigegeben von deiner Lehrperson' });
    this._show(w.win);
    w.select('Start');
    w.win.style.height = 'auto';
  }

  /** Auftragsblatt + Ziele. check() -> Promise<{ goals, level, partner }> (Test auf dem Server) */
  openAuftrag(level, { check, result = null, partner = null }) {
    const b = level.blatt;
    const tabs = {
      Auftrag: () => el('div', { class: 'ui-doc vb' }, el('div', { class: 'vb-stars' }, '★'.repeat(b.sterne), el('span', {}, '★'.repeat(5 - b.sterne))), el('h2', {}, b.titel), el('p', {}, b.story),
        el('h3', {}, `Deine Adressen – Standort ${b.ort}`), el('table', { class: 'vb-blatt' }, el('tbody', {}, ...b.zeilen.map(([k, v]) => el('tr', {}, el('th', {}, k), el('td', {}, el('code', {}, v)))))),
        el('p', { class: 'muted' }, 'Diese Werte gelten nur für deinen Platz – die Konfiguration von nebenan funktioniert hier nicht.'),
        el('h3', {}, 'Vorgehen'), el('ol', {}, ...b.schritte.map((t) => el('li', {}, t))), el('p', {}, el('b', {}, 'Material: '), b.bedarf),
        el('p', {}, el('b', {}, 'Partner: '), `Platz ${b.partner}. ${partner ? 'Sein Standort ist am Netz und antwortet selbst.' : 'Solange sein Standort nicht steht, antwortet der Referenz-Standort der Zentrale.'}`)),
      Ziele: () => {
        const list = el('div', { class: 'vb-goals' });
        const msg = el('div', { class: 'ui-msg' });
        const draw = (goals, server) => list.replaceChildren(...level.scenario.ziele.map((z) => {
          const g = goals.find((x) => x.id === z.id);
          return el('div', { class: `vb-goal ${g?.done ? 'done' : ''}` }, el('i', {}, g?.done ? '✓' : ''), el('span', {}, z.text, ...(z.gemeinsam ? [el('em', {}, 'gemeinsam')] : [])), el('small', {}, server ? 'Server' : ''));
        }));
        draw(this.state()?.goals ?? [], false);
        const btn = el('button', { class: 'btn', onclick: async () => {
          btn.disabled = true;
          msg.className = 'ui-msg';
          msg.textContent = 'Der Server spielt deinen Standort nach …';
          try {
            const r = await check();
            draw(r.goals, true);
            const n = r.goals.filter((g) => g.done).length;
            msg.className = `ui-msg ${n === r.goals.length ? 'ok' : ''}`;
            msg.textContent = `${n} von ${r.goals.length} Zielen vom Server bestätigt.`;
          } catch (e) { msg.className = 'ui-msg err'; msg.textContent = errorText(e.message); }
          setTimeout(() => { btn.disabled = false; }, 8000);
        } }, 'Vom Server prüfen lassen');
        return el('div', { class: 'ui-doc vb' }, ...(result ? [el('div', { class: `vb-result ${result.passed ? 'ok' : ''}` }, el('b', {}, result.passed ? 'Abnahme bestanden' : 'Abnahme: noch nicht alles erfüllt'), el('span', {}, `${result.done} von ${result.total} Zielen`))] : []), list, el('div', { class: 'row' }, btn), msg);
      },
    };
    const w = this._win(`Verbund · ${b.ort}`, tabs, { icon: 'ly', sub: `Platz ${b.seat} · ${'★'.repeat(b.sterne)}` });
    this._show(w.win);
    w.select('Auftrag');
  }

  showAbnahme(v, level) {
    const r = v.result;
    const open = (level?.scenario.ziele ?? []).filter((z) => r.missing.includes(z.id));
    const box = el('div', { class: 'ui-win done-box', style: 'height:auto' }, ...(r.passed ? [el('div', { class: 'check' })] : []), el('h2', {}, r.passed ? 'Abnahme bestanden!' : 'Abnahme: noch offen'),
      el('p', {}, `${'★'.repeat(v.sterne)} ${v.titel}: ${r.done} von ${r.total} Zielen`), ...(open.length ? [el('ul', { class: 'vb-open' }, ...open.map((z) => el('li', {}, z.text)))] : []),
      el('div', { class: 'actions' }, el('button', { class: 'btn', onclick: () => this.close() }, r.passed ? 'Schliessen' : 'Weiterbauen')));
    this._show(box);
  }

  /** "Level geschafft"-Dialog */
  showDone(level, next, run = null, verdict = null) {
    markWon(level.id);
    const box = el('div', { class: 'ui-win done-box', style: 'height:auto' },
      el('div', { class: 'check' }), el('h2', {}, 'Level geschafft!'), el('p', {}, level.title),
      run ? el('div', { class: 'time' }, el('b', {}, formatTime(run.ms)), el('span', {}, run.record ? (run.best === null ? 'erste Bestzeit!' : `neue Bestzeit! bisher ${formatTime(run.best)}`) : run.best === null ? 'aus einem Spielstand, ohne Bestzeit' : `Bestzeit ${formatTime(run.best)}`)) : '',
      ...(verdict ? [this._verdict(verdict)] : []),
      el('div', { class: 'actions' },
        el('button', { class: 'btn secondary', onclick: () => this.close() }, 'Weiterspielen'),
        next ? el('button', { class: 'btn', onclick: () => this.chooseStart(next) }, `Weiter: ${next.title.replace(/^Level \d+ - /, '')}`)
          : el('button', { class: 'btn', onclick: () => this.openLevels() }, 'Level-Übersicht')));
    this._show(box);
  }

  // ---------- Notebook-Displays im Raum ----------
  attachScreens(screenMeshes, nodeToId) {
    for (const mesh of screenMeshes) {
      if (mesh.userData.leyonet_overlay !== 'screen') continue; // KVM-Hotspot: unsichtbar, kein Display
      const node = mesh.name.replace(/_screen$/, '');
      // Export verwirft die UV-Map (Material screen_dark hat keine Textur) -> sonst sampelt die
      // Canvas nur Pixel (0,0) = schwarz. Planar aus dem Deckel-Lokalraum: x = Breite, y = Hoehe.
      const g = mesh.geometry;
      if (!g.attributes.uv) {
        g.computeBoundingBox();
        const { min, max } = g.boundingBox;
        const pos = g.attributes.position;
        const uv = new Float32Array(pos.count * 2);
        for (let k = 0; k < pos.count; k++) {
          uv[2 * k] = (pos.getX(k) - min.x) / (max.x - min.x || 1);
          uv[2 * k + 1] = (pos.getY(k) - min.y) / (max.y - min.y || 1);
        }
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      }
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 310;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      mesh.material = new THREE.MeshBasicMaterial({ map: tex });
      this.screens.set(node, { mesh, canvas, tex, id: nodeToId(node) });
    }
    this.drawScreens();
  }

  async drawScreens() {
    const kern = this.kern?.();
    if (!kern) return;
    for (const s of this.screens.values()) {
      if (!s.id) continue;
      const i = await kern.send({ action: 'device_info', device: s.id });
      const g = s.canvas.getContext('2d');
      const W = s.canvas.width, H = s.canvas.height;
      if (i.power === 'off') {
        // aus: schwarzes Panel mit leichtem Glanz
        const off = g.createLinearGradient(0, 0, W, H);
        off.addColorStop(0, '#0c0e11'); off.addColorStop(0.45, '#050607'); off.addColorStop(1, '#020203');
        g.fillStyle = off;
        g.fillRect(0, 0, W, H);
        s.tex.needsUpdate = true;
        continue;
      }
      // Desktop: Hintergrund, Fenster "Netzwerk", Taskleiste
      const bg = g.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#f5f7fa'); bg.addColorStop(1, '#e3e9f0');
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#cfd6df';
      for (let y = 9; y < H; y += 18) for (let x = 9; x < W; x += 18) g.fillRect(x, y, 2, 2);
      const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
      rr(24, 22, 330, 216, 12); g.fillStyle = '#ffffff'; g.fill(); g.strokeStyle = '#d3d9e1'; g.lineWidth = 2; g.stroke();
      rr(24, 22, 330, 36, [12, 12, 0, 0]); g.fillStyle = '#000000'; g.fill();
      g.fillStyle = '#ffffff'; g.font = "700 20px 'Courier New', 'Liberation Mono', monospace";
      g.fillText(`${s.id.toUpperCase()} · Netzwerk`, 40, 47);
      g.font = '20px ui-monospace, monospace';
      g.fillStyle = '#55606f'; g.fillText('IPv4', 40, 92); g.fillText('Maske', 40, 128); g.fillText('Gateway', 40, 164);
      g.fillStyle = '#18212c';
      g.fillText(i.ip || '—', 140, 92); g.fillText(i.mask || '—', 140, 128); g.fillText(i.gateway || '—', 140, 164);
      g.fillStyle = i.console ? '#16a34a' : '#8a8f98';
      g.beginPath(); g.arc(46, 202, 6, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#18212c'; g.font = '17px system-ui, sans-serif';
      g.fillText(i.console ? `Konsole → ${i.console}` : 'keine Konsole', 60, 208);
      g.fillStyle = '#000000'; g.fillRect(0, H - 34, W, 34);
      g.fillStyle = '#ffffff'; rr(12, H - 27, 20, 20, 5); g.fill();
      g.fillStyle = '#c7d2de'; g.font = '16px system-ui, sans-serif';
      const now = new Date();
      g.fillText(now.toTimeString().slice(0, 5), W - 58, H - 11);
      g.fillStyle = '#cfd6df'; g.fillText(`${this.settings.key('use')}: benutzen`, 44, H - 11);
      s.tex.needsUpdate = true;
    }
  }
}

// geschaffte Level nur im Browser dieses Spielers (kein Konto, keine Personendaten)
function loadWon() {
  try { return new Set(JSON.parse(localStorage.getItem('leyonet-dc.won') ?? '[]')); } catch { return new Set(); }
}
function markWon(id) {
  try { const w = loadWon(); w.add(id); localStorage.setItem('leyonet-dc.won', JSON.stringify([...w])); } catch { /* privat */ }
}

/** Kurzmeldung oben (statt Textzeile im Prompt) */
export function toast(text, kind = '', ms = 2600) {
  const host = document.getElementById('toasts');
  if (!host || !text) return;
  const t = el('div', { class: `toast glass ${kind}` }, text);
  host.append(t);
  while (host.children.length > 3) host.firstChild.remove();
  setTimeout(() => t.remove(), ms);
}
