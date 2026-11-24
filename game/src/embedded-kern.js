// EmbeddedKern: das Spiel-Protokoll (LocalKern, docs/SCENARIO_API.md) auf dem echten leyoNET-Kern
// (vendor/leyonet/src/core, AGPL-3.0-or-later). Kabel, Link-LEDs, Ziele (inkl. Ping) und die
// Switch-Konsole (CLI) laufen im leyoNET-Simulationskern; Protokoll, Inventar und Katalog erbt
// EmbeddedKern von LocalKern.
//
// Abbildung Spiel -> leyoNET:
//   sw<n> (switch_24)  -> leyoNET 'switch' mit 24 Kupfer-Ports + 4 SFP-Einschueben
//                         Port 01..24 -> Index 0..23, 25..28 -> SFP-Slot (Index 24..27, Glasfaser
//                         braucht ein SFP-Modul), con -> Konsole (keine Netzverbindung),
//                         mgmt -> vorerst nicht verbindbar (leyoNET verwaltet in-band: interface vlan 1)
//   nb<n> (Notebook)   -> leyoNET 'notebook' (Port 01 = Ethernet), con = USB-Konsole (Konsolkabel)
//   cs<n> (Core-Switch)-> leyoNET 'l3switch' (24 + 4 SFP): VLANs, interface vlan N, ip routing, SSH
//   rt<n> (Router 1U)  -> leyoNET 'router', Port 01..04 = eth0..eth3; SSH moeglich (ip ssh)
//   fw<n> (Firewall)   -> leyoNET 'firewall', 01 WAN, 02 LAN, 03 DMZ, 04 OPT1 (ab Werk default deny,
//                         von innen erlaubt); SSH moeglich
//   pp<n> (Patchpanel) -> KEIN leyoNET-Geraet (passiv). Jede Dose fuehrt laut Szenario
//                         (`dosen: { 'pp1/07': { name, type, ip, mask } }`) zu einem Endgeraet;
//                         ein Kabel Switch <-> Dose wird zu Switch <-> Endgeraet. Dose ohne
//                         Endgeraet: Kabel liegt, aber kein Link (LED aus) - wie in echt.
import * as core from '../../vendor/leyonet/src/core/index.ts';
import { LocalKern } from './kern.js';
import { UEBERGABE, partnerGoal, verbundTopology } from './verbund.js';

const SIM_BOOT_MS = 10_000; // wie leyoNET tasks.ts: Netz hochfahren (STP, DHCP, OSPF/BGP), dann die Aktion
const SIM_ACTION_MS = 15_000;
/** Meldungen der Simulation im Geraetestil (wie leyoNET CliTerminal) */
function pingLine(code, p = {}) {
  switch (code) {
    case 'ping.reply': return `Reply from ${p.from}: bytes=${p.size} time=${p.time}ms TTL=${p.ttl}`;
    case 'ping.timeout': return 'Request timed out.';
    case 'ping.summary': return `Success rate is ${p.sent ? Math.round((Number(p.received) / Number(p.sent)) * 100) : 0} percent (${p.received}/${p.sent})`;
    case 'ping.noRoute': return '% Network unreachable (no route)';
    case 'ping.hostUnreachable': case 'ping.gatewayUnreachable': return '% Host unreachable (no ARP reply)';
    case 'ping.ttlExpired': return `TTL expired in transit (from ${p.from})`;
    case 'ping.hostUnreachableFrom': case 'ping.netUnreachableFrom': return `Destination unreachable (from ${p.from})`;
    default: return code.startsWith('ping.') && !code.startsWith('ping.start') ? `% ${code}` : null;
  }
}
const SWITCH_PORTS = 24;
const SWITCH_SFP = 4;
const val = (r) => {
  if (!r.ok) throw new Error(`leyoNET: ${r.error.code} ${JSON.stringify(r.error.params ?? {})}`);
  return r.value;
};

export class EmbeddedKern extends LocalKern {
  constructor({ manifest, scenario, kit = null }) {
    super({ manifest, scenario, kit });
    this.t = core.emptyTopology();
    this.coreId = new Map(); // Kern-ID (sw1) -> leyoNET-Geraete-ID (d1)
    this.dosen = new Map(); // 'pp1/07' -> leyoNET-ID des Endgeraets hinter der Dose
    this.sessions = new Map(); // Konsole: Sitzungs-ID -> { session, device }
    this.sshLogins = new Set(); // Kern-IDs, auf die ein SSH-Login gelungen ist (Zieltyp ssh_login)
    // Strom: eingeschaltete Geraete (Kern-IDs). Notebooks per Einschaltknopf (Akku), Netzgeraete
    // (sw/cs/rt/fw) per Stromkabel PSU <-> PDU-Steckdose. Aus = alle Anschluesse im leyoNET-Kern shutdown.
    this.powered = new Set();
    this.hardwired = new Set(); // Netzgeraete, die im Level schon fest am Strom haengen (nicht in scenario.ohne_strom)
    this.savedShut = new Map(); // Kern-ID -> shutdown-Flags der Anschluesse vor dem Ausschalten
    this.sessionDev = new Map(); // Sitzungs-ID -> Kern-ID (Konsole endet, wenn das Geraet ausgeht)
    this.nextSession = 1;
    this.trunks = []; // { id, a: 'pp1', b: 'pp3', item } - Patchpanel <-> Patchpanel ueber die Gitterrinnen; Tischdose (Plan v4 D):
    // { id, a: 'td1', b: 'pp1', first: 9, ports: 8, desk: true } - Dose 1..8 <-> Patchpanel-Port 9..16
    this.stash = new Map(); // Plan v4 D: Geraetetyp -> [leyoNET-Geraet ...] ausgebaute Geraete behalten ihre Konfiguration
    this._x = 0;
    for (const d of this.manifest.json.devices) this._coreAdd(d);
    const noPower = new Set(scenario?.ohne_strom ?? []);
    for (const id of this.coreId.keys()) {
      if (!/^(sw|cs|rt|fw)/.test(id)) continue;
      if (noPower.has(id)) this._setPower(id, false, true);
      else { this.hardwired.add(id); this.powered.add(id); }
    }
    for (const [ref, ep] of Object.entries(scenario?.dosen ?? {})) {
      const r = val(core.addDevice(this.t, ep.type ?? 'pc', ep.name, { x: (this._x += 120), y: 200 }));
      this.t = r.topology;
      if (ep.gateway || ep.dhcp) this.t = val(core.configureHost(this.t, r.id, { ip: ep.ip ?? '', mask: ep.mask ?? '', gateway: ep.gateway ?? '', dns: '', dhcp: !!ep.dhcp }));
      else if (ep.ip) this.t = val(core.setInterfaceAddress(this.t, r.id, 0, ep.ip, ep.mask ?? '255.255.255.0'));
      if (ep.web) this.t = val(core.setWebServerEnabled(this.t, r.id, true, [{ path: '/index.html', content: ep.web }]));
      this.dosen.set(ref, r.id);
    }
  }

