// Headless-Check LocalKern (docs/SCENARIO_API.md, E1-E3): Manifest/hello, Intents -> ack/reject,
// Katalog + Inventar, Deltas mit reason/by, Stoerung, Reducer, Ziele.
const { LocalKern, RoomManifest, reduceState } = await import('../src/kern.js');
let ok = true;
const check = (name, cond, extra = '') => { ok &&= cond; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name} ${extra}`); };
const nums = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i + 1).padStart(2, '0'), 'rj45']));
const manifest = { room: 'test', version: 1, devices: [
  { id: 'sw1', node: 'r1_switch_U41', ports: { ...nums(24), 25: 'sfp' }, leds: ['p07', 'p08', 'pwr'] },
  { id: 'pp1', node: 'r1_patchpanel_U42', ports: Object.fromEntries(Object.keys(nums(24)).map((k) => [k, 'keystone'])), leds: [] },
  { id: 'sw2', node: 'r1_switch_U39', ports: nums(24), leds: [] },
] };
const scenario = {
  id: 'test', modus: 'katalog',
  hardware_katalog: [{ item: 'k025', laenge: 0.25, farbe: '#1f5fd1' }, { item: 'k10', laenge: 1.0, farbe: '#e0b21a' }],
  inventar: { k025: 1, k10: 1 },
  ziele: [{ id: 'g1', typ: 'link', a: 'sw1/07', b: 'pp1/07', text: 'g1' },
    { id: 'g2', typ: 'link_any', a: 'pp1/13', b_device: 'sw2', text: 'g2' }],
};

// --- E1 Manifest ---------------------------------------------------------------------------
const mf = new RoomManifest(manifest);
check('E1 Manifest: Node <-> Kern-Ref', mf.portRef('r1_switch_U41_port_07') === 'sw1/07'
  && mf.portNode('pp1/13') === 'r1_patchpanel_U42_port_13' && mf.ledRef('r1_switch_U41_led_p07') === 'sw1/led_p07'
  && mf.ledNode('sw1/led_pwr') === 'r1_switch_U41_led_pwr' && mf.portRef('r9_x_port_01') === null);
check('E1 validate: fehlender Node wird gemeldet', mf.validate(['r1_switch_U41_port_01']).length === 72);

const k = new LocalKern({ manifest, scenario });
const msgs = [];
k.onMessage((m) => msgs.push(m));
let r = await k.send({ action: 'link', from: 'sw1/07', to: 'pp1/07' });
check('vor hello -> reject rule', r.type === 'reject' && r.code === 'rule');
r = await k.send({ action: 'hello', scenario: 'test' });
await Promise.resolve();
check('E1 hello -> ack mit Manifest + Katalog, danach voller state', r.type === 'ack' && r.manifest.devices.length === 3
  && r.modus === 'katalog' && r.catalog.length === 2 && msgs[0]?.type === 'state'
  && msgs[0].leds['sw1/led_p07'] === 'off' && !('sw1/led_pwr' in msgs[0].leds));
let state = reduceState(null, msgs[0]);

// --- E2 Katalog / Inventar -------------------------------------------------------------------
r = await k.send({ action: 'link', from: 'sw1/07', to: 'pp1/07', cable: { length: 0.25, color: '#ff00ff' } });
check('E2 katalog: ohne item -> reject rule', r.code === 'rule');
r = await k.send({ action: 'link', from: 'sw1/07', to: 'pp1/07', cable: { item: 'k025', length: 9, color: '#ff00ff' } });
const d1 = msgs.at(-1);
state = reduceState(state, d1);
check('E2 link mit item -> ack, delta links_add', r.type === 'ack' && d1.type === 'delta' && d1.links_add.length === 1);
check('E2 Kern setzt Laenge/Farbe aus dem Katalog (nicht vom Client)', state.links[0].length === 0.25 && state.links[0].color === '#1f5fd1');
check('E2 Inventar k025 1 -> 0', state.inventory.k025 === 0);
check('delta: nur geaenderte LED + Ziel g1', JSON.stringify(d1.leds) === '{"sw1/led_p07":"on"}' && state.goals.find((g) => g.id === 'g1').done);
r = await k.send({ action: 'link', from: 'sw1/08', to: 'pp1/08', cable: { item: 'k025' } });
check('E2 Inventar leer -> reject budget', r.code === 'budget', `(${r.reason})`);

// --- bestehende Regeln -----------------------------------------------------------------------
r = await k.send({ action: 'link', from: 'sw1/07', to: 'pp1/09', cable: { item: 'k10' } });
check('belegt -> reject occupied', r.code === 'occupied');
r = await k.send({ action: 'link', from: 'sw1/25', to: 'pp1/09', cable: { item: 'k10' } });
check('SFP -> Keystone -> reject incompatible', r.code === 'incompatible');
r = await k.send({ action: 'link', from: 'sw1/01', to: 'sw1/01', cable: { item: 'k10' } });
check('gleicher Port -> reject same_port', r.code === 'same_port');
r = await k.send({ action: 'link', from: 'x/01', to: 'sw1/02', cable: { item: 'k10' } });
check('unbekannt -> reject unknown_port', r.code === 'unknown_port');
check('Rejects erzeugen kein Delta', msgs.length === 2 && k.rev === 1);

r = await k.send({ action: 'link', from: 'pp1/13', to: 'sw2/01', cable: { item: 'k10' } });
state = reduceState(state, msgs.at(-1));
check('link_any: Dose 13 -> sw2 erfuellt g2', r.type === 'ack' && state.goals.find((g) => g.id === 'g2').done);

// --- E3 Entfernen mit Grund ------------------------------------------------------------------
r = await k.send({ action: 'unlink', port: 'pp1/07' });
const d3 = msgs.at(-1);
state = reduceState(state, d3);
check('E3 unlink -> delta links_remove by player mit reason', d3.links_remove.length === 1 && d3.links_remove[0].by === 'player'
  && !!d3.links_remove[0].reason);
check('unlink: LED p07 off, g1 offen, Kabel zurueck ins Inventar', state.leds['sw1/led_p07'] === 'off'
  && !state.goals.find((g) => g.id === 'g1').done && state.inventory.k025 === 1);
check('E3 Stoerung: injectFault entfernt Kabel by fault mit Grund', k.injectFault('sw2/01', 'Stoerung: Kabel defekt') === true);
const d4 = msgs.at(-1);
state = reduceState(state, d4);
check('E3 fault-Delta: by fault, reason, Kabel NICHT zurueck ins Inventar', d4.links_remove[0].by === 'fault'
  && d4.links_remove[0].reason === 'Stoerung: Kabel defekt' && state.inventory.k10 === 0 && state.links.length === 0);
check('Reducer: altes Delta (rev <= aktuell) wird verworfen', reduceState(state, { ...d1 }) === state);
r = await k.send({ action: 'unlink', port: 'pp1/07' });
check('unlink ohne Kabel -> reject not_linked', r.code === 'not_linked');
check('rev steigt nur bei Aenderung', k.rev === 4, `(rev ${k.rev})`);

// --- Sandbox ------------------------------------------------------------------------------------
const ks = new LocalKern({ manifest, scenario: { ...scenario, modus: 'sandbox' } });
await ks.send({ action: 'hello' });
r = await ks.send({ action: 'link', from: 'sw1/07', to: 'pp1/07', cable: { length: 0.5, color: '#2e9b46' } });
check('E2 sandbox: freie Farbe/Laenge ohne item', r.type === 'ack' && ks.links[0].color === '#2e9b46' && ks.links[0].length === 0.5);
process.exit(ok ? 0 : 1);
