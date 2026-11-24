// Spiel <-> leyonet-Kern (docs/SCENARIO_API.md, Entscheidungen E1-E3). Das Spiel sendet Intents und
// rendert den Zustand, den der Kern zurueckgibt. LocalKern ist ein In-Browser-Kern fuer
// Entwicklung/Offline mit denselben Regeln und demselben Protokoll; die WS-Bridge (WsKern)
// ersetzt ihn spaeter, ohne dass CableManager sich aendert.
//
// E1: Intents/Zustaende/Szenarien verwenden Kern-IDs (sw1/07). Die Abbildung auf GLB-Nodes
//     liefert das Raum-Manifest (assets/out/<raum>.manifest.json, beim Bake erzeugt), das der Kern
//     in der Antwort auf `hello` mitschickt.
// E2: modus 'katalog' -> Kabel nur aus dem Inventar (item), 'sandbox' -> freie Palette.
// E3: Entfernungen kommen als delta.links_remove[{ id, reason, by }].

export const PORT_CLASS = { rj45: 'copper', keystone: 'copper', sfp: 'sfp', console: 'console', power: 'power' };

// Plan v3: Kern-Rolle je Geraetetyp (wie blender/lib/bake.py ROLE) und Node-Name je Bausatz-Vorlage
export const ROLE = [['coreswitch', 'cs'], ['switch', 'sw'], ['patchpanel', 'pp'], ['server', 'srv'], ['pdu', 'pdu'],
  ['notebook', 'nb'], ['router', 'rt'], ['firewall', 'fw'], ['kvm', 'kvm'], ['desk_strip', 'sl'], ['table_outlet', 'td']];
export const roleOf = (type) => ROLE.find(([k]) => String(type).startsWith(k))?.[1] ?? null;
const NODE_KIND = { kit_switch: 'switch', kit_coreswitch: 'coreswitch', kit_patchpanel: 'patchpanel', kit_server: 'server',
  kit_router: 'router', kit_firewall: 'firewall', kit_kvm: 'kvm', kit_blank_1u: 'blank', kit_blank_2u: 'blank', kit_pdu_1u: 'pdu' };
// Plan v4 D: feste Einrichtung des Pults (Raum-Manifest slots kind 'fixed'): Node-Name je Vorlage
const FIXED_NODE = { kit_bench: 'bench_1', kit_desk_strip: 't1_strip_1', kit_table_outlet: 't1_outlet_1' };
/** Einbau-Gestell mit Hoeheneinheiten: Rack oder 19-Zoll-Gestell auf dem Pult */
export const isFrame = (p) => p.vorlage === 'kit_rack' || p.vorlage === 'kit_bench';

/** Raum-Manifest: GLB-Node <-> Kern-Ref (PortRef `sw1/07`, LedRef `sw1/led_p07`). */
export class RoomManifest {
  constructor(json) {
    this.json = json;
    this.byId = new Map(json.devices.map((d) => [d.id, d]));
    this.byNode = new Map(json.devices.map((d) => [d.node, d]));
  }

  portRef(node) {
    const m = /^(.*)_port_(\w+)$/.exec(node);
    const d = m && this.byNode.get(m[1]);
    return d ? `${d.id}/${m[2]}` : null;
  }

  portNode(ref) {
    const [id, port] = ref.split('/');
    const d = this.byId.get(id);
    return d ? `${d.node}_port_${port}` : null;
  }

  ledRef(node) {
    const m = /^(.*)_led_(\w+)$/.exec(node);
    const d = m && this.byNode.get(m[1]);
    return d ? `${d.id}/led_${m[2]}` : null;
  }

  ledNode(ref) {
    const [id, led] = ref.split('/');
    const d = this.byId.get(id);
    return d ? `${d.node}_${led}` : null;
  }

  /** Alle Ports als [{ ref, kind }] */
  ports() {
    return this.json.devices.flatMap((d) => Object.entries(d.ports).map(([p, kind]) => ({ ref: `${d.id}/${p}`, kind })));
  }

