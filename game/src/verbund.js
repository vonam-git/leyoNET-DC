// Verbundsaufgaben (2026-11-23): Jeder Arbeitsplatz baut einen Standort (Rechenzentrum) und schliesst ihn an den Verbund der Klasse an.
// Adressplan und Zusammensetzen der Netze wie im Klassen-Verbund von leyoNET (vendor/leyonet/src/core/model/federation.ts,
// docs/verbund.md): Transitnetz 203.0.113.(4n)/30 je Platz n, Zentrale 198.51.100.10 (RFC 5737). Dazu je Platz ein oeffentliches Netz
// 192.0.2.(4n)/30. Diese Datei laeuft im Spiel UND auf dem Server (server-kern.js): gleiche Aufgabe, gleiche Pruefung.
//
// Uebergabe im Raum: Dose 24 am Patchpanel PP1 ist die Leitung des Providers. Wer dort Router oder Firewall ansteckt, haengt am Verbund.
import * as core from '../../vendor/leyonet/src/core/index.ts';
import { KATALOG } from './levels.js';

const val = (r) => {
  if (!r.ok) throw new Error(`leyoNET: ${r.error.code} ${JSON.stringify(r.error.params ?? {})}`);
  return r.value;
};
export const UEBERGABE = 'pp1/24';
export const PROVIDER_AS = 64500;
export const HUB_IP = '198.51.100.10';
export const HUB_NAME = 'zentrale.verbund.example';
export const REF_SEAT = 62; // Referenz-Standort der Zentrale: Partner, solange noch niemand am Partnerplatz sitzt

const ORTE = ['Aarau', 'Altdorf', 'Arbon', 'Baden', 'Basel', 'Bern', 'Biel', 'Brig', 'Brugg', 'Buchs', 'Burgdorf', 'Bülach', 'Chur', 'Davos', 'Delsberg', 'Dietikon', 'Frauenfeld', 'Freiburg', 'Genf', 'Glarus',
  'Gossau', 'Grenchen', 'Herisau', 'Horgen', 'Ilanz', 'Interlaken', 'Jona', 'Kloten', 'Köniz', 'Kreuzlingen', 'Landquart', 'Langenthal', 'Lausanne', 'Lenzburg', 'Liestal', 'Locarno', 'Lugano', 'Luzern', 'Lyss', 'Martigny',
  'Montreux', 'Muri', 'Neuenburg', 'Olten', 'Pratteln', 'Rapperswil', 'Romanshorn', 'Sarnen', 'Schwyz', 'Sion', 'Solothurn', 'Stans', 'Sursee', 'Thun', 'Uster', 'Vevey', 'Wil', 'Winterthur', 'Zofingen', 'Zug'];

/** Alles, was ein Platz braucht (Auftragsblatt, Ziele, Pruefung) */
export function seatPlan(n) {
  const t = 4 * n;
  return { seat: n, ort: ORTE[n - 1] ?? 'Referenz', as: 65000 + n, wan: `203.0.113.${t + 2}`, gw: `203.0.113.${t + 1}`, transit: `203.0.113.${t}/30`,
    pubNet: `192.0.2.${t}`, pub: `192.0.2.${t + 1}`, lan: (v) => `10.${n}.${v}`, pw: `Verbund-${(n * 7919) % 9000 + 1000}` };
}
/** Partnerplatz: 1-2, 3-4, ... Ist er leer, gilt der Referenz-Standort. */
export const partnerSeat = (n) => (n % 2 ? n + 1 : n - 1);

// ---------- Infrastruktur der Klasse ----------
let infraBase = null;
/** Provider + Zentrale (Web, DNS). Ohne Standorte. */
function infra() {
  if (infraBase) return infraBase;
  let t = core.emptyTopology();
  const add = (type, name, x, y, opt) => { const r = val(core.addDevice(t, type, name, { x, y }, opt)); t = r.topology; return r.id; };
  const prov = add('internet', 'Provider', 0, 0);
  const hub = add('server', 'Zentrale', 0, 200);
  t = val(core.setInterfaceAddress(t, prov, 0, '198.51.100.1', '24'));
  t = val(core.configureHost(t, hub, { ip: HUB_IP, mask: '255.255.255.0', gateway: '198.51.100.1', dns: HUB_IP }));
  t = val(core.setWebServerEnabled(t, hub, true, [{ path: '/index.html', content: '<h1>Zentrale</h1><p>Dein Standort ist mit dem Verbund verbunden.</p>' }]));
  t = val(core.setDnsServerEnabled(t, hub, true));
  t = val(core.addDnsRecord(t, hub, { name: HUB_NAME, type: 'A', value: HUB_IP, ttl: 3600 }));
  t = val(core.connect(t, prov, hub, 'tp', { a: 0, b: 0 })).topology;
  t = val(core.setVerbundProvider(t, prov, true));
  infraBase = t;
  return t;
}

