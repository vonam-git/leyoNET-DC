// Nachspielen auf dem Server (Plan v4 F, Konzept Kap. 9: «Client sendet Absichten, nie Ergebnisse»): dieselben Levels, derselbe
// EmbeddedKern. Wird mit esbuild zu server/kern.cjs gebuendelt (npm run build:server) und laeuft dort in einem Worker.
import { EmbeddedKern } from './embedded-kern.js';
import * as core from '../../vendor/leyonet/src/core/index.ts';
import { LEVELS, readyScenario } from './levels.js';
import { HUB_IP, TASK_LIST, auftragsblatt, partnerSeat, seatPlan, taskById, verbundLevel, verbundTopology } from './verbund.js';
import { createLoesungen } from './loesungen.js';
import manifest from '../../assets/out/room_v3.manifest.json';
import kit from '../../assets/out/kit.kit.json';

/** Absichten, die am Zustand nichts aendern, gehoeren nicht ins Protokoll (auch im Spiel: classroom.js). */
export const READ_ONLY = new Set(['device_info', 'console_complete', 'host_ping', 'host_http']);
export const LEVEL_LIST = LEVELS.map((l) => ({ id: l.id, title: l.title, goals: l.scenario.ziele?.length ?? 0, plan: !!l.bauplan }));

/** Protokoll eines Levels nachspielen -> { done, total } nach dem Urteil des Kerns. */
export async function replay({ level, ready = false, intents }) {
  const lv = LEVELS.find((l) => l.id === level);
  if (!lv || !lv.scenario.ziele?.length) throw new Error('levelUnknown');
  const kern = new EmbeddedKern({ manifest, scenario: ready ? readyScenario(lv) : lv.scenario, kit });
  await kern.send({ action: 'hello' });
  kern.quiet = true; // Ziele und Konsolen-Simulation (ping, show) erst am Schluss bzw. gar nicht
  for (const i of intents) {
    if (!i || typeof i !== 'object' || typeof i.action !== 'string' || i.action === 'hello' || READ_ONLY.has(i.action)) continue;
    try { await kern.send(i); } catch { /* ungueltige Absicht: zaehlt nicht */ }
  }
  kern.quiet = false;
  const goals = kern.goals();
  return { done: goals.filter((g) => g.done).length, total: goals.length };
}

// ---------- Verbundsaufgaben ----------
export { TASK_LIST, auftragsblatt, createLoesungen, partnerSeat };

/**
 * Standort eines Platzes nachspielen und pruefen. partner: { topology, uplink } eines geprueften Standorts, sonst antwortet der Referenz-Standort.
 * only 'site': nur Netz und Stufe (erster Durchgang, damit die Partner bekannt sind).
 * -> { goals: [{ id, done, reason? }], level, uplink, topology, plan } (topology/plan nur aus dem Kern, nie vom Spiel)
 */
export async function judge({ task, seat, intents, partner = null, only = null }) {
  const lv = verbundLevel(task, seat);
  if (!lv) throw new Error('taskUnknown');
  const kern = new EmbeddedKern({ manifest, scenario: lv.scenario, kit });
  kern.quiet = true;
  await kern.send({ action: 'hello' });
  for (const i of intents) {
    if (!i || typeof i !== 'object' || typeof i.action !== 'string' || i.action === 'hello' || READ_ONLY.has(i.action)) continue;
    try { await kern.send(i); } catch { /* ungueltige Absicht: zaehlt nicht */ }
  }
  kern.quiet = false;
  kern.partner = partner;
  const uplink = kern.uplink();
  const goals = only === 'site' ? [] : kern.goals();
  const net = verbundTopology({ task, seat, own: kern.t, uplink, names: new Map([...kern.coreId].map(([k, c]) => [c, k])), partner });
  const test = (check) => core.evaluateGoal(net, { id: 'x', text: '', check }).passed;
  const p = seatPlan(seat);
  let level = 'offline';
  if (uplink) {
    const dev = [...kern.coreId].find(([, c]) => c === uplink.device)?.[0];
    const web = test({ type: 'http', from: 'Zentrale', url: `http://${p.pub}/` });
    level = web ? 'services' : test({ type: 'verbundSite' }) || (dev && test({ type: 'ping', from: dev, to: HUB_IP })) ? 'online' : 'connected';
  }
  const st = kern.state();
  const used = new Set(st.links.flatMap((l) => [l.a, l.b]));
  return { goals: goals.map((g) => ({ id: g.id, done: !!g.done, ...(g.reason ? { reason: String(g.reason) } : {}) })), level, uplink, topology: kern.t, budget: kern.budget,
    plan: { devices: st.devices.map((d) => ({ id: d.id, rack: d.rack, ports: Object.fromEntries(Object.entries(d.ports).filter(([q]) => used.has(`${d.id}/${q}`))) })),
      links: st.links.map((l) => ({ id: l.id, a: l.a, b: l.b })), trunks: st.trunks, power: st.power, plan: st.plan } };
}
/** Welche Stufe muss der Partner haben, damit er selbst antwortet (sonst Referenz-Standort)? */
export const partnerNeeds = (task) => (taskById(task)?.sterne <= 2 ? 'online' : 'services');
