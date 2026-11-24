'use strict';
/**
 * Server von leyoNET DC (Plan v4 F, Konzept Kap. 8 + 9): Klassen mit Pseudonymen, geprüfte Ergebnisse, Admin-Board.
 *
 * Datenschutz (revDSG): keine Namen, keine E-Mail-Adressen, keine IP-Adressen auf der Platte, keine Cookies, kein
 * Zugriffsprotokoll. Pseudonyme vergibt der Server; wer dahinter steckt, weiss nur die Lehrperson (offline). Alles hat ein
 * Ablaufdatum: Live-Stand nur im Arbeitsspeicher, Fortschritt bis Semesterende + 3 Monate, Audit-Log 2 Jahre.
 *
 * Ergebnisse: Das Spiel meldet «geschafft» nur zusammen mit dem Protokoll seiner Absichten. Der Server spielt es im selben
 * leyoNET-Kern nach (Worker, kern.cjs) und misst die Zeit selbst. Protokolle werden nicht gespeichert – ausser als Spielstand, den jemand selbst speichert
 * (verschlüsselt, data/saves, wird mit dem Pseudonym gelöscht).
 *
 * Nur Node.js-Bordmittel. Umgebung: PORT, DATA_DIR, STATIC_DIR (nur lokal), DC_ADMIN_INVITE (Einladung für den ersten
 * Admin, mind. 16 Zeichen), DC_ADMIN_RESET=1 (Admin-Zugang neu einrichten), MAX_PLAYERS (Standard 3000).
 */
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { promisify } = require('node:util');
const { Worker } = require('node:worker_threads');

