#!/usr/bin/env node
// Herkunfts-Bot (Plan v4 H): prueft, woher jeder Bestandteil kommt und ob seine Lizenz freigegeben ist, und erzeugt
// daraus die Quellenangaben (docs/HERKUNFT.md, game/src/herkunft.json -> Menue «Quellen»).
//
//   node scripts/herkunft-bot.mjs            pruefen + Quellenangaben neu schreiben
//   node scripts/herkunft-bot.mjs --check    nur pruefen; Fehler auch, wenn die Quellenangaben veraltet sind (CI)
//   node scripts/herkunft-bot.mjs --online   zusaetzlich: npm-Register, ambientCG, Links im Netz abgleichen
//
// FEHLER (Exit 1): unbekannte Herkunft oder nicht freigegebene Lizenz bei etwas, das ausgeliefert wird.
// OFFEN (Exit 0):  ungeklaert, aber nicht ausgeliefert (Register-Feld «offen») - steht im Bericht.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const ONLINE = process.argv.includes('--online');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const reg = JSON.parse(read('docs/herkunft.json'));
const errors = [];
const open = [];
const bad = (t) => errors.push(t);

// ---- 1. npm-Pakete (Lockfile: exakte Version, Lizenz; Laufzeit = wird ausgeliefert) ----
const lock = JSON.parse(read('game/package-lock.json'));
const pkgs = Object.entries(lock.packages).filter(([p]) => p.startsWith('node_modules/')).map(([p, v]) => {
  const name = p.slice(p.lastIndexOf('node_modules/') + 13);
  return { name, version: v.version, lizenz: v.license ?? 'unbekannt', werkzeug: !!(v.dev || v.devOptional), quelle: `https://www.npmjs.com/package/${name}` };
});
for (const p of pkgs) {
  const okList = p.werkzeug ? [...reg.erlaubt, ...reg.erlaubt_werkzeuge] : reg.erlaubt;
  if (!okList.includes(p.lizenz)) bad(`npm ${p.name}@${p.version}: Lizenz «${p.lizenz}» nicht freigegeben`);
}
const runtime = pkgs.filter((p) => !p.werkzeug);
for (const s of reg.software) {
  if (!reg.erlaubt.includes(s.lizenz)) bad(`${s.name}: Lizenz «${s.lizenz}» nicht freigegeben`);
  for (const f of s.dateien ?? []) {
    // node_modules fehlt z.B. vor npm ci -> Nachweis dann nicht moeglich, kein Fehler
    if (existsSync(join(ROOT, 'game/node_modules')) && !existsSync(join(ROOT, f))) bad(`${s.name}: Nachweis ${f} fehlt`);
  }
}

// ---- 2. Submodul leyoNET: Adresse, Lizenz, nur freigegebene Teile eingebunden ----
const sm = reg.submodule;
if (!read('.gitmodules').includes(`url = ${sm.url}`)) bad(`Submodul ${sm.pfad}: Adresse weicht vom Register ab`);
if (existsSync(join(ROOT, sm.pfad, 'LICENSE'))) {
  if (!read(`${sm.pfad}/LICENSE`).includes(sm.lizenzdatei_enthaelt)) bad(`Submodul ${sm.pfad}: LICENSE ist nicht mehr ${sm.lizenz}`);
} else bad(`Submodul ${sm.pfad}: LICENSE fehlt (git submodule update --init?)`);

// ---- 3. Quelltext des Spiels: Importe aus dem Submodul und Adressen im Netz ----
const SRC = [...readdirSync(join(ROOT, 'game/src')).filter((f) => /\.(js|ts|css|json)$/.test(f)).map((f) => `game/src/${f}`), 'game/index.html', 'game/admin.html', 'game/public/favicon.svg'];
for (const f of SRC) {
  const t = read(f);
  for (const m of t.matchAll(/(?:from|import\()\s*['"][^'"]*vendor\/leyonet\/([^'"?]+)/g)) {
    if (!sm.benutzt.some((b) => m[1].startsWith(b))) bad(`${f}: Import aus vendor/leyonet/${m[1]} ist nicht im Register (submodule.benutzt)`);
  }
  if (f === 'game/src/herkunft.json') continue; // enthaelt die Quellen selbst
  for (const m of t.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
    if (m[1].includes('.') && !reg.links[m[1].toLowerCase()]) bad(`${f}: Adresse ${m[1]} ist nicht im Register (links)`);
  }
}

