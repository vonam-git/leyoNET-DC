// Speedrun-Timer (User 2026-11-23): ein-/ausschaltbar (Taste T oder Menue), laeuft ab Levelstart bis zum letzten Ziel und haelt
// nicht an (auch nicht im Menue). Bestzeiten je Level nur im Browser (localStorage).
const KEY_ON = 'leyonet-dc.timer';
const KEY_BEST = 'leyonet-dc.best';
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privat */ } };

/** 83456 -> "1:23.4" (Stunden nur, wenn noetig) */
export function formatTime(ms) {
  const t = Math.max(0, Math.floor(ms / 100));
  const s = Math.floor(t / 10);
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}.${t % 10}`;
}

export class SpeedTimer {
  constructor(el, now = () => performance.now()) {
    this.el = el;
    this.now = now;
    this.own = load(KEY_ON, false) === true; // eigene Wahl
    this.force = null; // Klasse: true/false = vorgegeben, null = frei
    this.key = null;
    this.t0 = null; // laeuft seit
    this.counts = true; // false = aus einem Spielstand: keine Bestzeit
    this.end = null; // gestoppte Zeit (ms)
    this._text = '';
    this._show();
  }

  get enabled() { return this.force ?? this.own; }
  setForce(v) { if (v !== this.force) { this.force = v; this._show(); } }

  toggle(on = !this.own) {
    if (this.force !== null) return this.enabled;
    this.own = on;
    save(KEY_ON, on);
    this._show();
    return on;
  }

  /** ms + counts: aus einem Spielstand weiterspielen (Uhr stand in der Pause -> keine Bestzeit) */
  start(key, { ms = 0, counts = true } = {}) {
    this.key = key;
    this.counts = counts;
    this.t0 = this.now() - ms;
    this.end = null;
    this._show();
  }

  /** Level fertig -> { ms, best, record } (Bestzeiten nur bei eingeschaltetem Timer) */
  stop() {
    if (this.t0 === null || this.end !== null) return null;
    this.end = this.now() - this.t0;
    const all = load(KEY_BEST, {});
    const before = all[this.key] ?? null;
    const record = this.enabled && this.counts && (before === null || this.end < before);
    if (record) { all[this.key] = Math.round(this.end); save(KEY_BEST, all); }
    this._show();
    return { ms: this.end, best: before, record };
  }

  reset() { this.t0 = null; this.end = null; this._show(); }
  best(key) { return load(KEY_BEST, {})[key] ?? null; }
  get ms() { return this.end ?? (this.t0 === null ? 0 : this.now() - this.t0); }

  /** pro Frame; schreibt nur, wenn sich die angezeigte Zehntelsekunde aendert */
  tick() {
    if (!this.enabled || this.t0 === null) return;
    const text = formatTime(this.ms);
    if (text !== this._text && this.el) { this._text = text; this.el.firstChild.textContent = text; }
  }

  _show() {
    if (!this.el) return;
    this.el.hidden = !this.enabled || this.t0 === null;
    this.el.classList.toggle('done', this.end !== null);
    const b = this.key ? this.best(this.key) : null;
    this._text = formatTime(this.ms);
    this.el.replaceChildren(Object.assign(document.createElement('b'), { textContent: this._text }),
      Object.assign(document.createElement('span'), { textContent: b === null ? 'noch keine Bestzeit' : `Bestzeit ${formatTime(b)}` }));
  }
}
