// Plan v4 D: Pult - Gestell (vorkonfigurieren), Steckdosenleiste, Stromleiste 1 HE, Tischdose -> Patchpanel, Trunk-Wege ueber Kopf.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { EmbeddedKern } from '../src/embedded-kern.js';
import { reduceState } from '../src/kern.js';
import { KATALOG } from '../src/levels.js';
import { planModel } from '../src/netplan.js';
import { Placement } from '../src/placement.js';

let ok = true;
const check = (name: string, cond: boolean, extra: any = '') => { ok &&= cond; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name} ${extra}`); };
const load = (p: string) => JSON.parse(readFileSync(new URL(`../../assets/out/${p}`, import.meta.url), 'utf8'));
const manifest = load('room_v3.manifest.json');
const kit = load('kit.kit.json');
const k: any = new EmbeddedKern({ manifest, scenario: { id: 'desk', modus: 'katalog', budget: null, hardware_katalog: KATALOG, inventar: {},
  dosen: { 'pp1/07': { name: 'AP07', type: 'pc', ip: '192.168.1.107', mask: '255.255.255.0' } }, ziele: [] }, kit });
let st: any = null;
k.onMessage((m: any) => { st = reduceState(st, m); });
const send = (i: any) => k.send(i) as Promise<any>;
const item = (id: string) => ({ item: id });
await send({ action: 'hello' });
await Promise.resolve();

// --- feste Einrichtung
check('Pult: Gestell, Tischdose, Steckdosenleiste stehen', ['bench_1', 't1_outlet_1', 't1_strip_1'].every((n) => st.placed.some((p: any) => p.node === n && p.fixed)));
check('Kern-IDs td1 + sl1 mit je 8 Ports', ['td1', 'sl1'].every((id) => Object.keys(st.devices.find((d: any) => d.id === id)?.ports ?? {}).length === 8));
check('leerer Netzplan bleibt leer', planModel(st).nodes.length === 0);
let r = await send({ action: 'uninstall', device: 't1_strip_1' });
check('Festes laesst sich nicht ausbauen', r.type === 'reject', r.reason);

for (const [it, n] of [['rack-42he', 2], ['switch-24', 2], ['patchpanel-24', 3], ['pdu-1u', 1], ['notebook', 2], ['strom-c13-1.0', 4], ['strom-c13-2.0', 4], ['patch-cat6-5.0-grau', 4],
  ['patch-cat6-0.5-blau', 6], ['konsolkabel-usb-3.0', 1], ['trunk-cat6-24', 1], ['sfp-1g-sx', 1]] as const) await send({ action: 'buy', item: it, qty: n });
for (const s of ['slot_rack_8', 'slot_rack_1']) await send({ action: 'install', item: 'rack-42he', slot: s });
check('PDU-Nummern wie bisher (pdu1/pdu2 im ersten Rack)', st.devices.find((d: any) => d.id === 'pdu1').rack === 'rack_8');

// --- vorkonfigurieren auf dem Pult
r = await send({ action: 'install', item: 'switch-24', rack: 'bench_1', u: 7 });
check('Gestell hat 6 HE', r.type === 'reject', r.reason);
r = await send({ action: 'install', item: 'switch-24', rack: 'bench_1', u: 3 });
check('Switch aufs Pult-Gestell', r.type === 'ack' && r.node === 'b1_switch_U3' && r.ids[0] === 'sw1', r.reason ?? r.node);
r = await send({ action: 'link', from: 'sw1/psu', to: 'sl1/01', cable: item('strom-c13-1.0') });
check('Strom aus der Steckdosenleiste am Pult', r.type === 'ack' && st.power.sw1 === 'on', r.reason ?? '');
await send({ action: 'install', item: 'notebook', slot: 'slot_nb_1' });
await send({ action: 'power', device: 'nb1', on: true });
r = await send({ action: 'link', from: 'nb1/con', to: 'sw1/con', cable: item('konsolkabel-usb-3.0') });
r = await send({ action: 'console_open', device: 'sw1', from: 'nb1' });
const sid = r.session;
const cli = async (line: string) => (await send({ action: 'console', session: sid, line })).lines?.join('\n') ?? '';
for (const l of ['enable', 'configure terminal', 'hostname PULT', 'vlan 42', 'exit', 'interface port5', 'switchport access vlan 42', 'end']) await cli(l);
check('auf dem Pult konfiguriert', /42/.test(await cli('show vlan')));
await send({ action: 'sfp_insert', port: 'sw1/25', item: 'sfp-1g-sx' });
r = await send({ action: 'uninstall', device: 'b1_switch_U3' });
check('Ausbau mit Kabeln abgelehnt', r.type === 'reject', r.reason);
for (const p of ['sw1/psu', 'nb1/con']) await send({ action: 'unlink', port: p });
r = await send({ action: 'uninstall', device: 'b1_switch_U3' });
check('ohne Kabel ausgebaut', r.type === 'ack' && st.inventory['switch-24'] === 2, r.reason ?? '');
r = await send({ action: 'install', item: 'switch-24', rack: 'rack_8', u: 41 });
check('ins Rack umgebaut: SFP-Modul steckt noch', r.ids[0] === 'sw1' && st.sfp['sw1/25'] === '1G-SX', JSON.stringify(st.sfp));
await send({ action: 'link', from: 'sw1/psu', to: 'pdu2/01', cable: item('strom-c13-2.0') });
await send({ action: 'link', from: 'nb1/con', to: 'sw1/con', cable: item('konsolkabel-usb-3.0') });
r = await send({ action: 'console_open', device: 'sw1', from: 'nb1' });
check('ins Rack umgebaut: Hostname bleibt', /PULT/.test(r.prompt ?? ''), r.prompt ?? r.reason);
const c2 = r.session;
await send({ action: 'console', session: c2, line: 'enable' });
const vl = (await send({ action: 'console', session: c2, line: 'show vlan' })).lines.join('\n');
check('ins Rack umgebaut: VLAN 42 bleibt', /42/.test(vl));
check('Ports nach dem Einschalten nicht shutdown', !k._dev('sw1').interfaces.some((i: any) => i.shutdown));
r = await send({ action: 'install', item: 'switch-24', rack: 'rack_8', u: 39 });
check('zweiter Switch ist fabrikneu', k._dev('sw2').name === 'sw2' && !(k._dev('sw2').interfaces[24].sfp));

// --- Stromleiste 1 HE
r = await send({ action: 'install', item: 'pdu-1u', rack: 'rack_8', u: 30 });
check('Stromleiste 1 HE eingebaut', r.type === 'ack' && r.ids.length === 1 && Object.keys(st.devices.find((d: any) => d.id === r.ids[0]).ports).length === 8, r.ids);
r = await send({ action: 'link', from: 'sw2/psu', to: `${r.ids[0]}/08`, cable: item('strom-c13-1.0') });
check('Strom aus der Stromleiste', r.type === 'ack' && st.power.sw2 === 'on', r.reason ?? '');

// --- Tischdose
await send({ action: 'install', item: 'patchpanel-24', rack: 'rack_8', u: 42 }); // pp1 mit Wanddose 07
await send({ action: 'install', item: 'patchpanel-24', rack: 'bench_1', u: 1 }); // pp2 auf dem Pult
r = await send({ action: 'desk_patch', device: 'td1', pp: 'pp1', first: 1 });
check('Block mit Wanddosen abgelehnt', r.type === 'reject', r.reason);
r = await send({ action: 'desk_patch', device: 'td1', pp: 'pp2', first: 1 });
check('Patchpanel auf dem Pult abgelehnt', r.type === 'reject', r.reason);
r = await send({ action: 'desk_patch', device: 'td1', pp: 'pp1', first: 9 });
check('Tischdose auf PP1 Port 9-16 aufgelegt', r.type === 'ack' && k._trunkFar('td1/02') === 'pp1/10' && k._trunkFar('pp1/16') === 'td1/08'
  && k._trunkFar('pp1/17') === null && k._trunkFar('pp1/07') === null, r.reason ?? '');
r = await send({ action: 'desk_patch', device: 'td1', pp: 'pp1', first: 17 });
check('zweimal auflegen abgelehnt', r.type === 'reject', r.reason);
r = await send({ action: 'uninstall', device: 'pp1' });
check('Patchpanel mit Leitung nicht ausbaubar', r.type === 'reject', r.reason);
r = await send({ action: 'untrunk', device: 'pp1' });
check('Leitung nicht mit dem Trunk-Kabel loesbar', r.type === 'reject', r.reason);
r = await send({ action: 'link', from: 'nb1/01', to: 'td1/02', cable: item('patch-cat6-5.0-grau') });
check('Notebook an der Tischdose: noch kein Link', r.type === 'ack' && st.leds['sw1/led_p05'] !== 'on', r.reason ?? '');
r = await send({ action: 'link', from: 'sw1/05', to: 'pp1/10', cable: item('patch-cat6-0.5-blau') });
check('im Rack gepatcht: Link steht', r.type === 'ack' && st.leds['sw1/led_p05'] === 'on', r.reason ?? '');
await send({ action: 'install', item: 'notebook', slot: 'slot_nb_2' });
await send({ action: 'power', device: 'nb2', on: true });
await send({ action: 'link', from: 'sw1/06', to: 'pp1/11', cable: item('patch-cat6-0.5-blau') });
await send({ action: 'link', from: 'nb2/01', to: 'td1/03', cable: item('patch-cat6-5.0-grau') });
check('andere Reihenfolge (zuerst Rack, dann Pult): Link steht', st.leds['sw1/led_p06'] === 'on');
for (const l of ['configure terminal', 'interface port6', 'switchport access vlan 42', 'end']) await send({ action: 'console', session: c2, line: l });
await send({ action: 'set_ip', device: 'nb1', ip: '10.0.0.1', mask: '255.255.255.0' });
await send({ action: 'set_ip', device: 'nb2', ip: '10.0.0.2', mask: '255.255.255.0' });
r = await send({ action: 'host_ping', device: 'nb1', target: '10.0.0.2' });
check('Ping NB1 -> NB2 ueber Tischdose, Decke, Patchpanel, Switch', r.ok, r.lines?.at(-1));
const plan = planModel(st);
check('Netzplan: Tischdose fest an PP1', plan.nodes.some((n: any) => n.id === 'td1') && plan.edges.some((e: any) => e.kind === 'trunk' && [e.a, e.b].sort().join() === 'pp1,td1'));
r = await send({ action: 'desk_unpatch', device: 'td1' });
check('Loesen mit Kabeln abgelehnt', r.type === 'reject', r.reason);
for (const p of ['nb1/01', 'nb2/01']) await send({ action: 'unlink', port: p });
check('Kabel am Pult gezogen: Link weg', st.leds['sw1/led_p05'] === 'off' && st.leds['sw1/led_p06'] === 'off');
for (const p of ['sw1/05', 'sw1/06']) await send({ action: 'unlink', port: p });

// --- Wege ueber Kopf
await send({ action: 'uninstall', device: 'pp2' });
await send({ action: 'install', item: 'patchpanel-24', rack: 'rack_1', u: 42 }); // pp2 in Reihe A
await send({ action: 'install', item: 'patchpanel-24', rack: 'rack_8', u: 38 }); // pp3 in Reihe B
r = await send({ action: 'trunk', a: 'pp2', b: 'pp3', item: 'trunk-cat6-24' });
check('Trunk Reihe A <-> Reihe B', r.type === 'ack', r.reason ?? '');
const slots = new Map(manifest.slots.map((s: any) => [s.node, s]));
const P: any = Object.create(Placement.prototype);
Object.assign(P, { trays: manifest.trays, slots, kit: new Map(kit.templates.map((t: any) => [t.node, t])), placed: st.placed, racks: new Map() });
P.rackSpec = P.kit.get('kit_rack');
for (const p of st.placed.filter((x: any) => x.vorlage === 'kit_rack')) {
  const o = new THREE.Object3D();
  o.matrixWorld.copy(P._slotMatrix(slots.get(p.slot)));
  P.racks.set(p.node, o);
}
const nodeOf = (id: string) => st.devices.find((d: any) => d.id === id)?.node;
st.trunks.forEach((t: any, lane: number) => {
  const pts = P.trunkPath(t, nodeOf, lane) as THREE.Vector3[];
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const sp = curve.getSpacedPoints(400);
  const name = t.desk ? 'Tischdose' : 'Trunk';
  check(`${name}: Weg gefunden, nirgends unter dem Boden`, sp.every((p) => p.y > 0.3), `${curve.getLength().toFixed(1)} m`);
  const inside = (z: number) => Math.abs(z - manifest.trays.rows.A) < 0.15 || Math.abs(z - manifest.trays.rows.B) < 0.15;
  const high = sp.filter((p) => p.y > manifest.trays.z - 0.03);
  const cx = (x: number) => Math.abs(x - manifest.trays.cross_x) < 0.16 || Math.abs(x - manifest.trays.pole[0]) < 0.16;
  // Einstieg ueber die Seitenwand der Rinne: nur direkt am Rack (bis 25 cm von der Dach-Einfuehrung)
  const racks = [...P.racks.values()].map((o: any) => new THREE.Vector3(0, 0, -0.8).applyMatrix4(o.matrixWorld));
  const riser = (p: THREE.Vector3) => racks.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < 0.25);
  const out = high.filter((p) => !inside(p.z) && !cx(p.x) && !riser(p));
  check(`${name}: bleibt in den Gitterrinnen`, high.length > 50 && out.length <= 12, `${out.length} Punkte am Uebergang Rack/Rinne`);
  let kink = 0;
  for (let i = 2; i < sp.length; i++) kink = Math.max(kink, sp[i].clone().sub(sp[i - 1]).angleTo(sp[i - 1].clone().sub(sp[i - 2])));
  const at = sp.findIndex((_, i) => i > 1 && sp[i].clone().sub(sp[i - 1]).angleTo(sp[i - 1].clone().sub(sp[i - 2])) === kink);
  check(`${name}: keine Knicke`, kink < (22 * Math.PI) / 180 * (curve.getLength() / 7.5) * 1.3, `max ${((kink * 180) / Math.PI).toFixed(0)} Grad bei ${sp[at].toArray().map((v) => v.toFixed(2))} (Schritt ${(curve.getLength() / 400 * 100).toFixed(1)} cm)`);
});
// --- Zuleitungen der Racks: jede endet oben in der PDU und beginnt im Abgangskasten (nichts haengt frei)
for (const p of st.placed.filter((x: any) => x.vorlage === 'kit_rack')) for (const side of [-1, 1]) {
  const f = P.feedPath(p.node, side);
  const name = `Zuleitung ${p.node} ${side < 0 ? 'A' : 'B'}`;
  check(`${name}: Weg gefunden`, !!f);
  if (!f) continue;
  const curve = new THREE.CatmullRomCurve3(f.pts, false, 'centripetal');
  const sp = curve.getSpacedPoints(Math.round(curve.getLength() * 100)); // 1 cm
  const end = sp.at(-1)!.clone().applyMatrix4(P.racks.get(p.node).matrixWorld.clone().invert());
  check(`${name}: endet in der PDU`, Math.abs(end.x - side * 0.273) < 0.003 && end.y < 1.872 && end.y > 1.84 && Math.abs(end.z + 0.92) < 0.005, end.toArray().map((v) => v.toFixed(3)));
  const tap = manifest.trays.power.taps[f.row];
  check(`${name}: beginnt im Abgangskasten`, Math.abs(sp[0].x - tap[0]) < 0.03 && Math.abs(sp[0].z - tap[1]) < 0.045 && sp[0].y > manifest.trays.power.z);
  let bend = 0;
  for (let i = 2; i < sp.length; i++) bend = Math.max(bend, sp[i].clone().sub(sp[i - 1]).angleTo(sp[i - 1].clone().sub(sp[i - 2])));
  check(`${name}: keine Knicke`, bend < (32 * Math.PI) / 180, `${((bend * 180) / Math.PI).toFixed(0)} Grad/cm, ${curve.getLength().toFixed(1)} m`);
}
r = await send({ action: 'desk_unpatch', device: 'td1' });
check('Leitung der Tischdose geloest', r.type === 'ack' && !st.trunks.some((t: any) => t.desk), r.reason ?? '');
process.exit(ok ? 0 : 1);