/** Kleiner Standort der Zentrale bzw. Platzhalter fuer den Partner: Router mit 1:1-NAT und Webserver. level 'online' = ohne Webseite. */
function stub(seat, level) {
  const p = seatPlan(seat);
  let t = core.emptyTopology();
  const add = (type, name, opt) => { const r = val(core.addDevice(t, type, name, { x: 0, y: 0 }, opt)); t = r.topology; return r.id; };
  const rt = add('router', 'Router', { ports: 4 });
  const web = add('server', 'Webserver');
  t = val(core.setInterfaceAddress(t, rt, 0, p.wan, '30'));
  t = val(core.setInterfaceAddress(t, rt, 1, `${p.lan(30)}.1`, '24'));
  t = val(core.addStaticRoute(t, rt, { network: '0.0.0.0', mask: '0.0.0.0', gateway: p.gw }));
  t = val(core.setInterfaceNat(t, rt, 0, true));
  t = val(core.configureHost(t, web, { ip: `${p.lan(30)}.80`, mask: '255.255.255.0', gateway: `${p.lan(30)}.1`, dns: '' }));
  t = val(core.connect(t, rt, web, 'tp', { a: 1, b: 0 })).topology;
  if (level === 'services') {
    t = val(core.addStaticNat(t, rt, { inside: `${p.lan(30)}.80`, outside: p.pub }));
    t = val(core.setWebServerEnabled(t, web, true, [{ path: '/index.html', content: `<h1>Standort ${p.ort}</h1>` }]));
  }
  return val(core.setVerbund(t, rt, 0));
}

/**
 * Netz fuer Simulation und Pruefung: eigener Standort + Infrastruktur + Partner.
 * own: Topologie des Kerns, uplink: { device, iface } | null, names: leyoNET-ID -> Kern-ID (Hostnamen der Lernenden stoeren die Ziele nicht),
 * partner: { topology, uplink } | 'services' | 'online' | null (null = leerer Partnerplatz -> Referenz-Standort antwortet).
 */
export function verbundTopology({ task, seat, own, uplink, names = new Map(), partner = null }) {
  const strip = (d) => { const { verbund: _v, ...rest } = d; return rest; };
  const mark = (t, up, map = null) => ({ ...t, devices: t.devices.map((d) => {
    const x = { ...strip(d), ...(map?.has(d.id) ? { name: map.get(d.id) } : {}) };
    return up && d.id === up.device ? { ...x, verbund: { iface: up.iface } } : x;
  }) });
  const pSeat = partner === null ? REF_SEAT : partnerSeat(seat);
  const pTopo = partner === null || typeof partner === 'string' ? (partner === 'offline' ? null : stub(pSeat, partner ?? 'services')) : mark(partner.topology, partner.uplink);
  const sites = [{ seat, label: 'ich', topology: mark(own, uplink, names), own: true }];
  if (pTopo) sites.push({ seat: pSeat, label: `Standort ${seatPlan(pSeat).ort}`, topology: pTopo });
  const f = core.federate(infra(), sites);
  let t = f.topology;
  // Routen des Providers zu den oeffentlichen Netzen der Standorte: fest eingetragen, bei Aufgaben mit BGP nur ueber BGP
  const bgp = !!TASK.get(task)?.bgp;
  const neighbors = [];
  for (const s of f.sites) {
    if (!s.uplink) continue;
    const p = seatPlan(s.seat);
    if (bgp && s.seat === seat) neighbors.push({ ip: p.wan, remoteAs: p.as });
    else if (bgp && typeof partner === 'object' && partner !== null) neighbors.push({ ip: p.wan, remoteAs: p.as });
    else t = val(core.addStaticRoute(t, f.provider, { network: p.pubNet, mask: '255.255.255.252', gateway: p.wan }));
  }
  if (bgp) t = val(core.setBgp(t, f.provider, { asn: PROVIDER_AS, neighbors, networks: [{ network: '198.51.100.0', mask: '255.255.255.0' }], redistribute: ['connected', 'static'] }));
  return t;
}

