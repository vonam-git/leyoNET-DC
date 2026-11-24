// Einstellungen (Plan 2026-11-24): Tastenbelegung, Grafik, Anzeige. Nur im Browser dieses Spielers (localStorage, «leyonet-dc.settings»).
// Ohne DOM, damit scripts/check-settings.mjs es pruefen kann. Alle Texte im Spiel holen ihre Tasten von hier (key / legacy / fill).
const KEY = 'leyonet-dc.settings';

/** letter: Buchstabe, unter dem die Taste in aelteren Texten steht («E:», «(B)») */
export const ACTIONS = [
  { id: 'forward', group: 'Bewegen', label: 'Vorwärts', code: 'KeyW', help: 'Vorwärts gehen. Im Sitzen: aufstehen.' },
  { id: 'back', group: 'Bewegen', label: 'Rückwärts', code: 'KeyS', help: 'Rückwärts gehen. Im Sitzen: aufstehen.' },
  { id: 'left', group: 'Bewegen', label: 'Links', code: 'KeyA', help: 'Seitwärts gehen. Im Sitzen: mit dem Stuhl am Pult entlangrollen.' },
  { id: 'right', group: 'Bewegen', label: 'Rechts', code: 'KeyD', help: 'Seitwärts gehen. Im Sitzen: mit dem Stuhl am Pult entlangrollen.' },
  { id: 'run', group: 'Bewegen', label: 'Rennen', code: 'ShiftLeft', help: 'Gedrückt halten.' },
  { id: 'crouch', group: 'Bewegen', label: 'Ducken', code: 'KeyC', help: 'Ein- und ausschalten. Hilft bei den unteren Höheneinheiten.' },
  { id: 'use', group: 'Bauen', label: 'Benutzen', code: 'KeyE', letter: 'E', help: 'Einbauen, Kabel stecken, Notebook öffnen, hinsetzen. Linksklick macht dasselbe.' },
  { id: 'cancel', group: 'Bauen', label: 'Abbrechen', code: 'KeyQ', letter: 'Q', help: 'Ein angefangenes Kabel wieder weglegen.' },
  { id: 'remove', group: 'Bauen', label: 'Ausbauen', code: 'KeyR', letter: 'R', help: 'Gerät oder SFP-Modul ausbauen, es kommt zurück ins Inventar.' },
  { id: 'inventory', group: 'Bauen', label: 'Inventar', code: 'KeyI', letter: 'I', hint: 'Inventar', help: 'Auswählen, was du in der Hand hast.' },
  { id: 'shop', group: 'Bauen', label: 'Shop', code: 'KeyB', letter: 'B', hint: 'Shop', help: 'Racks, Geräte und Kabel kaufen.' },
  { id: 'levels', group: 'Anzeigen', label: 'Levels', code: 'KeyL', letter: 'L', hint: 'Level', help: 'Level wählen.' },
  { id: 'plan', group: 'Anzeigen', label: 'Netzplan', code: 'KeyN', letter: 'N', hint: 'Netzplan', help: 'Zeichnet mit, was du baust.' },
  { id: 'map', group: 'Anzeigen', label: 'Minikarte', code: 'KeyM', letter: 'M', hint: 'Karte', help: 'Raum, Netzplan oder aus.' },
  { id: 'timer', group: 'Anzeigen', label: 'Speedrun-Timer', code: 'KeyT', letter: 'T', hint: 'Timer', help: 'Stoppt die Zeit bis zum letzten Ziel.' },
  { id: 'verbund', group: 'Anzeigen', label: 'Verbundauftrag', code: 'KeyJ', letter: 'J', hint: 'Auftrag', help: 'Auftragsblatt der Verbundaufgabe (nur in einer Klasse).' },
  { id: 'help', group: 'Anzeigen', label: 'Hilfe', code: 'KeyH', hint: 'Hilfe', help: 'Kurze Anleitungen zum Spiel.' },
  { id: 'hints', group: 'Anzeigen', label: 'Tastenhinweise', code: 'KeyK', hint: 'Hinweise aus', help: 'Die Leiste unten ein- und ausblenden.' },
];
const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));
const BY_LETTER = new Map(ACTIONS.filter((a) => a.letter).map((a) => [a.letter, a.id]));

/** ratio: Anteil der Bildpunkte, cap: hoechste Pixeldichte, aa: Kantenglaettung (nur beim Laden waehlbar) */
export const QUALITY = {
  niedrig: { cap: 1, ratio: 0.7, aa: false, label: 'Niedrig', help: 'Für schwache Geräte: weniger Bildpunkte, keine Kantenglättung. Schrift im Raum ist etwas unschärfer.' },
  mittel: { cap: 1, ratio: 1, aa: true, label: 'Mittel', help: 'Ein Bildpunkt je Bildschirmpunkt.' },
  hoch: { cap: 1.5, ratio: 1, aa: true, label: 'Hoch', help: 'Schärfer auf hochauflösenden Bildschirmen. Braucht eine gute Grafikkarte.' },
};
export const pixelRatio = (quality, dpr) => Math.min(dpr || 1, QUALITY[quality].cap) * QUALITY[quality].ratio;

