// Zugangscodes fuers freie Bauen erzeugen. Schreibt nur Pruefsummen nach src/freischaltung.json, der Klartext erscheint einmal hier.
//   node scripts/freischalt-codes.mjs            beide Codes neu
//   node scripts/freischalt-codes.mjs weitergabe nur diesen Code neu (der andere gilt weiter)
//   node scripts/freischalt-codes.mjs mark --eigen   eigenes Passwort eingeben (mind. 10 Zeichen)
import { randomInt } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const FILE = new URL('../src/freischaltung.json', import.meta.url);
if (!existsSync(FILE)) writeFileSync(FILE, '[]\n');
const { derive, normCode, MIN_LENGTH } = await import('../src/freischaltung.js');
const IDS = ['mark', 'weitergabe'];
const [id] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (id && !IDS.includes(id)) { console.error(`unbekannt: ${id} (${IDS.join(', ')})`); process.exit(1); }
const own = process.argv.includes('--eigen');
const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const part = (n) => Array.from({ length: n }, () => A[randomInt(A.length)]).join('');
const list = JSON.parse(readFileSync(FILE, 'utf8'));
for (const k of id ? [id] : IDS) {
  let code = `${part(5)}-${part(5)}-${part(5)}`;
  if (own) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    code = await rl.question(`Passwort «${k}»: `);
    rl.close();
    if (normCode(code).length < MIN_LENGTH) { console.error(`mindestens ${MIN_LENGTH} Zeichen`); process.exit(1); }
  }
  const salt = part(16);
  const row = { id: k, salt, hash: await derive(code, salt) };
  const at = list.findIndex((c) => c.id === k);
  if (at < 0) list.push(row); else list[at] = row;
  console.log(`${k}: ${own ? '(eigenes Passwort)' : code}`);
}
writeFileSync(FILE, `${JSON.stringify(list, null, 1)}\n`);
