// Alle Level gegen den echten leyoNET-Kern durchspielen (EmbeddedKern): Shop, Kabel, IP, Ping,
// Konsole, SSH. Start: npx tsx scripts/check-levels.ts
import { readFileSync } from 'node:fs';
import { EmbeddedKern } from '../src/embedded-kern.js';
import { reduceState } from '../src/kern.js';
import { LEVELS, levelById } from '../src/levels.js';
import { READ_ONLY, replay } from '../src/server-kern.js';

let ok = true;
const check = (name: string, cond: boolean, extra = '') => { ok &&= cond; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name} ${extra}`); };
// Plan v3: leerer Raum v3 + Bausatz; play() kauft und baut den Bauplan des Levels (Budget muss reichen)
const manifest = JSON.parse(readFileSync(new URL('../../assets/out/room_v3.manifest.json', import.meta.url), 'utf8'));
const kit = JSON.parse(readFileSync(new URL('../../assets/out/kit.kit.json', import.meta.url), 'utf8'));
const runs: any[] = [];
async function play(id: string, powerOn = true) {
  const lv: any = levelById(id);
  const k = new EmbeddedKern({ manifest, scenario: lv.scenario, kit });
  let st: any = null;
  k.onMessage((m: any) => { st = reduceState(st, m); });
  const log: any[] = [];
  runs.push({ id, log, goals: () => k.goals() });
  const send = (i: any) => { if (i.action !== 'hello' && !READ_ONLY.has(i.action)) log.push(structuredClone(i)); return k.send(i) as Promise<any>; };
  await send({ action: 'hello' });
  await Promise.resolve();
  let built = true;
  for (const [it, qty] of Object.entries(lv.bauplan?.kaufen ?? {})) {
    const r = await send({ action: 'buy', item: it, qty });
    if (r.type !== 'ack') { built = false; check(`${id}: Bauplan kaufen ${it}`, false, `(${r.reason})`); }
  }
  for (const e of lv.bauplan?.einbau ?? []) {
    const r = await send({ action: 'install', ...e });
    if (r.type !== 'ack') { built = false; check(`${id}: Bauplan einbauen ${e.item}`, false, `(${r.reason})`); }
  }
  if (!seen.has(id) && lv.bauplan) {
    seen.add(id);
    check(`${id}: Bauplan im Budget gekauft + eingebaut`, built, `(${st.devices.map((d: any) => d.id).join(' ')}, Rest CHF ${st.budget})`);
  }
  if (powerOn) {
    for (const d of st.devices.filter((x: any) => x.id.startsWith('nb'))) await send({ action: 'power', device: d.id, on: true });
    // Netzgeraete: Stromkabel von der rechten 0U-PDU (pdu2) an das Netzteil
    let n = 1;
    for (const d of st.devices.filter((x: any) => /^(sw|cs|rt|fw|kvm)/.test(x.id))) {
      const r = await send({ action: 'link', from: `${d.id}/psu`, to: `pdu2/${String(n++).padStart(2, '0')}`, cable: cable('strom-c13-2.0') });
      if (r.type !== 'ack') check(`${id}: Strom ${d.id}`, false, `(${r.reason})`);
    }
  }
  // Strom-Ziel (id gs) separat, damit die Indizes der Fachziele stabil bleiben
  return { k, send, st: () => st, done: () => st.goals.filter((g: any) => g.id !== 'gs').map((g: any) => g.done),
    power: () => st.goals.find((g: any) => g.id === 'gs')?.done };
}
const seen = new Set<string>();
const item = (id: string) => LEVELS[0].scenario.hardware_katalog.find((c: any) => c.item === id)!;
const cable = (id: string) => ({ item: id, length: item(id).laenge, color: item(id).farbe });

// --- Strom Notebook ----------------------------------------------------------------------------
{
  const { send, st, done } = await play('L1', false);
  check('Notebooks starten ausgeschaltet', st().power.nb1 === 'off' && st().power.nb2 === 'off', JSON.stringify(st().power));
  let r = await send({ action: 'set_ip', device: 'nb1', ip: '10.0.0.1', mask: '255.255.255.0' });
  check('aus: IP setzen -> reject', r.type === 'reject' && /ausgeschaltet/.test(r.reason), `(${r.reason})`);
  await send({ action: 'buy', item: 'patch-cat6-1.0-gelb' });
  await send({ action: 'link', from: 'nb1/01', to: 'nb2/01', cable: cable('patch-cat6-1.0-gelb') });
  check('aus: Kabel steckt, aber kein Link (connected ok, Ping offen)', done()[0] && !done()[2], JSON.stringify(done()));
  r = await send({ action: 'power', device: 'nb1', on: true });
  await send({ action: 'power', device: 'nb2', on: true });
  check('einschalten -> power on', r.type === 'ack' && st().power.nb1 === 'on' && st().power.nb2 === 'on');
  await send({ action: 'set_ip', device: 'nb1', ip: '10.0.0.1', mask: '255.255.255.0' });
  await send({ action: 'set_ip', device: 'nb2', ip: '10.0.0.2', mask: '255.255.255.0' });
  check('an + IP -> Ping-Ziel erfuellt', done().every(Boolean), JSON.stringify(done()));
  await send({ action: 'power', device: 'nb2', on: false });
  check('NB2 ausschalten -> Ping-Ziel wieder offen', !done()[2], JSON.stringify(done()));
}

// --- Strom Netzgeraete -------------------------------------------------------------------------
{
  const { send, st, done, power } = await play('L2', false);
  check('L2: Switches ohne Strom', st().power.sw1 === 'off' && st().power.sw2 === 'off' && st().leds['sw1/led_pwr'] === 'off', JSON.stringify(st().power));
  await send({ action: 'link', from: 'sw1/07', to: 'pp1/07', cable: cable('patch-cat6-0.25-blau') });
  await send({ action: 'link', from: 'sw2/13', to: 'pp1/13', cable: cable('patch-cat6-0.5-blau') });
  await send({ action: 'link', from: 'sw1/24', to: 'sw2/24', cable: cable('patch-cat6-0.25-blau') });
  check('L2: alles gepatcht, aber ohne Strom kein Ping', done()[0] && done()[1] && !done()[2], JSON.stringify(done()));
  let r = await send({ action: 'link', from: 'sw1/psu', to: 'sw2/01', cable: cable('strom-c13-2.0') });
  check('Stromkabel an Netzwerkport -> reject', r.type === 'reject', `(${r.reason})`);
  r = await send({ action: 'link', from: 'sw1/psu', to: 'pdu2/01', cable: cable('patch-cat6-0.25-blau') });
  check('Patchkabel an PSU -> reject', r.type === 'reject', `(${r.reason})`);
  await send({ action: 'link', from: 'sw1/psu', to: 'pdu2/01', cable: cable('strom-c13-2.0') });
  await send({ action: 'link', from: 'pdu2/02', to: 'sw2/psu', cable: cable('strom-c13-2.0') });
  check('L2: Strom an -> pwr-LED an, Ping + Strom-Ziel', st().leds['sw1/led_pwr'] === 'on' && done().every(Boolean) && power(), JSON.stringify(done()));
  await send({ action: 'unlink', port: 'sw2/psu' });
  check('L2: Stecker von SW2 gezogen -> Ping weg', st().power.sw2 === 'off' && !done()[2] && !power(), JSON.stringify(done()));
  const { send: s7 } = await play('L7', false);
  r = await s7({ action: 'console_open', device: 'cs1', from: 'kvm1' });
  check('L7: Core-Switch ohne Strom -> KVM-Konsole abgelehnt', r.type === 'reject' && /Strom/.test(r.reason), `(${r.reason})`);
}

// --- L1 -------------------------------------------------------------------------------------
{
  const { send, st, done } = await play('L1');
  let r = await send({ action: 'link', from: 'nb1/01', to: 'nb2/01', cable: cable('patch-cat6-1.0-gelb') });
  check('L1: ohne Kabel im Inventar -> reject budget', r.code === 'budget', `(${r.reason})`);
  r = await send({ action: 'buy', item: 'patch-cat6-1.0-gelb', qty: 1 });
  check('L1: Shop kaufen -> Budget 100 -> 92 (nach 2 Notebooks), Inventar 1', r.type === 'ack' && st().budget === 92 && st().inventory['patch-cat6-1.0-gelb'] === 1, `(CHF ${st().budget})`);
  r = await send({ action: 'buy', item: 'server-1u', qty: 1 });
  check('L1: zu teuer -> reject budget', r.code === 'budget', `(${r.reason})`);
  r = await send({ action: 'link', from: 'nb1/con', to: 'nb2/con', cable: cable('patch-cat6-1.0-gelb') });
  check('L1: Patchkabel an Konsolports -> reject (Klasse)', r.type === 'reject', `(${r.reason})`);
  r = await send({ action: 'link', from: 'nb1/01', to: 'nb2/01', cable: cable('patch-cat6-1.0-gelb') });
  check('L1: NB1 <-> NB2 verbunden, Ziel 1 erfuellt', r.type === 'ack' && JSON.stringify(done()) === '[true,false,false]', JSON.stringify(done()));
  r = await send({ action: 'host_ping', device: 'nb1', target: '10.0.0.2' });
  check('L1: ping ohne IP scheitert', r.ok === false, `(${r.lines.at(-1)})`);
  await send({ action: 'set_ip', device: 'nb1', ip: '10.0.0.1', mask: '255.255.255.0' });
  r = await send({ action: 'set_ip', device: 'nb2', ip: '10.0.0.2', mask: '255.255.255.0', gateway: '' });
  check('L1: IPs gesetzt -> alle Ziele erfuellt', r.type === 'ack' && done().every(Boolean), JSON.stringify(done()));
  r = await send({ action: 'host_ping', device: 'nb1', target: '10.0.0.2' });
  check('L1: ping 10.0.0.2 ok', r.ok === true, `(${r.lines[1]})`);
  r = await send({ action: 'device_info', device: 'nb2' });
  check('L1: device_info liefert die IP', r.ip === '10.0.0.2' && r.mask === '255.255.255.0');
  r = await send({ action: 'set_ip', device: 'nb1', ip: '10.0.0.999', mask: '255.255.255.0' });
  check('L1: ungueltige IP -> reject', r.type === 'reject', `(${r.reason})`);
}

// --- L2 -------------------------------------------------------------------------------------
{
  const { send, done } = await play('L2');
  await send({ action: 'link', from: 'sw1/07', to: 'pp1/07', cable: cable('patch-cat6-0.25-blau') });
  await send({ action: 'link', from: 'pp1/13', to: 'sw2/13', cable: cable('patch-cat6-0.5-blau') });
  check('L2: ohne Uplink kein Ping', JSON.stringify(done()) === '[true,true,false]', JSON.stringify(done()));
  await send({ action: 'link', from: 'sw1/24', to: 'sw2/24', cable: cable('patch-cat6-0.25-blau') });
  check('L2: mit Uplink alle Ziele', done().every(Boolean), JSON.stringify(done()));
}

// --- L3 -------------------------------------------------------------------------------------
{
  const { send, st, done } = await play('L3');
  let r = await send({ action: 'console_open', device: 'sw1', from: 'nb1' });
  check('L3: Konsole ohne Konsolkabel -> reject', r.type === 'reject', `(${r.reason})`);
  r = await send({ action: 'link', from: 'nb1/01', to: 'sw1/03', cable: cable('konsolkabel-usb-3.0') });
  check('L3: Konsolkabel an RJ45 -> reject (Klasse)', r.type === 'reject', `(${r.reason})`);
  r = await send({ action: 'link', from: 'nb1/con', to: 'sw1/con', cable: cable('konsolkabel-usb-3.0') });
  check('L3: Konsolkabel NB1 -> sw1 CON', r.type === 'ack' && st().links.some((l: any) => l.console?.to === 'sw1'));
  r = await send({ action: 'console_open', device: 'sw1', from: 'nb1' });
  const sid = r.session;
  check('L3: Konsole offen', r.type === 'ack' && r.prompt === 'sw1>', `(${r.prompt})`);
  for (const line of ['enable', 'configure terminal', 'interface vlan 1', 'ip address 192.168.1.2 255.255.255.0', 'end']) {
    r = await send({ action: 'console', session: sid, line });
  }
  check('L3: Verwaltungsadresse gesetzt -> Ziel 1', done()[0] === true && done()[1] === false, JSON.stringify(done()));
  r = await send({ action: 'console', session: sid, line: 'write memory' });
  check('L3: write memory -> Ziel 2', done()[1] === true, `(${r.lines.join(' | ')})`);
  r = await send({ action: 'link', from: 'nb1/01', to: 'sw1/03', cable: cable('patch-cat6-5.0-grau') });
  await send({ action: 'set_ip', device: 'nb1', ip: '192.168.1.50', mask: '255.255.255.0' });
  check('L3: NB1 am Netz, Ping auf Switch -> alle Ziele', r.type === 'ack' && done().every(Boolean), JSON.stringify(done()));
  r = await send({ action: 'ssh', from: 'nb1', target: '192.168.1.2', user: 'admin', password: 'Geheim123' });
  check('L3: ssh auf L2-Switch -> klare Ablehnung (leyoNET: nur Layer 3)', r.type === 'reject' && /Layer-3|L3/.test(r.reason), `(${r.reason})`);
  r = await send({ action: 'ssh', from: 'nb1', target: '192.168.9.9', user: 'admin', password: 'x' });
  check('L3: ssh auf unerreichbare Adresse -> reject', r.type === 'reject' && /nicht erreichbar/.test(r.reason), `(${r.reason})`);
}
// --- KVM (Konsolserver im Rack) ------------------------------------------------------------------
{
  const { send } = await play('L7');
  let r = await send({ action: 'console_open', device: 'cs1', from: 'kvm1' });
  check('KVM: Konsole auf cs1 ohne Konsolkabel', r.type === 'ack' && /cs1/.test(r.prompt), `(${r.prompt})`);
  r = await send({ action: 'console_open', device: 'nb1', from: 'kvm1' });
  check('KVM: Notebooks nicht ueber KVM', r.type === 'reject', `(${r.reason})`);
  r = await send({ action: 'console_open', device: 'cs1', from: 'nb1' });
  check('Laptop ohne Konsolkabel weiterhin abgelehnt', r.type === 'reject', `(${r.reason})`);
}

// --- L4 Router -------------------------------------------------------------------------------
{
  const { send, done } = await play('L4');
  let r = await send({ action: 'link', from: 'nb1/01', to: 'rt1/01', cable: cable('patch-cat6-5.0-grau') });
  await send({ action: 'link', from: 'nb2/01', to: 'rt1/02', cable: cable('patch-cat6-5.0-grau') });
  await send({ action: 'link', from: 'nb1/con', to: 'rt1/con', cable: cable('konsolkabel-usb-3.0') });
  r = await send({ action: 'console_open', device: 'rt1', from: 'nb1' });
  const sid = r.session;
  check('L4: Konsole am Router', r.type === 'ack' && /rt1/.test(r.prompt), `(${r.prompt})`);
  for (const line of ['enable', 'configure terminal', 'interface eth0', 'ip address 192.168.10.1 255.255.255.0',
    'interface eth1', 'ip address 192.168.20.1 255.255.255.0', 'end']) r = await send({ action: 'console', session: sid, line });
  check('L4: Router-Adressen -> Ziele 1+2', done()[0] && done()[1] && !done()[2], JSON.stringify(done()));
  await send({ action: 'set_ip', device: 'nb1', ip: '192.168.10.10', mask: '255.255.255.0', gateway: '192.168.10.1' });
  r = await send({ action: 'set_ip', device: 'nb2', ip: '192.168.20.10', mask: '255.255.255.0', gateway: '192.168.20.1' });
  check('L4: Gateways gesetzt -> Ping ueber den Router, alle Ziele', r.type === 'ack' && done().every(Boolean), JSON.stringify(done()));
  for (const line of ['configure terminal', 'username admin password Geheim123', 'ip ssh', 'end']) await send({ action: 'console', session: sid, line });
  r = await send({ action: 'ssh', from: 'nb1', target: '192.168.10.1', user: 'admin', password: 'Geheim123' });
  check('L4: ssh admin@192.168.10.1 vom NB1 (Router: Layer 3)', r.type === 'ack' && !!r.session, `(${r.prompt ?? r.reason})`);
  if (r.session) {
    r = await send({ action: 'console', session: r.session, line: 'show ip route' });
    check('L4: ueber ssh: show ip route zeigt beide Netze', r.lines.some((x: string) => x.includes('192.168.10.0')) && r.lines.some((x: string) => x.includes('192.168.20.0')), `(${r.lines.length} Zeilen)`);
  }
}

// --- L5 Firewall -----------------------------------------------------------------------------
{
  const { send, done } = await play('L5');
  check('L5: am Anfang kein Ziel erfuellt (noPing zaehlt erst mit Netz)', done().every((x: boolean) => !x), JSON.stringify(done()));
  await send({ action: 'link', from: 'nb1/01', to: 'fw1/02', cable: cable('patch-cat6-5.0-grau') });
  await send({ action: 'link', from: 'nb2/01', to: 'fw1/03', cable: cable('patch-cat6-5.0-grau') });
  await send({ action: 'link', from: 'nb1/con', to: 'fw1/con', cable: cable('konsolkabel-usb-3.0') });
  let r = await send({ action: 'console_open', device: 'fw1', from: 'nb1' });
  const sid = r.session;
  for (const line of ['enable', 'configure terminal', 'interface eth1', 'ip address 192.168.1.1 255.255.255.0',
    'interface eth2', 'ip address 192.168.2.1 255.255.255.0', 'end']) r = await send({ action: 'console', session: sid, line });
  await send({ action: 'set_ip', device: 'nb1', ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1' });
  await send({ action: 'set_ip', device: 'nb2', ip: '192.168.2.10', mask: '255.255.255.0', gateway: '192.168.2.1' });
  check('L5: LAN -> DMZ geht, DMZ -> LAN ab Werk auch (Ziel 2 offen)', done()[0] && !done()[1], JSON.stringify(done()));
  for (const line of ['configure terminal', 'firewall rule 1 deny ip any 192.168.1.0/24 in dmz', 'end']) {
    r = await send({ action: 'console', session: sid, line });
  }
  check('L5: Regel deny in dmz -> LAN erreicht DMZ, DMZ nicht das LAN', done()[0] && done()[1], JSON.stringify(done()));
  r = await send({ action: 'console', session: sid, line: 'write memory' });
  check('L5: write memory -> alle Ziele', done().every(Boolean), JSON.stringify(done()));
}
// --- L6 Glasfaser -----------------------------------------------------------------------------
{
  const { send, st, done } = await play('L6');
  await send({ action: 'link', from: 'sw1/07', to: 'pp1/07', cable: cable('patch-cat6-0.25-blau') });
  await send({ action: 'link', from: 'pp1/13', to: 'sw2/13', cable: cable('patch-cat6-0.5-blau') });
  await send({ action: 'buy', item: 'lwl-om3-1.0' });
  let r = await send({ action: 'link', from: 'sw1/25', to: 'sw2/25', cable: cable('lwl-om3-1.0') });
  check('L6: Glasfaser ohne Modul -> reject mit Hinweis', r.type === 'reject' && /SFP-Modul/.test(r.reason), `(${r.reason})`);
  r = await send({ action: 'link', from: 'sw1/24', to: 'sw2/24', cable: cable('lwl-om3-1.0') });
  check('L6: Glasfaserkabel an Kupferport -> reject (Klasse)', r.type === 'reject', `(${r.reason})`);
  r = await send({ action: 'buy', item: 'sfp-1g-sx' });
  const r2 = await send({ action: 'buy', item: 'sfp-1g-lx' });
  check('L6: SFP-Module gekauft (SX + LX)', r.type === 'ack' && r2.type === 'ack', `(Budget ${st().budget})`);
  r = await send({ action: 'sfp_insert', port: 'sw1/25', item: 'sfp-1g-sx' });
  check('L6: SFP einsetzen -> Zustand sfp', r.type === 'ack' && st().sfp['sw1/25'] === '1G-SX' && st().inventory['sfp-1g-sx'] === 0);
  r = await send({ action: 'sfp_insert', port: 'sw1/25', item: 'sfp-1g-lx' });
  check('L6: belegter Einschub -> reject', r.code === 'occupied', `(${r.reason})`);
  r = await send({ action: 'sfp_insert', port: 'sw2/25', item: 'sfp-1g-lx' });
  check('L6: LX in sw2/25', r.type === 'ack', `(${r.reason ?? ''})`);
  r = await send({ action: 'link', from: 'sw1/25', to: 'sw2/25', cable: cable('lwl-om3-1.0') });
  check('L6: SX <-> LX: Kabel steckt, aber kein Link (sfpMismatch)', r.type === 'ack' && !done()[2] && st().leds['sw1/led_p25'] === 'off', JSON.stringify(done()));
  r = await send({ action: 'sfp_remove', port: 'sw2/25' });
  check('L6: Modul mit Kabel entfernen -> reject', r.code === 'occupied', `(${r.reason})`);
  await send({ action: 'unlink', port: 'sw2/25' });
  r = await send({ action: 'sfp_remove', port: 'sw2/25' });
  check('L6: LX-Modul zurueck ins Inventar', r.type === 'ack' && st().inventory['sfp-1g-lx'] === 1 && !st().sfp['sw2/25']);
  await send({ action: 'buy', item: 'sfp-1g-sx' });
  await send({ action: 'sfp_insert', port: 'sw2/25', item: 'sfp-1g-sx' });
  r = await send({ action: 'link', from: 'sw1/25', to: 'sw2/25', cable: cable('lwl-om3-1.0') });
  check('L6: SX <-> SX: Glasfaser-Link up, LED p25 an, alle Ziele', r.type === 'ack' && done().every(Boolean) && st().leds['sw1/led_p25'] === 'on', JSON.stringify(done()));
}
// --- L7 Core-Switch ---------------------------------------------------------------------------
{
  const { send, done } = await play('L7');
  await send({ action: 'link', from: 'nb1/01', to: 'cs1/01', cable: cable('patch-cat6-5.0-grau') });
  await send({ action: 'link', from: 'nb2/01', to: 'cs1/02', cable: cable('patch-cat6-5.0-grau') });
  let r = await send({ action: 'console_open', device: 'cs1', from: 'kvm1' });
  const sid = r.session;
  check('L7: KVM-Konsole am Core-Switch', r.type === 'ack' && /cs1/.test(r.prompt), `(${r.prompt})`);
  for (const line of ['enable', 'configure terminal', 'vlan 10', 'vlan 20', 'interface port1', 'switchport access vlan 10',
    'interface port2', 'switchport access vlan 20', 'interface vlan 10', 'ip address 192.168.10.1 255.255.255.0',
    'interface vlan 20', 'ip address 192.168.20.1 255.255.255.0', 'end']) await send({ action: 'console', session: sid, line });
  check('L7: VLANs zugeordnet -> Ziele 1+2', done()[0] && done()[1] && !done()[2], JSON.stringify(done()));
  await send({ action: 'set_ip', device: 'nb1', ip: '192.168.10.10', mask: '255.255.255.0', gateway: '192.168.10.1' });
  await send({ action: 'set_ip', device: 'nb2', ip: '192.168.20.10', mask: '255.255.255.0', gateway: '192.168.20.1' });
  check('L7: Routing zwischen VLANs -> Ping', done()[2], JSON.stringify(done()));
  for (const line of ['configure terminal', 'username admin password Geheim123', 'ip ssh', 'end']) await send({ action: 'console', session: sid, line });
  r = await send({ action: 'ssh', from: 'nb1', target: '192.168.10.1', user: 'admin', password: 'Geheim123' });
  check('L7: ssh admin@192.168.10.1 auf den L3-Switch -> alle Ziele', r.type === 'ack' && done().every(Boolean), `(${r.prompt ?? r.reason}) ${JSON.stringify(done())}`);
}
// Plan v4 F: der Server spielt das Protokoll nach (server-kern.js) und muss zum selben Urteil kommen
for (const id of new Set(runs.map((r) => r.id))) {
  const done = (r: any) => r.goals().filter((g: any) => g.done).length;
  const best = runs.filter((r) => r.id === id).sort((a, b) => done(b) - done(a))[0];
  const r = await replay({ level: id, intents: JSON.parse(JSON.stringify(best.log)) });
  check(`${id}: Nachspiel auf dem Server = Spiel`, r.done === done(best) && r.done > 0, `(${r.done}/${r.total} Ziele, ${best.log.length} Schritte)`);
}
process.exit(ok ? 0 : 1);
