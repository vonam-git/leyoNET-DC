// Klasse (Plan v4 F): Beitritt mit Klassencode, Lebenszeichen, Ergebnisse. Ohne Server (oder ohne Beitritt) bleibt alles lokal.
// Das Spiel sendet Absichten, nie Ergebnisse: «geschafft» geht mit dem Protokoll an den Server, der es nachspielt (server/app.cjs).
const KEY = 'leyonet-dc.klasse';
const READ_ONLY = new Set(['device_info', 'console_complete', 'host_ping', 'host_http', 'hello']); // wie server-kern.js
const BEAT_MS = 15_000;
const OBSERVE_MS = 3_000;
const MAX_LOG = 4000;
const MAX_RECORD = 20_000; // Spielstaende duerfen laenger sein als ein bestaetigter Lauf (saves.js MAX_STEPS)
const SYNC_MS = 2_500;

export const ERRORS = {
  codeUnknown: 'Diesen Code gibt es nicht.', classClosed: 'Die Klasse ist geschlossen.', classFull: 'Die Klasse ist voll.', tooMany: 'Zu viele Versuche – kurz warten.',
  notAllowed: 'Die Lehrperson hat das Spielen gerade angehalten.', levelLocked: 'Dieses Level ist für deine Klasse noch nicht offen.', runUnknown: 'Der Server kennt diesen Lauf nicht mehr – das Ergebnis zählt nur auf diesem Gerät.',
  tooFast: 'Schneller als von Hand möglich – der Server zählt das nicht.', notSolved: 'Der Server konnte das Ergebnis nicht bestätigen.', replayFailed: 'Der Server konnte das Ergebnis nicht bestätigen.', replayTimeout: 'Der Server konnte das Ergebnis nicht bestätigen.',
  tooMuch: 'Zu viele Schritte für eine Aufgabe – bitte die Lehrperson fragen.', noTask: 'Keine Verbundaufgabe freigegeben.',
  savesFull: 'Auf dem Server sind schon fünf Spielstände.', storageFull: 'Auf dem Server ist kein Platz mehr.', tooLarge: 'Der Spielstand ist zu gross für den Server.',
  saveUnknown: 'Diesen Spielstand gibt es nicht mehr.',
  busy: 'Der Server ist gerade ausgelastet.', offline: 'Der Server ist nicht erreichbar.', join: 'Du bist nicht mehr in der Klasse.',
};
export const errorText = (e) => ERRORS[e] ?? `Fehler (${e})`;

/** Nur, was der Netzplan braucht - klein genug fuers Lebenszeichen (64 KB). */
export function slimPlan(st) {
  if (!st) return null;
  const used = new Set((st.links ?? []).flatMap((l) => [l.a, l.b]));
  return {
    devices: (st.devices ?? []).map((d) => ({ id: d.id, rack: d.rack, ports: Object.fromEntries(Object.entries(d.ports).filter(([p]) => used.has(`${d.id}/${p}`))) })),
    links: (st.links ?? []).map((l) => ({ id: l.id, a: l.a, b: l.b })),
    trunks: st.trunks ?? [], power: st.power ?? {}, plan: st.plan ?? {},
  };
}

export class Classroom {
  /** getState(): { level, goals: [{done}], kern } ; onChange(): Anzeige aktualisieren */
  constructor({ base = './api/', getState, onChange = () => {}, fetchFn = (...a) => fetch(...a) }) {
    Object.assign(this, { base, getState, onChange, fetchFn });
    this.server = false;
    this.saveMax = 0;
    this.me = null; // { token, code, name, label }
    this.info = {}; // letzte Antwort des Servers: locked, paused, closed, observe, settings
    this.run = null;
    this.log = [];
    this.timer = null;
    this.vb = null; // laufende Verbundsaufgabe { run, task, seat, sent }
  }