  /** Ein Manifest-Geraet im leyoNET-Kern anlegen (Patchpanels/Server/PDUs: kein Kern-Geraet). */
  _coreAdd(d) {
    const pos = () => ({ x: (this._x += 120), y: d.id.startsWith('nb') ? 100 : 0 });
    let r = null;
    if (d.id.startsWith('sw')) {
      r = val(core.addDevice(this.t, 'switch', d.id, pos(), { ports: SWITCH_PORTS, sfpSlots: SWITCH_SFP }));
    } else if (d.id.startsWith('cs')) {
      // Core-Switch = leyoNET 'l3switch': VLAN-Routing (ip routing, interface vlan N) und SSH
      r = val(core.addDevice(this.t, 'l3switch', d.id, pos(), { ports: SWITCH_PORTS, sfpSlots: SWITCH_SFP }));
    } else if (d.id.startsWith('nb')) {
      r = val(core.addDevice(this.t, 'notebook', d.id, pos()));
      // Notebooks starten AUS: Netzwerkanschluss im Kern abgeschaltet, bis jemand sie einschaltet
      r.topology = val(core.setInterfaceShutdown(r.topology, r.id, 0, true));
    } else if (d.id.startsWith('rt')) {
      r = val(core.addDevice(this.t, 'router', d.id, pos(), { ports: 4 }));     // eth0..eth3
    } else if (d.id.startsWith('fw')) {
      r = val(core.addDevice(this.t, 'firewall', d.id, pos(), { ports: 4 }));   // WAN LAN DMZ OPT1
    }
    if (!r) return; // Patchpanels passiv, Server/PDU (noch) ohne Netz
    this.t = r.topology;
    this.coreId.set(d.id, r.id);
  }

  /** Plan v3: gekaufte Geraete zur Laufzeit. Netzgeraete brauchen ein Stromkabel (powered = Szenario-Aufbau). */
  _onInstall(rows, { powered = false } = {}) {
    for (const d of rows) {
      this._coreAdd(d);
      this._restore(d);
      if (/^(kvm|srv)/.test(d.id)) { if (powered) { this.hardwired.add(d.id); this.powered.add(d.id); } continue; }
      if (!/^(sw|cs|rt|fw)/.test(d.id) || !this.coreId.has(d.id)) continue;
      if (powered) { this.hardwired.add(d.id); this.powered.add(d.id); } else this._setPower(d.id, false, true);
    }
  }

  _onUninstall(rows) {
    for (const d of rows) {
      const cid = this.coreId.get(d.id);
      if (!cid) continue;
      this._stash(d, core.getDevice(this.t, cid));
      const r = core.removeDevice(this.t, cid);
      if (r.ok) this.t = r.value;
      this.coreId.delete(d.id);
      this.powered.delete(d.id);
      this.hardwired.delete(d.id);
      this.savedShut.delete(d.id);
      for (const [sid, dev] of this.sessionDev) if (dev === d.id) { this.sessions.delete(sid); this.sessionDev.delete(sid); }
    }
  }

  /** Vorkonfigurieren (Plan v4 D): Konfiguration + SFP-Module bleiben im ausgebauten Geraet, das zuletzt ausgebaute
   *  Geraet eines Typs wird zuerst wieder eingebaut. */
  _stash(row, dev) {
    if (!dev) return;
    const shut = row.id.startsWith('nb') ? null : this.savedShut.get(row.id);
    const list = this.stash.get(row.type) ?? [];
    list.push({ id: row.id, dev: { ...dev, interfaces: dev.interfaces.map((i, k) => (shut && !this.powered.has(row.id) ? { ...i, shutdown: shut[k] } : i)) } });
    this.stash.set(row.type, list);
  }

  _restore(row) {
    const cid = this.coreId.get(row.id);
    const old = cid && this.stash.get(row.type)?.pop();
    if (!old) return;
    const fresh = core.getDevice(this.t, cid);
    const dev = { ...old.dev, id: cid, x: fresh.x, y: fresh.y, name: old.dev.name === old.id ? fresh.name : old.dev.name };
    if (row.id.startsWith('nb')) dev.interfaces = dev.interfaces.map((i) => ({ ...i, shutdown: true })); // startet aus
    this.t = { ...this.t, devices: this.t.devices.map((d) => (d.id === cid ? dev : d)) };
    this.savedShut.delete(row.id);
  }

