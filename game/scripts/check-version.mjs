// Version ueberall gleich: info.js, package.json, Lockfile, Server, CHANGELOG
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const json = (p) => JSON.parse(read(p));
const { VERSION, CHANGES } = await import('../src/info.js');
const lock = json('game/package-lock.json');
const all = { 'info.js VERSION': VERSION, 'info.js CHANGES': CHANGES[0].v, 'game/package.json': json('game/package.json').version, 'package-lock.json': lock.version, 'package-lock.json (Paket)': lock.packages[''].version,
  'server/package.json': json('server/package.json').version, 'CHANGELOG.md': /^## (\S+) /m.exec(read('CHANGELOG.md'))?.[1] };
const bad = Object.entries(all).filter(([, v]) => v !== VERSION);
console.log(bad.length ? `FAIL Version ${VERSION}: ${bad.map(([k, v]) => `${k} = ${v}`).join(', ')}` : `OK   Version ${VERSION} ueberall gleich`);
process.exit(bad.length ? 1 : 0);
