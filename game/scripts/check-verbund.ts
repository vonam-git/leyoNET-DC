// Verbundsaufgaben: Musterloesung je Aufgabe gegen den Kern (allein und mit Partner), Auftragsblatt, Budget, keine Abkuerzungen.
import { existsSync, readFileSync } from 'node:fs';
import { EmbeddedKern } from '../src/embedded-kern.js';
import { TASKS, auftragsblatt, seatPlan, partnerSeat, verbundLevel } from '../src/verbund.js';
import { createLoesungen } from '../src/loesungen.js';

// Musterloesungen sind nicht oeffentlich: ohne Datei laufen nur die Pruefungen, die keine brauchen
const SOL = process.env.DC_LOESUNGEN ?? new URL('../../privat/loesungen.json', import.meta.url);
const hasSol = existsSync(SOL);
const { loesungIntents } = createLoesungen(hasSol ? JSON.parse(readFileSync(SOL, 'utf8')) : null);
if (!hasSol) console.log('SKIP Musterloesungen: privat/loesungen.json fehlt');

let ok = true;
const check = (name: string, cond: boolean, extra: any = '') => { ok &&= cond; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name} ${extra}`); };
const load = (p: string) => JSON.parse(readFileSync(new URL(`../../assets/out/${p}`, import.meta.url), 'utf8'));
const manifest = load('room_v3.manifest.json');
const kit = load('kit.kit.json');
const only = process.argv[2];

async function build(id: string, seat: number, skip: ((i: any) => boolean) | null = null) {
  const lv: any = verbundLevel(id, seat);
  const k: any = new EmbeddedKern({ manifest, scenario: lv.scenario, kit });
  k.quiet = true;
  await k.send({ action: 'hello' });
  for (const i of loesungIntents(id, seat)) {
    if (skip?.(i)) continue;
    const r = await k.send(i);
    if (skip) continue; // Negativtest: Folgefehler sind gewollt
    if (r.type !== 'ack') check(`${id} Platz ${seat}: ${i.action} ${JSON.stringify(i).slice(0, 90)}`, false, r.reason);
    const bad = (r.lines ?? []).find((l: string) => /^%|invalid|unknown|ambiguous/i.test(l));
    if (i.action === 'console' && bad) check(`${id}: CLI «${i.line}»`, false, bad);
  }
  k.quiet = false;
  return k;
}
for (const t of TASKS) {
  if (!hasSol || (only && t.id !== only)) continue;
  for (const seat of only ? [1] : [1, 14, 60]) {
    const k = await build(t.id, seat);
    const t0 = performance.now();
    const g = k.goals();
    const ms = performance.now() - t0;
    const open = g.filter((x: any) => !x.done);
    check(`${t.id} ${'*'.repeat(t.sterne)} Platz ${seat}: Musterloesung erfuellt ${g.length} Ziele`, open.length === 0, `${open.map((x: any) => `${x.id}:${x.reason ?? ''}`).join(' ')} (${ms.toFixed(0)} ms, Rest CHF ${k.budget})`);
  }
}
// --- Konsole: ping und show zeigen den laufenden Zustand (2026-11-24), beim Nachspielen laeuft keine Simulation
if (hasSol && !only) {
  const con = async (k: any, dev: string, line: string) => {
    const nb = k.consoleOf('nb1');
    if (nb && nb !== dev) await k.send({ action: 'unlink', port: 'nb1/con' });
    if (k.consoleOf('nb1') !== dev) await k.send({ action: 'link', from: 'nb1/con', to: `${dev}/con`, cable: { item: 'konsolkabel-usb-3.0' } });
    const o = await k.send({ action: 'console_open', device: dev, from: 'nb1' });
    await k.send({ action: 'console', session: o.session, line: 'enable' });
    const t0 = performance.now();
    const r = await k.send({ action: 'console', session: o.session, line });
    return { text: r.lines.join('\n'), ms: performance.now() - t0 };
  };
  const v1 = await build('V1', 1);
  let c = await con(v1, 'rt1', 'ping 198.51.100.10');
  check('V1: ping an der Router-Konsole erreicht die Zentrale', /Reply from 198\.51\.100\.10/.test(c.text) && /100 percent \(4\/4\)/.test(c.text), `(${c.ms.toFixed(0)} ms)`);
  c = await con(v1, 'rt1', 'ping 198.51.100.77');
  check('V1: ping auf eine fremde Adresse scheitert sichtbar', /0 percent|unreachable|timed out/i.test(c.text) && !/Reply/.test(c.text), c.text.split('\n').at(-1));
  const no = await build('V1', 1, (i) => i.action === 'console' && /^ip route/.test(i.line));
  c = await con(no, 'rt1', 'ping 198.51.100.10');
  check('V1: ohne Standardroute sagt ping es', /no route/i.test(c.text), c.text.split('\n').at(-1));
  const v2 = await build('V2', 1);
  check('V2: show ip dhcp binding zeigt Clients', /10\.1\.10\.\d+/.test((await con(v2, 'rt1', 'show ip dhcp binding')).text));
  const v5 = await build('V5', 1);
  check('V5: show ip route zeigt BGP-Route', /^B.*198\.51\.100\.0\/24/m.test((await con(v5, 'rt1', 'show ip route')).text));
  check('V5: show ip route am Core-Switch zeigt OSPF-Route', /^O.*198\.51\.100\.0\/24/m.test((await con(v5, 'cs1', 'show ip route')).text));
  check('V5: show ip ospf neighbor', /full/i.test((await con(v5, 'cs1', 'show ip ospf neighbor')).text));
  v1.quiet = true;
  v1._live = null;
  await con(v1, 'rt1', 'ping 198.51.100.10');
  check('Nachspielen: ping startet keine Simulation', v1._live === null);
}
// --- Abkuerzungen zaehlen nicht: je Fall fehlt eine Zeile/ein Kabel -> genau diese Ziele muessen offen sein
const without = (re: RegExp) => (i: any) => i.action === 'console' && re.test(i.line);
const cases: [string, string, (i: any) => boolean, string[]][] = [
  ['V1', 'Uebergabe nicht gesteckt', (i) => i.action === 'link' && i.to === 'pp1/24', ['up', 'on', 'sv']],
  ['V1', 'kein Strom', (i) => i.action === 'link' && i.from === 'rt1/psu', ['gs', 'on']],
  ['V1', 'nicht gespeichert', without(/write memory/), ['sv']],
  ['V1', 'ohne Standardroute', without(/^ip route/), ['dr', 'on']],
  ['V2', 'ohne NAT', without(/nat outside/), ['w1', 'pa']],
  ['V2', 'DHCP ohne DNS', without(/dns-server/), ['d1', 'd2', 'w1']],
  ['V3', 'Gast im falschen VLAN', without(/access vlan 20/), ['v2']],
  ['V3', 'Server nicht veroeffentlicht', without(/source static/), ['w2']],
  ['V3', 'kein Trunk', without(/mode trunk/), ['tr', 'd1', 'd2']],
  ['V4', 'DMZ darf ins LAN', without(/rule 2 deny/), ['n2']],
  ['V4', 'keine Regel fuer Port 80', without(/rule 1 allow/), ['w2', 'n1']],
  ['V4', 'Kupfer fehlt: Glasfaser nicht gesteckt', (i) => i.action === 'link' && i.from === 'sw1/25', ['lw', 'd1']],
  ['V4', 'kein SSH', (i) => i.action === 'ssh', ['sh']],
  ['V5', 'Netz nicht angekuendigt', without(/^network 192\.0\.2/), ['pr', 'w2']],
  ['V5', 'Gaeste ohne ACL', without(/access-group/), ['n1']],
  ['V5', 'OSPF ohne BGP-Routen', without(/redistribute bgp/), ['or', 'w1']],
];
for (const [id, name, skip, want] of cases) {
  if (!hasSol || (only && id !== only)) continue;
  const k = await build(id, 3, skip).catch((e) => { check(`${id}: ${name}`, false, e.message); return null; });
  if (!k) continue;
  const g = k.goals();
  const open = g.filter((x: any) => !x.done).map((x: any) => x.id);
  check(`${id}: ${name} -> offen`, want.every((w) => open.includes(w)) && open.length < g.length, open.join(' '));
}
if (hasSol && !only) {
  // V4 ohne Regel, aber alles erlaubt: Ping von aussen muss auffallen
  let k: any = await build('V4', 5, (i) => i.action === 'console' && /rule 1 allow/.test(i.line) && ((i.line = i.line.replace('allow tcp any', 'allow ip any').replace(' port 80', '')), false));
  check('V4: alles von aussen erlaubt -> Ziel n1 offen', !k.goals().find((x: any) => x.id === 'n1').done);
  // V5 mit statischer Standardroute
  k = await build('V5', 5, (i) => { if (i.action === 'console' && /^ip route 192/.test(i.line)) i.line = `ip route 0.0.0.0 0.0.0.0 ${seatPlan(5).gw}`; return false; });
  check('V5: statische Standardroute -> Ziel nd offen', !k.goals().find((x: any) => x.id === 'nd').done);
  // fremdes Protokoll (Platz 7) an Platz 8: andere Adressen -> nicht geloest
  const lv: any = verbundLevel('V2', 8);
  k = new EmbeddedKern({ manifest, scenario: lv.scenario, kit });
  k.quiet = true;
  await k.send({ action: 'hello' });
  for (const i of loesungIntents('V2', 7)) await k.send(i);
  k.quiet = false;
  check('fremdes Protokoll loest die eigene Aufgabe nicht', k.goals().some((x: any) => !x.done && ['on', 'w1'].includes(x.id)), k.goals().filter((x: any) => x.done).length + ' Ziele');
}
if (!only) {
  // leerer Raum: nichts erfuellt (verneinte Ziele haengen an requires)
  for (const t of TASKS) {
    const e: any = new EmbeddedKern({ manifest, scenario: (verbundLevel(t.id, 2) as any).scenario, kit });
    await e.send({ action: 'hello' });
    check(`${t.id}: leerer Raum erfuellt kein Ziel`, e.goals().every((x: any) => !x.done), e.goals().filter((x: any) => x.done).map((x: any) => x.id).join(' '));
  }
  // Partner: Platzhalter online ohne Webseite -> gemeinsames Ziel offen; mit Webseite erfuellt; aus -> offen
  const k: any = hasSol ? await build('V3', 9) : null;
  if (k) for (const [lvl, want] of [['services', true], ['online', false], [null, true]] as const) {
    k.setPartner(lvl);
    check(`V3: Partner ${lvl ?? 'leer (Referenz)'} -> gemeinsames Ziel ${want ? 'erfuellt' : 'offen'}`, k.goals().find((x: any) => x.id === 'pa').done === want);
  }
  check('Partnerplaetze paarweise', [1, 2, 3, 60].map(partnerSeat).join() === '2,1,4,59');
  const orte = new Set(Array.from({ length: 60 }, (_, i) => seatPlan(i + 1).ort));
  check('60 verschiedene Standorte', orte.size === 60 && !orte.has('Referenz'), orte.size);
  const nets = new Set(Array.from({ length: 60 }, (_, i) => seatPlan(i + 1)).flatMap((p) => [p.wan, p.gw, p.pub]));
  check('alle Adressen eindeutig und in den Dokumentationsnetzen', nets.size === 180 && [...nets].every((x) => /^(203\.0\.113|192\.0\.2)\.(\d+)$/.test(x) && Number(x.split('.')[3]) < 255));
  check('Auftragsblatt nennt WAN und Provider', auftragsblatt('V5', 60).zeilen.some(([, v]: any) => v === '203.0.113.242/30'));
}
process.exit(ok ? 0 : 1);
