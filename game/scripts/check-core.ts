// Smoke-Test leyoNET-Kern (vendor/leyonet, Submodul): Laeuft der echte Kern hier, und passen die
// Bausteine fuer Level 1 (2 Notebooks + Kabel + IP + Ping) und fuer die Switch-CLI?
// Start: npx tsx scripts/check-core.ts
import * as core from '../../vendor/leyonet/src/core/index.ts';

let ok = true;
const check = (name: string, cond: boolean, extra = '') => { ok &&= cond; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name} ${extra}`); };
const val = <T>(r: core.Result<T>): T => { if (!r.ok) throw new Error(`core: ${JSON.stringify(r.error)}`); return r.value; };

// --- Level 1: zwei Notebooks direkt verbinden, IP setzen, Ping ---------------------------
let t = core.emptyTopology();
const a = val(core.addDevice(t, 'notebook', 'NB-A', { x: 0, y: 0 })); t = a.topology;
const b = val(core.addDevice(t, 'notebook', 'NB-B', { x: 200, y: 0 })); t = b.topology;
const cab = val(core.connect(t, a.id, b.id, 'tp')); t = cab.topology;
check('Kabel Notebook <-> Notebook (tp)', core.cablesOf(t, a.id).length === 1);
const goals: core.Goal[] = [
  { id: 'g1', text: 'verbunden', check: { type: 'connected', a: 'NB-A', b: 'NB-B' } },
  { id: 'g2', text: 'Ping', check: { type: 'ping', from: 'NB-A', to: 'NB-B' } },
];
const before = goals.map((g) => core.evaluateGoal(t, g));
check('ohne IP: verbunden ja, Ping nein', before[0].passed && !before[1].passed, JSON.stringify(before.map((r) => [r.passed, r.reason?.code])));
t = val(core.setInterfaceAddress(t, a.id, 0, '192.168.1.10', '255.255.255.0'));
t = val(core.setInterfaceAddress(t, b.id, 0, '192.168.1.20', '255.255.255.0'));
const after = goals.map((g) => core.evaluateGoal(t, g));
check('mit IP im selben Netz: Ping ok', after[0].passed && after[1].passed, JSON.stringify(after.map((r) => r.passed)));
let t2 = val(core.setInterfaceAddress(t, b.id, 0, '192.168.2.20', '255.255.255.0'));
check('Gegenprobe anderes Netz: Ping scheitert', !core.evaluateGoal(t2, goals[1]).passed);

// --- Switch-CLI (Konsole) -------------------------------------------------------------------
const sw = val(core.addDevice(t, 'switch', 'SW1', { x: 100, y: 100 }, { ports: 24 })); t = sw.topology;
const dev = core.getDevice(t, sw.id)!;
check('Switch hat Konsole/CLI', core.hasCli(dev.type), `(${dev.interfaces.length} Interfaces)`);
let { session, lines } = core.startSession(dev);
const run = (line: string) => {
  const out = core.execute(session, line, { topology: t });
  session = out.session;
  if (out.topology) t = out.topology;
  return out.lines;
};
console.log(`     Prompt: ${core.prompt(t, session)}  Banner: ${JSON.stringify(lines)}`);
for (const l of ['enable', 'configure terminal', 'hostname SW-A', 'interface vlan 1', 'ip address 192.168.1.2 255.255.255.0', 'end']) {
  const o = run(l);
  if (o.length) console.log(`     ${l} -> ${o.join(' | ')}`);
}
const rc = run('show running-config');
check('CLI: hostname + VLAN-1-Adresse in running-config', rc.some((x) => /hostname SW-A/.test(x)) && rc.some((x) => /192\.168\.1\.2/.test(x)),
  `(${rc.length} Zeilen, Prompt ${core.prompt(t, session)})`);
const err = run('shw vlan');
check('CLI: Tippfehler -> Fehlermeldung mit ^', err.some((x) => x.includes('^') || x.startsWith('%')), JSON.stringify(err));
process.exit(ok ? 0 : 1);
