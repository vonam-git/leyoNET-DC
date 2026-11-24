// Kopiert Draco- und Basis(KTX2)-Decoder aus three nach public/decoders (self-hosted, kein CDN).
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const libs = join(root, 'node_modules/three/examples/jsm/libs');
const out = join(root, 'public/decoders');

for (const [src, dst] of [['draco/gltf', 'draco'], ['basis', 'basis']]) {
  mkdirSync(join(out, dst), { recursive: true });
  cpSync(join(libs, src), join(out, dst), { recursive: true });
}
console.log('decoders -> public/decoders');