  /** Alle LEDs als LedRef */
  leds() {
    return this.json.devices.flatMap((d) => d.leds.map((l) => `${d.id}/led_${l}`));
  }

  /** E1-Validierung beim hello: fehlende GLB-Nodes (Ports) -> Liste, leer = ok. */
  validate(glbPortNodes) {
    const have = new Set(glbPortNodes);
    return this.ports().map((p) => this.portNode(p.ref)).filter((n) => !have.has(n));
  }
}

/** Zustand + Delta -> neuer Zustand (rein, testbar). */
export function reduceState(prev, msg) {
  if (msg.type === 'state') return msg;
  if (msg.type !== 'delta' || msg.rev <= (prev?.rev ?? -1)) return prev;
  const removed = new Set((msg.links_remove ?? []).map((r) => r.id));
  return {
    type: 'state',
    rev: msg.rev,
    links: [...prev.links.filter((l) => !removed.has(l.id)), ...(msg.links_add ?? [])],
    leds: { ...prev.leds, ...(msg.leds ?? {}) },
    goals: msg.goals ?? prev.goals,
    inventory: msg.inventory ?? prev.inventory,
    budget: msg.budget ?? prev.budget,
    sfp: msg.sfp ?? prev.sfp,
    power: msg.power ?? prev.power,
    trunks: msg.trunks ?? prev.trunks,
    plan: msg.plan ?? prev.plan,
    placed: prev.placed,
    devices: prev.devices,
    unlimited: prev.unlimited,
    modus: prev.modus,
  };
}

/**
 * Schnittstelle (Duck-Typing):
 *   send(intent) -> Promise<{ type: 'ack', seq, rev, manifest?, catalog? } | { type: 'reject', seq, code, reason }>
 *   onMessage(cb) -> cb(state | delta)  (nach hello: zuerst voller state, danach deltas)
 */
export class LocalKern {
  /**
   * manifest: Raum-Manifest-JSON (Kern-Seite), scenario: { id, modus, hardware_katalog, inventar, ziele }
   */
  constructor({ manifest, scenario, kit = null }) {
    this._setManifest(manifest);
    // Plan v3: Bausatz-Vorlagen (assets/out/kit.kit.json) + Einbau-Plaetze des Raums (manifest.slots)
    this.kit = new Map((kit?.templates ?? []).map((t) => [t.node, t]));
    this.slots = new Map((manifest.slots ?? []).map((sl) => [sl.node, sl]));
    this.placed = []; // { node, vorlage, item, slot, rack, u, he, ids }
    this.scenario = scenario;
    this.modus = scenario?.modus ?? 'sandbox';
    this.catalog = new Map((scenario?.hardware_katalog ?? []).map((c) => [c.item, c]));
    this.inventory = { ...(scenario?.inventar ?? {}) };
    this.unlimited = scenario?.budget === null || scenario?.budget === 'unbegrenzt'; // Sandbox
    this.budget = this.unlimited ? 0 : scenario?.budget ?? 0; // CHF, Shop (Intent buy)
    this.links = []; // { id, a, b, length, color, item }
    this.rev = 0;
    this.seq = 0;
    this.nextId = 1;
    this.listeners = [];
    this.started = false;
  }

  _setManifest(json) {
    this.manifest = new RoomManifest(json);
    this.ports = new Map(this.manifest.ports().map((p) => [p.ref, { ...p, cls: PORT_CLASS[p.kind] ?? 'copper' }]));
    this.portLeds = new Set(this.manifest.leds().filter((l) => /\/led_p\d\d$/.test(l)));
  }

  /** Naechste freie Kern-ID einer Rolle (sw1, sw2 ... - Luecken nach Ausbau werden wieder belegt). */
  _nextId(role, taken) {
    for (let n = 1; ; n++) if (!taken.has(`${role}${n}`)) return `${role}${n}`;
  }