  /** Geraet ein-/ausschalten. Aus: alle Anschluesse shutdown (Konfiguration bleibt), an: alter Zustand. */
  _setPower(id, on, force = false) {
    if (!force && this.powered.has(id) === on) return;
    const cid = this.coreId.get(id);
    if (!cid) { // KVM, Server: kein Netz im leyoNET-Kern, nur Strom an/aus
      if (on) this.powered.add(id); else this.powered.delete(id);
      return;
    }
    const d = core.getDevice(this.t, cid);
    if (on) {
      const saved = this.savedShut.get(id) ?? d.interfaces.map(() => false);
      saved.forEach((sh, k) => { this.t = val(core.setInterfaceShutdown(this.t, cid, k, sh)); });
      this.powered.add(id);
    } else {
      if (!force || !this.savedShut.has(id)) this.savedShut.set(id, d.interfaces.map((i) => !!i.shutdown));
      d.interfaces.forEach((_, k) => { this.t = val(core.setInterfaceShutdown(this.t, cid, k, true)); });
      this.powered.delete(id);
      for (const [sid, dev] of this.sessionDev) if (dev === id) { this.sessions.delete(sid); this.sessionDev.delete(sid); }
    }
  }

  /** Netzgeraet hat Strom: fest verdrahtet oder Stromkabel an einer PDU-Steckdose */
  _hasPowerLink(id) {
    return this.hardwired.has(id) || this.links.some((l) => l.power === id);
  }

  /** Spiel-PortRef -> leyoNET-Endpunkt { device, iface } | { passive } | { error } */
  _endpoint(ref) {
    const [dev, port] = ref.split('/');
    if (/^(pdu|sl)\d/.test(dev)) return { outlet: ref }; // PDU im Rack, Steckdosenleiste am Pult
    // Plan v4: Strom fuer jedes Geraet mit Netzteil-Buchse (Netzgeraete, KVM, Server)
    if (port === 'psu') return this.manifest.byId.get(dev)?.ports?.psu ? { psu: dev } : { error: { code: 'rule', reason: `${dev} braucht hier keinen Strom` } };
    if (/^(pp|td)\d/.test(dev)) {
      const id = this.dosen.get(ref);
      if (id) return { device: id, iface: 0, via: ref };
      // Trunk: Port k dieses Patchpanels ist mit Port k des Partners durchgeschaltet -> Geraet am anderen Ende
      const far = this._trunkFar(ref);
      if (far) {
        const l = this.linkAt(far);
        const other = l && (l.a === far ? l.b : l.a);
        const e = other && !/^(pp|td)\d/.test(other) ? this._endpoint(other) : null;
        if (e?.device) return { ...e, trunkVia: l.id };
      }
      return { passive: true };
    }
    const id = this.coreId.get(dev);
    if (!id) return { error: { code: 'unknown_port', reason: `${dev} ist nicht im Simulationskern` } };
    if (port === 'con') return { console: dev }; // Konsolkabel: keine Netzverbindung im Kern
    if (port === 'mgmt') return { error: { code: 'rule', reason: 'Management-Port folgt mit SSH (leyoNET: interface vlan 1)' } };
    const n = Number(port);
    return { device: id, iface: n - 1, sfp: /^(sw|cs)/.test(dev) && n > SWITCH_PORTS };
  }

  /** Anderes Ende einer festen Leitung: Trunk 'pp1/07' -> 'pp3/07', Tischdose 'td1/02' <-> 'pp1/10' (first 9); sonst null */
  _trunkFar(ref) {
    const [dev, port] = ref.split('/');
    if (!/^\d\d$/.test(port)) return null;
    const n = Number(port);
    const pad = (k) => String(k).padStart(2, '0');
    const t = this.trunks.find((x) => x.a === dev || x.b === dev);
    if (!t) return null;
    const first = t.first ?? 1;
    const count = t.ports ?? 24;
    if (t.a === dev) return n <= count ? `${t.b}/${pad(first - 1 + n)}` : null;
    return n >= first && n < first + count ? `${t.a}/${pad(n - first + 1)}` : null;
  }

  _applyLink(link) {
    const a = this._endpoint(link.a);
    const b = this._endpoint(link.b);
    link.viaTrunk = a.trunkVia ?? b.trunkVia ?? null; // Verbindung haengt am Kabel auf der anderen Seite
    for (const e of [a, b]) if (e.error) return e.error;
    if (a.outlet || b.outlet || a.psu || b.psu) {
      // Stromkabel: PDU-Steckdose (C13) <-> Netzteil (C14) eines Geraets
      const psu = (a.psu ?? b.psu);
      if (!(a.outlet || b.outlet) || !psu) return { code: 'rule', reason: 'Stromkabel gehört zwischen eine PDU-Steckdose und das Netzteil (PSU) eines Geräts' };
      link.power = psu;
      this._setPower(psu, true);
      return null;
    }
    if (a.console || b.console) {
      // Konsolkabel: Notebook (USB) <-> Switch (CON); die Klasse "console" ist schon geprueft
      const nb = [a, b].find((e) => e.console.startsWith('nb'));
      const sw = [a, b].find((e) => /^(sw|cs|rt|fw)/.test(e.console));
      if (!nb || !sw) return { code: 'rule', reason: 'Konsolkabel gehoert zwischen Laptop (USB) und den CON-Port eines Switches, Routers oder einer Firewall' };
      link.console = { from: nb.console, to: sw.console };
      return null;
    }
    if (a.passive || b.passive) return null; // Dose ohne Endgeraet: liegt, aber kein Link
    const medium = a.sfp || b.sfp ? 'fiber' : 'tp';
    for (const [e, ref] of [[a, link.a], [b, link.b]]) {
      if (e.sfp && !core.getDevice(this.t, e.device).interfaces[e.iface].sfp) {
        return { code: 'rule', reason: `zuerst ein SFP-Modul in ${ref} einsetzen (E auf den leeren Einschub)` };
      }
    }
    const r = core.connect(this.t, a.device, b.device, medium, { a: a.iface, b: b.iface });
    if (!r.ok) return { code: 'rule', reason: `leyoNET: ${r.error.code}` };
    this.t = r.value.topology;
    link.coreCable = r.value.id;
    return null;
  }