/** Pruefbaustein fuer diesen Platz: '@partnerWan' / '@partnerPub' durch die Adresse des Partners ersetzen */
export function partnerGoal(check, seat, partner) {
  const p = seatPlan(partner === null ? REF_SEAT : partnerSeat(seat));
  const fill = (v) => (typeof v === 'string' ? v.replace('@partnerWan', p.wan).replace('@partnerPub', p.pub) : v);
  return Object.fromEntries(Object.entries(check).map(([k, v]) => [k, fill(v)]));
}

// ---------- Aufgaben ----------
const pc = (name) => ({ name, type: 'pc', dhcp: true });
const srv = (p) => ({ name: 'Webserver', type: 'server', ip: `${p.lan(30)}.80`, mask: '255.255.255.0', gateway: `${p.lan(30)}.1`, web: `<h1>Standort ${p.ort}</h1><p>Platz ${p.seat}</p>` });
const uebergabe = { name: 'Verbund-Übergabe', type: 'internet' };
const core_ = (id, text, check, requires) => ({ id, typ: 'core', text, check, ...(requires ? { requires } : {}) });
const saved = (id, dev, requires) => core_(id, `${dev.toUpperCase()}: Konfiguration gespeichert (write memory)`, { type: 'configSaved', device: dev }, requires);
const power = (...devices) => ({ id: 'gs', typ: 'power', devices, text: `${devices.map((d) => d.toUpperCase()).join(', ')} mit Strom versorgen` });
const link = (dev) => ({ id: 'up', typ: 'link_any', a: UEBERGABE, b_device: dev, text: `Verbund-Übergabe (PP1 Dose 24) an ${dev.toUpperCase()} ETH0/WAN gepatcht` });
const online = (requires) => core_('on', 'Die Zentrale erreicht deinen Standort (Ping auf die WAN-Adresse)', { type: 'verbundSite' }, requires);
const http = (id, text, from, url, requires) => core_(id, text, { type: 'http', from, url }, requires);

