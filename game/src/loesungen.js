// Musterloesungen der Verbundaufgaben: Der Inhalt ist nicht oeffentlich (loesungen.json, docs/VERBUND.md). Hier steht nur, wie eine
// Vorlage fuer einen Platz ausgefuellt wird ({wan}, {gw}, {pub}, {pubNet}, {as}, {pw}, {lan:10}) und wie man sie im Spiel ausfuehren wuerde.
// Nur Server und Tests, nie im Spiel-Bundle.
import { seatPlan } from './verbund.js';

const RACK = 'rack_8';
const KONSOLKABEL = 'konsolkabel-usb-3.0';
function fill(v, p) {
  if (typeof v === 'string') return v.replace(/\{(\w+)(?::(\d+))?\}/g, (m, k, n) => (k === 'lan' ? p.lan(Number(n)) : k in p ? String(p[k]) : m));
  if (Array.isArray(v)) return v.map((x) => fill(x, p));
  return v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, p)])) : v;
}

/** data: { V1: { einbau: [[artikel, HE | 'nb']], kabel: [[a, b, artikel]], cli: { geraet: [zeilen] }, sfp?, nb?, ssh? }, ... } */
export function createLoesungen(data) {
  const loesung = (id, seat) => {
    if (!data || !Object.hasOwn(data, id)) return null;
    return fill(data[id], seatPlan(seat));
  };
  /** Absichten in der Reihenfolge, in der man sie im Spiel ausfuehren wuerde (Tests) */
  const loesungIntents = (id, seat) => {
    const l = loesung(id, seat);
    const out = [];
    const need = new Map([['rack-42he', 1]]);
    const plus = (i) => need.set(i, (need.get(i) ?? 0) + 1);
    l.einbau.forEach(([i]) => plus(i));
    l.kabel.forEach(([, , i]) => plus(i));
    (l.sfp ?? []).forEach(([, i]) => plus(i));
    plus(KONSOLKABEL);
    for (const [item, qty] of need) out.push({ action: 'buy', item, qty });
    out.push({ action: 'install', item: 'rack-42he', slot: 'slot_rack_8' });
    for (const [item, u] of l.einbau) out.push(u === 'nb' ? { action: 'install', item, slot: 'slot_nb_1' } : { action: 'install', item, rack: RACK, u });
    out.push({ action: 'power', device: 'nb1', on: true });
    for (const [port, item] of l.sfp ?? []) out.push({ action: 'sfp_insert', port, item });
    for (const [from, to, item] of l.kabel) out.push({ action: 'link', from, to, cable: { item } });
    let s = 1;
    for (const [dev, lines] of Object.entries(l.cli)) {
      out.push({ action: 'link', from: 'nb1/con', to: `${dev}/con`, cable: { item: KONSOLKABEL } }, { action: 'console_open', device: dev, from: 'nb1' });
      for (const line of lines) out.push({ action: 'console', session: `S${s}`, line });
      out.push({ action: 'unlink', port: 'nb1/con' });
      s++;
    }
    if (l.nb) out.push({ action: 'set_ip', device: 'nb1', ...l.nb });
    if (l.ssh) out.push({ action: 'ssh', from: 'nb1', target: l.ssh[0], user: 'admin', password: l.ssh[1] });
    return out;
  };
  return { loesung, loesungIntents };
}
