// EmbeddedKern gegen den echten leyoNET-Kern (vendor/leyonet): Link-LEDs, Dosen, Ping-Ziel, Konsole.
// Start: npx tsx scripts/check-embedded.ts
import { readFileSync } from 'node:fs';
import { EmbeddedKern } from '../src/embedded-kern.js';
import { reduceState } from '../src/kern.js';

let ok = true;
const check = (name: string, cond: boolean, extra = '') => { ok &&= cond; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name} ${extra}`); };
const manifest = JSON.parse(readFileSync(new URL('./fixtures/test_room.manifest.json', import.meta.url), 'utf8'));
const scenario = {
  id: 'test', modus: 'sandbox',
  dosen: {
    'pp1/07': { name: 'AP07', type: 'pc', ip: '192.168.1.107', mask: '255.255.255.0' },
    'pp1/13': { name: 'AP13', type: 'pc', ip: '192.168.1.113', mask: '255.255.255.0' },
  },
  ziele: [{ id: 'g1', typ: 'core', text: 'AP07 erreicht AP13', check: { type: 'ping', from: 'AP07', to: 'AP13' } }],
};
const k = new EmbeddedKern({ manifest, scenario });
let st: any = null;
k.onMessage((m: any) => { st = reduceState(st, m); });
const send = (i: any) => k.send(i) as Promise<any>;
let r = await send({ action: 'hello' });
await Promise.resolve();
check('hello: 3 Switches (inkl. Core) + 3 Notebooks im Kern, alle Port-LEDs aus', r.type === 'ack' && [...k.coreId.keys()].filter((x) => /^(sw|cs)/.test(x)).length === 3 && [...k.coreId.keys()].filter((x) => x.startsWith('nb')).length === 3 && Object.entries(st.leds).filter(([l]) => /\/led_p\d\d$/.test(l)).every(([, v]) => v === 'off'),
  `(${[...k.coreId].map(([a, b]) => `${a}=${b}`).join(' ')})`);
const cab = { length: 0.5, color: '#1f5fd1' };
r = await send({ action: 'link', from: 'sw1/07', to: 'pp1/07', cable: cab });
check('sw1/07 -> Dose 07 (AP07 dahinter): Link-LED on aus dem Kern', r.type === 'ack' && st.leds['sw1/led_p07'] === 'on');
r = await send({ action: 'link', from: 'sw1/09', to: 'pp1/09', cable: cab });
check('Dose 09 ohne Endgeraet: Kabel liegt, LED aus', r.type === 'ack' && st.links.length === 2 && st.leds['sw1/led_p09'] === 'off');
r = await send({ action: 'link', from: 'sw2/03', to: 'pp1/13', cable: cab });
check('AP13 an anderem Switch (kein Uplink): Ping-Ziel offen', r.type === 'ack' && st.goals[0].done === false, `(${st.goals[0].reason})`);
await send({ action: 'unlink', port: 'pp1/13' });
r = await send({ action: 'link', from: 'sw1/05', to: 'pp1/13', cable: cab });
check('AP13 an sw1: Ping AP07 -> AP13 erfuellt (leyoNET-Simulation)', r.type === 'ack' && st.goals[0].done === true);

// Konsole
r = await send({ action: 'console_open', device: 'sw1' });
const sid = r.session;
check('Konsole sw1 offen', r.type === 'ack' && r.prompt === 'sw1>', `(${r.prompt})`);
for (const line of ['enable', 'configure terminal', 'interface port7']) r = await send({ action: 'console', session: sid, line });
check('Prompt im Interface-Modus', r.prompt === 'sw1(config-if)#', `(${r.prompt})`);
r = await send({ action: 'console', session: sid, line: 'shutdown' });
check('shutdown auf port7 -> LED p07 aus, Ping-Ziel offen (Delta)', st.leds['sw1/led_p07'] === 'off' && st.goals[0].done === false);
r = await send({ action: 'console', session: sid, line: 'no shutdown' });
check('no shutdown -> LED p07 an, Ping wieder ok', st.leds['sw1/led_p07'] === 'on' && st.goals[0].done === true);
r = await send({ action: 'console_complete', session: sid, line: 'shut' });
check('Tab: console_complete ergaenzt eindeutige Woerter', r.line === 'shutdown ', `(${JSON.stringify(r.line)})`);
r = await send({ action: 'console', session: sid, line: 'do show interfaces status' });
check('do show interfaces status liefert Ausgabe', r.lines.length > 3, `(${r.lines.length} Zeilen, z.B. ${JSON.stringify(r.lines[1])})`);

// Grenzen
r = await send({ action: 'link', from: 'sw1/25', to: 'sw2/25', cable: cab });
check('SFP ohne Modul -> reject vom leyoNET-Kern', r.type === 'reject', `(${r.reason})`);
r = await send({ action: 'link', from: 'sw1/con', to: 'sw2/con', cable: cab });
check('Konsolport -> reject', r.type === 'reject', `(${r.reason})`);
r = await send({ action: 'link', from: 'sw1/mgmt', to: 'pp1/20', cable: cab });
check('MGMT -> reject mit Hinweis', r.type === 'reject' && /SSH/.test(r.reason), `(${r.reason})`);
r = await send({ action: 'unlink', port: 'sw1/07' });
check('unlink -> leyoNET-Kabel weg, LED aus, Ping offen', r.type === 'ack' && st.leds['sw1/led_p07'] === 'off' && !st.goals[0].done
  && k.t.cables.length === 1, `(${k.t.cables.length} Kabel im Kern)`);
process.exit(ok ? 0 : 1);
