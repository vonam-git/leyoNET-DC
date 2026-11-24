// Plan v3: Einbau/Ausbau zur Laufzeit (Intents install/uninstall) gegen den echten leyoNET-Kern.
// Start: npx tsx scripts/check-install.ts
import { readFileSync } from 'node:fs';
import { EmbeddedKern } from '../src/embedded-kern.js';
import { LEVELS, readyScenario } from '../src/levels.js';
import { reduceState } from '../src/kern.js';

let ok = true;
const check = (name: string, cond: boolean, extra = '') => { ok &&= cond; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name} ${extra}`); };
const kit = JSON.parse(readFileSync(new URL('../../assets/out/kit.kit.json', import.meta.url), 'utf8'));
const manifest = {
  room: 'test', version: 3, devices: [],
  slots: [
    { node: 'slot_rack_1', kind: 'rack', index: 1, row: 'A', pos: [1.9, 0, -2], yaw: Math.PI },
    { node: 'slot_rack_2', kind: 'rack', index: 2, row: 'A', pos: [2.5, 0, -2], yaw: Math.PI },
    { node: 'slot_nb_1', kind: 'notebook', index: 1, pos: [5.9, 0.74, -5.1], yaw: 0 },
    { node: 'slot_nb_2', kind: 'notebook', index: 2, pos: [6.4, 0.74, -5.1], yaw: 0 },
  ],
};
const KAT = [
  { item: 'rack-42he', typ: 'rack', vorlage: 'kit_rack', name: 'Rack 42 HE', preis: 900 },
  { item: 'switch-24', typ: 'geraet', vorlage: 'kit_switch', name: 'Switch 24 Port', preis: 300 },
  { item: 'patchpanel-24', typ: 'geraet', vorlage: 'kit_patchpanel', name: 'Patchpanel 24', preis: 60 },
  { item: 'notebook', typ: 'notebook', vorlage: 'kit_notebook', name: 'Notebook', preis: 700 },
  { item: 'blank-1u', typ: 'geraet', vorlage: 'kit_blank_1u', name: 'Blindplatte 1 HE', preis: 5 },
  { item: 'patch-0.5', typ: 'patchkabel', klasse: 'copper', laenge: 0.5, farbe: '#2f6fdb', name: 'Patch 0.5 m', preis: 4 },
  { item: 'patch-3', typ: 'patchkabel', klasse: 'copper', laenge: 3, farbe: '#2f6fdb', name: 'Patch 3 m', preis: 6 },
  { item: 'strom', typ: 'stromkabel', klasse: 'power', laenge: 2, farbe: '#202225', name: 'Strom', preis: 8 },
];
const scenario = { id: 'install', modus: 'katalog', budget: 3000, hardware_katalog: KAT, inventar: {}, ziele: [
  { id: 'p', typ: 'core', text: 'NB1 -> NB2', check: { type: 'ping', from: 'nb1', to: '10.0.0.2' } }] };
const k = new EmbeddedKern({ manifest, scenario, kit });
let st: any = null;
k.onMessage((m: any) => { st = reduceState(st, m); });
const send = (i: any) => k.send(i) as Promise<any>;
await send({ action: 'hello' });
await Promise.resolve();
check('leerer Raum: keine Geraete', st.devices.length === 0 && st.placed.length === 0);

let r = await send({ action: 'install', item: 'rack-42he', slot: 'slot_rack_1' });
check('Rack ohne Kauf abgelehnt', r.type === 'reject' && r.code === 'budget', r.reason);
for (const [item, qty] of [['rack-42he', 1], ['switch-24', 1], ['notebook', 2], ['patch-3', 2], ['strom', 1], ['blank-1u', 1]] as const) {
  await send({ action: 'buy', item, qty });
}
check('Budget abgezogen', Math.abs(st.budget - (3000 - 900 - 300 - 1400 - 12 - 8 - 5)) < 1e-6, `CHF ${st.budget}`);
r = await send({ action: 'install', item: 'rack-42he', slot: 'slot_rack_1' });
check('Rack auf Platz 1', r.type === 'ack' && r.node === 'rack_1' && st.placed[0]?.node === 'rack_1'
  && st.devices.filter((d: any) => d.id.startsWith('pdu')).length === 2, JSON.stringify(st.devices.map((d: any) => [d.id, d.node])));
r = await send({ action: 'install', item: 'rack-42he', slot: 'slot_rack_1' });
check('zweites Rack: Inventar leer', r.type === 'reject');
r = await send({ action: 'install', item: 'switch-24', rack: 'rack_1', u: 41 });
check('Switch in HE 41 -> sw1', r.type === 'ack' && r.node === 'r1_switch_U41' && r.ids[0] === 'sw1'
  && Object.keys(st.devices.find((d: any) => d.id === 'sw1').ports).length === 31);
check('Switch ohne Strom', st.power.sw1 === 'off', JSON.stringify(st.power));
r = await send({ action: 'install', item: 'blank-1u', rack: 'rack_1', u: 41 });
check('HE belegt abgelehnt', r.type === 'reject' && r.code === 'occupied', r.reason);
r = await send({ action: 'install', item: 'blank-1u', rack: 'rack_1', u: 43 });
check('HE ausserhalb abgelehnt', r.type === 'reject', r.reason);
r = await send({ action: 'install', item: 'blank-1u', rack: 'rack_1', u: 40 });
check('Blindplatte HE 40 (kein Kern-Geraet)', r.type === 'ack' && r.ids.length === 0 && st.placed.length === 3);
r = await send({ action: 'link', from: 'sw1/psu', to: 'pdu1/01', cable: { item: 'strom' } });
check('Strom PDU -> Switch', r.type === 'ack' && st.power.sw1 === 'on', r.reason ?? '');
await send({ action: 'install', item: 'notebook', slot: 'slot_nb_1' });
r = await send({ action: 'install', item: 'notebook', slot: 'slot_nb_2' });
check('2 Notebooks -> nb1, nb2', r.type === 'ack' && st.devices.filter((d: any) => d.id.startsWith('nb')).length === 2);
for (const [nb, ip] of [['nb1', '10.0.0.1'], ['nb2', '10.0.0.2']]) {
  await send({ action: 'power', device: nb, on: true });
  await send({ action: 'set_ip', device: nb, ip, mask: '255.255.255.0', gateway: '' });
}
await send({ action: 'link', from: 'nb1/01', to: 'sw1/01', cable: { item: 'patch-3' } });
await send({ action: 'link', from: 'nb2/01', to: 'sw1/02', cable: { item: 'patch-3' } });
check('Ping ueber gekauften Switch', st.goals[0].done, JSON.stringify(st.goals));
r = await send({ action: 'uninstall', device: 'sw1' });
check('Ausbau mit Kabeln abgelehnt', r.type === 'reject' && r.code === 'occupied', r.reason);
r = await send({ action: 'uninstall', device: 'rack_1' });
check('Rack nicht leer abgelehnt', r.type === 'reject', r.reason);
for (const p of ['sw1/01', 'sw1/02', 'sw1/psu']) await send({ action: 'unlink', port: p });
r = await send({ action: 'uninstall', device: 'r1_switch_U41' });
check('Switch ausgebaut -> Inventar', r.type === 'ack' && !st.devices.some((d: any) => d.id === 'sw1') && st.inventory['switch-24'] === 1
  && !k.coreId.has('sw1'));
await send({ action: 'uninstall', device: 'r1_blank_U40' });
r = await send({ action: 'uninstall', device: 'rack_1' });
check('leeres Rack ausgebaut', r.type === 'ack' && !st.placed.some((p: any) => p.node === 'rack_1') && st.inventory['rack-42he'] === 1);

// Szenario-Aufbau (Demo): Geraete + Kabel fertig, mit Strom, ohne Inventar
const demo = { id: 'demo', modus: 'katalog', budget: null, hardware_katalog: KAT, inventar: {},
  aufbau: [{ vorlage: 'kit_rack', slot: 'slot_rack_1' }, { vorlage: 'kit_switch', rack: 'rack_1', u: 42 },
    { vorlage: 'kit_patchpanel', rack: 'rack_1', u: 41 }],
  kabel: [{ from: 'sw1/01', to: 'pp1/01', item: 'patch-0.5' }], ziele: [] };
const k2 = new EmbeddedKern({ manifest, scenario: demo, kit });
let st2: any = null;
k2.onMessage((m: any) => { st2 = reduceState(st2, m); });
const h = await k2.send({ action: 'hello' }) as any;
await Promise.resolve();
check('Demo-Aufbau: Rack, Switch, PP, Kabel, Strom', h.manifest.devices.length === 4 && st2.links.length === 1
  && st2.power.sw1 === 'on' && st2.unlimited === true, JSON.stringify(st2.power));
r = await k2.send({ action: 'buy', item: 'switch-24', qty: 5 }) as any;
check('Sandbox: Budget unbeschraenkt', r.type === 'ack' && st2.inventory['switch-24'] === 5);

// Link nach unten: Trunk Patchpanel Rack 1 <-> Patchpanel Rack 2, Ping ueber zwei Switches
{
  const KT = [...KAT, { item: 'trunk', typ: 'trunk', klasse: 'trunk', name: 'Trunk', preis: 180 }];
  const sc = { id: 'trunk', modus: 'katalog', budget: null, hardware_katalog: KT, inventar: {}, ziele: [
    { id: 'p', typ: 'core', text: 'NB1 -> NB2', check: { type: 'ping', from: 'nb1', to: '10.0.0.2' } }] };
  const k3 = new EmbeddedKern({ manifest, scenario: sc, kit });
  let s3: any = null;
  k3.onMessage((m: any) => { s3 = reduceState(s3, m); });
  const q = (i: any) => k3.send(i) as Promise<any>;
  await q({ action: 'hello' });
  for (const [item, qty] of [['rack-42he', 2], ['switch-24', 2], ['patchpanel-24', 2], ['notebook', 2], ['patch-3', 2], ['patch-0.5', 2], ['trunk', 1], ['strom', 2]] as const) {
    await q({ action: 'buy', item, qty });
  }
  for (const r of [1, 2]) {
    await q({ action: 'install', item: 'rack-42he', slot: `slot_rack_${r}` });
    await q({ action: 'install', item: 'patchpanel-24', rack: `rack_${r}`, u: 42 });
    await q({ action: 'install', item: 'switch-24', rack: `rack_${r}`, u: 41 });
  }
  await q({ action: 'install', item: 'notebook', slot: 'slot_nb_1' });
  await q({ action: 'install', item: 'notebook', slot: 'slot_nb_2' });
  let t = await q({ action: 'trunk', a: 'pp1', b: 'pp1', item: 'trunk' });
  check('Trunk im selben Rack abgelehnt', t.type === 'reject', t.reason);
  t = await q({ action: 'trunk', a: 'pp1', b: 'pp2', item: 'trunk' });
  check('Trunk pp1 (Rack 1) <-> pp2 (Rack 2)', t.type === 'ack' && s3.trunks.length === 1, t.reason ?? '');
  await q({ action: 'link', from: 'sw1/psu', to: 'pdu1/01', cable: { item: 'strom' } });
  await q({ action: 'link', from: 'sw2/psu', to: 'pdu3/01', cable: { item: 'strom' } });
  for (const [nb, ip] of [['nb1', '10.0.0.1'], ['nb2', '10.0.0.2']]) {
    await q({ action: 'power', device: nb, on: true });
    await q({ action: 'set_ip', device: nb, ip, mask: '255.255.255.0', gateway: '' });
  }
  await q({ action: 'link', from: 'nb1/01', to: 'sw1/01', cable: { item: 'patch-3' } });
  await q({ action: 'link', from: 'nb2/01', to: 'sw2/01', cable: { item: 'patch-3' } });
  await q({ action: 'link', from: 'sw1/24', to: 'pp1/24', cable: { item: 'patch-0.5' } });
  check('nur eine Seite gepatcht: kein Ping', !s3.goals[0].done);
  await q({ action: 'link', from: 'pp2/24', to: 'sw2/24', cable: { item: 'patch-0.5' } });
  check('beide Seiten gepatcht: Ping ueber den Trunk', s3.goals[0].done, JSON.stringify(s3.goals));
  await q({ action: 'unlink', port: 'pp1/24' });
  check('Patchkabel Rack 1 gezogen: Ping weg', !s3.goals[0].done);
  t = await q({ action: 'untrunk', device: 'pp2' });
  check('Trunk loesen mit Patchkabel abgelehnt', t.type === 'reject', t.reason);
  await q({ action: 'unlink', port: 'pp2/24' });
  t = await q({ action: 'untrunk', device: 'pp2' });
  check('Trunk geloest -> Inventar', t.type === 'ack' && s3.trunks.length === 0 && s3.inventory.trunk === 1);
}
// Plan v4: Strom fuer KVM + Server (PSU-Buchse), KVM-Konsole nur mit Strom
{
  const KV = [...KAT, { item: 'kvm', typ: 'geraet', vorlage: 'kit_kvm', name: 'KVM', preis: 650 },
    { item: 'srv', typ: 'geraet', vorlage: 'kit_server', name: 'Server', preis: 2800 }];
  const k4 = new EmbeddedKern({ manifest, scenario: { id: 'kvm', modus: 'katalog', budget: null, hardware_katalog: KV, inventar: {}, ziele: [] }, kit });
  let s4: any = null;
  k4.onMessage((m: any) => { s4 = reduceState(s4, m); });
  const q = (i: any) => k4.send(i) as Promise<any>;
  await q({ action: 'hello' });
  for (const [item, qty] of [['rack-42he', 1], ['switch-24', 1], ['kvm', 1], ['srv', 1], ['strom', 3]] as const) await q({ action: 'buy', item, qty });
  await q({ action: 'install', item: 'rack-42he', slot: 'slot_rack_1' });
  await q({ action: 'install', item: 'switch-24', rack: 'rack_1', u: 41 });
  await q({ action: 'install', item: 'kvm', rack: 'rack_1', u: 34 });
  await q({ action: 'install', item: 'srv', rack: 'rack_1', u: 20 });
  await q({ action: 'link', from: 'sw1/psu', to: 'pdu1/01', cable: { item: 'strom' } });
  let r = await q({ action: 'console_open', device: 'sw1', from: 'kvm1' });
  check('KVM ohne Strom: Konsole abgelehnt', r.type === 'reject' && /KVM1 hat keinen Strom/.test(r.reason), r.reason);
  r = await q({ action: 'link', from: 'kvm1/psu', to: 'pdu1/02', cable: { item: 'strom' } });
  check('Stromkabel PDU -> KVM', r.type === 'ack' && s4.power.kvm1 === 'on' && s4.leds['kvm1/led_pwr'] === 'on', r.reason ?? '');
  r = await q({ action: 'console_open', device: 'sw1', from: 'kvm1' });
  check('KVM mit Strom: Konsole auf SW1', r.type === 'ack', r.reason ?? r.prompt);
  r = await q({ action: 'link', from: 'srv1/psu', to: 'pdu2/01', cable: { item: 'strom' } });
  check('Stromkabel PDU -> Server', r.type === 'ack' && s4.power.srv1 === 'on', r.reason ?? '');
  await q({ action: 'unlink', port: 'kvm1/psu' });
  check('KVM-Stecker gezogen: aus', s4.power.kvm1 === 'off');
}
// Plan v4 E: «fertig aufgebaut» = gleicher Stand wie Bauplan selbst gekauft + eingebaut (echtes Raum-Manifest)
const roomV3 = JSON.parse(readFileSync(new URL('../../assets/out/room_v3.manifest.json', import.meta.url), 'utf8'));
for (const lv of LEVELS.filter((l: any) => l.bauplan) as any[]) {
  const run = async (scenario: any, build: boolean) => {
    const k = new EmbeddedKern({ manifest: roomV3, scenario, kit });
    let s: any = null;
    k.onMessage((m: any) => { s = reduceState(s, m); });
    await k.send({ action: 'hello' });
    if (build) {
      for (const [it, qty] of Object.entries(lv.bauplan.kaufen)) await k.send({ action: 'buy', item: it, qty });
      for (const e of lv.bauplan.einbau) await k.send({ action: 'install', ...e });
    }
    await Promise.resolve();
    const inv = Object.fromEntries(Object.entries(s.inventory).filter(([, n]: any) => n > 0).sort());
    return JSON.stringify([s.placed.map((p: any) => [p.node, p.vorlage, p.ids]), s.devices.map((d: any) => d.id), inv, s.budget, s.power, s.goals]);
  };
  const a = await run(readyScenario(lv), false);
  const b = await run(lv.scenario, true);
  check(`${lv.id}: fertig aufgebaut = selbst gebaut`, a === b && JSON.parse(a)[0].length === lv.bauplan.einbau.length + roomV3.slots.filter((x: any) => x.kind === 'fixed').length, a === b ? '' : `\n  ${a}\n  ${b}`);
}
process.exit(ok ? 0 : 1);