/** linke und rechte Umschalttaste gelten als dieselbe Taste */
export const normCode = (code) => (code === 'ShiftRight' ? 'ShiftLeft' : code);
/** Strg/Alt/Meta wuerden Browser-Befehle ausloesen (Strg+W), 1-9 waehlen die Hand, Esc gehoert dem Menue */
export const assignable = (code) => /^(Key[A-Z]|Shift(Left|Right)|Space|Enter|Backspace|Arrow(Up|Down|Left|Right)|Digit0|Numpad\w+|Minus|Equal|Bracket(Left|Right)|Semicolon|Quote|Backquote|Backslash|IntlBackslash|Comma|Period|Slash)$/.test(code);

const NAMES = { ShiftLeft: 'Shift', Space: 'Leertaste', Enter: 'Enter', Backspace: 'Rücktaste', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };

/** localStorage kann schon beim Zugriff werfen (gesperrte Websitedaten) */
export function safeStorage() { try { return globalThis.localStorage ?? null; } catch { return null; } }

export class Settings {
  constructor(storage = safeStorage(), onChange = () => {}) {
    this.storage = storage;
    this.onChange = onChange;
    this.layout = null; // echte Beschriftung der Tastatur (z.B. Schweiz: KeyY -> z)
    let s = null;
    try { s = JSON.parse(storage?.getItem(KEY) ?? 'null'); } catch { /* privat oder kaputt */ }
    this.hints = s?.hints !== false;
    this.fps = s?.fps === true;
    this.quality = Object.hasOwn(QUALITY, s?.quality ?? '') ? s.quality : 'hoch';
    this.keys = {};
    const used = new Set();
    const want = s?.keys && typeof s.keys === 'object' ? s.keys : {};
    const valid = (c) => typeof c === 'string' && assignable(c) && normCode(c) === c;
    if (ACTIONS.every((a) => { const c = want[a.id] ?? a.code; const ok = valid(c) && !used.has(c); used.add(c); return ok; })) {
      for (const a of ACTIONS) this.keys[a.id] = want[a.id] ?? a.code;
    } else this.resetKeys(false); // doppelt belegt oder unbekannt: lieber Standard als eine tote Taste
  }

  save() {
    const keys = Object.fromEntries(ACTIONS.filter((a) => this.keys[a.id] !== a.code).map((a) => [a.id, this.keys[a.id]]));
    try { this.storage?.setItem(KEY, JSON.stringify({ hints: this.hints, fps: this.fps, quality: this.quality, keys })); } catch { /* privat */ }
    this.onChange();
  }
  set(name, value) { this[name] = value; this.save(); }
  resetKeys(save = true) { for (const a of ACTIONS) this.keys[a.id] = a.code; if (save) this.save(); }

  /** Taste neu belegen -> { ok, swapped? } ; eine schon benutzte Taste wird getauscht, damit keine Aktion ohne Taste bleibt */
  bind(id, rawCode) {
    if (!assignable(rawCode)) return { ok: false };
    const code = normCode(rawCode);
    const other = ACTIONS.find((a) => a.id !== id && this.keys[a.id] === code);
    if (other) this.keys[other.id] = this.keys[id];
    this.keys[id] = code;
    this.save();
    return { ok: true, swapped: other?.label ?? null };
  }
  actionOf(code) { const c = normCode(code); return ACTIONS.find((a) => this.keys[a.id] === c)?.id ?? null; }

  /** Beschriftung einer Taste */
  codeLabel(code) {
    if (NAMES[code]) return NAMES[code];
    const l = this.layout?.get?.(code);
    if (l) return l.length === 1 ? l.toUpperCase() : l;
    return code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ');
  }
  key(id) { return this.codeLabel(this.keys[id]); }
  get changed() { return ACTIONS.some((a) => this.keys[a.id] !== a.code) || !!this.layout; }

  /** «{shop}» -> Taste */
  fill(text) { return String(text).replace(/\{(\w+)\}/g, (m, id) => (BY_ID.has(id) ? this.key(id) : m)); }
  /** aeltere Texte mit festen Buchstaben: «(B)», «E/Klick», «oder I)», «Taste J» */
  legacy(text) {
    const k = (l) => (BY_LETTER.has(l) ? this.key(BY_LETTER.get(l)) : l);
    return String(text).replace(/\(([A-Z])\)/g, (m, l) => (BY_LETTER.has(l) ? `(${k(l)})` : m)).replace(/\bE\/Klick/g, `${k('E')}/Klick`)
      .replace(/oder I\)/g, `oder ${k('I')})`).replace(/Taste ([A-Z])\b/g, (m, l) => `Taste ${k(l)}`).replace(/\bR baut wieder aus/g, `${k('R')} baut wieder aus`)
      .replace(/\(E auf/g, `(${k('E')} auf`);
  }
}