  _applyUnlink(link) {
    if (link.power) {
      // _remove ruft uns vor dem Entfernen aus this.links: andere Stromkabel desselben Geraets zaehlen
      const other = this.hardwired.has(link.power) || this.links.some((l) => l !== link && l.power === link.power);
      if (!other) this._setPower(link.power, false);
      return;
    }
    // Trunk: wer ueber dieses Kabel verbunden war, verliert die Verbindung im Kern
    for (const l of this.links) {
      if (l !== link && l.viaTrunk === link.id && l.coreCable) {
        const r = core.removeCable(this.t, l.coreCable);
        if (r.ok) this.t = r.value;
        l.coreCable = null;
        l.viaTrunk = null;
      }
    }
    if (!link.coreCable) return;
    const r = core.removeCable(this.t, link.coreCable);
    if (r.ok) this.t = r.value;
  }

  _leds() {
    const leds = {};
    for (const l of this.portLeds) {
      const [dev, led] = l.split('/');
      const id = this.coreId.get(dev);
      const n = Number(led.slice(5)); // led_p07 -> 7
      leds[l] = id && core.linkUpAt(this.t, { device: id, iface: n - 1 }) ? 'on' : 'off';
    }
    // Betriebs-LEDs (pwr, sys, ...) der Netzgeraete folgen dem Strom
    for (const d of this.manifest.json.devices) {
      if (!/^(sw|cs|rt|fw|nb|kvm|srv)/.test(d.id)) continue;
      for (const led of d.leds) if (!/^p\d\d$/.test(led)) leds[`${d.id}/led_${led}`] = this.powered.has(d.id) ? 'on' : 'off';
    }
    return leds;
  }

  /** Verbundsaufgabe: Geraet an der Uebergabe-Dose { device, iface } oder null */
  uplink() {
    const l = this.linkAt(UEBERGABE);
    if (!l?.coreCable) return null;
    const e = this._endpoint(l.a === UEBERGABE ? l.b : l.a);
    const d = e.device && core.getDevice(this.t, e.device);
    return d && ['router', 'firewall'].includes(d.type) ? { device: d.id, iface: e.iface } : null;
  }

  /** Verbundsaufgabe: Zustand des Partners laut Server ('online' | 'services' | null = Referenz-Standort antwortet) */
  setPartner(level) {
    if (this.partner === level) return;
    this.partner = level;
    this._sim = null;
    if (this.started) this._delta(this._leds(), [], []);
  }

  /** Netz fuer Simulation und Ziele: im Verbund eigener Standort + Provider + Zentrale + Partner, sonst das eigene Netz */
  _simT() {
    const v = this.scenario?.verbund;
    if (!v) return this.t;
    const up = this.uplink();
    const key = up ? `${up.device}/${up.iface}` : '';
    const partner = this.partner ?? null;
    if (this._sim?.t !== this.t || this._sim.key !== key || this._sim.partner !== partner) {
      const names = new Map([...this.coreId].map(([k, c]) => [c, k]));
      this._sim = { t: this.t, key, partner, net: verbundTopology({ task: v.task, seat: v.seat, own: this.t, uplink: up, names, partner }) };
    }
    return this._sim.net;
  }

  /** Laufende Simulation fuer die Konsole (ping, show): einmal hochgefahren, bis sich das Netz aendert */
  _liveSim() {
    const net = this._simT();
    if (this._live?.net !== net) {
      const sim = new core.Simulation(net);
      sim.runUntil(SIM_BOOT_MS);
      this._live = { net, sim };
    }
    return this._live.sim;
  }

  /** «ping» an der Konsole: im Netz wirklich ausfuehren -> Ausgabezeilen */
  _consolePing(cid, { target, vrf }) {
    const sim = this._liveSim();
    const from = sim.getDeviceState(cid).console.length;
    sim.ping(cid, target, 1, vrf);
    sim.runUntil(sim.now + SIM_ACTION_MS);
    return sim.getDeviceState(cid).console.slice(from).map((l) => pingLine(l.code, l.params)).filter(Boolean);
  }

  /** Spiel: Ziele erst pruefen, wenn kurz nichts mehr passiert (Verbund: bis 20 Simulationen je Pruefung) */
  deferGoals(ms = 600) {
    const calc = () => this._goalsNow();
    let last = (this.scenario.ziele ?? []).map((g) => ({ id: g.id, text: g.text, done: false }));
    let timer = null;
    let fresh = false;
    this.goals = () => {
      if (!fresh && !this.quiet) {
        clearTimeout(timer);
        timer = setTimeout(() => { last = calc(); fresh = true; this._delta(this._leds(), [], []); fresh = false; }, ms);
      }
      return last;
    };
    this.stopGoals = () => { clearTimeout(timer); this.goals = () => last; };
  }

  /** Protokoll wieder einspielen (Seite neu geladen, anderes Geraet): ohne Meldungen, danach voller Zustand ueber state() */
  async resume(intents) {
    const ls = this.listeners;
    this.listeners = [];
    this.quiet = true;
    for (const i of intents) { try { await EmbeddedKern.prototype.send.call(this, i); } catch { /* zaehlt nicht */ } }
    this.quiet = false;
    this.listeners = ls;
    this.rev++;
  }

