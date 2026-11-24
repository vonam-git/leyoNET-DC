// Spielstand = Protokoll der Spielschritte (wie beim Nachspielen auf dem Server). Beim Oeffnen spielt der Kern es wieder ein.
// In einer Klasse liegt er auf dem Server; ohne Klasse oder wenn er zu gross ist, wird er heruntergeladen. Ohne DOM (check-save.ts).
export const FORMAT = 'leyonet-dc-save';
export const MAX_STEPS = 20_000;
export const MAX_FILE = 8 * 1024 * 1024;

/** Kennzahlen zum Vergleich nach dem Oeffnen (andere Spielversion?) */
export const markOf = (st) => ({ devices: st?.devices?.length ?? 0, links: st?.links?.length ?? 0, budget: st?.budget ?? 0 });

export function buildSave({ version, level, ready, intents, state, ms = 0, player = null, now = new Date() }) {
  return { format: FORMAT, v: 1, game: version, level, ready: !!ready, saved: now.toISOString(), ms: Math.round(ms), player, mark: markOf(state), intents };
}
export const saveSize = (save) => new TextEncoder().encode(JSON.stringify(save)).length;
export const sizeText = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

const pad = (n) => String(n).padStart(2, '0');
export function saveName(save) {
  const d = new Date(save.saved);
  return `leyonet-dc_${save.level}_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}
export function saveDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(+d) ? '' : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Text einer Datei -> { save } oder { error }. Alles wird geprueft: Die Datei kann von irgendwem stammen. */
export function parseSave(text, levelIds) {
  if (text.length > MAX_FILE) return { error: 'Die Datei ist zu gross für einen Spielstand.' };
  let s;
  try { s = JSON.parse(text); } catch { return { error: 'Das ist keine Spielstand-Datei.' }; }
  return checkSave(s, levelIds);
}
export function checkSave(s, levelIds) {
  if (!s || typeof s !== 'object' || s.format !== FORMAT) return { error: 'Das ist kein Spielstand von leyoNET DC.' };
  if (s.v !== 1) return { error: 'Dieser Spielstand stammt aus einer neueren Version.' };
  if (!levelIds.includes(s.level)) return { error: 'Dieses Level gibt es hier nicht.' };
  if (!Array.isArray(s.intents) || s.intents.length > MAX_STEPS
    || s.intents.some((i) => !i || typeof i !== 'object' || Array.isArray(i) || typeof i.action !== 'string' || i.action.length > 40 || i.action === 'hello')) return { error: 'Der Spielstand ist beschädigt.' };
  const num = (v) => (Number.isFinite(v) ? v : 0);
  return { save: { format: FORMAT, v: 1, game: /^[0-9.]{1,16}$/.test(s.game) ? s.game : '?', level: s.level, ready: s.ready === true,
    saved: typeof s.saved === 'string' ? s.saved.slice(0, 30) : '', ms: Math.max(0, num(s.ms)),
    player: Array.isArray(s.player) && s.player.length === 4 && s.player.every(Number.isFinite) ? s.player : null,
    mark: { devices: num(s.mark?.devices), links: num(s.mark?.links), budget: num(s.mark?.budget) }, intents: s.intents } };
}

/** Nach dem Oeffnen: null = alles da, sonst Hinweis */
export function compareMark(save, state) {
  const now = markOf(state);
  const d = save.mark.devices - now.devices, l = save.mark.links - now.links;
  if (!d && !l && Math.abs(save.mark.budget - now.budget) < 0.01) return null;
  return `Spielstand aus Version ${save.game}: nicht alles liess sich wiederherstellen${d > 0 ? ` (${d} Geräte fehlen)` : l > 0 ? ` (${l} Kabel fehlen)` : ''}.`;
}