  /**
   * Plan v3: Geraet aus dem Bausatz einbauen. spec: { vorlage, item, slot? (Rack/Notebook-Platz),
   * rack? (Rack-Node), u? (unterste HE) }. Rueckgabe { entry, rows } oder { error: { code, reason } }.
   */
  _install(spec, { powered = false } = {}) {
    const err = (code, reason) => ({ error: { code, reason } });
    const tpl = this.kit.get(spec.vorlage);
    if (!tpl) return err('rule', `unbekannte Vorlage ${spec.vorlage}`);
    const devs = [...this.manifest.json.devices];
    const taken = new Set(devs.map((d) => d.id));
    const rows = [];
    const row = (t, node, rack) => {
      const role = roleOf(t.type);
      if (!role || !(Object.keys(t.ports).length || t.leds.length)) return null;
      const id = this._nextId(role, taken);
      taken.add(id);
      return { id, node, type: t.type, rack, ports: { ...t.ports }, leds: [...t.leds] };
    };
    let entry;
    if (spec.fixed) {
      const sl = this.slots.get(spec.slot);
      entry = { node: FIXED_NODE[tpl.node], vorlage: tpl.node, item: null, slot: sl.node, rack: null, u: 0, he: 0, fixed: true };
      const r = row(tpl, entry.node, '');
      if (r) rows.push(r);
    } else if (FIXED_NODE[tpl.node]) {
      return err('rule', 'das gehört fest zum Pult');
    } else if (tpl.type === 'rack') {
      const sl = this.slots.get(spec.slot);
      if (!sl || sl.kind !== 'rack') return err('rule', 'hier ist kein Rack-Platz');
      if (this.placed.some((p) => p.slot === sl.node)) return err('occupied', 'Rack-Platz ist schon belegt');
      const node = `rack_${sl.index}`;
      entry = { node, vorlage: tpl.node, item: spec.item ?? null, slot: sl.node, rack: null, u: 0, he: 0, row: sl.row };
      for (const part of [...(tpl.parts ?? [])].sort((a, b) => a.suffix.localeCompare(b.suffix))) { // L vor R
        const r = row(part, `r${sl.index}_${part.suffix}`, node);
        if (r) rows.push(r);
      }
    } else if (tpl.type === 'notebook') {
      const sl = this.slots.get(spec.slot);
      if (!sl || sl.kind !== 'notebook') return err('rule', 'Notebooks gehören auf einen Platz am Tisch');
      if (this.placed.some((p) => p.slot === sl.node)) return err('occupied', 'Platz am Tisch ist schon belegt');
      entry = { node: `t1_notebook_${sl.index}`, vorlage: tpl.node, item: spec.item ?? null, slot: sl.node, rack: null, u: 0, he: 0 };
      const r = row(tpl, entry.node, '');
      if (r) rows.push(r);
    } else {
      const rack = this.placed.find((p) => p.node === spec.rack && isFrame(p));
      if (!rack) return err('rule', 'zuerst ein Rack aufstellen');
      const spec42 = this.kit.get(rack.vorlage)?.slots ?? 42;
      const he = Math.max(1, tpl.he);
      const u = Math.floor(spec.u ?? 0);
      if (u < 1 || u + he - 1 > spec42) return err('rule', `passt nicht: HE ${u}${he > 1 ? `-${u + he - 1}` : ''} liegt ausserhalb 1-${spec42}`);
      const clash = this.placed.find((p) => p.rack === rack.node && u <= p.u + p.he - 1 && p.u <= u + he - 1);
      if (clash) return err('occupied', `HE ${u} ist belegt`);
      const idx = rack.node.replace('rack_', 'r').replace('bench_', 'b'); // rack_3 -> r3, bench_1 -> b1
      entry = { node: `${idx}_${NODE_KIND[tpl.node] ?? 'device'}_U${u}`, vorlage: tpl.node, item: spec.item ?? null,
        slot: null, rack: rack.node, u, he };
      const r = row(tpl, entry.node, rack.node);
      if (r) rows.push(r);
    }
    entry.ids = rows.map((r) => r.id);
    this.placed.push(entry);
    this._setManifest({ ...this.manifest.json, devices: [...devs, ...rows] });
    this._onInstall(rows, { powered });
    return { entry, rows };
  }