export const TASKS = [
  {
    id: 'V1', sterne: 1, titel: 'Anschluss ans Alpennetz', dauer: 30, themen: ['Rack', 'WAN', 'Standardroute'],
    story: 'Das Alpennetz verbindet Rechenzentren im ganzen Land. Dein Standort ist neu: ein leerer Raum und eine Leitung des Providers, die an Dose 24 des Patchpanels PP1 endet. Bring den Standort ans Netz.',
    bedarf: 'Rack, Patchpanel, Router, Notebook mit Konsolkabel (oder KVM), Patch- und Stromkabel',
    schritte: (p) => ['Rack aufstellen, Patchpanel (PP1) und Router (RT1) einbauen, RT1 mit Strom versorgen.', 'RT1 ETH0 auf Dose 24 von PP1 patchen (Verbund-Übergabe).',
      `An der Konsole: eth0 = ${p.wan}/30, Standardroute zu ${p.gw}.`, 'Von der Konsole die Zentrale pingen und die Konfiguration speichern.'],
    blatt: () => [],
    budget: 3200, aufbau: { 'rack-42he': 1, 'patchpanel-24': 1, 'router-4': 1, notebook: 1 },
    dosen: () => ({ [UEBERGABE]: uebergabe }),
    ziele: (p) => [power('rt1'), link('rt1'), core_('ad', `RT1 eth0 = ${p.wan}/30`, { type: 'address', device: 'rt1', address: `${p.wan}/30` }),
      core_('dr', `RT1: Standardroute zu ${p.gw}`, { type: 'defaultRoute', device: 'rt1', gateway: p.gw }), online('up'), saved('sv', 'rt1', 'on')],
  },
  {
    id: 'V2', sterne: 2, titel: 'Das Büro geht online', dauer: 45, themen: ['DHCP', 'NAT', 'DNS'],
    story: 'Am Standort ziehen Leute ein. Die Büro-PCs hinter Dose 07 und 08 beziehen ihre Adresse per DHCP und sollen ins Netz der Zentrale – private Adressen lässt der Provider aber nicht durch.',
    bedarf: 'wie ★, dazu ein Switch',
    schritte: (p) => ['Standort wie in ★ anschliessen (WAN, Standardroute).', `LAN an RT1 eth1 = ${p.lan(10)}.1/24, SW1 anschliessen, Dose 07 und 08 auf SW1 patchen.`,
      `DHCP-Pool für ${p.lan(10)}.0/24 mit Gateway ${p.lan(10)}.1 und DNS ${HUB_IP}.`, 'NAT am WAN-Anschluss einschalten, testen, speichern.'],
    blatt: (p) => [['LAN Büro', `${p.lan(10)}.0/24 · RT1 eth1 = ${p.lan(10)}.1`], ['DHCP', `Pool ${p.lan(10)}.0/24, Gateway ${p.lan(10)}.1, DNS ${HUB_IP}`], ['Clients', 'Büro 1 (Dose 07), Büro 2 (Dose 08): DHCP']],
    budget: 4200, aufbau: { 'rack-42he': 1, 'patchpanel-24': 1, 'router-4': 1, 'switch-24': 1, notebook: 1 },
    dosen: () => ({ [UEBERGABE]: uebergabe, 'pp1/07': pc('Büro 1'), 'pp1/08': pc('Büro 2') }),
    ziele: (p) => [power('rt1', 'sw1'), link('rt1'), online('up'),
      core_('d1', 'Büro 1 erhält eine Adresse mit DNS der Zentrale (DHCP)', { type: 'dhcpLease', device: 'Büro 1', dns: HUB_IP }),
      core_('d2', 'Büro 2 erhält eine Adresse mit DNS der Zentrale (DHCP)', { type: 'dhcpLease', device: 'Büro 2', dns: HUB_IP }),
      http('w1', `Büro 1 öffnet http://${HUB_NAME}/`, 'Büro 1', `http://${HUB_NAME}/`),
      { ...core_('pa', 'Büro 2 erreicht den Partner-Standort (Ping auf dessen WAN-Adresse)', { type: 'ping', from: 'Büro 2', to: '@partnerWan' }), gemeinsam: true }, saved('sv', 'rt1', 'w1')],
  },
  {
    id: 'V3', sterne: 3, titel: 'Drei Zonen und ein Webauftritt', dauer: 70, themen: ['VLAN', 'Trunk', 'Router-on-a-Stick', '1:1-NAT'],
    story: 'Büro, Gäste und Server gehören getrennt. Der Webserver des Standorts soll aus dem ganzen Verbund erreichbar sein – unter einer eigenen öffentlichen Adresse.',
    bedarf: 'wie ★★',
    schritte: (p) => ['Standort anschliessen, NAT am WAN-Anschluss.', 'SW1: VLAN 10 Büro (Dose 07), 20 Gäste (Dose 08), 30 Server (Dose 10); Trunk zu RT1.',
      `RT1: Subinterfaces eth1.10, eth1.20, eth1.30 (je .1), DHCP für VLAN 10 und 20.`, `Webserver ${p.lan(30)}.80 per statischem NAT unter ${p.pub} veröffentlichen.`, 'Webseite des Partners vom Büro aus öffnen, beide Geräte speichern.'],
    blatt: (p) => [['VLAN 10 Büro', `${p.lan(10)}.0/24 · Dose 07 · DHCP`], ['VLAN 20 Gäste', `${p.lan(20)}.0/24 · Dose 08 · DHCP`], ['VLAN 30 Server', `${p.lan(30)}.0/24 · Dose 10 · Webserver ${p.lan(30)}.80 (fertig eingerichtet)`],
      ['Öffentlich', `${p.pub} → Webserver (statisches NAT)`], ['DNS', HUB_IP]],
    budget: 4500, aufbau: { 'rack-42he': 1, 'patchpanel-24': 1, 'router-4': 1, 'switch-24': 1, notebook: 1 },
    dosen: (p) => ({ [UEBERGABE]: uebergabe, 'pp1/07': pc('Büro'), 'pp1/08': pc('Gast'), 'pp1/10': srv(p) }),
    ziele: (p) => [power('rt1', 'sw1'), link('rt1'), online('up'), core_('tr', 'Trunk RT1 – SW1 mit VLAN 10, 20, 30', { type: 'trunk', a: 'rt1', b: 'sw1', vlans: [10, 20, 30] }),
      core_('v1', 'Büro in VLAN 10', { type: 'hostVlan', device: 'Büro', vlan: 10 }), core_('v2', 'Gast in VLAN 20', { type: 'hostVlan', device: 'Gast', vlan: 20 }), core_('v3', 'Webserver in VLAN 30', { type: 'hostVlan', device: 'Webserver', vlan: 30 }),
      core_('d1', 'Büro erhält eine Adresse per DHCP', { type: 'dhcpLease', device: 'Büro', dns: HUB_IP }), core_('d2', 'Gast erhält eine Adresse per DHCP', { type: 'dhcpLease', device: 'Gast', dns: HUB_IP }),
      http('w1', `Gast öffnet http://${HUB_NAME}/`, 'Gast', `http://${HUB_NAME}/`), http('w2', `Die Zentrale öffnet deine Webseite http://${p.pub}/`, 'Zentrale', `http://${p.pub}/`),
      { ...http('pa', 'Büro öffnet die Webseite des Partner-Standorts', 'Büro', 'http://@partnerPub/'), gemeinsam: true }, saved('s1', 'rt1', 'w2'), saved('s2', 'sw1', 'v3')],
  },
  {
    id: 'V4', sterne: 4, titel: 'Festung mit Schaufenster', dauer: 90, themen: ['Firewall', 'DMZ', 'Glasfaser', 'SSH'],
    story: 'Nach einem Angriff auf einen Nachbarstandort verlangt die Zentrale eine Firewall: Der Webserver steht in der DMZ und ist nur auf Port 80 offen, aus der DMZ kommt niemand ins Büro. Der zweite Switch hängt an Glasfaser.',
    bedarf: 'Rack, Patchpanel, Firewall, 2 Switches, 2 gleiche SFP-Module, Glasfaserkabel, Notebook',
    schritte: (p) => ['FW1 statt Router: WAN an die Übergabe, LAN an SW1, DMZ an Dose 10 (Webserver).', `eth0 = ${p.wan}/30, eth1 = ${p.lan(10)}.1/24, eth2 = ${p.lan(30)}.1/24, Standardroute, NAT am WAN, DHCP fürs LAN.`,
      'SW1 – SW2 per Glasfaser; Büro 1 (Dose 07) an SW1, Büro 2 (Dose 08) an SW2.', `Webserver unter ${p.pub} veröffentlichen, von aussen nur TCP 80 erlauben.`, 'DMZ darf nicht ins LAN, LAN darf in die DMZ.',
      `Fernwartung: Benutzer admin, Passwort ${p.pw}, SSH von NB1 (LAN).`, 'Alles speichern.'],
    blatt: (p) => [['LAN', `${p.lan(10)}.0/24 · FW1 eth1 = ${p.lan(10)}.1 · DHCP, DNS ${HUB_IP}`], ['DMZ', `${p.lan(30)}.0/24 · FW1 eth2 = ${p.lan(30)}.1 · Webserver ${p.lan(30)}.80 (Dose 10)`], ['Öffentlich', `${p.pub} → Webserver, nur TCP 80`],
      ['SSH', `Benutzer admin, Passwort ${p.pw}`], ['Notebook NB1', `${p.lan(10)}.200/24, Gateway ${p.lan(10)}.1`]],
    budget: 6500, aufbau: { 'rack-42he': 1, 'patchpanel-24': 1, 'firewall-4': 1, 'switch-24': 2, notebook: 1, 'sfp-1g-sx': 2 },
    dosen: (p) => ({ [UEBERGABE]: uebergabe, 'pp1/07': pc('Büro 1'), 'pp1/08': pc('Büro 2'), 'pp1/10': srv(p) }),
    ziele: (p) => [power('fw1', 'sw1', 'sw2'), link('fw1'), core_('ad', `FW1 eth0 = ${p.wan}/30`, { type: 'address', device: 'fw1', address: `${p.wan}/30` }),
      { id: 'lw', typ: 'fiber_link', a_device: 'sw1', b_device: 'sw2', text: 'Glasfaser SW1 – SW2 aktiv' }, { id: 'p2', typ: 'link_any', a: 'pp1/08', b_device: 'sw2', text: 'Büro 2 (Dose 08) an SW2' },
      core_('d1', 'Büro 2 erhält über die Glasfaser eine Adresse (DHCP)', { type: 'dhcpLease', device: 'Büro 2', dns: HUB_IP }, 'lw'), http('w1', `Büro 1 öffnet http://${HUB_NAME}/`, 'Büro 1', `http://${HUB_NAME}/`),
      http('w2', `Die Zentrale öffnet http://${p.pub}/`, 'Zentrale', `http://${p.pub}/`), http('w3', 'Büro 1 öffnet den Webserver in der DMZ', 'Büro 1', `http://${p.lan(30)}.80/`),
      core_('n1', 'Von aussen nur Port 80: Die Zentrale kann den Webserver nicht pingen', { type: 'noPing', from: 'Zentrale', to: p.pub }, 'w2'),
      core_('n2', 'Aus der DMZ kommt niemand ins LAN', { type: 'noPing', from: 'Webserver', to: 'Büro 1' }, 'w3'), { id: 'sh', typ: 'ssh_login', device: 'fw1', text: 'SSH-Anmeldung an FW1 von NB1' },
      { ...http('pa', 'Büro 2 öffnet die Webseite des Partner-Standorts', 'Büro 2', 'http://@partnerPub/'), gemeinsam: true }, saved('s1', 'fw1', 'w2')],
  },
  {
    id: 'V5', sterne: 5, titel: 'Eigenes autonomes System', dauer: 120, themen: ['BGP', 'OSPF', 'Layer 3', 'ACL', 'Glasfaser'], bgp: true,
    story: 'Dein Standort wird ein vollwertiger Teilnehmer: eigenes AS, der Provider lernt dein öffentliches Netz nur noch per BGP. Innen routet ein Core-Switch, OSPF verteilt die Wege. Statische Standardrouten sind tabu.',
    bedarf: 'Rack, Patchpanel, Router, Core-Switch, Switch, 2 SFP-Module, Glasfaserkabel, Notebook',
    schritte: (p) => [`RT1 eth0 = ${p.wan}/30, BGP AS ${p.as} mit dem Provider (${p.gw}, AS ${PROVIDER_AS}). Keine Standardroute.`, `Öffentliches Netz ${p.pubNet}/30 per BGP ankündigen (es muss in der Routingtabelle stehen: ip route … zum Core-Switch).`,
      `Transit RT1 eth1 (${p.lan(0)}.1/30) – CS1 VLAN 99 (${p.lan(0)}.2/30), OSPF Area 0; RT1 verteilt BGP-Routen nach OSPF.`, 'CS1: VLAN 10 Büro, 20 Gäste, 30 Server mit .1 als Gateway, DHCP für 10 und 20, alles in OSPF.',
      'CS1 – SW1 per Glasfaser als Trunk; Büro (Dose 07) und Gast (Dose 08) an SW1, Webserver (Dose 10) an CS1.', `NAT am WAN, Webserver unter ${p.pub}.`, 'ACL auf CS1: Gäste dürfen nicht ins Server-VLAN (aber ins Internet).',
      `SSH auf CS1: admin / ${p.pw}, Anmeldung von NB1 im Büro-VLAN. Alles speichern.`],
    blatt: (p) => [['BGP', `AS ${p.as} ↔ Provider ${p.gw} AS ${PROVIDER_AS}`], ['Ankündigen', `${p.pubNet}/30`], ['Transit', `VLAN 99 · ${p.lan(0)}.0/30 · RT1 .1, CS1 .2 · OSPF Area 0`], ['VLAN 10 Büro', `${p.lan(10)}.0/24 · Dose 07 · DHCP`], ['VLAN 20 Gäste', `${p.lan(20)}.0/24 · Dose 08 · DHCP`],
      ['VLAN 30 Server', `${p.lan(30)}.0/24 · Dose 10 · Webserver ${p.lan(30)}.80`], ['Öffentlich', `${p.pub} → Webserver`], ['SSH CS1', `admin / ${p.pw}`], ['Notebook NB1', `${p.lan(10)}.200/24, Gateway ${p.lan(10)}.1`]],
    budget: 9000, aufbau: { 'rack-42he': 1, 'patchpanel-24': 1, 'router-4': 1, 'coreswitch-24': 1, 'switch-24': 1, notebook: 1, 'sfp-1g-sx': 2 },
    dosen: (p) => ({ [UEBERGABE]: uebergabe, 'pp1/07': pc('Büro'), 'pp1/08': pc('Gast'), 'pp1/10': srv(p) }),
    ziele: (p) => [power('rt1', 'cs1', 'sw1'), link('rt1'), online('up'), core_('bn', `BGP-Nachbarschaft mit dem Provider (AS ${PROVIDER_AS})`, { type: 'neighbors', device: 'rt1', protocol: 'bgp' }),
      core_('br', 'RT1 lernt das Netz der Zentrale per BGP', { type: 'routeLearned', device: 'rt1', network: '198.51.100.0/24', protocol: 'bgp' }), core_('pr', `Der Provider lernt ${p.pubNet}/30 per BGP`, { type: 'routeLearned', device: 'Provider', network: `${p.pubNet}/30`, protocol: 'bgp' }),
      core_('on2', 'OSPF-Nachbarschaft RT1 – CS1', { type: 'neighbors', device: 'cs1', protocol: 'ospf' }), core_('or', 'CS1 lernt das Netz der Zentrale per OSPF', { type: 'routeLearned', device: 'cs1', network: '198.51.100.0/24', protocol: 'ospf' }),
      { id: 'nd', typ: 'no_default', device: 'rt1', text: 'RT1 ohne statische Standardroute', requires: 'br' }, { id: 'lw', typ: 'fiber_link', a_device: 'cs1', b_device: 'sw1', text: 'Glasfaser CS1 – SW1 aktiv' },
      core_('tr', 'Trunk CS1 – SW1 mit VLAN 10 und 20', { type: 'trunk', a: 'cs1', b: 'sw1', vlans: [10, 20] }), core_('d1', 'Büro erhält eine Adresse per DHCP', { type: 'dhcpLease', device: 'Büro', dns: HUB_IP }),
      core_('d2', 'Gast erhält eine Adresse per DHCP', { type: 'dhcpLease', device: 'Gast', dns: HUB_IP }), http('w1', `Büro öffnet http://${HUB_NAME}/`, 'Büro', `http://${HUB_NAME}/`), http('wg', `Gast öffnet http://${HUB_NAME}/`, 'Gast', `http://${HUB_NAME}/`),
      http('w3', 'Büro öffnet den Webserver', 'Büro', `http://${p.lan(30)}.80/`), core_('n1', 'Gäste erreichen den Webserver intern nicht (ACL)', { type: 'noPing', from: 'Gast', to: `${p.lan(30)}.80` }, 'wg'),
      http('w2', `Die Zentrale öffnet http://${p.pub}/`, 'Zentrale', `http://${p.pub}/`), { id: 'sh', typ: 'ssh_login', device: 'cs1', text: 'SSH-Anmeldung an CS1 von NB1' },
      { ...http('pa', 'Büro öffnet die Webseite des Partner-Standorts', 'Büro', 'http://@partnerPub/'), gemeinsam: true }, saved('s1', 'rt1', 'w2'), saved('s2', 'cs1', 'w2')],
  },
];
const TASK = new Map(TASKS.map((t) => [t.id, t]));
export const taskById = (id) => TASK.get(id) ?? null;
/** Kurzform fuers Admin-Board (ohne Ziele je Platz) */
export const TASK_LIST = TASKS.map((t) => ({ id: t.id, sterne: t.sterne, titel: t.titel, dauer: t.dauer, themen: t.themen, story: t.story, bedarf: t.bedarf, goals: t.ziele(seatPlan(1)).map((g) => ({ id: g.id, text: g.text, gemeinsam: !!g.gemeinsam })) }));

