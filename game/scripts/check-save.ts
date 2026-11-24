// Spielstaende, Einstellungen und Zugangscode (2026-11-24). Start: npx tsx scripts/check-save.ts
import { readFileSync } from 'node:fs';
import { EmbeddedKern } from '../src/embedded-kern.js';
import { LEVELS, readyScenario } from '../src/levels.js';
import { reduceState } from '../src/kern.js';
import { buildSave, checkSave, compareMark, parseSave, saveName, saveSize } from '../src/saves.js';
import { ACTIONS, assignable, pixelRatio, Settings } from '../src/settings.js';
import { derive, needsCode, Unlock } from '../src/freischaltung.js';
import { HILFE, WILLKOMMEN } from '../src/hilfe.js';

let ok = true;
const check = (name: string, cond: boolean, extra = '') => { ok &&= cond; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name} ${extra}`); };
const json = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const manifest = json('../../assets/out/room_v3.manifest.json');
const kit = json('../../assets/out/kit.kit.json');
const ids = LEVELS.map((l: any) => l.id);
const mem = (init: Record<string, string> = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

// ---- Spielstand: L7 bis mitten in die Konfiguration, speichern, laden, vergleichen
const lv: any = LEVELS.find((l: any) => l.id === 'L7');
const start = async () => { const k: any = new EmbeddedKern({ manifest, scenario: readyScenario(lv), kit }); await k.send({ action: 'hello' }); return k; };
const a = await start();
const log: any[] = [];
const send = async (i: any) => { log.push(structuredClone(i)); return a.send(i); };
for (const i of [{ action: 'link', from: 'pdu1/01', to: 'cs1/psu', cable: { item: 'strom-c13-2.0' } }, { action: 'link', from: 'pdu1/02', to: 'kvm1/psu', cable: { item: 'strom-c13-2.0' } },
  { action: 'power', device: 'nb1', on: true }, { action: 'set_ip', device: 'nb1', ip: '192.168.10.10', mask: '255.255.255.0', gateway: '192.168.10.1' },
  { action: 'link', from: 'nb1/01', to: 'cs1/01', cable: { item: 'patch-cat6-5.0-grau' } }, { action: 'link', from: 'x/1', to: 'y/2' }]) await send(i);
let r: any = await send({ action: 'console_open', device: 'cs1', from: 'kvm1' });
for (const line of ['enable', 'configure terminal', 'vlan 10', 'interface vlan 10', 'ip address 192.168.10.1 255.255.255.0', 'exit']) await send({ action: 'console', session: r.session, line });
const sa = a.state();
const save = buildSave({ version: '0.0.13', level: 'L7', ready: true, intents: log, state: sa, ms: 1234.6, player: [1, -2, 0, 0] });
const back: any = parseSave(JSON.stringify(save), ids);
check('Spielstand lesen', !back.error && back.save.intents.length === log.length, back.error);
const b = await start();
await b.resume(back.save.intents);
const sb = b.state();
const strip = (s: any) => JSON.stringify({ ...s, rev: 0 });
check('geladen = gespeichert (Geräte, Kabel, LEDs, Ziele, Adressen)', strip(sa) === strip(sb) && sb.goals.some((g: any) => g.done));
check('Konfiguration bleibt', JSON.stringify(a.t) === JSON.stringify(b.t));
check('Vergleich stimmt', compareMark(back.save, sb) === null);
check('Vergleich meldet Fehlendes', /2 Kabel/.test(compareMark({ ...back.save, mark: { ...back.save.mark, links: sb.links.length + 2 } }, sb) ?? ''));
let st: any = null;
b.onMessage((m: any) => { st = reduceState(st, m); });
check('nach dem Laden geht es weiter', (await b.send({ action: 'unlink', port: 'nb1/01' })).type === 'ack' && st.links.length === sb.links.length - 1);
check('Dateiname', /^leyonet-dc_L7_\d{4}-\d\d-\d\d_\d{4}\.json$/.test(saveName(save)), `${saveName(save)} ${saveSize(save)} Bytes`);
for (const [n, t] of [['kein JSON', 'x'], ['fremdes JSON', '{"a":1}'], ['anderes Level', JSON.stringify({ ...save, level: 'ZZ' })], ['Schritte kaputt', JSON.stringify({ ...save, intents: [null] })],
  ['hello im Protokoll', JSON.stringify({ ...save, intents: [{ action: 'hello' }] })], ['neuere Version', JSON.stringify({ ...save, v: 2 })], ['zu gross', ' '.repeat(9 * 1024 * 1024)]] as const) check(`abgelehnt: ${n}`, !!(parseSave(t, ids) as any).error);
check('Unsinn bei Position/Version wird verworfen', (checkSave({ ...save, player: [1, 'x', 0, 0], game: '<b>' }, ids) as any).save.player === null);
// grosser Spielstand: wie lange dauert das Laden?
const big = await start();
const many = [...log];
for (let i = 0; i < 1000; i++) many.push({ action: 'link', from: 'nb2/01', to: 'cs1/02', cable: { item: 'patch-cat6-5.0-grau' } }, { action: 'unlink', port: 'nb2/01' });
const t0 = Date.now();
await big.resume(many);
check('2000 Schritte laden unter 10 s', Date.now() - t0 < 10_000, `${Date.now() - t0} ms, ${Math.round(saveSize(buildSave({ version: '1', level: 'L7', ready: true, intents: many, state: big.state() })) / 1024)} KB`);

// ---- Einstellungen
const store = mem();
const s = new Settings(store as any);
check('Standard', s.hints && !s.fps && s.quality === 'hoch' && s.key('use') === 'E');
check('alle Standardtasten erlaubt und eindeutig', ACTIONS.every((x) => assignable(x.code)) && new Set(ACTIONS.map((x) => x.code)).size === ACTIONS.length);
check('tauschen statt doppelt', s.bind('use', 'KeyF').ok && s.bind('shop', 'KeyF').swapped === 'Benutzen' && s.key('shop') === 'F' && s.key('use') === 'B');
check('verboten: Strg, Esc, Ziffern, Tab, F-Tasten', !['ControlLeft', 'AltLeft', 'MetaLeft', 'Escape', 'Digit1', 'Tab', 'F5'].some((c) => s.bind('use', c).ok));
check('Shift rechts = Shift links', s.actionOf('ShiftRight') === 'run');
check('bleibt gespeichert', new Settings(store as any).key('shop') === 'F');
check('Texte folgen der Belegung', s.legacy('Shop (B), E/Klick, Taste J, R baut wieder aus') === 'Shop (F), B/Klick, Taste J, R baut wieder aus' && s.fill('{shop} {x}') === 'F {x}', s.legacy('Shop (B), E/Klick'));
check('doppelte Belegung im Speicher -> Standard', new Settings(mem({ 'leyonet-dc.settings': '{"keys":{"use":"KeyW"}}' }) as any).key('use') === 'E');
check('kaputter Speicher -> Standard', new Settings(mem({ 'leyonet-dc.settings': '{' }) as any).quality === 'hoch' && new Settings(null as any).key('use') === 'E');
check('niedrig rechnet weniger Bildpunkte', pixelRatio('niedrig', 2) < pixelRatio('mittel', 2) && pixelRatio('mittel', 2) < pixelRatio('hoch', 2));
const texts = JSON.stringify([WILLKOMMEN, HILFE]);
const tokens = [...texts.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((t) => !ACTIONS.some((x) => x.id === t));
check('Hilfetexte: alle Tasten bekannt', tokens.length === 0, tokens.join(','));

// ---- Zugangscode
check('Code nötig: nur Levels ohne Budgetgrenze', LEVELS.filter((l: any) => needsCode(l)).map((l: any) => l.id).join() === 'SB,DEMO');
const codes = [{ id: 'mark', salt: 's1', hash: await derive('TESTT-TESTT-11111', 's1') }, { id: 'weitergabe', salt: 's2', hash: await derive('TESTT-TESTT-22222', 's2') }];
const us = mem();
const u = new Unlock(codes, us as any);
const sb1 = LEVELS.find((l: any) => l.id === 'SB');
check('zu Beginn gesperrt, L1 offen', !u.open(sb1) && u.open(LEVELS[0]));
check('falscher Code', !!(await u.enter('FALSCH-FALSCH-1')) && !u.open(sb1));
check('zweiter Code gilt (klein, ohne Striche)', (await u.enter('testt testt22222')) === null && u.open(sb1));
check('bleibt frei nach Neuladen', new Unlock(codes, us as any).open(sb1));
check('ausgetauschter Code sperrt wieder', !new Unlock([codes[0]], us as any).open(sb1));
const real = json('../src/freischaltung.json');
check('zwei Prüfsummen hinterlegt, kein Klartext', real.length === 2 && real.every((c: any) => /^[0-9a-f]{64}$/.test(c.hash) && c.salt.length === 16 && Object.keys(c).join() === 'id,salt,hash'));
if (!ok) process.exit(1);