  goals() { return this._goalsNow(); }

  _goalsNow() {
    if (this.quiet) return []; // Nachspielen auf dem Server: Ziele erst am Schluss (sonst je Absicht eine Simulation)
    const list = this._goalsRaw();
    const byId = new Map(list.map((g) => [g.id, g]));
    // `requires`: Ziel zaehlt erst, wenn das andere erfuellt ist (z.B. noPing erst bei funktionierendem Netz)
    return list.map((g, i) => {
      const req = this.scenario.ziele[i].requires;
      return req && !byId.get(req)?.done ? { ...g, done: false } : g;
    });
  }

  _goalsRaw() {
    const base = super.goals();
    return (this.scenario?.ziele ?? []).map((g, i) => {
      if (g.typ === 'power') return { id: g.id, text: g.text, done: g.devices.every((d) => this.powered.has(d)) };
      if (g.typ === 'ssh_login') return { id: g.id, text: g.text, done: this.sshLogins.has(g.device) };
      if (g.typ === 'fiber_link') {
        // Glasfaser-Uplink zwischen zwei Geraeten, der im leyoNET-Kern auch wirklich "up" ist
        const done = this.links.some((l) => {
          const [da, pa] = l.a.split('/');
          const [db, pb] = l.b.split('/');
          const pair = (da === g.a_device && db === g.b_device) || (da === g.b_device && db === g.a_device);
          const ea = this._endpoint(l.a);
          return pair && ea.sfp && this._endpoint(l.b).sfp && l.coreCable
            && core.linkUpAt(this.t, { device: ea.device, iface: ea.iface }) && pa && pb;
        });
        return { id: g.id, text: g.text, done };
      }
      if (g.typ === 'mgmt_address') {
        // Verwaltungsadresse (interface vlan N). leyoNETs Pruefbaustein 'address' sieht SVIs nicht.
        const d = this._dev(g.device);
        const done = !!d && (d.svis ?? []).some((v) => v.vlan === (g.vlan ?? 1) && v.ip === g.ip && v.mask === g.mask);
        return { id: g.id, text: g.text, done };
      }
      if (g.typ === 'no_default') {
        const d = this._dev(g.device);
        return { id: g.id, text: g.text, done: !!d && !(d.routes ?? []).some((r) => r.network === '0.0.0.0' && r.mask === '0.0.0.0') };
      }
      if (g.typ !== 'core') return base[i];
      const v = this.scenario.verbund;
      const r = core.evaluateGoal(this._simT(), { id: g.id, text: g.text, check: v ? partnerGoal(g.check, v.seat, this.partner ?? null) : g.check });
      return { id: g.id, text: g.text, done: r.passed, reason: r.reason?.code };
    });
  }

  /** Eingesetzte SFP-Module: { 'sw1/25': '1G-SX', ... } (aus dem leyoNET-Kern) */
  _extraState() {
    const power = {};
    for (const d of this.manifest.json.devices) if (/^(nb|sw|cs|rt|fw|kvm|srv)/.test(d.id)) power[d.id] = this.powered.has(d.id) ? 'on' : 'off';
    const sfp = {};
    for (const [id, coreId] of this.coreId) {
      const d = core.getDevice(this.t, coreId);
      d?.interfaces.forEach((i, k) => { if (i.sfpSlot && i.sfp) sfp[`${id}/${String(k + 1).padStart(2, '0')}`] = i.sfp; });
    }
    return { sfp, power, trunks: this.trunks.map((t) => ({ ...t })), plan: this._plan() };
  }

  /** Netzplan (Plan v4): Adressen je Geraet, Endgeraete hinter Dosen, Kabelstatus aus dem leyoNET-Kern */
  _plan() {
    const ips = {};
    for (const [id, cid] of this.coreId) {
      const d = core.getDevice(this.t, cid);
      const list = [...(d?.interfaces ?? []), ...(d?.svis ?? [])].filter((i) => i.ip).map((i) => i.ip);
      if (list.length) ips[id] = list;
    }
    const dosen = {};
    for (const [ref, cid] of this.dosen) {
      const d = core.getDevice(this.t, cid);
      if (d) dosen[ref] = { name: d.name, type: d.type, ip: d.interfaces[0]?.ip ?? '' };
    }
    const up = {};
    for (const l of this.links) {
      const c = l.coreCable && this.t.cables.find((x) => x.id === l.coreCable);
      if (c) up[l.id] = core.linkUpAt(this.t, c.a);
      // Kabel am anderen Ende eines Trunks: der Link haengt am Partner-Kabel
      if (l.viaTrunk && c) up[l.viaTrunk] = up[l.id];
    }
    return { ips, dosen, up };
  }

  /** Warum laesst sich die Tischdose nicht auf diesen 8er-Block auflegen? null = geht (auch fuer den Dialog) */
  deskPatchBlock(pp, first) {
    if (!pp || !pp.id.startsWith('pp')) return 'das ist kein Patchpanel';
    if (pp.rack?.startsWith('bench')) return 'Patchpanel zuerst ins Rack einbauen';
    if (![1, 9, 17].includes(first)) return 'Block 1–8, 9–16 oder 17–24 wählen';
    if (this.trunks.some((t) => t.a === pp.id || t.b === pp.id)) return 'hier liegt schon ein Trunk';
    const refs = Array.from({ length: 8 }, (_, k) => `${pp.id}/${String(first + k).padStart(2, '0')}`);
    if (refs.some((r) => this.dosen.has(r))) return 'hier hängen Wanddosen';
    if (refs.some((r) => this.linkAt(r))) return 'hier stecken Patchkabel';
    return null;
  }

