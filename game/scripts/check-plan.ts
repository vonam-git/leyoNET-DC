// Netzplan (Plan v4 C): Modell aus dem Kern-Zustand - Geraete, Kabelarten, Status, Dosen, Trunk, Strom, Layout.
import { readFileSync } from 'node:fs';
import { EmbeddedKern } from '../src/embedded-kern.js';
import { reduceState } from '../src/kern.js';
import { LEVELS } from '../src/levels.js';
import { fitView, planModel } from '../src/netplan.js';

const load = (p: string) => JSON.parse(readFileSync(new URL(`../../assets/out/${p}`, import.meta.url), 'utf8'));
const manifest = load('room_v3.manifest.json');
const kit = load('kit.kit.json');
let ok = true;
const check = (name: string, pass: boolean, info: any = '') => { ok &&= pass; console.log(`${pass ? 'OK  ' : 'FAIL'} ${name}`, info); };

async function start(id: string) {
  const level = LEVELS.find((l: any) => l.id === id)!;
  const kern: any = new EmbeddedKern({ manifest, scenario: level.scenario, kit });
  const ctx: any = { st: null, send: (i: any) => kern.send(i) };
  kern.onMessage((m: any) => { ctx.st = reduceState(ctx.st, m); });
  await ctx.send({ action: 'hello' });
  await Promise.resolve();
  return ctx;
}
{
  const c = await start('SB');
  check('leer: kein Geraet', planModel(c.st).nodes.length === 0);
  const katalog = LEVELS.find((l: any) => l.id === 'SB')!.scenario.hardware_katalog;
  const item = (re: RegExp) => katalog.find((k: any) => re.test(k.item)).item;
  for (const [re, qty] of [[/^rack/, 1], [/^switch/, 1], [/^patchpanel/, 1], [/^notebook/, 1], [/^strom/, 2], [/^patch-cat6-5/, 2], [/^konsol/, 1]] as const) {
    await c.send({ action: 'buy', item: item(re), qty });
  }
  await c.send({ action: 'install', item: item(/^rack/), slot: 'slot_rack_8' });
  await c.send({ action: 'install', item: item(/^switch/), rack: 'rack_8', u: 41 });
  await c.send({ action: 'install', item: item(/^patchpanel/), rack: 'rack_8', u: 42 });
  await c.send({ action: 'install', item: item(/^notebook/), slot: 'slot_nb_1' });
  let p = planModel(c.st);
  check('Geraete ohne PDU', p.nodes.map((n: any) => n.id).sort().join() === 'nb1,pp1,sw1', p.nodes.map((n: any) => n.id));
  check('Switch ohne Strom', p.nodes.find((n: any) => n.id === 'sw1')?.on === false);
  let r = await c.send({ action: 'link', from: 'nb1/01', to: 'sw1/01', cable: { item: item(/^patch-cat6-5/) } });
  p = planModel(c.st);
  const e = p.edges.find((x: any) => x.kind === 'copper');
  check('Kabel NB1-SW1 gezeichnet, Link unten', r.type === 'ack' && !!e && e.n === 1 && e.up === 0, r.reason ?? '');
  await c.send({ action: 'link', from: 'sw1/psu', to: 'pdu1/01', cable: { item: item(/^strom/) } });
  await c.send({ action: 'power', device: 'nb1', on: true });
  p = planModel(c.st);
  check('mit Strom: Link oben', p.edges.find((x: any) => x.kind === 'copper')?.up === 1);
  check('Ports am Kabel', JSON.stringify(p.edges.map((x: any) => [x.a, x.pa, x.b, x.pb])) === '[["nb1","01","sw1","01"]]');
  await c.send({ action: 'set_ip', device: 'nb1', ip: '192.168.1.10', mask: '255.255.255.0' });
  check('IP am Notebook', planModel(c.st).nodes.find((n: any) => n.id === 'nb1')?.sub === '192.168.1.10');
  const pw = planModel(c.st, { power: true });
  check('Strom einblendbar', pw.nodes.some((n: any) => n.id === 'pdu1') && pw.edges.some((x: any) => x.kind === 'power'));
  const dose = Object.keys(c.st.plan.dosen)[0];
  r = await c.send({ action: 'link', from: 'sw1/02', to: dose, cable: { item: item(/^patch-cat6-5/) } });
  p = planModel(c.st);
  check('Endgeraet hinter der Dose', r.type === 'ack' && p.nodes.some((n: any) => n.id === `dose:${dose}` && n.label), r.reason ?? dose);
  const y = (id: string) => p.nodes.find((n: any) => n.id === id)!.y;
  check('Ebenen: Switch ueber Patchpanel ueber Notebook', y('sw1') < y('pp1') && y('pp1') < y('nb1'));
  await c.send({ action: 'unlink', port: 'nb1/01' });
  check('Kabel gezogen: Verbindung weg', !planModel(c.st).edges.some((x: any) => x.a === 'nb1'));
}
{
  const c = await start('DEMO');
  const p = planModel(c.st);
  const keys = new Set(p.nodes.map((n: any) => `${n.x}|${n.y}`));
  check('Demo-RZ: keine Ueberlappung', keys.size === p.nodes.length && p.nodes.length > 20, `${p.nodes.length} Geraete, ${p.edges.length} Verbindungen`);
  const v = fitView(p, 1600, 824);
  check('Demo-RZ passt auf die Wand', p.nodes.every((n: any) => Math.abs((n.x - v.x) * v.s) < 800 && Math.abs((n.y - v.y) * v.s) < 412), `Massstab ${v.s.toFixed(2)}`);
}
process.exit(ok ? 0 : 1);