const scrypt = promisify(crypto.scrypt);
const VERSION = 1;
const DAY = 86_400_000;
const KEEP_AFTER_DAYS = 90; // Fortschritt: Semesterende + 3 Monate
const AUDIT_MONTHS = 24;
const TOKEN_MS = 8 * 3_600_000;
const IDLE_MS = 60 * 60_000;
const ONLINE_MS = 45_000; // Lebenszeichen alle 15 s
const OBSERVE_MS = 20_000;
const MAX_BODY = 64 * 1024;
const MAX_FINISH = 512 * 1024;
const MAX_INTENTS = 4000;
const MIN_MS_PER_INTENT = 250;
const MAX_PER_CLASS = 60;
const MAX_CLASSES_PER_ACCOUNT = 60;
const REPLAY_MS = 10_000;
const REPLAY_PARALLEL = Math.min(4, Math.max(2, require('node:os').availableParallelism() - 1));
const REPLAY_QUEUE = 80;
const MAX_VB_BYTES = 1024 * 1024; // Protokoll einer Verbundsaufgabe je Platz (nur Arbeitsspeicher)
const MAX_VB_TOTAL = 96 * 1024 * 1024;
const VB_FRESH_MS = 6_000; // Dashboard: so lange gilt eine Prüfung
const VB_IDLE_MS = 12 * 3_600_000; // unbenutztes Protokoll einer Verbundsaufgabe
const MAX_SAVE = 128 * 1024; // Spielstand (JSON); grössere speichert das Spiel als Datei
const MAX_SAVES = 5; // je Spieler
const MAX_SAVES_TOTAL = 256 * 1024 * 1024;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('base64url');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const code = (n) => Array.from({ length: n }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
const normCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
const today = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && today(Date.parse(v)) === v;

// --- TOTP (RFC 6238 / 4226) ---------------------------------------------------------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = ((value << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return bits ? out + B32[(value << (5 - bits)) & 31] : out;
}
function hotp(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secret).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
/** Zeitschritt des Codes (Fenster ±1, jeder Schritt nur einmal) oder null */
function totpStep(secret, given, last = 0, now = Date.now()) {
  const c = String(given || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const cur = Math.floor(now / 30_000);
  for (const s of [cur - 1, cur, cur + 1]) if (s > last && same(hotp(secret, s), c)) return s;
  return null;
}

// --- Pseudonyme: aus Wortlisten, nie frei wählbar (keine Klarnamen) --------------------------
const WORT = ['Patch', 'Kabel', 'Switch', 'Router', 'Ping', 'Port', 'Rack', 'Trunk', 'Glasfaser', 'Konsole', 'Gateway', 'Subnetz', 'Uplink', 'Paket', 'Modul', 'Server', 'Laser', 'Bit', 'Byte', 'Frame'];
const TIER = ['Fuchs', 'Dachs', 'Luchs', 'Biber', 'Igel', 'Falke', 'Otter', 'Marder', 'Uhu', 'Wolf', 'Gecko', 'Lachs', 'Specht', 'Hase', 'Rabe', 'Delfin', 'Panda', 'Adler', 'Salamander', 'Murmeltier'];
function pseudonym(taken) {
  for (let i = 0; i < 400; i++) {
    const p = `${WORT[crypto.randomInt(WORT.length)]}-${TIER[crypto.randomInt(TIER.length)]}`;
    if (!taken.has(p)) return p;
  }
  return `Paket-${code(4)}`;
}

const err = (status, error) => Object.assign(new Error(error), { status, api: true });

function createApp(opts = {}) {
  const env = { ...process.env, ...opts.env };
  const now = opts.now || Date.now;
  const DATA = path.resolve(opts.dataDir || env.DATA_DIR || path.join(__dirname, 'data'));
  const STATIC = opts.staticDir || env.STATIC_DIR || null;
  const MAX_PLAYERS = Math.max(1, Number(env.MAX_PLAYERS) || 3000);
  const KERN = opts.kern || path.join(__dirname, 'kern.cjs');
  const warnings = [];
  const CLASSES = path.join(DATA, 'classes');
  const AUDIT = path.join(DATA, 'audit');
  const SAVES = path.join(DATA, 'saves'); // Spielstände: eine Datei je Spieler-ID
  for (const d of [DATA, CLASSES, AUDIT, SAVES]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(DATA, '.htaccess'), 'Require all denied\n');
  if (!path.relative(__dirname, DATA).startsWith('..')) warnings.push('DATA_DIR liegt im Programmordner – besser ausserhalb des Web-Verzeichnisses (docs/ADMIN_SERVER.md)');

  // --- Speicher (JSON, atomar) ---
  const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return d; throw e; } };
  const writeJson = (f, v) => {
    const tmp = `${f}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(v), { mode: 0o600 });
    fs.renameSync(tmp, f);
  };
  const ACC_FILE = path.join(DATA, 'accounts.json');
  const KEY_FILE = path.join(DATA, 'secret.key');
  if (!fs.existsSync(KEY_FILE)) fs.writeFileSync(KEY_FILE, crypto.randomBytes(32), { mode: 0o600 });
  const KEY = fs.readFileSync(KEY_FILE);
  let accounts = readJson(ACC_FILE, []);
  const saveAccounts = () => writeJson(ACC_FILE, accounts);
  const classes = new Map();
  for (const f of fs.readdirSync(CLASSES)) {
    if (!/^[0-9a-f]{12}\.json$/.test(f)) continue;
    const c = readJson(path.join(CLASSES, f));
    if (c) classes.set(c.id, c);
  }
  const saveClass = (c) => writeJson(path.join(CLASSES, `${c.id}.json`), c);
  // Token-/Code-Prüfsumme -> [Klasse, Spieler-ID]
  const byToken = new Map(), byCode = new Map();
  const index = (c, pid) => { const p = c.players[pid]; byToken.set(p.token, [c.id, pid]); byCode.set(p.code, [c.id, pid]); };
  const unindex = (p) => { byToken.delete(p.token); byCode.delete(p.code); };
  for (const c of classes.values()) for (const pid of Object.keys(c.players)) index(c, pid);
  const saveFile = (pid) => path.join(SAVES, `${pid}.json`);
  const sizeOf = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
  let savesBytes = 0;
  for (const f of fs.readdirSync(SAVES)) { // Reste ohne Spieler (z.B. Sicherung eingespielt) nicht behalten
    const pid = f.replace(/\.json$/, '');
    if ([...classes.values()].some((c) => Object.hasOwn(c.players, pid))) savesBytes += sizeOf(path.join(SAVES, f));
    else fs.rmSync(path.join(SAVES, f), { force: true });
  }
  // verschlüsselt (secret.key): im Protokoll stehen auch Übungspasswörter
  const readSaves = (pid) => { const box = readJson(saveFile(pid)); if (!box) return []; try { return JSON.parse(unseal(box.data).toString('utf8')); } catch { return []; } /* anderer Schlüssel */ };
  function writeSaves(pid, list) {
    savesBytes -= sizeOf(saveFile(pid));
    if (list.length) writeJson(saveFile(pid), { data: seal(JSON.stringify(list)) }); else fs.rmSync(saveFile(pid), { force: true });
    savesBytes += sizeOf(saveFile(pid));
  }
  const live = new Map(); // Spieler-ID -> { seen, level, ready, done, total, run, plan, observe, closed }
  const liveOf = (pid) => { if (!live.has(pid)) live.set(pid, { seen: 0, run: null, observe: 0 }); return live.get(pid); };

  const seal = (text) => {
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
    const body = Buffer.concat([c.update(text), c.final()]);
    return [iv, c.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
  };
  const unseal = (box) => {
    const [iv, tag, body] = box.split('.').map((x) => Buffer.from(x, 'base64url'));
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]);
  };
  const hashPw = async (pw, salt = crypto.randomBytes(16).toString('base64url')) =>
    `${salt}.${(await scrypt(pw, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('base64url')}`;
  const checkPw = async (pw, stored) => same(await hashPw(pw, (stored || 'x.x').split('.')[0]), stored || '');

  /** Audit-Log: wer (Konto), was, worauf. Keine Adressen, keine Inhalte. Eine Datei je Monat. */
  function audit(who, action, target = '') {
    const t = new Date(now()).toISOString();
    fs.appendFileSync(path.join(AUDIT, `${t.slice(0, 7)}.jsonl`), `${JSON.stringify({ t, who, action, target })}\n`, { mode: 0o600 });
  }
  function readAudit(limit = 300) {
    const out = [];
    for (const f of fs.readdirSync(AUDIT).filter((x) => /^\d{4}-\d{2}\.jsonl$/.test(x)).sort().reverse()) {
      const lines = fs.readFileSync(path.join(AUDIT, f), 'utf8').trim().split('\n').reverse();
      for (const l of lines) { if (l) out.push(JSON.parse(l)); if (out.length >= limit) return out; }
    }
    return out;
  }

  // --- Erster Admin / Zurücksetzen ---
  const INVITE = String(env.DC_ADMIN_INVITE || '');
  if (INVITE && INVITE.length < 16) warnings.push('DC_ADMIN_INVITE ist kürzer als 16 Zeichen und wird ignoriert');
  if (env.DC_ADMIN_RESET === '1' && accounts.some((a) => a.role === 'admin')) {
    accounts = accounts.filter((a) => a.role !== 'admin');
    saveAccounts();
    audit('server', 'admin.reset');
    warnings.push('Admin-Zugang zurückgesetzt – DC_ADMIN_RESET wieder entfernen und neu starten');
  }
  if (!accounts.some((a) => a.role === 'admin') && INVITE.length < 16) warnings.push('noch kein Admin: DC_ADMIN_INVITE setzen (mind. 16 Zeichen) und /admin.html öffnen');

  // --- Aufräumen (Löschfristen) ---
  function cleanup() {
    const t = now();
    for (const c of classes.values()) if (Date.parse(c.until) + (KEEP_AFTER_DAYS + 1) * DAY < t) { dropClass(c); audit('server', 'class.expired', c.label); }
    for (const [pid, l] of live) {
      if (t - l.seen > DAY) live.delete(pid);
      else if (l.vb && t - l.vb.at > VB_IDLE_MS) l.vb = null;
    }
    const limit = new Date(t);
    limit.setUTCMonth(limit.getUTCMonth() - AUDIT_MONTHS);
    for (const f of fs.readdirSync(AUDIT)) if (f.slice(0, 7) < limit.toISOString().slice(0, 7)) fs.rmSync(path.join(AUDIT, f));
    for (const [k, b] of buckets) if (t - b.start > 900_000) buckets.delete(k);
    for (const [k, s] of sessions) if (t > s.expires || t - s.seen > IDLE_MS) sessions.delete(k);
    for (const [k, p] of pending) if (t > p.expires) pending.delete(k);
  }
  function dropClass(c) {
    for (const [pid, p] of Object.entries(c.players)) { unindex(p); live.delete(pid); writeSaves(pid, []); }
    classes.delete(c.id);
    fs.rmSync(path.join(CLASSES, `${c.id}.json`), { force: true });
  }
  function dropPlayer(c, pid) {
    unindex(c.players[pid]);
    delete c.players[pid];
    live.delete(pid);
    writeSaves(pid, []);
    saveClass(c);
  }

  // --- Ratenbegrenzung (gesalzener Hash, nur im Arbeitsspeicher) ---
  const SALT = crypto.randomBytes(16);
  const buckets = new Map();
  function address(req) {
    const direct = req.socket.remoteAddress || '';
    if (direct && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(direct)) return shorten(direct);
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
    return shorten(fwd.length ? fwd[fwd.length - 1] : direct); // letzter Eintrag: vom Proxy selbst
  }
  function shorten(a) {
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a);
    if (m) return m[1];
    return net.isIPv6(a) ? a.split(':').slice(0, 4).join(':') : a.slice(0, 64); // IPv6: /64
  }
  const ipKey = (req, kind) => crypto.createHash('sha256').update(SALT).update(address(req)).update(kind).digest('base64url').slice(0, 16);
  function count(key, windowMs = 60_000) {
    const t = now();
    let b = buckets.get(key);
    if (!b || t - b.start > windowMs) {
      if (!b && buckets.size > 50_000) {
        for (const [k, x] of buckets) if (t - x.start > 60_000 && !k.startsWith('pw:')) buckets.delete(k);
        if (buckets.size > 50_000) throw err(429, 'busy');
      }
      b = { start: t, n: 0 };
      buckets.set(key, b);
    }
    return ++b.n;
  }
  const peek = (key, windowMs) => { const b = buckets.get(key); return b && now() - b.start <= windowMs ? b.n : 0; };
  const limit = (req, kind, perMinute) => { if (count(ipKey(req, kind)) > perMinute) throw err(429, 'tooMany'); };

  // --- Nachspielen im Worker ---
  let running = 0;
  const queue = [], slow = []; // slow: Verbund-Prüfungen, Levels gehen vor
  function verify(data) {
    if (!fs.existsSync(KERN)) return Promise.reject(err(503, 'kernMissing'));
    const q = data.kind === 'verbund' ? slow : queue;
    if (q.length >= (q === slow ? 400 : REPLAY_QUEUE)) return Promise.reject(err(503, 'busy'));
    return new Promise((resolve, reject) => { q.push({ data, resolve, reject }); pump(); });
  }
  function pump() {
    if (running >= REPLAY_PARALLEL || !(queue.length || slow.length)) return;
    const job = queue.shift() ?? slow.shift();
    running++;
    let done = false;
    const w = new Worker(path.join(__dirname, 'replay-worker.cjs'), { workerData: job.data, env: {}, resourceLimits: { maxOldGenerationSizeMb: 160 } });
    const finish = (fn) => { if (done) return; done = true; clearTimeout(timer); running--; w.terminate(); fn(); pump(); };
    const timer = setTimeout(() => finish(() => job.reject(err(422, 'replayTimeout'))), REPLAY_MS);
    w.on('message', (m) => finish(() => (m.ok ? job.resolve(m) : job.reject(err(422, 'replayFailed')))));
    w.on('error', () => finish(() => job.reject(err(422, 'replayFailed'))));
    w.on('exit', () => finish(() => job.reject(err(422, 'replayFailed'))));
  }

  // --- Anmeldung Lehrpersonen ---
  const sessions = new Map(); // Token-Prüfsumme -> { id, expires, seen }
  const pending = new Map(); // Einrichtung: Passwort + TOTP noch nicht bestätigt
  const bearer = (req) => { const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization || ''); return m ? m[1] : ''; };
  function account(req, admin = false) {
    const s = sessions.get(sha(bearer(req)));
    const t = now();
    if (!s || t > s.expires || t - s.seen > IDLE_MS) throw err(401, 'login');
    const a = accounts.find((x) => x.id === s.id);
    if (!a || !a.pw) throw err(401, 'login');
    s.seen = t;
    if (admin && a.role !== 'admin') throw err(403, 'forbidden');
    return a;
  }
  function issue(a) {
    const token = crypto.randomBytes(32).toString('base64url');
    sessions.set(sha(token), { id: a.id, expires: now() + TOKEN_MS, seen: now() });
    a.last = today(now());
    saveAccounts();
    return { token, user: a.user, role: a.role };
  }
  const endSessions = (id) => { for (const [k, s] of sessions) if (s.id === id) sessions.delete(k); };
  const newInvite = (a) => {
    const invite = `${code(5)}-${code(5)}-${code(5)}-${code(5)}`;
    Object.assign(a, { invite: sha(normInvite(invite)), inviteUntil: now() + 7 * DAY });
    return invite;
  };
  const normInvite = (v) => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const lockKey = (user) => `pw:${user}`;

  // --- Spieler ---
  function player(req) {
    const hit = byToken.get(sha(bearer(req)));
    const c = hit && classes.get(hit[0]);
    const p = c && c.players[hit[1]];
    if (!p) throw err(401, 'join');
    return { c, p, pid: hit[1] };
  }
  const classOpen = (c) => c.settings.open && Date.parse(c.until) + DAY > now();
  const publicClass = (c) => ({ label: c.label, until: c.until, settings: { timer: c.settings.timer, levels: c.settings.levels, leaderboard: c.settings.leaderboard } });
  const stateFor = (c, p, l) => ({ locked: !!p.locked, paused: !!c.settings.paused, closed: !classOpen(c) || !!l.closed, observe: l.observe > now(), settings: publicClass(c).settings, verbund: vbFor(c, p, l) });
  function leaderboard(c) {
    const out = {};
    for (const p of Object.values(c.players)) for (const [k, r] of Object.entries(p.results)) if (r.best) (out[k] ??= []).push({ name: p.name, ms: r.best });
    for (const k of Object.keys(out)) out[k] = out[k].sort((a, b) => a.ms - b.ms).slice(0, 10);
    return out;
  }
  const kern = () => { try { return require(KERN); } catch { return null; } };
  const levels = () => kern()?.LEVEL_LIST ?? [];
  const vbTasks = () => kern()?.TASK_LIST ?? [];
  // Musterlösungen: nicht im Repo, der Betreiber legt sie ab (docs/VERBUND.md). Ohne Datei zeigt das Admin-Board keine.
  const LOESUNGEN = opts.loesungen || env.DC_LOESUNGEN || path.join(DATA, 'loesungen.json');
  let solCache = null;
  function loesungen() {
    let at;
    try { at = fs.statSync(LOESUNGEN).mtimeMs; } catch { return null; }
    if (solCache?.at !== at) {
      try { solCache = { at, api: kern().createLoesungen(JSON.parse(fs.readFileSync(LOESUNGEN, 'utf8'))) }; } catch (e) { console.error('Musterlösungen nicht lesbar:', e.message); solCache = { at, api: null }; }
    }
    return solCache.api;
  }

  // --- Verbundsaufgaben: Jeder Platz schickt seine Absichten, der Server spielt sie nach, setzt den Verbund zusammen und prüft ---
  // Dauerhaft (Klassendatei): freigegebene Aufgabe, Platznummer, Abnahmen. Protokolle und Netze nur im Arbeitsspeicher.
  const vbBytes = () => { let n = 0; for (const l of live.values()) n += l.vb ? l.vb.bytes : 0; return n; };
  const vbOpen = (c) => (c.verbund && c.verbund.open ? c.verbund.task : null);
  const vbCurrent = (c, l) => (l && l.vb && c.verbund && l.vb.task === c.verbund.task && l.vb.round === c.verbund.round ? l.vb : null);
  function vbFor(c, p, l) {
    if (!c.verbund) return null;
    const v = vbCurrent(c, l);
    const t = vbTasks().find((x) => x.id === c.verbund.task);
    if (!t) return null;
    const r = p.verbund?.[c.verbund.task];
    return { task: t.id, sterne: t.sterne, titel: t.titel, dauer: t.dauer, open: !!c.verbund.open, round: c.verbund.round, seat: p.seat ?? null, running: !!v, have: v ? v.log.length : 0,
      partner: v ? v.partner : null, ...(r && r.round === c.verbund.round ? { result: { done: r.done, total: r.total, passed: r.passed, missing: r.missing, at: r.at } } : {}) };
  }
  function vbSeat(c, p) {
    if (p.seat) return p.seat;
    const used = new Set(Object.values(c.players).map((x) => x.seat));
    let n = 1;
    while (used.has(n)) n++;
    p.seat = n;
    saveClass(c);
    return n;
  }
  const partnerOf = (c, p) => { const n = kern().partnerSeat(p.seat); return Object.entries(c.players).find(([, x]) => x.seat === n) ?? null; };
  const RANK = { offline: 0, connected: 1, online: 2, services: 3 };
  const vbVerify = async (c, pid, v, extra) => {
    try { return await verify({ kind: 'verbund', task: v.task, seat: c.players[pid].seat, ...extra }); } catch (e) { if (e.status === 503) throw e; return { goals: [], level: 'offline', uplink: null, topology: null, plan: null, failed: true }; }
  };
  const vbStale = (v) => !v.site || v.site.n !== v.log.length;
  /** Erster Durchgang: nur Netz und Stufe eines Platzes */
  async function vbSite(c, pid) {
    const v = vbCurrent(c, live.get(pid));
    if (!v || !vbStale(v)) return;
    const n = v.log.length;
    const r = await vbVerify(c, pid, v, { intents: v.log.slice(0, n), only: 'site' });
    v.site = { n, level: r.level, uplink: r.uplink, topology: r.topology };
  }
  /** Ziele eines Platzes prüfen (nur wenn sich sein Protokoll oder der Partner geändert hat) */
  async function vbJudge(c, pid) {
    const p = c.players[pid];
    const v = p && vbCurrent(c, live.get(pid));
    if (!v) return null;
    const other = partnerOf(c, p);
    const o = other && vbCurrent(c, live.get(other[0]));
    const use = o && o.site && RANK[o.site.level] >= RANK[kern().partnerNeeds(v.task)] ? o.site : null;
    const n = v.log.length;
    const key = `${n}|${use ? `${other[0]}:${use.n}` : '-'}`;
    if (v.judged && v.judged.key === key) return v.judged;
    const r = await vbVerify(c, pid, v, { intents: v.log.slice(0, n), partner: use ? { topology: use.topology, uplink: use.uplink } : null });
    if (vbCurrent(c, live.get(pid)) !== v) return null; // inzwischen neu begonnen
    v.site = { n, level: r.level, uplink: r.uplink, topology: r.topology };
    v.judged = { key, n, goals: r.goals, level: r.level, plan: r.plan, failed: !!r.failed, at: now() };
    const all = r.goals.length > 0 && r.goals.every((g) => g.done);
    v.doneAt = all ? v.doneAt ?? now() : null;
    v.partner = use ? use.level : null;
    return v.judged;
  }
  const vbRuns = new Map(); // Klasse -> laufende Prüfung { at, promise, ms, total, done }
  /** Ganze Klasse prüfen: zuerst die Netze, dann die Ziele mit den Partnern, die schon stehen */
  function vbRefresh(c, force = false) {
    const cur = vbRuns.get(c.id);
    if (cur && cur.promise) return force ? cur.promise.then(() => vbRefresh(c, true)) : cur.promise;
    if (cur && !force && now() - cur.at < VB_FRESH_MS) return Promise.resolve();
    const started = Date.now();
    const ids = Object.keys(c.players).filter((pid) => vbCurrent(c, live.get(pid)));
    const run = { at: now(), promise: null, total: ids.length, done: 0, ok: false };
    run.promise = (async () => {
      await Promise.all(ids.map((pid) => vbSite(c, pid)));
      await Promise.all(ids.map((pid) => vbJudge(c, pid).then(() => { run.done++; })));
      run.ok = true;
    })().catch((e) => { if (!e.api) console.error('Verbund-Prüfung', e.message); }).finally(() => { run.promise = null; run.at = now(); run.ms = Date.now() - started; });
    vbRuns.set(c.id, run);
    return run.promise.then(() => run.ok);
  }
  const vbRow = (c, pid) => {
    const p = c.players[pid];
    const v = vbCurrent(c, live.get(pid));
    const j = v && v.judged;
    const r = p.verbund?.[c.verbund.task];
    const other = p.seat ? partnerOf(c, p) : null;
    const goals = j ? j.goals : [];
    return { id: pid, seat: p.seat, name: p.name, online: online(pid), level: !j ? 'offline' : goals.length && goals.every((g) => g.done) ? 'done' : j.level, goals, since: v ? now() - v.start : null, solved: v && v.doneAt ? v.doneAt - v.start : null, steps: v ? v.log.length : 0,
      changed: v ? now() - v.at : null, partner: other ? other[1].seat : null, partnerReal: !!(v && v.partner), failed: !!(j && j.failed), ...(r && r.round === c.verbund.round ? { result: r } : {}) };
  };

  // --- Eingaben prüfen ---
  const str = (v, re, name) => { if (typeof v !== 'string' || !re.test(v)) throw err(400, `invalid:${name}`); return v; };
  const bool = (v, name) => { if (typeof v !== 'boolean') throw err(400, `invalid:${name}`); return v; };
  const int = (v, lo, hi, name) => { if (!Number.isInteger(v) || v < lo || v > hi) throw err(400, `invalid:${name}`); return v; };
  const LEVEL = /^[A-Z][A-Z0-9]{0,7}$/;
  const LABEL = /^[\p{L}\p{N}][\p{L}\p{N} ._/-]{0,29}$/u;

  const routes = [];
  const on = (method, pattern, fn, max = MAX_BODY) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[A-Za-z0-9_-]{1,40})')}$`), fn, max });

  on('GET', '/api/status', () => ({ app: 'leyonet-dc', version: VERSION, classes: true, ready: fs.existsSync(KERN), saveMax: MAX_SAVE }));

  // ---------- Spiel ----------
  on('POST', '/api/join', (req, b) => {
    if (peek(ipKey(req, 'miss'), 60_000) >= 30) throw err(429, 'tooMany');
    limit(req, 'join', 60); // eine Klasse tritt auf einmal bei (eine Schul-Adresse)
    const given = normCode(b.code);
    const c = [...classes.values()].find((x) => same(x.code, given));
    if (!c) { count(ipKey(req, 'miss')); throw err(404, 'codeUnknown'); }
    if (!classOpen(c)) throw err(403, 'classClosed');
    const n = Object.keys(c.players).length;
    if (n >= MAX_PER_CLASS || byToken.size >= MAX_PLAYERS) throw err(507, 'classFull');
    const pid = crypto.randomBytes(8).toString('hex');
    const token = crypto.randomBytes(32).toString('base64url');
    const pcode = code(10);
    c.players[pid] = { name: pseudonym(new Set(Object.values(c.players).map((p) => p.name))), token: sha(token), code: sha(pcode), day: today(now()), locked: false, results: {} };
    index(c, pid);
    saveClass(c);
    liveOf(pid).seen = now();
    return { token, code: `${pcode.slice(0, 5)}-${pcode.slice(5)}`, name: c.players[pid].name, class: publicClass(c) };
  });
  on('POST', '/api/resume', (req, b) => { // anderes Gerät: eigener Code -> neues Token, das alte gilt nicht mehr
    if (peek(ipKey(req, 'miss'), 60_000) >= 30) throw err(429, 'tooMany');
    const hit = byCode.get(sha(normCode(b.code)));
    if (!hit) { count(ipKey(req, 'miss')); throw err(404, 'codeUnknown'); }
    const c = classes.get(hit[0]), p = c.players[hit[1]];
    if (!classOpen(c)) throw err(403, 'classClosed');
    const token = crypto.randomBytes(32).toString('base64url');
    byToken.delete(p.token);
    p.token = sha(token);
    index(c, hit[1]);
    saveClass(c);
    return { token, name: p.name, class: publicClass(c) };
  });
  on('POST', '/api/run', (req, b) => {
    const { c, p, pid } = player(req);
    limit(req, 'run', 240);
    const l = liveOf(pid);
    const level = str(b.level, LEVEL, 'level');
    if (!classOpen(c) || p.locked || c.settings.paused) throw err(403, 'notAllowed');
    if (c.settings.levels && !c.settings.levels.includes(level)) throw err(403, 'levelLocked');
    l.closed = false;
    l.run = { id: crypto.randomBytes(8).toString('hex'), level, ready: bool(b.ready, 'ready'), start: now() };
    Object.assign(l, { seen: now(), level, ready: l.run.ready, done: 0, total: 0, plan: null });
    return { run: l.run.id };
  });
  on('POST', '/api/finish', async (req, b) => {
    const { c, p, pid } = player(req);
    if (count(`fin:${pid}`) > 6) throw err(429, 'tooMany');
    const l = liveOf(pid);
    const run = l.run && l.run.id === b.run ? l.run : null;
    if (!run || run.busy) throw err(409, 'runUnknown');
    if (!classOpen(c) || p.locked) throw err(403, 'notAllowed');
    if (!Array.isArray(b.intents) || b.intents.length > MAX_INTENTS) throw err(400, 'invalid:intents');
    const ms = now() - run.start; // Zeit misst der Server
    if (ms < b.intents.length * MIN_MS_PER_INTENT) throw err(422, 'tooFast'); // von Hand nicht möglich (Skript)
    run.busy = true; // ein Lauf zählt einmal, auch bei gleichzeitigen Anfragen
    let r;
    try { r = await verify({ level: run.level, ready: run.ready, intents: b.intents }); } finally { run.busy = false; }
    if (r.done !== r.total || !r.total) throw err(422, 'notSolved');
    if (!classes.has(c.id) || !c.players[pid]) throw err(401, 'join'); // inzwischen gelöscht
    if (l.run !== run) throw err(409, 'runUnknown'); // inzwischen neu gestartet oder geschlossen
    l.run = null;
    const key = `${run.level}${run.ready ? '+' : ''}`;
    const old = p.results[key];
    // Aus einem Spielstand: zählt als geschafft, aber ohne Bestzeit (in der Pause steht die Uhr still)
    const record = !run.resumed && (!old || !old.best || ms < old.best);
    p.results[key] = { best: record ? ms : old ? old.best : null, count: (old ? old.count : 0) + 1, day: today(now()) };
    p.day = today(now());
    saveClass(c);
    Object.assign(l, { done: r.done, total: r.total });
    return { ok: true, ms, record, best: p.results[key].best, ...(run.resumed ? { resumed: true } : {}), ...(c.settings.leaderboard ? { top: leaderboard(c)[key] } : {}) };
  }, MAX_FINISH);
  on('POST', '/api/beat', (req, b) => {
    const { c, p, pid } = player(req);
    if (count(`beat:${pid}`) > 30) throw err(429, 'tooMany');
    const l = liveOf(pid);
    l.seen = now();
    if (b.total !== undefined) { // nur Anzeige im Admin-Board, zählt nicht als Ergebnis
      l.total = int(b.total, 0, 50, 'total');
      l.done = int(b.done, 0, l.total, 'done');
    }
    if (b.level !== undefined) l.level = str(b.level, LEVEL, 'level');
    if (l.observe > now() && b.plan && typeof b.plan === 'object') { l.plan = b.plan; l.planAt = now(); }
    return stateFor(c, p, l);
  });
  on('GET', '/api/me', (req) => {
    const { c, p, pid } = player(req);
    return { name: p.name, class: publicClass(c), results: p.results, ...stateFor(c, p, liveOf(pid)), ...(c.settings.leaderboard ? { leaderboard: leaderboard(c) } : {}) };
  });
  on('POST', '/api/leave', (req) => { // Recht auf Löschung: Pseudonym + Ergebnisse weg
    const { c, pid } = player(req);
    dropPlayer(c, pid);
    return { ok: true };
  });

  // ---------- Spielstände: Protokoll der Spielschritte, gehört dem Pseudonym ----------
  // Kein freier Name (keine Klarnamen). Läuft beim Speichern ein bestätigter Lauf, merkt sich der Server dessen Dauer selbst.
  const saveMeta = ({ intents, ...m }) => ({ ...m, steps: intents.length });
  const num = (v) => (Number.isFinite(v) ? v : 0);
  on('GET', '/api/saves', (req) => {
    const { pid } = player(req);
    return { saves: readSaves(pid).map(saveMeta), max: MAX_SAVES };
  });
  on('POST', '/api/saves', (req, b) => {
    const { c, p, pid } = player(req);
    if (count(`sav:${pid}`) > 12) throw err(429, 'tooMany');
    if (p.locked) throw err(403, 'notAllowed');
    const x = b.save;
    if (!x || typeof x !== 'object') throw err(400, 'invalid:save');
    const level = str(x.level, LEVEL, 'level');
    const known = levels();
    if (known.length && !known.some((l) => l.id === level)) throw err(400, 'invalid:level');
    if (!Array.isArray(x.intents) || x.intents.some((i) => !i || typeof i !== 'object' || typeof i.action !== 'string' || i.action.length > 40)) throw err(400, 'invalid:intents');
    const l = live.get(pid);
    const run = l && l.run && l.run.id === b.run && l.run.level === level && l.run.ready === x.ready ? l.run : null;
    const mark = x.mark && typeof x.mark === 'object' ? x.mark : {};
    const save = { id: crypto.randomBytes(8).toString('hex'), format: 'leyonet-dc-save', v: 1, game: str(x.game, /^[0-9.]{1,16}$/, 'game'), level, ready: bool(x.ready, 'ready'),
      saved: new Date(now()).toISOString(), ms: Math.max(0, Math.round(num(x.ms))), player: Array.isArray(x.player) && x.player.length === 4 ? x.player.map(num) : null,
      mark: { devices: num(mark.devices), links: num(mark.links), budget: num(mark.budget) }, elapsed: run ? now() - run.start : null, intents: x.intents };
    const size = Buffer.byteLength(JSON.stringify(save));
    if (size > MAX_SAVE) throw err(413, 'tooLarge');
    const list = readSaves(pid);
    if (list.length >= MAX_SAVES) throw err(507, 'savesFull');
    if (savesBytes + size > MAX_SAVES_TOTAL) throw err(507, 'storageFull');
    list.unshift(save);
    writeSaves(pid, list);
    return { ok: true, size, saves: list.map(saveMeta), max: MAX_SAVES };
  }, MAX_SAVE + 4096);
  on('POST', '/api/saves/:id/open', (req, b, m) => {
    const { c, p, pid } = player(req);
    if (count(`sav:${pid}`) > 12) throw err(429, 'tooMany');
    const save = readSaves(pid).find((x) => x.id === m.id);
    if (!save) throw err(404, 'saveUnknown');
    if (p.locked || c.settings.paused) throw err(403, 'notAllowed');
    if (c.settings.levels && !c.settings.levels.includes(save.level)) throw err(403, 'levelLocked');
    const l = liveOf(pid);
    l.run = null; // ein offener Lauf gehört zum verlassenen Level
    if (classOpen(c) && save.elapsed !== null) l.run = { id: crypto.randomBytes(8).toString('hex'), level: save.level, ready: save.ready, start: now() - save.elapsed, resumed: true };
    Object.assign(l, { seen: now(), closed: false, level: save.level, ready: save.ready, done: 0, total: 0, plan: null });
    return { save, run: l.run ? l.run.id : null };
  });
  on('POST', '/api/saves/:id/delete', (req, b, m) => {
    const { pid } = player(req);
    if (count(`sav:${pid}`) > 12) throw err(429, 'tooMany');
    const list = readSaves(pid);
    const rest = list.filter((x) => x.id !== m.id);
    if (rest.length === list.length) throw err(404, 'saveUnknown');
    writeSaves(pid, rest);
    return { saves: rest.map(saveMeta), max: MAX_SAVES };
  });

  // ---------- Verbundsaufgabe: Arbeitsplatz ----------
  /** Beginnen oder weiterbauen. Antwort enthält das bisherige Protokoll (neu geladene Seite, anderes Gerät). */
  on('POST', '/api/verbund/start', (req, b) => {
    const { c, p, pid } = player(req);
    if (count(`vbs:${pid}`) > 20) throw err(429, 'tooMany');
    const task = vbOpen(c);
    if (!classOpen(c) || p.locked || c.settings.paused || !task) throw err(403, 'notAllowed');
    const l = liveOf(pid);
    let v = vbCurrent(c, l);
    if (!v || bool(b.fresh ?? false, 'fresh')) {
      if (vbBytes() > MAX_VB_TOTAL) throw err(503, 'busy');
      v = { run: crypto.randomBytes(8).toString('hex'), task, round: c.verbund.round, start: now(), at: now(), log: [], bytes: 0, judged: null, partner: null, doneAt: null };
      l.vb = v;
    }
    l.seen = now();
    l.level = task;
    return { run: v.run, task, seat: vbSeat(c, p), intents: v.log, partner: v.partner };
  });
  on('POST', '/api/verbund/sync', (req, b) => {
    const { c, p, pid } = player(req);
    if (count(`vby:${pid}`) > 60) throw err(429, 'tooMany');
    const v = vbCurrent(c, live.get(pid));
    if (!v || v.run !== b.run) throw err(409, 'runUnknown');
    if (p.locked || !vbOpen(c)) throw err(403, 'notAllowed');
    if (!Array.isArray(b.intents) || b.intents.length > 400) throw err(400, 'invalid:intents');
    const from = int(b.from, 0, MAX_INTENTS, 'from');
    if (from !== v.log.length) return { have: v.log.length, resync: true };
    const size = JSON.stringify(b.intents).length;
    if (v.log.length + b.intents.length > MAX_INTENTS || v.bytes + size > MAX_VB_BYTES) throw err(413, 'tooMuch');
    if (b.intents.some((i) => !i || typeof i !== 'object' || typeof i.action !== 'string' || i.action.length > 40)) throw err(400, 'invalid:intents');
    v.log.push(...b.intents);
    v.bytes += size;
    v.at = now();
    return { have: v.log.length };
  }, MAX_FINISH);
  /** Selbsttest: derselbe Test wie auf dem Dashboard */
  on('POST', '/api/verbund/check', async (req) => {
    const { c, p, pid } = player(req);
    if (count(`vbc:${pid}`) > 6) throw err(429, 'tooMany');
    const v = vbCurrent(c, live.get(pid));
    if (!v) throw err(409, 'runUnknown');
    const j = await vbJudge(c, pid);
    if (!j) throw err(409, 'runUnknown');
    return { goals: j.goals, level: j.level, steps: j.n, partner: v.partner, seat: p.seat };
  });

  // ---------- Admin-Board: Anmeldung ----------
  on('POST', '/api/admin/activate', async (req, b) => {
    limit(req, 'login', 10);
    const inv = normInvite(b.invite);
    const pw = str(b.password, /^.{12,200}$/s, 'password');
    let target = null;
    const a = inv.length >= 16 ? accounts.find((x) => x.invite && same(x.invite, sha(inv)) && x.inviteUntil > now()) : null;
    if (a) target = { id: a.id };
    else if (INVITE.length >= 16 && !accounts.some((x) => x.role === 'admin') && same(sha(String(b.invite || '').trim()), sha(INVITE))) target = { first: true };
    if (!target) throw err(403, 'inviteUnknown');
    const secret = crypto.randomBytes(20);
    const id = crypto.randomBytes(18).toString('base64url');
    pending.set(id, { ...target, pw: await hashPw(pw), secret, expires: now() + 10 * 60_000, fails: 0 });
    const text = base32(secret);
    const user = a ? a.user : 'admin';
    return { pending: id, user, secret: text, uri: `otpauth://totp/leyoNET%20DC:${encodeURIComponent(user)}?secret=${text}&issuer=leyoNET%20DC` };
  });
  on('POST', '/api/admin/confirm', (req, b) => {
    limit(req, 'login', 20);
    const p = pending.get(String(b.pending || ''));
    if (!p || p.expires < now()) throw err(403, 'setupExpired');
    const step = totpStep(p.secret, b.code, 0, now());
    if (step === null) { if (++p.fails >= 5) pending.delete(b.pending); throw err(403, 'codeWrong'); }
    pending.delete(b.pending);
    let a;
    if (p.first) {
      if (accounts.some((x) => x.role === 'admin')) throw err(409, 'exists');
      a = { id: crypto.randomBytes(6).toString('hex'), user: 'admin', role: 'admin', created: today(now()) };
      accounts.push(a);
    } else a = accounts.find((x) => x.id === p.id && x.invite);
    if (!a) throw err(403, 'setupExpired');
    const recovery = Array.from({ length: 8 }, () => `${code(5)}-${code(5)}`);
    Object.assign(a, { pw: p.pw, mfa: { secret: seal(p.secret), step, recovery: recovery.map((r) => sha(normInvite(r))) } });
    delete a.invite;
    delete a.inviteUntil;
    endSessions(a.id);
    audit(a.user, 'account.activated');
    return { ...issue(a), recovery };
  });
  on('POST', '/api/admin/login', async (req, b) => {
    limit(req, 'login', 10);
    const user = String(b.user || '').trim().toLowerCase().slice(0, 40);
    const a = accounts.find((x) => x.user === user && x.pw);
    // je Konto UND Adresse: wer rät, sperrt nur sich selbst aus; dazu eine weite Grenze je Konto
    const own = ipKey(req, lockKey(user));
    if (peek(own, 900_000) >= 5 || peek(lockKey(user), 900_000) >= 60) throw err(429, 'locked');
    const ok = await checkPw(String(b.password || '').slice(0, 200), a ? a.pw : undefined);
    let pass = false;
    if (ok && a) {
      const step = totpStep(unseal(a.mfa.secret), b.code, a.mfa.step, now());
      if (step !== null) { a.mfa.step = step; pass = true; }
      else {
        const i = a.mfa.recovery.findIndex((h) => same(h, sha(normInvite(b.code))));
        if (i >= 0) { a.mfa.recovery.splice(i, 1); pass = true; audit(a.user, 'login.recovery'); }
      }
    }
    if (!pass) { count(own, 900_000); count(lockKey(user), 900_000); throw err(403, 'loginWrong'); } // gleiche Antwort für alle Fälle
    buckets.delete(own);
    audit(a.user, 'login');
    return issue(a);
  });
  on('POST', '/api/admin/logout', (req) => { sessions.delete(sha(bearer(req))); return { ok: true }; });
  on('GET', '/api/admin/me', (req) => { const a = account(req); return { user: a.user, role: a.role, recovery: a.mfa.recovery.length, levels: levels(), verbund: vbTasks() }; });

  // ---------- Admin-Board: Klassen ----------
  const own = (a, id) => { const c = classes.get(id); if (!c || (a.role !== 'admin' && c.owner !== a.id)) throw err(404, 'classUnknown'); return c; };
  const online = (pid) => { const l = live.get(pid); return !!l && now() - l.seen < ONLINE_MS; };
  const ownerName = (id) => accounts.find((x) => x.id === id)?.user ?? '–';
  const classRow = (c) => ({ id: c.id, code: c.code, label: c.label, until: c.until, owner: ownerName(c.owner), settings: c.settings,
    players: Object.keys(c.players).length, online: Object.keys(c.players).filter(online).length, open: classOpen(c),
    deleted: today(Date.parse(c.until) + (KEEP_AFTER_DAYS + 1) * DAY) });
  on('GET', '/api/admin/classes', (req) => { const a = account(req); return { classes: [...classes.values()].filter((c) => a.role === 'admin' || c.owner === a.id).map(classRow).sort((x, y) => x.label.localeCompare(y.label, 'de')) }; });
  on('POST', '/api/admin/classes', (req, b) => {
    const a = account(req);
    const label = str(b.label, LABEL, 'label');
    if (!isDate(b.until) || Date.parse(b.until) < now() - DAY || Date.parse(b.until) > now() + 400 * DAY) throw err(400, 'invalid:until');
    if ([...classes.values()].filter((c) => c.owner === a.id).length >= MAX_CLASSES_PER_ACCOUNT) throw err(507, 'tooManyClasses');
    let cc;
    do cc = code(6); while ([...classes.values()].some((c) => c.code === cc));
    const c = { id: crypto.randomBytes(6).toString('hex'), code: cc, label, owner: a.id, created: today(now()), until: b.until,
      settings: { open: true, paused: false, leaderboard: false, timer: 'frei', levels: null }, players: {} };
    classes.set(c.id, c);
    saveClass(c);
    audit(a.user, 'class.create', label);
    return classRow(c);
  });
  on('GET', '/api/admin/classes/:id', (req, b, m) => {
    const a = account(req);
    const c = own(a, m.id);
    return { ...classRow(c), table: Object.entries(c.players).map(([pid, p]) => {
      const l = live.get(pid);
      return { id: pid, name: p.name, locked: !!p.locked, online: online(pid), day: p.day, results: p.results,
        level: l?.level ?? null, ready: !!l?.ready, done: l?.done ?? 0, total: l?.total ?? 0, since: l?.run ? now() - l.run.start : null };
    }).sort((x, y) => x.name.localeCompare(y.name, 'de')) };
  });
  on('POST', '/api/admin/classes/:id/settings', (req, b, m) => {
    const a = account(req);
    const c = own(a, m.id);
    const s = { ...c.settings };
    for (const k of ['open', 'paused', 'leaderboard']) if (b[k] !== undefined) s[k] = bool(b[k], k);
    if (b.timer !== undefined) s.timer = str(b.timer, /^(frei|ein|aus)$/, 'timer');
    if (b.levels !== undefined) {
      if (b.levels !== null && (!Array.isArray(b.levels) || b.levels.length > 40)) throw err(400, 'invalid:levels');
      s.levels = b.levels === null ? null : b.levels.map((x) => str(x, LEVEL, 'levels'));
    }
    if (b.until !== undefined) {
      if (!isDate(b.until) || Date.parse(b.until) > now() + 400 * DAY) throw err(400, 'invalid:until');
      c.until = b.until;
    }
    c.settings = s;
    saveClass(c);
    audit(a.user, 'class.settings', c.label);
    return classRow(c);
  });
  /** Unterrichts-Presets: Klassenstart / Zwischenstopp / Schluss */
  on('POST', '/api/admin/classes/:id/preset', (req, b, m) => {
    const a = account(req);
    const c = own(a, m.id);
    const preset = str(b.preset, /^(start|stopp|schluss)$/, 'preset');
    Object.assign(c.settings, { start: { open: true, paused: false }, stopp: { open: true, paused: true }, schluss: { open: false, paused: false } }[preset]);
    if (preset === 'start') for (const pid of Object.keys(c.players)) if (live.has(pid)) live.get(pid).closed = false;
    if (preset === 'schluss') for (const pid of Object.keys(c.players)) if (live.has(pid)) live.get(pid).run = null;
    saveClass(c);
    audit(a.user, `class.${preset}`, c.label);
    return classRow(c);
  });
  on('POST', '/api/admin/classes/:id/delete', (req, b, m) => {
    const a = account(req);
    const c = own(a, m.id);
    dropClass(c);
    audit(a.user, 'class.delete', c.label);
    return { ok: true };
  });
  on('POST', '/api/admin/classes/:id/players/:pid', (req, b, m) => {
    const a = account(req);
    const c = own(a, m.id);
    const p = Object.hasOwn(c.players, m.pid) ? c.players[m.pid] : null; // nie __proto__ o.ä.
    if (!p) throw err(404, 'playerUnknown');
    const action = str(b.action, /^(lock|unlock|close|delete|code|observe)$/, 'action');
    const l = liveOf(m.pid);
    if (action === 'observe') { // Live-Beobachtung: solange das Fenster offen ist; die Lernenden sehen einen Hinweis
      if (l.observe <= now()) { audit(a.user, 'player.observe', `${c.label}/${p.name}`); l.plan = null; }
      l.observe = now() + OBSERVE_MS;
      return { online: online(m.pid), level: l.level ?? null, done: l.done ?? 0, total: l.total ?? 0, plan: l.plan ?? null, age: l.plan ? now() - l.planAt : null };
    }
    let out = { ok: true };
    if (action === 'lock' || action === 'unlock') { p.locked = action === 'lock'; if (p.locked) l.run = null; }
    if (action === 'close') { l.closed = true; l.run = null; }
    if (action === 'code') { // Code verloren: neuer Code (der alte und das alte Gerät gelten nicht mehr)
      const pcode = code(10);
      unindex(p);
      Object.assign(p, { code: sha(pcode), token: sha(crypto.randomBytes(32)) });
      index(c, m.pid);
      out = { code: `${pcode.slice(0, 5)}-${pcode.slice(5)}` };
    }
    if (action === 'delete') dropPlayer(c, m.pid); else saveClass(c);
    audit(a.user, `player.${action}`, `${c.label}/${p.name}`);
    return out;
  });
  // ---------- Admin-Board: Verbund ----------
  const vbExam = new Map(); // Klasse -> Abnahme läuft
  const vbView = (c) => {
    const run = vbRuns.get(c.id);
    const rows = c.verbund ? Object.keys(c.players).filter((pid) => c.players[pid].seat).map((pid) => vbRow(c, pid)).sort((x, y) => x.seat - y.seat) : [];
    return { label: c.label, code: c.code, verbund: c.verbund ?? null, players: Object.keys(c.players).length, rows, checking: !!(run && run.promise), progress: run && run.promise ? [run.done, run.total] : null, abnahmeLaeuft: vbExam.has(c.id), abnahmeFehler: vbExam.get(`${c.id}!`) ?? null, ms: run?.ms ?? null, age: run ? now() - run.at : null, now: now() };
  };
  on('POST', '/api/admin/classes/:id/verbund', (req, b, m) => {
    const a = account(req);
    const c = own(a, m.id);
    const action = str(b.action, /^(open|close|reopen|end)$/, 'action');
    if (action === 'open') {
      const task = str(b.task, /^V[1-9]$/, 'task');
      if (!vbTasks().some((t) => t.id === task)) throw err(404, 'taskUnknown');
      c.verbund = { task, open: true, round: (c.verbund?.round ?? 0) + 1, since: now() };
      vbRuns.delete(c.id);
    } else if (!c.verbund) throw err(409, 'noTask');
    else if (action === 'end') { for (const pid of Object.keys(c.players)) if (live.has(pid)) live.get(pid).vb = null; c.verbund = null; vbRuns.delete(c.id); }
    else c.verbund.open = action === 'reopen';
    saveClass(c);
    audit(a.user, `verbund.${action}`, `${c.label}${c.verbund ? ` ${c.verbund.task}` : ''}`);
    return vbView(c);
  });
  on('GET', '/api/admin/classes/:id/verbund', (req, b, m) => {
    const c = own(account(req), m.id);
    if (c.verbund) vbRefresh(c); // im Hintergrund, die Antwort wartet nicht
    return vbView(c);
  });
  /** Abnahme: alles frisch prüfen und je Platz festhalten (Ziele erfüllt / gesamt, was fehlt) */
  on('POST', '/api/admin/classes/:id/verbund/abnahme', (req, b, m) => {
    const a = account(req);
    const c = own(a, m.id);
    if (!c.verbund) throw err(409, 'noTask');
    if (vbExam.has(c.id)) return vbView(c);
    if (count(`vba:${c.id}`) > 6) throw err(429, 'tooMany');
    vbExam.set(c.id, true);
    vbExam.delete(`${c.id}!`);
    const round = c.verbund.round;
    audit(a.user, 'verbund.abnahme', `${c.label} ${c.verbund.task}`);
    vbRefresh(c, true).then((ok) => { // läuft im Hintergrund, das Dashboard fragt nach
      if (!classes.has(c.id) || !c.verbund || c.verbund.round !== round) return;
      if (!ok) { vbExam.set(`${c.id}!`, 'busy'); return; }
      const t = vbTasks().find((x) => x.id === c.verbund.task);
      for (const [pid, p] of Object.entries(c.players)) {
        const v = vbCurrent(c, live.get(pid));
        if (!v || !v.judged || v.judged.failed) continue;
        const done = v.judged.goals.filter((g) => g.done).length;
        p.verbund = { ...(p.verbund ?? {}), [t.id]: { round, done, total: t.goals.length, passed: done === t.goals.length, sterne: t.sterne, missing: v.judged.goals.filter((g) => !g.done).map((g) => g.id), at: now(), ms: (v.doneAt ?? now()) - v.start } };
      }
      c.verbund.abnahme = now();
      saveClass(c);
    }).catch((e) => { console.error('Abnahme', e.message); vbExam.set(`${c.id}!`, 'busy'); }).finally(() => vbExam.delete(c.id));
    return vbView(c);
  });
  /** Netzplan eines Standorts (vom Server nachgespielt, nicht vom Spiel gemeldet) + Auftragsblatt + Musterlösung */
  on('GET', '/api/admin/classes/:id/verbund/:pid', (req, b, m) => {
    const c = own(account(req), m.id);
    const p = Object.hasOwn(c.players, m.pid) ? c.players[m.pid] : null;
    if (!p || !p.seat || !c.verbund) throw err(404, 'playerUnknown');
    const v = vbCurrent(c, live.get(m.pid));
    return { row: vbRow(c, m.pid), plan: v?.judged?.plan ?? null, blatt: kern().auftragsblatt(c.verbund.task, p.seat), loesung: loesungen()?.loesung(c.verbund.task, p.seat) ?? null };
  });
  on('GET', '/api/admin/classes/:id/csv', (req, b, m) => {
    const a = account(req);
    const c = own(a, m.id);
    const lv = levels().filter((l) => l.goals);
    const cols = lv.flatMap((l) => (l.plan ? [l.id, `${l.id}+`] : [l.id]));
    const cell = (v) => { const s = String(v ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = [['Pseudonym', 'zuletzt', ...cols.flatMap((k) => [`${k} Bestzeit s`, `${k} Anzahl`]), ...vbTasks().map((t) => `${t.id} Abnahme`)],
      ...Object.values(c.players).sort((x, y) => x.name.localeCompare(y.name, 'de')).map((p) => [p.name, p.day,
        ...cols.flatMap((k) => (p.results[k] ? [p.results[k].best ? (p.results[k].best / 1000).toFixed(1) : '', p.results[k].count] : ['', ''])), ...vbTasks().map((t) => { const r = p.verbund?.[t.id]; return r ? `${r.done}/${r.total}` : ''; })])];
    audit(a.user, 'class.csv', c.label);
    return { raw: `﻿${rows.map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`, type: 'text/csv; charset=utf-8' };
  });

  // ---------- Admin-Board: Konten (nur Admin), Audit ----------
  on('GET', '/api/admin/accounts', (req) => { account(req, true); return { accounts: accounts.map((x) => ({ id: x.id, user: x.user, role: x.role, created: x.created, last: x.last ?? null, active: !!x.pw,
    inviteUntil: x.invite ? today(x.inviteUntil) : null, classes: [...classes.values()].filter((c) => c.owner === x.id).length })) }; });
  on('POST', '/api/admin/accounts', (req, b) => {
    const a = account(req, true);
    const user = str(b.user, /^[a-z0-9][a-z0-9._-]{1,19}$/, 'user');
    if (accounts.some((x) => x.user === user)) throw err(409, 'exists');
    if (accounts.length >= 300) throw err(507, 'tooMany');
    const x = { id: crypto.randomBytes(6).toString('hex'), user, role: 'lehrperson', created: today(now()) };
    const invite = newInvite(x);
    accounts.push(x);
    saveAccounts();
    audit(a.user, 'account.create', user);
    return { user, invite };
  });
  on('POST', '/api/admin/accounts/:id/:what', (req, b, m) => {
    const a = account(req, true);
    const x = accounts.find((y) => y.id === m.id);
    if (!x || x.role === 'admin' || !['reset', 'delete'].includes(m.what)) throw err(404, 'accountUnknown');
    endSessions(x.id);
    audit(a.user, `account.${m.what}`, x.user);
    if (m.what === 'delete') {
      for (const c of [...classes.values()]) if (c.owner === x.id) { c.owner = a.id; saveClass(c); } // Klassen gehen an den Admin
      accounts = accounts.filter((y) => y !== x);
      saveAccounts();
      return { ok: true };
    }
    delete x.pw;
    delete x.mfa;
    const invite = newInvite(x);
    saveAccounts();
    return { user: x.user, invite };
  });
  on('GET', '/api/admin/audit', (req) => {
    const a = account(req);
    const all = readAudit(a.role === 'admin' ? 300 : 3000);
    return { audit: a.role === 'admin' ? all : all.filter((r) => r.who === a.user).slice(0, 300) };
  });

  // --- HTTP ---
  const HEAD = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store',
    'Cross-Origin-Resource-Policy': 'same-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Strict-Transport-Security': 'max-age=15552000',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" };
  const send = (res, status, type, body, extra = {}) => { res.writeHead(status, { ...HEAD, 'Content-Type': type, ...extra }); res.end(body); };
  const json = (res, status, v) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(v));
  function body(req, max) {
    return new Promise((resolve, reject) => {
      if (Number(req.headers['content-length'] || 0) > max) return reject(err(413, 'tooLarge'));
      let size = 0;
      const chunks = [];
      req.on('data', (d) => { size += d.length; if (size > max) { reject(err(413, 'tooLarge')); req.destroy(); } else chunks.push(d); });
      req.on('error', reject);
      req.on('end', () => {
        if (!size) return resolve({});
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
          resolve(v);
        } catch { reject(err(400, 'invalidJson')); }
      });
    });
  }
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8' };
  function serveStatic(req, res, p) { // nur lokal (STATIC_DIR); auf Plesk liefert der Webserver die Dateien aus
    const f = path.join(STATIC, path.normalize(decodeURIComponent(p === '/' ? '/index.html' : p === '/admin' ? '/admin.html' : p)));
    if (!f.startsWith(path.resolve(STATIC) + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return json(res, 404, { error: 'notFound' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(f).pipe(res);
  }
  async function handle(req, res) {
    const p = new URL(req.url, 'http://x').pathname;
    try {
      if (!p.startsWith('/api/')) {
        if (p === '/admin' && !STATIC) return send(res, 302, 'text/plain', '', { Location: '/admin.html' });
        if (STATIC && req.method === 'GET') return serveStatic(req, res, p);
        throw err(404, 'notFound');
      }
      limit(req, 'all', 1800); // eine Schulklasse teilt sich oft eine Adresse
      for (const r of routes) {
        const m = r.method === req.method && r.re.exec(p);
        if (!m) continue;
        const b = req.method === 'POST' ? await body(req, r.max) : {};
        const out = await r.fn(req, b, m.groups || {});
        return out && out.raw !== undefined ? send(res, 200, out.type, out.raw) : json(res, 200, out);
      }
      throw err(404, 'notFound');
    } catch (e) {
      if (!e.api) console.error('Fehler', req.method, p.replace(/[0-9a-f]{12,}/g, '…'), e.message); // ohne Inhalte, ohne Adresse
      if (!res.headersSent) json(res, e.api ? e.status : 500, { error: e.api ? e.message : 'internal' });
    }
  }
  const server = http.createServer(handle);
  server.headersTimeout = 10_000;
  server.requestTimeout = 20_000;
  const job = setInterval(cleanup, 3_600_000);
  job.unref();
  cleanup();
  return { server, warnings, cleanup, DATA, _test: { hotp, base32, accounts: () => accounts, classes, live } };
}

module.exports = { createApp, hotp, base32, totpStep };
