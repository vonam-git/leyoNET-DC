// Verbundsaufgaben auf dem Server: freigeben, Platz, Protokoll nachführen, prüfen, Partner, Abnahme, Rechte, Grenzen, Datenschutz.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';

const require = createRequire(import.meta.url);
const { createApp, hotp } = require('./app.cjs');
const { createLoesungen, TASK_LIST } = require('./kern.cjs');
// Musterlösungen sind nicht öffentlich: ohne Datei werden die Tests übersprungen, die eine brauchen
const SOL = process.env.DC_LOESUNGEN || new URL('../privat/loesungen.json', import.meta.url).pathname;
const skip = fs.existsSync(SOL) ? false : 'privat/loesungen.json fehlt';
const { loesung, loesungIntents } = createLoesungen(skip ? null : JSON.parse(fs.readFileSync(SOL, 'utf8')));
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-verbund-'));
const INVITE = 'erste-einladung-0123456789';
let clock = Date.parse('2026-11-23T08:00:00Z');
const app = createApp({ dataDir: DIR, loesungen: SOL, now: () => clock, env: { DC_ADMIN_INVITE: INVITE } });
await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.server.address().port}`;
after(() => { app.server.close(); app.server.closeAllConnections(); fs.rmSync(DIR, { recursive: true, force: true }); });
async function call(method, p, body, token) {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.0.0.1', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* CSV */ }
  return { status: r.status, json, text };
}
const post = (p, b, t) => call('POST', p, b, t);
const get = (p, t) => call('GET', p, undefined, t);
const unb32 = (t) => { let bits = 0, v = 0; const o = []; for (const c of t) { v = (v << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; v &= 255; } } return Buffer.from(o); };
async function account(invite, pw) {
  const a = (await post('/api/admin/activate', { invite, password: pw })).json;
  return (await post('/api/admin/confirm', { pending: a.pending, code: hotp(unb32(a.secret), Math.floor(clock / 30_000)) })).json.token;
}
const admin = await account(INVITE, 'ein langes Passwort');
const lp = await account((await post('/api/admin/accounts', { user: 'lp1' }, admin)).json.invite, 'noch ein Passwort');
const lp2 = await account((await post('/api/admin/accounts', { user: 'lp2' }, admin)).json.invite, 'noch ein Passwort');
const cls = (await post('/api/admin/classes', { label: 'INF22a', until: '2027-01-31' }, lp)).json;
const U = `/api/admin/classes/${cls.id}/verbund`;
const P = [];
for (let i = 0; i < 4; i++) P.push((await post('/api/join', { code: cls.code })).json);
const sendAll = async (p, run, log, from = 0) => {
  for (let k = from; k < log.length; k += 100) assert.equal((await post('/api/verbund/sync', { run, from: k, intents: log.slice(k, k + 100) }, p.token)).status, 200);
};

async function abnahme(u, token) {
  let v = (await post(`${u}/abnahme`, {}, token)).json;
  assert.equal(v.abnahmeLaeuft, true);
  for (let i = 0; i < 1200 && v.abnahmeLaeuft; i++) { await new Promise((r) => setTimeout(r, 50)); v = (await get(u, token)).json; }
  assert.equal(v.abnahmeFehler, null);
  return v;
}

test('fünf Aufgaben, ein bis fünf Sterne; nur die Lehrperson gibt frei', async () => {
  assert.deepEqual(TASK_LIST.map((t) => t.sterne), [1, 2, 3, 4, 5]);
  assert.equal((await get('/api/admin/me', lp)).json.verbund.length, 5);
  assert.equal((await post('/api/verbund/start', {}, P[0].token)).status, 403, 'noch nichts freigegeben');
  assert.equal((await post(U, { action: 'open', task: 'V2' })).status, 401);
  assert.equal((await post(U, { action: 'open', task: 'V2' }, P[0].token)).status, 401);
  assert.equal((await post(U, { action: 'open', task: 'V2' }, lp2)).status, 404, 'fremde Klasse');
  assert.equal((await post(U, { action: 'open', task: 'V9' }, lp)).status, 404);
  assert.equal((await post(U, { action: 'close' }, lp)).status, 409);
  assert.equal((await post(U, { action: 'open', task: 'V2' }, lp)).json.verbund.task, 'V2');
  assert.equal((await post('/api/beat', {}, P[0].token)).json.verbund.titel, 'Das Büro geht online');
});

test('Plätze: jede Person bekommt einen eigenen, er bleibt', async () => {
  const s = [];
  for (const p of P) { const r = (await post('/api/verbund/start', {}, p.token)).json; p.run = r.run; p.seat = r.seat; s.push(r.seat); }
  assert.deepEqual(s, [1, 2, 3, 4]);
  const again = (await post('/api/verbund/start', {}, P[2].token)).json;
  assert.deepEqual([again.seat, again.run], [3, P[2].run], 'weiterbauen: gleicher Lauf');
});

test('Protokoll: lückenlos, falsche Stelle -> neu abgleichen, fremder Lauf abgelehnt', { skip }, async () => {
  const log = loesungIntents('V2', 1);
  await sendAll(P[0], P[0].run, log.slice(0, 30));
  const r = (await post('/api/verbund/sync', { run: P[0].run, from: 10, intents: [] }, P[0].token)).json;
  assert.deepEqual(r, { have: 30, resync: true });
  assert.equal((await post('/api/verbund/sync', { run: P[1].run, from: 30, intents: [] }, P[0].token)).json.error, 'runUnknown');
  for (const bad of [[null], ['x'], [{ action: 5 }], Array(401).fill({ action: 'x' })]) assert.equal((await post('/api/verbund/sync', { run: P[0].run, from: 30, intents: bad }, P[0].token)).status, 400);
  const c = (await post('/api/verbund/check', {}, P[0].token)).json;
  assert.ok(c.goals.some((g) => !g.done), 'halb gebaut ist nicht fertig');
  await sendAll(P[0], P[0].run, log, 30);
  const done = (await post('/api/verbund/check', {}, P[0].token)).json;
  assert.ok(done.goals.every((g) => g.done), JSON.stringify(done.goals));
  assert.equal(done.level, 'online');
  assert.equal((await post('/api/verbund/start', {}, P[0].token)).json.intents.length, log.length, 'weiterbauen nach dem Neuladen');
});

test('Dashboard: Stufen nur aus der Prüfung des Servers, Meldungen des Spiels zählen nicht', { skip }, async () => {
  await post('/api/beat', { level: 'V2', done: 8, total: 8 }, P[2].token); // behauptet fertig
  await sendAll(P[1], P[1].run, loesungIntents('V2', 1)); // abgeschrieben von Platz 1
  let v;
  for (let i = 0; i < 100; i++) { v = (await get(U, lp)).json; if (!v.checking && v.rows.every((r) => r.goals.length)) break; clock += 7_000; await new Promise((r) => setTimeout(r, 50)); }
  assert.deepEqual(v.rows.map((r) => r.level), ['done', v.rows[1].level, 'offline', 'offline']);
  assert.notEqual(v.rows[1].level, 'done', 'abgeschriebene Adressen lösen den eigenen Platz nicht');
  assert.equal((await get(U, lp2)).status, 404);
  assert.equal((await get(U, P[0].token)).status, 401);
});

test('Partner: erst wenn er steht, antwortet er selbst (sonst die Referenz)', { skip }, async () => {
  const r = (await post('/api/verbund/start', { fresh: true }, P[1].token)).json;
  assert.equal(r.intents.length, 0);
  P[1].run = r.run;
  await sendAll(P[1], r.run, loesungIntents('V2', 2));
  clock += 61_000;
  const v = await abnahme(U, lp);
  assert.deepEqual(v.rows.slice(0, 2).map((x) => [x.level, x.partnerReal, x.partner]), [['done', true, 2], ['done', true, 1]]);
  assert.deepEqual(v.rows.slice(0, 2).map((x) => [x.result.passed, x.result.done, x.result.total]), [[true, 8, 8], [true, 8, 8]]);
  assert.equal(v.rows[2].result.passed, false);
  assert.equal((await post('/api/beat', {}, P[0].token)).json.verbund.result.passed, true);
  assert.equal((await post('/api/beat', {}, P[0].token)).json.verbund.partner, 'online');
});

test('Standort im Detail: Netzplan vom Server, Auftragsblatt und Musterlösung nur für die Lehrperson', { skip }, async () => {
  const id = (await get(U, lp)).json.rows[0].id;
  const d = (await get(`${U}/${id}`, lp)).json;
  assert.ok(d.plan.links.some((l) => [l.a, l.b].includes('pp1/24')));
  assert.equal(d.blatt.zeilen.find(([k]) => k === 'WAN-Adresse')[1], '203.0.113.6/30');
  assert.deepEqual(d.loesung, JSON.parse(JSON.stringify(loesung('V2', 1))));
  assert.equal((await get(`${U}/${id}`, lp2)).status, 404);
  assert.equal((await get(`${U}/__proto__`, lp)).status, 404);
});

test('schliessen, neue Aufgabe, beenden, Platz wird frei', { skip }, async () => {
  await post(U, { action: 'close' }, lp);
  assert.equal((await post('/api/verbund/sync', { run: P[0].run, from: 0, intents: [] }, P[0].token)).status, 403);
  assert.equal((await post('/api/verbund/start', {}, P[0].token)).status, 403);
  await post(U, { action: 'reopen' }, lp);
  assert.equal((await post('/api/verbund/start', {}, P[0].token)).status, 200);
  await post(U, { action: 'open', task: 'V5' }, lp);
  const r = (await post('/api/verbund/start', {}, P[0].token)).json;
  assert.deepEqual([r.task, r.seat, r.intents.length], ['V5', 1, 0]);
  assert.equal((await post('/api/verbund/sync', { run: P[1].run, from: 0, intents: [] }, P[1].token)).status, 409, 'alter Lauf gilt nicht mehr');
  await post('/api/leave', {}, P[1].token);
  const n = (await post('/api/join', { code: cls.code })).json;
  assert.equal((await post('/api/verbund/start', {}, n.token)).json.seat, 2);
});

test('Klasse mit 24 Plätzen: fünf Sterne, alles auf einmal prüfen', { skip }, async () => {
  const c = (await post('/api/admin/classes', { label: 'GROSS', until: '2027-01-31' }, lp)).json;
  await post(`/api/admin/classes/${c.id}/verbund`, { action: 'open', task: 'V5' }, lp);
  for (let i = 1; i <= 24; i++) {
    const p = (await post('/api/join', { code: c.code })).json;
    const r = (await post('/api/verbund/start', {}, p.token)).json;
    await sendAll(p, r.run, loesungIntents('V5', r.seat));
    clock += 4_000;
  }
  const t0 = Date.now();
  const v = await abnahme(`/api/admin/classes/${c.id}/verbund`, lp);
  const ms = Date.now() - t0;
  console.log(`# Abnahme 24 Plätze ★★★★★: ${ms} ms`);
  assert.equal(v.rows.filter((r) => r.result?.passed).length, 24, JSON.stringify(v.rows.filter((r) => !r.result?.passed).map((r) => r.goals.filter((g) => !g.done))));
  assert.ok(v.rows.every((r) => r.partnerReal));
  assert.ok(ms < 60_000);
});

test('Datenschutz: keine Protokolle, keine Netze auf der Platte; CSV mit Abnahme', { skip }, async () => {
  let text = '';
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else text += fs.readFileSync(p, 'latin1'); } };
  walk(DIR);
  for (const bad of ['router bgp', '"console"', 'patch-cat6', '203.0.113.', 'topology', '10.0.0.1']) assert.ok(!text.includes(bad), `gefunden: ${bad}`);
  assert.ok(text.includes('verbund.abnahme'));
  assert.match((await get(`/api/admin/classes/${cls.id}/csv`, lp)).text, /V2 Abnahme[\s\S]*8\/8/);
});
