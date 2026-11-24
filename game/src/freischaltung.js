// Freies Bauen (unbegrenztes Budget) braucht einen Zugangscode (User 2026-11-24). Im Quelltext stehen nur gesalzene Pruefsummen
// (freischaltung.json, erzeugt von scripts/freischalt-codes.mjs). Es ist eine Tuer, kein Tresor: Das Spiel laeuft im Browser und ist
// quelloffen, wer den Code aendert, kommt daran vorbei.
import { safeStorage } from './settings.js';
import codes from './freischaltung.json' with { type: 'json' };

const KEY = 'leyonet-dc.frei';
export const ITERATIONS = 200_000;
export const MIN_LENGTH = 10;
export const normCode = (v) => String(v ?? '').normalize('NFKC').toUpperCase().replace(/[\s-]/g, '');

export async function derive(code, salt, iterations = ITERATIONS) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(normCode(code)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations }, k, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const needsCode = (level) => !level?.verbund && level?.scenario?.budget === null;

export class Unlock {
  constructor(list = codes, storage = safeStorage()) { this.list = list; this.storage = storage; }
  /** frei, solange der eingegebene Code noch gilt (ein ausgetauschter Code sperrt wieder) */
  get unlocked() {
    try { const h = this.storage?.getItem(KEY); return !!h && this.list.some((c) => c.hash === h); } catch { return this.session ?? false; }
  }
  open(level) { return !needsCode(level) || this.unlocked || !!this.session; }
  /** -> null oder Fehlertext */
  async enter(code) {
    if (normCode(code).length < MIN_LENGTH) return 'Dieser Code ist zu kurz.';
    if (!globalThis.crypto?.subtle) return 'Die Prüfung braucht eine sichere Verbindung (https).';
    for (const c of this.list) {
      if (await derive(code, c.salt) !== c.hash) continue;
      this.session = true; // auch ohne Speicher (privates Fenster) bis zum Neuladen
      try { this.storage?.setItem(KEY, c.hash); } catch { /* privat */ }
      return null;
    }
    return 'Dieser Code stimmt nicht.';
  }
}