  async init() {
    try {
      const r = await this._call('GET', 'status');
      this.server = r.app === 'leyonet-dc';
      this.saveMax = Number(r.saveMax) || 0; // 0 = aelterer Server ohne Spielstaende
    } catch { this.server = false; }
    if (!this.server) return;
    try { this.me = JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { this.me = null; }
    if (this.me) await this.refresh();
    this.onChange();
    this._schedule();
  }

  async _call(method, path, body) {
    let r;
    try {
      r = await this.fetchFn(this.base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(this.me?.token ? { Authorization: `Bearer ${this.me.token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    } catch { throw new Error('offline'); }
    const j = await r.json().catch(() => null); // statischer Server: HTML statt JSON
    if (!j) throw new Error('offline');
    if (!r.ok) {
      if (r.status === 401 && this.me) this._forget(); // geloescht oder auf anderem Geraet weitergespielt
      throw new Error(j.error ?? 'offline');
    }
    return j;
  }

  _save() { try { localStorage.setItem(KEY, JSON.stringify(this.me)); } catch { /* privat */ } }
  _forget() {
    this.me = null;
    this.info = {};
    this.run = null;
    try { localStorage.removeItem(KEY); } catch { /* privat */ }
    this.onChange();
  }

  get joined() { return !!this.me; }
  /** null = frei; sonst Text: Spiel ist angehalten */
  get blocked() {
    if (!this.me) return null;
    if (this.info.locked) return 'Die Lehrperson hat dich gesperrt.';
    if (this.info.paused) return 'Zwischenstopp: Die Lehrperson hat die Klasse angehalten.';
    return null;
  }
  get observed() { return !!(this.me && this.info.observe); }
  levelOpen(id) { const l = this.me && this.info.settings?.levels; return !l || l.includes(id); }

  async join(code) { return this._enter(await this._call('POST', 'join', { code })); }
  async resume(code) { return this._enter({ code, ...(await this._call('POST', 'resume', { code })) }); }
  _enter(r) {
    this.me = { token: r.token, code: r.code, name: r.name, label: r.class.label };
    this.info = { settings: r.class.settings };
    this._save();
    this.onChange();
    this._schedule(500);
    return this.me;
  }
  /** auf diesem Geraet abmelden (Stand bleibt auf dem Server, weiter mit dem eigenen Code) */
  signOut() { this._forget(); }
  /** Pseudonym und Ergebnisse auf dem Server loeschen */
  async leave() { await this._call('POST', 'leave', {}); this._forget(); }
  async refresh() {
    try {
      this.info = await this._call('GET', 'me');
      this.onChange();
    } catch { /* offline: naechster Schlag */ }
    return this.info;
  }

  /** Absichten mitschreiben: kern.send umhuellen. initial: schon eingespieltes Protokoll (Verbund weiterbauen) */
  record(kern, initial = []) {
    const send = kern.send.bind(kern);
    const log = [...initial];
    this.log = log;
    kern.send = (i) => {
      if (!READ_ONLY.has(i.action) && log.length < (this.vb ? MAX_LOG + 1 : MAX_RECORD)) {
        log.push(structuredClone(i));
        if (this.vb && log === this.log) this._syncSoon();
      }
      return send(i);
    };
  }

  async startRun(level, ready) {
    this.run = null;
    if (!this.me) return null;
    const token = (this._runToken = {});
    try {
      const r = await this._call('POST', 'run', { level, ready });
      if (token === this._runToken) this.run = r.run;
      return null;
    } catch (e) { return errorText(e.message); }
  }

  /** Level geschafft -> { ms, record, best, top? } vom Server oder { error } */
  async finish() {
    if (!this.me) return null;
    const run = this.run;
    this.run = null;
    if (!run) return { error: errorText('runUnknown') };
    if (this.log.length > MAX_LOG) return { error: 'Zu viele Schritte – das Ergebnis zählt nur auf diesem Gerät.' };
    try { return await this._call('POST', 'finish', { run, intents: this.log }); } catch (e) { return { error: errorText(e.message) }; }
  }

  // ---------- Spielstaende auf dem Server (nur mit Klasse) ----------
  get canSave() { return !!(this.server && this.me && this.saveMax); }
  listSaves() { return this._call('GET', 'saves'); }
  storeSave(save) { return this._call('POST', 'saves', { save, ...(this.run ? { run: this.run } : {}) }); }
  /** -> { save, run }: run nur, wenn der Server den Lauf beim Speichern kannte */
  openSave(id) { return this._call('POST', `saves/${id}/open`, {}); }
  deleteSave(id) { return this._call('POST', `saves/${id}/delete`, {}); }
  /** Lauf eines neuen Levels: alter Lauf gilt nicht mehr (null = dieses Level zaehlt nicht fuer die Klasse) */
  setRun(run) { this.run = run; this._runToken = {}; }

  // ---------- Verbundsaufgabe: das Protokoll laeuft laufend zum Server (er spielt es nach) ----------
  /** Beginnen oder weiterbauen -> { task, seat, intents, partner }; wirft Fehler */
  async startVerbund(fresh = false) {
    const r = await this._call('POST', 'verbund/start', { fresh });
    this.vb = { run: r.run, task: r.task, seat: r.seat, sent: r.intents.length };
    return r;
  }
  leaveVerbund() { clearTimeout(this._syncTimer); this.vb = null; }
  _syncSoon(ms = SYNC_MS) {
    if (this._syncTimer) return;
    this._syncTimer = setTimeout(() => { this._syncTimer = null; this.sync(); }, ms);
  }
  /** Rueckgabe null oder Fehlercode */
  async sync() {
    if (this._syncing) { await this._syncing; }
    this._syncing = this._sync().finally(() => { this._syncing = null; });
    return this._syncing;
  }
  async _sync() {
    const vb = this.vb;
    if (!vb || !this.me) return null;
    const log = this.log;
    try {
      for (let guard = 0; vb === this.vb && log.length > vb.sent && guard < 60; guard++) {
        const part = log.slice(vb.sent, vb.sent + 200);
        const r = await this._call('POST', 'verbund/sync', { run: vb.run, from: vb.sent, intents: part });
        if (r.resync && r.have > log.length) { this.onVerbundLost?.(); this.vb = null; return 'runUnknown'; }
        vb.sent = r.have;
      }
      return null;
    } catch (e) {
      if (e.message === 'runUnknown' && vb === this.vb) { // Server neu gestartet: neuer Lauf, alles nachreichen. Sonst: anderes Geraet
        try {
          const r = await this._call('POST', 'verbund/start', { fresh: false });
          if (r.task === vb.task && r.seat === vb.seat && !r.intents.length) { Object.assign(vb, { run: r.run, sent: 0 }); this._syncSoon(); return null; }
        } catch { /* geschlossen oder beendet */ }
        this.vb = null;
        this.onVerbundLost?.();
        return 'runUnknown';
      }
      if (e.message === 'offline' || e.message === 'tooMany' || e.message === 'busy') this._syncSoon(8000);
      return e.message;
    }
  }
  /** Test auf dem Server (gleicher Test wie die Abnahme) */
  async checkVerbund() {
    const e = await this.sync();
    if (e) throw new Error(e);
    return this._call('POST', 'verbund/check', {});
  }

  async beat() {
    if (!this.me) return;
    const s = this.getState();
    const goals = s.goals ?? [];
    try {
      this.info = await this._call('POST', 'beat', { ...(s.level ? { level: s.level } : {}), done: goals.filter((g) => g.done).length, total: goals.length,
        ...(this.info.observe ? { plan: slimPlan(s.kern) } : {}) });
      this.onChange();
      if (this.vb && this.log.length > this.vb.sent) this._syncSoon();
    } catch { /* offline: spaeter wieder */ }
  }

  _schedule(ms = this.info.observe ? OBSERVE_MS : BEAT_MS) {
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => { await this.beat(); this._schedule(); }, ms);
  }
}