  _dev(ref) {
    const id = this.coreId.get(ref);
    return id ? core.getDevice(this.t, id) : null;
  }

  /** Konsolkabel des Laptops `nb` -> Switch-Kern-ID oder null */
  consoleOf(nb) {
    return this.links.find((l) => l.console?.from === nb)?.console.to ?? null;
  }

  /**
   * Notebook + Konsole (leyoNET-Kern):
   *   device_info { device }                      -> ack { ip, mask, gateway, console }
   *   set_ip { device, ip, mask, gateway? }        -> ack + delta (Ziele)
   *   host_ping { device, target }                 -> ack { lines, ok }
   *   console_open { device, from? }               -> ack { session, lines, prompt } (from = Laptop mit Konsolkabel)
   *   ssh { from, target, user, password }         -> ack { session, lines, prompt }
   *   console { session, line }                    -> ack { lines, prompt, close } (+ delta bei Konfig-Aenderung)
   */
  _handle(intent, seq) {
    const reject = (code, reason) => ({ type: 'reject', seq, code, reason });
    if (intent.action === 'power') {
      // Notebook ein-/ausschalten (Akku): aus = Anschluss shutdown, keine Bedienung
      const d = this._dev(intent.device);
      if (!d || d.type !== 'notebook') return reject('rule', 'Netzgeräte bekommen Strom über ein Stromkabel an der PDU');
      const on = intent.on ?? !this.powered.has(intent.device);
      const before = this._leds();
      this.t = val(core.setInterfaceShutdown(this.t, d.id, 0, !on));
      if (on) this.powered.add(intent.device); else this.powered.delete(intent.device);
      this._delta(before, [], []);
      return { type: 'ack', seq, rev: this.rev, power: on ? 'on' : 'off' };
    }
    const offNb = ['set_ip', 'host_ping', 'host_http'].includes(intent.action) ? intent.device : intent.action === 'ssh' ? intent.from : null;
    if (offNb?.startsWith('nb') && !this.powered.has(offNb)) return reject('rule', `${offNb.toUpperCase()} ist ausgeschaltet`);
    if (intent.action === 'console_open' && intent.from?.startsWith('nb') && !this.powered.has(intent.from)) {
      return reject('rule', `${intent.from.toUpperCase()} ist ausgeschaltet`);
    }
    if (intent.action === 'sfp_insert' || intent.action === 'sfp_remove') {
      // SFP-Modul aus dem Inventar in einen leeren Einschub (bzw. zurueck ins Inventar)
      const e = this._endpoint(intent.port);
      if (!e.device || !e.sfp) return reject('rule', 'kein SFP-Einschub');
      const port = core.getDevice(this.t, e.device).interfaces[e.iface];
      if (this.linkAt(intent.port)) return reject('occupied', 'erst das Glasfaserkabel abziehen');
      const before = this._leds();
      if (intent.action === 'sfp_insert') {
        const c = this.catalog.get(intent.item);
        if (!c || c.typ !== 'sfp') return reject('rule', 'kein SFP-Modul');
        if (port.sfp) return reject('occupied', `Einschub belegt (${port.sfp})`);
        if (this.modus === 'katalog') {
          if (!(this.inventory[c.item] > 0)) return reject('budget', `kein ${c.name} im Inventar`);
          this.inventory[c.item]--;
        }
        this.t = val(core.setSfpModule(this.t, e.device, e.iface, c.modul));
      } else {
        if (!port.sfp) return reject('rule', 'Einschub ist leer');
        const c = [...this.catalog.values()].find((x) => x.typ === 'sfp' && x.modul === port.sfp);
        if (c && this.modus === 'katalog') this.inventory[c.item] = (this.inventory[c.item] ?? 0) + 1;
        this.t = val(core.setSfpModule(this.t, e.device, e.iface, null));
      }
      this._delta(before, [], []);
      return { type: 'ack', seq, rev: this.rev };
    }
    if (intent.action === 'trunk' || intent.action === 'untrunk') {
      // Trunk-Kabel (24 Adernpaare) Patchpanel A <-> Patchpanel B ueber die Gitterrinnen
      const pp = (id) => this.manifest.byId.get(id);
      const ppHasCables = (id) => this.links.some((l) => l.a.startsWith(`${id}/`) || l.b.startsWith(`${id}/`));
      if (intent.action === 'untrunk') {
        const t = this.trunks.find((x) => x.a === intent.device || x.b === intent.device);
        if (!t) return reject('rule', 'an diesem Patchpanel hängt kein Trunk');
        if (t.desk) return reject('rule', 'das ist die Leitung der Tischdose – an der Tischdose lösen');
        if (ppHasCables(t.a) || ppHasCables(t.b)) return reject('occupied', `zuerst die Patchkabel an ${t.a.toUpperCase()} und ${t.b.toUpperCase()} abziehen`);
        this.trunks.splice(this.trunks.indexOf(t), 1);
        if (t.item && this.modus === 'katalog') this.inventory[t.item] = (this.inventory[t.item] ?? 0) + 1;
        this._delta(this._leds(), [], []);
        return { type: 'ack', seq, rev: this.rev };
      }
      const A = pp(intent.a);
      const B = pp(intent.b);
      if (!A || !B || !A.id.startsWith('pp') || !B.id.startsWith('pp')) return reject('rule', 'ein Trunk verbindet zwei Patchpanels');
      if ([A, B].some((d) => d.rack?.startsWith('bench'))) return reject('rule', 'vom Pult geht kein Trunk weg – Patchpanel ins Rack einbauen');
      if (A.rack === B.rack) return reject('rule', 'beide Patchpanels sind im selben Rack – ein Trunk verbindet zwei Racks');
      if (this.trunks.some((x) => [x.a, x.b].includes(A.id) || [x.a, x.b].includes(B.id))) return reject('occupied', 'an einem der Patchpanels hängt schon ein Trunk');
      if (ppHasCables(A.id) || ppHasCables(B.id)) return reject('occupied', 'Trunk zuerst legen, dann patchen (Patchkabel abziehen)');
      const c = this.catalog.get(intent.item);
      if (this.modus === 'katalog') {
        if (!c || c.typ !== 'trunk') return reject('rule', 'dafür braucht es ein Trunk-Kabel');
        if (!(this.inventory[c.item] > 0)) return reject('budget', `kein ${c.name} im Inventar`);
        this.inventory[c.item]--;
      }
      this.trunks.push({ id: `T${this.nextId++}`, a: A.id, b: B.id, item: c?.item ?? null });
      this._delta(this._leds(), [], []);
      return { type: 'ack', seq, rev: this.rev };
    }
    if (intent.action === 'desk_patch' || intent.action === 'desk_unpatch') {
      // Plan v4 D: feste Leitung Tischdose (8 Ports) ueber Saeule + Gitterrinnen -> 8er-Block eines Patchpanels
      const td = this.manifest.byId.get(intent.device);
      if (!td || !td.id.startsWith('td')) return reject('rule', 'das ist keine Tischdose');
      const cur = this.trunks.find((x) => x.a === td.id);
      const used = (id, from, to) => this.links.some((l) => [l.a, l.b].some((r) => {
        const [d, p] = r.split('/');
        return d === id && Number(p) >= from && Number(p) <= to;
      }));
      if (used(td.id, 1, 8)) return reject('occupied', 'zuerst die Kabel an der Tischdose abziehen');
      if (intent.action === 'desk_unpatch') {
        if (!cur) return reject('rule', 'die Tischdose ist nicht aufgelegt');
        if (used(cur.b, cur.first, cur.first + cur.ports - 1)) return reject('occupied', `zuerst die Patchkabel an ${cur.b.toUpperCase()} Port ${cur.first}–${cur.first + cur.ports - 1} abziehen`);
        this.trunks.splice(this.trunks.indexOf(cur), 1);
      } else {
        const pp = this.manifest.byId.get(intent.pp);
        const first = Number(intent.first);
        const why = this.deskPatchBlock(pp, first);
        if (cur) return reject('occupied', `die Tischdose ist schon auf ${cur.b.toUpperCase()} aufgelegt`);
        if (why) return reject('rule', why);
        this.trunks.push({ id: `T${this.nextId++}`, a: td.id, b: pp.id, first, ports: 8, desk: true, item: null });
      }
      this._delta(this._leds(), [], []);
      return { type: 'ack', seq, rev: this.rev };
    }
    if (intent.action === 'device_info') {
      const d = this._dev(intent.device);
      if (!d) return reject('unknown_port', 'unbekanntes Geraet');
      const i = d.interfaces[0] ?? {};
      return { type: 'ack', seq, rev: this.rev, ip: i.ip ?? '', mask: i.mask ?? '', gateway: d.gateway ?? '',
        console: this.consoleOf(intent.device), power: d.type !== 'notebook' || this.powered.has(intent.device) ? 'on' : 'off' };
    }
    if (intent.action === 'set_ip') {
      const d = this._dev(intent.device);
      if (!d || d.type !== 'notebook') return reject('rule', 'nur fuer Notebooks');
      const before = this._leds();
      // leyoNET configureHost: IP, Maske, Gateway in einem Schritt (atomar, eigene Pruefung);
      // leeres Gateway = keins. (setDefaultGateway ist die Default-Route fuer Router, nicht fuer Hosts.)
      const r = core.configureHost(this.t, d.id, { ip: intent.ip ?? '', mask: intent.mask ?? '', gateway: intent.gateway ?? '',
        dns: d.dns ?? '' });
      if (!r.ok) return reject('rule', `ungueltige Eingabe (${r.error.code}${r.error.field ? `: ${r.error.field}` : ''})`);
      this.t = r.value;
      this._delta(before, [], []);
      return { type: 'ack', seq, rev: this.rev };
    }
    if (intent.action === 'host_ping') {
      const d = this._dev(intent.device);
      if (!d) return reject('unknown_port', 'unbekanntes Geraet');
      const target = String(intent.target ?? '').trim();
      const r = core.evaluateGoal(this._simT(), { id: 'ping', text: '', check: { type: 'ping', from: this.scenario?.verbund ? intent.device : d.name, to: target } });
      const lines = r.passed
        ? [`Ping wird ausgefuehrt fuer ${target}:`, ...[1, 2, 3, 4].map(() => `Antwort von ${target}: Bytes=32 Zeit<1ms TTL=64`), '', 'Pakete: Gesendet = 4, Empfangen = 4, Verloren = 0 (0% Verlust)']
        : [`Ping wird ausgefuehrt fuer ${target}:`, ...[1, 2, 3, 4].map(() => 'Zeitueberschreitung der Anforderung.'), '',
          `Pakete: Gesendet = 4, Empfangen = 0, Verloren = 4 (100% Verlust)${r.reason ? `   [${r.reason.code}]` : ''}`];
      return { type: 'ack', seq, rev: this.rev, ok: r.passed, lines };
    }
    if (intent.action === 'host_http') { // curl vom Notebook (nur lesen)
      const d = this._dev(intent.device);
      if (!d) return reject('unknown_port', 'unbekanntes Geraet');
      const url = String(intent.url ?? '').trim().slice(0, 200);
      const r = core.evaluateGoal(this._simT(), { id: 'http', text: '', check: { type: 'http', from: this.scenario?.verbund ? intent.device : d.name, url: /^https?:/.test(url) ? url : `http://${url}` } });
      return { type: 'ack', seq, rev: this.rev, ok: r.passed, lines: r.passed ? ['HTTP/1.1 200 OK'] : [`curl: keine Antwort von ${url}${r.reason ? `   [${r.reason.code}]` : ''}`] };
    }
    if (intent.action === 'ssh') {
      const from = this._dev(intent.from);
      if (!from) return reject('unknown_port', 'unbekanntes Geraet');
      const target = String(intent.target ?? '').trim();
      const sw = this.t.devices.find((d) => (d.svis ?? []).some((v) => v.ip === target)
        || d.interfaces.some((i) => i.ip === target));
      const reach = core.evaluateGoal(this._simT(), { id: 'ssh', text: '', check: { type: 'ping', from: this.scenario?.verbund ? intent.from : from.name, to: target } });
      if (!sw || !reach.passed) return reject('rule', `ssh: Verbindung zu ${target} fehlgeschlagen (nicht erreichbar)`);
      // leyoNET: SSH-Dienst (ip ssh / transport input ssh) gibt es nur auf Layer-3-Geraeten
      if (!['router', 'l3switch', 'firewall'].includes(sw.type)) {
        return reject('rule', `ssh: ${target} bietet kein SSH (nur L3-Switch, Router oder Firewall - L2-Switch per Konsole/KVM verwalten)`);
      }
      if (!sw.cli?.ssh) return reject('rule', `ssh: ${target} lehnt ab (kein SSH-Dienst: ip ssh)`);
      const user = (sw.cli.users ?? []).find((u) => u.name === intent.user);
      if (!user || user.password !== intent.password) return reject('rule', 'ssh: Zugriff verweigert (Benutzer/Passwort)');
      const { session, lines } = core.startSession(sw, true);
      const sid = `S${this.nextSession++}`;
      this.sessions.set(sid, session);
      const kid = [...this.coreId].find(([, c]) => c === sw.id)?.[0];
      if (kid) this.sessionDev.set(sid, kid);
      if (kid && !this.sshLogins.has(kid)) {
        const before = this._leds();
        this.sshLogins.add(kid);
        this._delta(before, [], []); // Ziel ssh_login neu bewerten
      }
      return { type: 'ack', seq, rev: this.rev, session: sid, lines, prompt: core.prompt(this.t, session) };
    }
    if (intent.action === 'console_open') {
      // KVM / Konsolserver im Rack (kvm<n>): Zugriff auf Switches, Router, Firewalls ohne Konsolkabel
      const viaKvm = intent.from?.startsWith('kvm') && /^(sw|cs|rt|fw)/.test(intent.device);
      if (viaKvm && !this.powered.has(intent.from)) return reject('rule', `${intent.from.toUpperCase()} hat keinen Strom – Stromkabel von der PDU an das Netzteil (PSU) der KVM stecken`);
      if (intent.from && !viaKvm && this.consoleOf(intent.from) !== intent.device) {
        return reject('rule', 'kein Konsolkabel zwischen diesem Laptop und dem Geraet');
      }
      const dev = this._dev(intent.device);
      if (!dev || !core.hasCli(dev.type)) return { type: 'reject', seq, code: 'rule', reason: 'Geraet ohne Befehlszeile' };
      if (!this.powered.has(intent.device)) return reject('rule', `${intent.device.toUpperCase()} hat keinen Strom – Stromkabel von der PDU an das Netzteil (PSU) stecken`);
      const { session, lines } = core.startSession(dev);
      const sid = `S${this.nextSession++}`;
      this.sessions.set(sid, session);
      this.sessionDev.set(sid, intent.device);
      return { type: 'ack', seq, rev: this.rev, session: sid, lines, prompt: core.prompt(this.t, session) };
    }
    if (intent.action === 'console_complete') {
      // Tab: leyoNET complete() ergaenzt das angefangene Wort, wenn es eindeutig ist
      const session = this.sessions.get(intent.session);
      if (!session) return reject('rule', 'Konsolsitzung unbekannt');
      return { type: 'ack', seq, rev: this.rev, line: core.complete(session, intent.line, { topology: this.t }) };
    }
    if (intent.action === 'console') {
      const session = this.sessions.get(intent.session);
      if (!session) return { type: 'reject', seq, code: 'rule', reason: 'Verbindung verloren – Gerät ohne Strom oder Sitzung beendet' };
      const before = this._leds();
      // show-Befehle sehen den laufenden Zustand (gelernte Routen, Nachbarn, DHCP); beim Nachspielen (quiet) ohne Simulation
      const cid = this.coreId.get(this.sessionDev.get(intent.session));
      const live = !this.quiet && cid && /^\s*(do\s+)?sh(o|ow)?\s/i.test(String(intent.line ?? '')) ? this._liveSim() : null;
      const out = core.execute(session, intent.line, { topology: this.t, ...(live ? { state: live.getDeviceState(cid), now: live.now } : {}) });
      const lines = out.action?.kind === 'ping' && cid && !this.quiet ? [...out.lines, ...this._consolePing(cid, out.action)] : out.lines;
      this.sessions.set(intent.session, out.session);
      if (out.close) this.sessions.delete(intent.session);
      if (out.topology) {
        this.t = out.topology;
        this._delta(before, [], []); // Konfiguration geaendert -> LEDs/Ziele neu (z.B. shutdown)
      }
      return { type: 'ack', seq, rev: this.rev, lines, prompt: out.close ? null : core.prompt(this.t, out.session),
        close: !!out.close };
    }
    return null;
  }
}
