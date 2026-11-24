// Tests des Servers (node --test): Klassen, Pseudonyme, geprüfte Ergebnisse, Anmeldung mit TOTP, Rechte, Löschfristen, Datenschutz.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';

const require = createRequire(import.meta.url);
const { createApp, hotp, base32, totpStep } = require('./app.cjs');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-server-'));
const INVITE = 'erste-einladung-0123456789';
let clock = Date.parse('2026-11-23T08:00:00Z');
const make = (extra = {}) => createApp({ dataDir: DIR, now: () => clock, env: { DC_ADMIN_INVITE: INVITE, ...extra } });
let app = make();
let base;
const listen = () => new Promise((r) => app.server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${app.server.address().port}`; r(); }));
await listen();
after(() => { app.server.close(); app.server.closeAllConnections(); fs.rmSync(DIR, { recursive: true, force: true }); });

let ip = 1;
async function call(method, p, body, token, addr = `10.0.0.${ip}`) {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': addr, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* CSV */ }
  return { status: r.status, json, text, headers: r.headers };
}
const post = (p, b, t, a) => call('POST', p, b, t, a);
const get = (p, t, a) => call('GET', p, undefined, t, a);
const unb32 = (t) => { let bits = 0, v = 0; const o = []; for (const c of t) { v = (v << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; v &= 255; } } return Buffer.from(o); };
const totp = (secret) => hotp(unb32(secret), Math.floor(clock / 30_000));
const L1 = [{ action: 'buy', item: 'patch-cat6-1.0-gelb', qty: 1 }, ...['nb1', 'nb2'].flatMap((n) => [{ action: 'power', device: n, on: true },
  { action: 'set_ip', device: n, ip: `10.0.0.${n[2]}`, mask: '255.255.255.0' }]), { action: 'link', from: 'nb1/01', to: 'nb2/01', cable: { item: 'patch-cat6-1.0-gelb' } }];
const ctx = {};

test('RFC-Testwerte: HOTP (RFC 4226) und Base32', () => {
  const s = Buffer.from('12345678901234567890');
  assert.deepEqual([0, 1, 2, 9].map((c) => hotp(s, c)), ['755224', '287082', '359152', '520489']);
  assert.equal(base32(s), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(totpStep(s, hotp(s, 100), 100, 100 * 30_000), null, 'jeder Schritt nur einmal');
});

test('Status ohne Anmeldung, Admin gesperrt', async () => {
  assert.equal((await get('/api/status')).json.app, 'leyonet-dc');
  for (const p of ['me', 'classes', 'accounts', 'audit']) assert.equal((await get(`/api/admin/${p}`)).status, 401);
  assert.equal((await get('/nirgends')).status, 404);
  assert.equal((await post('/api/join', [])).status, 400);
});

test('erster Admin: Einladung, Passwort, TOTP-Pflicht', async () => {
  assert.equal((await post('/api/admin/activate', { invite: 'falsch-falsch-falsch', password: 'x'.repeat(14) })).status, 403);
  assert.equal((await post('/api/admin/activate', { invite: INVITE, password: 'kurz' })).status, 400);
  const a = (await post('/api/admin/activate', { invite: INVITE, password: 'ein langes Passwort' })).json;
  assert.match(a.uri, /^otpauth:\/\/totp\//);
  assert.equal((await post('/api/admin/confirm', { pending: a.pending, code: '000000' })).status, 403);
  const c = (await post('/api/admin/confirm', { pending: a.pending, code: totp(a.secret) })).json;
  assert.equal(c.role, 'admin');
  assert.equal(c.recovery.length, 8);
  Object.assign(ctx, { admin: c.token, adminSecret: a.secret, recovery: c.recovery });
  assert.equal((await post('/api/admin/activate', { invite: INVITE, password: 'ein langes Passwort' })).status, 403, 'Einladung gilt nur einmal');
  clock += 31_000;
  assert.equal((await post('/api/admin/login', { user: 'admin', password: 'ein langes Passwort', code: '123456' })).status, 403);
  const code = totp(a.secret);
  assert.equal((await post('/api/admin/login', { user: 'admin', password: 'ein langes Passwort', code })).status, 200);
  assert.equal((await post('/api/admin/login', { user: 'admin', password: 'ein langes Passwort', code })).status, 403, 'Code nur einmal');
  ip++;
  assert.equal((await post('/api/admin/login', { user: 'admin', password: 'ein langes Passwort', code: ctx.recovery[0] })).status, 200);
  assert.equal((await post('/api/admin/login', { user: 'admin', password: 'ein langes Passwort', code: ctx.recovery[0] })).status, 403, 'Wiederherstellungscode nur einmal');
});

test('Anmeldung: nach 5 Fehlversuchen gesperrt, andere Adresse nicht', async () => {
  ip = 20;
  for (let i = 0; i < 5; i++) assert.equal((await post('/api/admin/login', { user: 'admin', password: 'falsch', code: '1' })).json.error, 'loginWrong');
  assert.equal((await post('/api/admin/login', { user: 'admin', password: 'falsch', code: '1' })).json.error, 'locked');
  assert.equal((await post('/api/admin/login', { user: 'admin', password: 'falsch', code: '1' }, null, '10.9.9.9')).json.error, 'loginWrong');
  assert.equal((await post('/api/admin/login', { user: 'gibtsnicht', password: 'falsch', code: '1' }, null, '10.9.9.8')).json.error, 'loginWrong', 'gleiche Antwort');
  ip = 30;
});

test('Lehrperson: Konto, Einladung, Rechte', async () => {
  assert.equal((await post('/api/admin/accounts', { user: 'Anna Muster' }, ctx.admin)).status, 400);
  const inv = (await post('/api/admin/accounts', { user: 'lp1' }, ctx.admin)).json.invite;
  const inv2 = (await post('/api/admin/accounts', { user: 'lp2' }, ctx.admin)).json.invite;
  for (const [k, i] of [['lp1', inv], ['lp2', inv2]]) {
    const a = (await post('/api/admin/activate', { invite: i, password: 'noch ein Passwort' })).json;
    assert.equal(a.user, k);
    ctx[k] = (await post('/api/admin/confirm', { pending: a.pending, code: totp(a.secret) })).json.token;
  }
  assert.equal((await get('/api/admin/accounts', ctx.lp1)).status, 403);
  assert.equal((await post('/api/admin/classes', { label: 'INF22a', until: '2026-02-01' }, ctx.lp1)).status, 400, 'Vergangenheit');
  const c = await post('/api/admin/classes', { label: 'INF22a', until: '2027-01-31' }, ctx.lp1);
  assert.equal(c.status, 200);
  ctx.cls = c.json;
  assert.equal((await get(`/api/admin/classes/${c.json.id}`, ctx.lp2)).status, 404, 'fremde Klasse unsichtbar');
  assert.equal((await post(`/api/admin/classes/${c.json.id}/delete`, {}, ctx.lp2)).status, 404);
  assert.equal((await get('/api/admin/classes', ctx.admin)).json.classes.length, 1);
});

test('Beitreten: Pseudonym vom Server, anderes Gerät mit eigenem Code', async () => {
  assert.equal((await post('/api/join', { code: 'ZZZZZZ' })).status, 404);
  const names = new Set();
  for (let i = 0; i < 12; i++) {
    const j = (await post('/api/join', { code: ctx.cls.code.toLowerCase(), name: 'Anna Muster' })).json;
    assert.match(j.name, /^[A-Za-zäöü]+-[A-Za-zäöü]+$/);
    names.add(j.name);
    if (!i) ctx.p = j;
    if (i === 1) ctx.q = j;
  }
  assert.equal(names.size, 12);
  const r = (await post('/api/resume', { code: ctx.p.code })).json;
  assert.equal(r.name, ctx.p.name);
  assert.equal((await get('/api/me', ctx.p.token)).status, 401, 'altes Gerät gilt nicht mehr');
  ctx.p.token = r.token;
});

test('Ergebnis zählt nur, wenn das Protokoll das Level löst; Zeit misst der Server', async () => {
  const run = (await post('/api/run', { level: 'L1', ready: true }, ctx.p.token)).json.run;
  clock += 1_000;
  assert.equal((await post('/api/finish', { run, intents: L1 }, ctx.p.token)).json.error, 'tooFast');
  clock += 41_000;
  assert.equal((await post('/api/finish', { run, intents: L1.slice(0, -1), ms: 1 }, ctx.p.token)).json.error, 'notSolved');
  const [x, y] = await Promise.all([1, 2].map(() => post('/api/finish', { run, intents: L1, ms: 1 }, ctx.p.token)));
  assert.deepEqual([x.status, y.status].sort(), [200, 409], 'ein Lauf zählt einmal');
  const ok = x.status === 200 ? x.json : y.json;
  assert.equal(ok.ms, 42_000);
  assert.equal(ok.record, true);
  const r2 = (await post('/api/run', { level: 'L1', ready: true }, ctx.p.token)).json.run;
  clock += 60_000;
  const again = (await post('/api/finish', { run: r2, intents: [...L1, { action: '__proto__' }, null, { action: 'link' }] }, ctx.p.token)).json;
  assert.deepEqual([again.record, again.best], [false, 42_000]);
  assert.equal((await post('/api/run', { level: 'L1"; DROP', ready: true }, ctx.p.token)).status, 400);
});

test('Spielstände: speichern, öffnen, weiterspielen ohne Bestzeit, löschen', async () => {
  const t = ctx.p.token;
  const save = { game: '0.0.13', level: 'L1', ready: true, ms: 5000, player: [1, 0, -2, 0.5], mark: { devices: 2, links: 0, budget: 10 }, intents: L1.slice(0, 3), name: 'Anna Muster' };
  assert.equal((await post('/api/saves', { save })).status, 401, 'nur mit Pseudonym');
  const run = (await post('/api/run', { level: 'L1', ready: true }, t)).json.run;
  clock += 30_000;
  const s = (await post('/api/saves', { save, run }, t)).json.saves[0];
  assert.deepEqual([s.steps, s.elapsed, s.name, s.intents], [3, 30_000, undefined, undefined], 'kein freier Name, Liste ohne Schritte');
  assert.equal((await post(`/api/saves/${s.id}/open`, {}, ctx.q.token)).status, 404, 'fremder Spielstand unsichtbar');
  for (const bad of [{ level: 'ZZ9' }, { level: '../x' }, { ready: 1 }, { intents: 'x' }, { intents: [null] }, { game: '<b>' }]) assert.equal((await post('/api/saves', { save: { ...save, ...bad } }, t)).status, 400, JSON.stringify(bad));
  clock += 61_000;
  const big = { ...save, intents: Array.from({ length: 1500 }, () => ({ action: 'console', session: 'S1', line: 'x'.repeat(60) })) };
  assert.equal((await post('/api/saves', { save: big }, t)).status, 413, 'zu gross');
  // Ohne Lauf gespeichert (aus Datei): öffnen geht, zählt aber nie
  const s2 = (await post('/api/saves', { save, run: 'fremd' }, t)).json.saves[0];
  assert.equal(s2.elapsed, null);
  assert.equal((await post(`/api/saves/${s2.id}/open`, {}, t)).json.run, null);
  const o = (await post(`/api/saves/${s.id}/open`, {}, t)).json;
  assert.deepEqual(o.save.intents, save.intents);
  clock += 3_000;
  const fin = (await post('/api/finish', { run: o.run, intents: L1 }, t)).json;
  assert.deepEqual([fin.ok, fin.ms, fin.record, fin.best, fin.resumed], [true, 33_000, false, 42_000, true], 'geschafft, aber keine Bestzeit');
  assert.equal((await post('/api/saves/0000000000000000/delete', {}, t)).status, 404);
  assert.equal((await post(`/api/saves/${s.id}/delete`, {}, t)).json.saves.length, 1);
  clock += 61_000;
  for (let i = 0; i < 4; i++) assert.equal((await post('/api/saves', { save }, t)).status, 200);
  assert.equal((await post('/api/saves', { save }, t)).json.error, 'savesFull');
  assert.ok(fs.readdirSync(path.join(DIR, 'saves')).length === 1);
  // Löschen mit dem Pseudonym
  const j = (await post('/api/join', { code: ctx.cls.code })).json;
  await post('/api/saves', { save }, j.token);
  assert.equal(fs.readdirSync(path.join(DIR, 'saves')).length, 2);
  await post('/api/leave', {}, j.token);
  assert.equal(fs.readdirSync(path.join(DIR, 'saves')).length, 1, 'Klasse verlassen löscht Spielstände');
});

test('Klassensteuerung: Zwischenstopp, Sperren, Levels, Schluss', async () => {
  const id = ctx.cls.id;
  const me = (await get(`/api/admin/classes/${id}`, ctx.lp1)).json;
  const pid = me.table.find((t) => t.name === ctx.p.name).id;
  assert.equal(me.table.find((t) => t.id === pid).results['L1+'].count, 3);
  await post(`/api/admin/classes/${id}/preset`, { preset: 'stopp' }, ctx.lp1);
  assert.equal((await post('/api/beat', { level: 'L1', done: 1, total: 3 }, ctx.p.token)).json.paused, true);
  assert.equal((await post('/api/run', { level: 'L1', ready: false }, ctx.p.token)).status, 403);
  await post(`/api/admin/classes/${id}/preset`, { preset: 'start' }, ctx.lp1);
  await post(`/api/admin/classes/${id}/settings`, { levels: ['L1', 'L2'], timer: 'ein', leaderboard: true }, ctx.lp1);
  assert.equal((await post('/api/run', { level: 'L3', ready: false }, ctx.p.token)).json.error, 'levelLocked');
  assert.equal((await get('/api/me', ctx.p.token)).json.leaderboard['L1+'][0].name, ctx.p.name);
  await post(`/api/admin/classes/${id}/players/${pid}`, { action: 'lock' }, ctx.lp1);
  assert.equal((await post('/api/beat', {}, ctx.p.token)).json.locked, true);
  assert.equal((await post('/api/beat', {}, ctx.q.token)).json.locked, false);
  await post(`/api/admin/classes/${id}/players/${pid}`, { action: 'unlock' }, ctx.lp1);
  for (const bad of ['__proto__', 'constructor', 'toString']) assert.equal((await post(`/api/admin/classes/${id}/players/${bad}`, { action: 'lock' }, ctx.lp1)).status, 404);
  assert.equal({}.locked, undefined);
  ctx.pid = pid;
});

test('Live-Beobachtung nur auf Anfrage und nur im Speicher', async () => {
  const u = `/api/admin/classes/${ctx.cls.id}/players/${ctx.pid}`;
  assert.equal((await post('/api/beat', { plan: { devices: ['geheim'] } }, ctx.p.token)).json.observe, false);
  assert.equal((await post(u, { action: 'observe' }, ctx.lp1)).json.plan, null, 'ohne Beobachtung wird nichts behalten');
  assert.equal((await post('/api/beat', { plan: { devices: ['x'] } }, ctx.p.token)).json.observe, true);
  assert.deepEqual((await post(u, { action: 'observe' }, ctx.lp1)).json.plan, { devices: ['x'] });
  assert.equal((await post(u, { action: 'observe' }, ctx.lp2)).status, 404);
  clock += 30_000;
  assert.equal((await post('/api/beat', {}, ctx.p.token)).json.observe, false);
});

test('CSV, neuer Code, Löschen auf Wunsch', async () => {
  const csv = await get(`/api/admin/classes/${ctx.cls.id}/csv`, ctx.lp1);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.ok(csv.text.includes(`${ctx.p.name};2026-11-23`) && csv.text.includes('42.0;3'));
  const n = (await post(`/api/admin/classes/${ctx.cls.id}/players/${ctx.pid}`, { action: 'code' }, ctx.lp1)).json.code;
  assert.equal((await get('/api/me', ctx.p.token)).status, 401);
  ctx.p.token = (await post('/api/resume', { code: n })).json.token;
  assert.equal((await post('/api/leave', {}, ctx.q.token)).status, 200);
  assert.equal((await get('/api/me', ctx.q.token)).status, 401);
});

test('Neustart: Daten bleiben, Anmeldungen enden', async () => {
  app.server.close();
  app.server.closeAllConnections();
  app = make();
  await listen();
  assert.equal((await get('/api/admin/me', ctx.lp1)).status, 401);
  assert.equal((await get('/api/me', ctx.p.token)).json.name, ctx.p.name);
});

test('Datenschutz: keine Adresse, kein Klartext-Geheimnis, kein Protokoll auf der Platte', () => {
  const all = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else all.push([p, fs.readFileSync(p, 'latin1')]); } };
  walk(DIR);
  const text = all.map(([, t]) => t).join('\n');
  for (const bad of ['10.0.0.', '10.9.9.', 'ein langes Passwort', 'Anna', ctx.adminSecret, ctx.p.token, ctx.p.code.replace('-', ''), 'set_ip', 'patch-cat6', 'geheim', ctx.recovery[1]]) assert.ok(!text.includes(bad), `gefunden: ${bad}`);
  for (const [p] of all) if (!p.endsWith('.htaccess')) assert.equal(fs.statSync(p).mode & 0o077, 0, `Rechte ${p}`);
});

test('Löschfristen: nach dem Semester zu, nach 3 Monaten weg; Audit 2 Jahre', async () => {
  clock = Date.parse('2027-02-02T08:00:00Z');
  assert.equal((await post('/api/beat', {}, ctx.p.token)).json.closed, true);
  assert.equal((await post('/api/join', { code: ctx.cls.code })).json.error, 'classClosed');
  app.cleanup();
  assert.equal(app._test.classes.size, 1);
  clock = Date.parse('2027-05-05T08:00:00Z');
  app.cleanup();
  assert.equal(app._test.classes.size, 0);
  assert.equal((await get('/api/me', ctx.p.token)).status, 401);
  assert.ok(fs.existsSync(path.join(DIR, 'audit', '2026-11.jsonl')));
  clock = Date.parse('2028-12-05T08:00:00Z');
  app.cleanup();
  assert.ok(!fs.existsSync(path.join(DIR, 'audit', '2026-11.jsonl')));
});

test('Admin zurücksetzen', async () => {
  app.server.close();
  app.server.closeAllConnections();
  app = make({ DC_ADMIN_RESET: '1' });
  await listen();
  assert.ok(!app._test.accounts().some((a) => a.role === 'admin'));
  assert.equal((await post('/api/admin/activate', { invite: INVITE, password: 'ein neues Passwort' }, null, '10.7.7.7')).status, 200);
});

test('Grenzen: Grösse, Zahl der Absichten, Codes raten', async () => {
  assert.equal((await post('/api/beat', { x: 'y'.repeat(70_000) }, 'a'.repeat(40), '10.6.6.1')).status, 413);
  let last;
  for (let i = 0; i < 32; i++) last = await post('/api/join', { code: `AAAAA${i}` }, null, '10.6.6.2');
  assert.equal(last.status, 429);
});