  /** Geraet/Rack/Notebook ausbauen (nur ohne Kabel; Rack nur leer). Rueckgabe null oder Fehler. */
  _uninstall(target) {
    const entry = this.placed.find((p) => p.node === target || p.ids.includes(target));
    if (!entry) return { code: 'rule', reason: 'hier ist nichts zum Ausbauen' };
    if (entry.fixed) return { code: 'rule', reason: 'gehört fest zum Pult' };
    if (entry.vorlage === 'kit_rack' && this.placed.some((p) => p.rack === entry.node)) {
      return { code: 'rule', reason: 'Rack ist nicht leer – zuerst die Geräte ausbauen' };
    }
    const ids = new Set(entry.ids);
    if (this.links.some((l) => ids.has(l.a.split('/')[0]) || ids.has(l.b.split('/')[0]))) {
      return { code: 'occupied', reason: 'zuerst alle Kabel abziehen' };
    }
    if ((this.trunks ?? []).some((t) => ids.has(t.a) || ids.has(t.b))) return { code: 'occupied', reason: 'zuerst den Trunk bzw. die Leitung der Tischdose lösen' };
    const rows = this.manifest.json.devices.filter((d) => ids.has(d.id));
    this._onUninstall(rows);
    this.placed.splice(this.placed.indexOf(entry), 1);
    this._setManifest({ ...this.manifest.json, devices: this.manifest.json.devices.filter((d) => !ids.has(d.id)) });
    if (entry.item && this.catalog.has(entry.item) && this.modus === 'katalog') this.inventory[entry.item] = (this.inventory[entry.item] ?? 0) + 1;
    return null;
  }

  /** Hooks (EmbeddedKern legt die Geraete im Simulationskern an / entfernt sie). */
  _onInstall(_rows, _opts) {}
  _onUninstall(_rows) {}

  /** Szenario-Aufbau (Demo-RZ, Level-Vorgaben): Geraete + Kabel ohne Inventar/Budget, einmal bei hello. */
  _setup() {
    if (this._setupDone) return;
    this._setupDone = true;
    for (const sl of this.slots.values()) {
      if (sl.kind === 'fixed' && this.kit.has(sl.vorlage)) this._install({ vorlage: sl.vorlage, slot: sl.node, fixed: true });
    }
    for (const a of this.scenario?.aufbau ?? []) {
      const r = this._install(a, { powered: a.strom !== false });
      if (r.error) console.warn('[kern] Aufbau', a, r.error.reason);
    }
    for (const t of this.scenario?.trunks ?? []) {
      if (this.trunks) this.trunks.push({ id: `T${this.nextId++}`, a: t.a, b: t.b, item: t.item ?? null });
    }
    for (const k of this.scenario?.kabel ?? []) {
      const a = this.ports.get(k.from);
      const b = this.ports.get(k.to);
      if (!a || !b || this.linkAt(a.ref) || this.linkAt(b.ref)) { console.warn('[kern] Kabel', k.from, k.to, 'uebersprungen'); continue; }
      const c = this.catalog.get(k.item) ?? {};
      const link = { id: `L${this.nextId++}`, a: a.ref, b: b.ref, length: c.laenge ?? k.laenge ?? null, color: c.farbe ?? k.farbe ?? null, item: k.item ?? null };
      const e = this._applyLink(link);
      if (e) { console.warn('[kern] Kabel', k.from, k.to, e.reason); continue; }
      this.links.push(link);
    }
  }

  /** Voller Zustand nach Ein-/Ausbau (Manifest hat sich geaendert). */
  _emitFull() {
    this.rev++;
    this._emit(this.state());
  }

  onMessage(cb) {
    this.listeners.push(cb);
    if (this.started) cb(this.state());
  }