/** Auftragsblatt fuer einen Platz: [{ k, v }] */
export function auftragsblatt(id, seat) {
  const t = TASK.get(id), p = seatPlan(seat);
  return { titel: t.titel, sterne: t.sterne, story: t.story, bedarf: t.bedarf, dauer: t.dauer, ort: p.ort, seat, schritte: t.schritte(p), zeilen: [['Standort', `${p.ort} (Platz ${seat})`], ['Übergabe', 'Patchpanel PP1, Dose 24'], ['WAN-Adresse', `${p.wan}/30`],
    ['Provider (Gateway)', p.gw], ['Zentrale', `${HUB_IP} · http://${HUB_NAME}/`], ...t.blatt(p)], partner: partnerSeat(seat) };
}

/** Level fuer das Spiel (gleiche Form wie levels.js) */
export function verbundLevel(id, seat) {
  const t = TASK.get(id);
  if (!t) return null;
  const p = seatPlan(seat);
  return { id, verbund: true, sterne: t.sterne, seat, tags: t.themen, title: `Verbund ${'★'.repeat(t.sterne)} ${t.titel}`, text: t.story, blatt: auftragsblatt(id, seat),
    scenario: { id: `${id}-${seat}`, modus: 'katalog', budget: t.budget, hardware_katalog: KATALOG, inventar: {}, dosen: t.dosen(p), verbund: { task: id, seat }, ziele: t.ziele(p) } };
}