// ---- 4. Texturen: alle Sets aus blender/lib/textures.py und alle Bilder in den ausgelieferten GLBs ----
const texPy = read('blender/lib/textures.py');
const used = new Set([...texPy.matchAll(/(?:asset="|wear=\(")([A-Z][A-Za-z]+\d{3}[A-Z]?)"/g)].map((m) => m[1]));
const sets = reg.texturen.sets;
if (!reg.erlaubt.includes(reg.texturen.lizenz)) bad(`Texturen: Lizenz «${reg.texturen.lizenz}» nicht freigegeben`);
for (const id of used) if (!sets[id]) bad(`Textur ${id} (textures.py) fehlt im Register (texturen.sets)`);
const matNames = new Set([...texPy.matchAll(/^\s+"([a-z0-9_]+)":\s+dict\(/gm)].map((m) => m[1]));
const kit = JSON.parse(read('assets/out/kit.kit.json'));
const kitTypes = new Set((kit.templates ?? []).flatMap((t) => [t.type, ...(t.parts ?? []).map((p) => p.type)]));
function glbImages(file) {
  const b = readFileSync(join(ROOT, file));
  const len = b.readUInt32LE(12);
  return (JSON.parse(b.subarray(20, 20 + len).toString('utf8')).images ?? []).map((i) => i.name ?? '(ohne Namen)');
}
const isOwn = (n) => {
  if (n.startsWith('LM_')) return true; // eigene Lightmaps (bake.py)
  const m = /^(.*)_(normal|color|orm|Color|Normal)$/.exec(n);
  return !!m && (kitTypes.has(m[1]) || matNames.has(m[1])
    || [...kitTypes].some((t) => t.startsWith(m[1])) || /^blank_\du$/.test(m[1])); // Frontplatten-Atlanten (retrofit)
};
for (const file of ['assets/out/room_v3.glb', 'assets/out/kit.glb']) {
  for (const n of glbImages(file)) {
    const id = /^([A-Z][A-Za-z]+\d{3}[A-Z]?)_/.exec(n)?.[1];
    if (id ? !sets[id] : !isOwn(n)) bad(`${file}: Bild «${n}» hat keine bekannte Herkunft`);
  }
}

// ---- 5. Dateien im Repo: jede Datei unter assets/, game/public/, docs/refs/ braucht einen Eintrag ----
const tracked = execFileSync('git', ['ls-files', 'assets', 'game/public', 'docs/refs'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const hits = reg.dateien.map((d) => ({ ...d, re: new RegExp(d.muster), n: 0 }));
for (const f of tracked) {
  const d = hits.find((x) => x.re.test(f));
  if (!d) bad(`${f}: keine Herkunft im Register (dateien)`);
  else d.n++;
}
for (const d of hits) {
  if (!d.n) { bad(`Register-Eintrag «${d.titel}» passt auf keine Datei mehr`); continue; }
  if (d.offen) (d.ausgeliefert ? errors : open).push(`${d.titel} (${d.n} ${d.n === 1 ? 'Datei' : 'Dateien'}): ${d.offen}`);
}

// ---- 6. online: stimmen Register-Angaben mit den Quellen ueberein? ----
async function online() {
  const UA = { 'User-Agent': 'herkunft-bot/1.0' };
  const get = (u, o = {}) => fetch(u, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(20000), ...o });
  const note = (t) => open.push(`online: ${t}`);
  for (const p of runtime) {
    try {
      const j = await (await get(`https://registry.npmjs.org/${p.name}/${p.version}`)).json();
      const lic = typeof j.license === 'string' ? j.license : j.license?.type;
      if (lic !== p.lizenz) bad(`npm ${p.name}@${p.version}: Register von npm nennt «${lic}», Lockfile «${p.lizenz}»`);
    } catch (e) { note(`npm ${p.name} nicht abfragbar (${e.message})`); }
  }
  for (const id of Object.keys(sets)) {
    try {
      const j = await (await get(`https://ambientcg.com/api/v2/full_json?id=${id}`)).json();
      if (!(j.foundAssets ?? []).some((a) => a.assetId === id)) bad(`Textur ${id}: bei ambientCG nicht gefunden`);
    } catch (e) { note(`ambientCG ${id} nicht abfragbar (${e.message})`); }
  }
  const urls = new Set([reg.texturen.lizenz_url, ...reg.software.map((s) => s.quelle)]);
  for (const f of SRC) if (f !== 'game/src/herkunft.json') for (const m of read(f).matchAll(/https:\/\/(?!www\.w3\.org)[^\s'"`<>)]+/g)) urls.add(m[0]);
  for (const u of urls) {
    try {
      const r = await get(u);
      // 403/429: Seite wehrt Automaten ab -> keine Aussage
      if (!r.ok) note(`${u} antwortet mit ${r.status}`);
    } catch (e) { note(`${u} nicht erreichbar (${e.message})`); }
  }
}
if (ONLINE) await online();

// ---- 7. Quellenangaben erzeugen ----
const rows = [
  ...runtime.map((p) => ({ was: p.name, zweck: reg.npm_zweck[p.name] ?? '', quelle: p.quelle, lizenz: p.lizenz })),
  ...reg.software.map((s) => ({ was: s.name, zweck: s.zweck, quelle: s.quelle, lizenz: s.lizenz })),
  { was: 'leyoNET', zweck: sm.zweck, quelle: sm.url.replace(/\.git$/, ''), lizenz: sm.lizenz },
  ...reg.dateien.filter((d) => d.ausgeliefert).map((d) => ({ was: d.titel, zweck: '', quelle: d.herkunft, lizenz: d.lizenz })),
];
const game = {
  software: rows,
  texturen: { quelle: reg.texturen.quelle, lizenz: reg.texturen.lizenz, sets: Object.entries(sets).filter(([id]) => used.has(id)).map(([id, zweck]) => ({ id, zweck })) },
};
const tools = [...new Map(pkgs.filter((p) => p.werkzeug && !/^@(esbuild|rolldown\/binding|emnapi|napi-rs|tybys)/.test(p.name)).map((p) => [p.name, p])).values()];
const md = `# Herkunft und Lizenzen

> Erzeugt von \`scripts/herkunft-bot.mjs\` aus \`docs/herkunft.json\`. Nicht von Hand ändern. Technische Bestandesaufnahme, keine Rechtsberatung.

## Ausgeliefert

| Bestandteil | Zweck | Herkunft | Lizenz |
|---|---|---|---|
${rows.map((r) => `| ${r.was} | ${r.zweck} | ${r.quelle} | ${r.lizenz} |`).join('\n')}

## Texturen (${reg.texturen.quelle}, ${reg.texturen.lizenz})

| Set | Verwendet für |
|---|---|
${game.texturen.sets.map((s) => `| [${s.id}](https://ambientcg.com/view?id=${s.id}) | ${s.zweck} |`).join('\n')}

## Nicht ausgeliefert, im Repo

| Bestandteil | Herkunft | Lizenz |
|---|---|---|
${reg.dateien.filter((d) => !d.ausgeliefert).map((d) => `| ${d.titel} | ${d.herkunft} | ${d.lizenz} |`).join('\n')}

Werkzeuge zum Bauen: ${tools.map((p) => `${p.name} (${p.lizenz})`).join(', ')}.

## Offen

${reg.dateien.filter((d) => d.offen).map((d) => `- **${d.titel}:** ${d.offen}`).join('\n') || 'nichts'}
`;
// Lizenztexte, die jede Kopie begleiten muessen (MIT, Apache-2.0); Quelle: installierte Pakete
const out = [['docs/HERKUNFT.md', md], ['game/src/herkunft.json', `${JSON.stringify(game, null, 1)}\n`]];
const nm = join(ROOT, 'game/node_modules');
const apache = join(nm, 'detect-libc/LICENSE'); // unveraenderter Apache-2.0-Text
if (existsSync(join(nm, 'three/LICENSE')) && existsSync(apache)) {
  out.push(['game/public/lizenzen.txt', [`leyoNET DC - AGPL-3.0-or-later - https://github.com/vonam-git/leyoNET-DC\nErzeugt von scripts/herkunft-bot.mjs`,
    ...runtime.map((p) => `${p.name} ${p.version} (${p.lizenz})\n\n${readFileSync(join(nm, p.name, 'LICENSE'), 'utf8').trim()}`),
    `${reg.software.filter((x) => x.lizenz === 'Apache-2.0').map((x) => x.name).join(', ')} (Apache-2.0)\n\n${readFileSync(apache, 'utf8').trim()}`,
  ].join(`\n\n${'='.repeat(78)}\n\n`) + '\n']);
}
for (const [file, text] of out) {
  const old = existsSync(join(ROOT, file)) ? read(file) : '';
  if (old === text) continue;
  if (CHECK) bad(`${file} ist veraltet – node scripts/herkunft-bot.mjs ausführen und committen`);
  else { writeFileSync(join(ROOT, file), text); console.log(`geschrieben: ${file}`); }
}

console.log(`Herkunfts-Bot: ${pkgs.length} npm-Pakete (${runtime.length} ausgeliefert), ${used.size} Textur-Sets, ${tracked.length} Dateien geprüft`);
for (const o of open) console.log(`OFFEN   ${o}`);
for (const e of errors) console.log(`FEHLER  ${e}`);
console.log(errors.length ? `${errors.length} Fehler` : 'Herkunft und Lizenzen in Ordnung');
process.exit(errors.length ? 1 : 0);