  _emit(msg) {
    for (const cb of this.listeners) cb(msg);
  }

  linkAt(ref) {
    return this.links.find((l) => l.a === ref || l.b === ref);
  }

  _leds() {
    const leds = {};
    for (const l of this.portLeds) {
      const [dev, led] = l.split('/');
      leds[l] = this.linkAt(`${dev}/${led.slice(5)}`) ? 'on' : 'off'; // led_p07 -> Port 07
    }
    return leds;
  }

  state() {
    return { type: 'state', rev: this.rev, links: this.links.map((l) => ({ ...l })), leds: this._leds(),
      goals: this.goals(), inventory: { ...this.inventory }, budget: this.budget, modus: this.modus, unlimited: this.unlimited,
      placed: this.placed.map((p) => ({ ...p, ids: [...p.ids] })), devices: this.manifest.json.devices, ...this._extraState() };
  }

  /** Zusaetzliche Zustandsfelder (EmbeddedKern: eingesetzte SFP-Module). */
  _extraState() { return {}; }

  goals() {
    return (this.scenario?.ziele ?? []).map((g) => {
      let done = false;
      if (g.typ === 'link') done = this.links.some((l) => (l.a === g.a && l.b === g.b) || (l.a === g.b && l.b === g.a));
      if (g.typ === 'link_any') {
        const l = this.linkAt(g.a);
        const other = l && (l.a === g.a ? l.b : l.a);
        done = !!other && other.split('/')[0] === g.b_device;
      }
      return { id: g.id, text: g.text, done };
    });
  }

  /** Delta nach einer Aenderung: nur geaenderte LEDs, Ziele + Inventar immer mit. */
  _delta(before, add, remove) {
    this.rev++;
    const after = this._leds();
    const leds = {};
    for (const [k, v] of Object.entries(after)) if (before[k] !== v) leds[k] = v;
    this._emit({ type: 'delta', rev: this.rev, links_add: add, links_remove: remove, leds,
      goals: this.goals(), inventory: { ...this.inventory }, budget: this.budget, ...this._extraState() });
  }

  // --- Hooks fuer EmbeddedKern (leyoNET-Kern): Standard = nichts tun ---------------------------
  /** Link im Simulationskern anlegen; Rueckgabe null = ok, sonst { code, reason } -> reject. */
  _applyLink(_link) { return null; }
  /** Link im Simulationskern entfernen. */
  _applyUnlink(_link) {}
  /** Weitere Intents (z.B. Konsole); Rueckgabe Antwort-Objekt oder null = unbekannt. */
  _handle(_intent, _seq) { return null; }

  _remove(link, reason, by) {
    const before = this._leds();
    this._applyUnlink(link);
    this.links.splice(this.links.indexOf(link), 1);
    // nur abgezogene Kabel zurueck ins Inventar; defekte (fault) / vom Kern entzogene nicht
    if (by === 'player' && link.item && this.catalog.has(link.item)) {
      this.inventory[link.item] = (this.inventory[link.item] ?? 0) + 1;
    }
    this._delta(before, [], [{ id: link.id, reason, by }]);
  }

  async send(intent) {
    const seq = intent.seq ?? ++this.seq;
    const reject = (code, reason) => ({ type: 'reject', seq, code, reason });
    if (intent.action === 'hello') {
      this._setup();
      this.started = true;
      const ack = { type: 'ack', seq, rev: this.rev, manifest: this.manifest.json, modus: this.modus,
        catalog: [...this.catalog.values()] };
      queueMicrotask(() => this._emit(this.state()));
      return ack;
    }
    if (!this.started) return reject('rule', 'erst hello senden');
    if (intent.action === 'link') {
      const a = this.ports.get(intent.from);
      const b = this.ports.get(intent.to);
      if (!a || !b) return reject('unknown_port', 'unbekannter Port');
      if (a.ref === b.ref) return reject('same_port', 'gleicher Port');
      if (a.cls !== b.cls) return reject('incompatible', `passt nicht: ${a.cls} -> ${b.cls}`);
      if (this.linkAt(a.ref) || this.linkAt(b.ref)) return reject('occupied', 'Port belegt');
      let { length = null, color = null } = intent.cable ?? {};
      const item = intent.cable?.item ?? null;
      if (this.modus === 'katalog') {
        const c = this.catalog.get(item);
        if (!c) return reject('rule', 'Kabel nicht im Katalog');
        if ((c.klasse ?? 'copper') !== a.cls) {
          return reject('rule', `falsches Kabel: ${c.name ?? c.item} passt nicht an ${{ console: 'Konsolports', power: 'Stromanschlüsse', sfp: 'SFP-Module' }[a.cls] ?? 'Netzwerkports'}`);
        }
        if (!(this.inventory[item] > 0)) return reject('budget', `kein ${c.name ?? `${c.laenge} m Kabel`} mehr im Inventar`);
        this.inventory[item]--;
        length = c.laenge; // Kern ist verbindlich: Laenge/Farbe aus dem Katalog
        color = c.farbe;
      }
      const before = this._leds();
      const link = { id: `L${this.nextId++}`, a: a.ref, b: b.ref, length, color, item };
      const err = this._applyLink(link);
      if (err) {
        if (item && this.modus === 'katalog') this.inventory[item]++; // Kabel zurueck, nichts passiert
        return reject(err.code, err.reason);
      }
      this.links.push(link);
      this._delta(before, [{ ...link }], []);
    } else if (intent.action === 'buy') {
      const c = this.catalog.get(intent.item);
      const qty = Math.max(1, Math.floor(intent.qty ?? 1));
      if (!c) return reject('rule', 'Artikel nicht im Katalog');
      const cost = (c.preis ?? 0) * qty;
      if (!this.unlimited && cost > this.budget + 1e-9) return reject('budget', `Budget reicht nicht (CHF ${cost.toFixed(2)} > ${this.budget.toFixed(2)})`);
      const before = this._leds();
      if (!this.unlimited) this.budget = +(this.budget - cost).toFixed(2);
      this.inventory[c.item] = (this.inventory[c.item] ?? 0) + qty;
      this._delta(before, [], []);
    } else if (intent.action === 'install') {
      // Plan v3: { item, slot } (Rack / Notebook) oder { item, rack, u } (Geraet ins Rack)
      const c = this.catalog.get(intent.item);
      if (!c?.vorlage) return reject('rule', 'das lässt sich nicht einbauen');
      if (this.modus === 'katalog' && !(this.inventory[c.item] > 0)) return reject('budget', `kein ${c.name} im Inventar – im Shop kaufen (B)`);
      const r = this._install({ vorlage: c.vorlage, item: c.item, slot: intent.slot, rack: intent.rack, u: intent.u });
      if (r.error) return reject(r.error.code, r.error.reason);
      if (this.modus === 'katalog') this.inventory[c.item]--;
      this._emitFull();
      return { type: 'ack', seq, rev: this.rev, node: r.entry.node, ids: r.entry.ids };
    } else if (intent.action === 'uninstall') {
      const e = this._uninstall(intent.device);
      if (e) return reject(e.code, e.reason);
      this._emitFull();
    } else if (intent.action === 'unlink') {
      const l = this.linkAt(intent.port);
      if (!l) return reject('not_linked', 'kein Kabel an diesem Port');
      this._remove(l, 'abgezogen', 'player');
    } else {
      const res = this._handle(intent, seq);
      return res ?? reject('rule', `unbekannte Aktion ${intent.action}`);
    }
    return { type: 'ack', seq, rev: this.rev };
  }

  /** Dev/Test (E3): Stoerung - der Kern entfernt ein Kabel mit Grund (by: fault). */
  injectFault(portRef, reason = `Stoerung: Kabel an ${portRef} defekt`) {
    const l = this.linkAt(portRef);
    if (!l) return false;
    this._remove(l, reason, 'fault');
    return true;
  }
}
