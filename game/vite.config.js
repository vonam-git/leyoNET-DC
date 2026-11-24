import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// leyoNET-Simulationskern (Git-Submodul vendor/leyonet, AGPL-3.0-or-later): reines TypeScript ohne DOM
const LEYONET_CORE = fileURLToPath(new URL('../vendor/leyonet/src/core/index.ts', import.meta.url));

export default defineConfig({
  // relativ: laeuft auf dev-dc.leyonet.ch/, dc.leyonet.ch/ oder in einem Unterordner gleich
  base: './',
  // GLBs liegen in ../assets/out und werden per `?url` importiert (Hash-Namen im Build).
  assetsInclude: ['**/*.glb'],
  resolve: { alias: { '@leyonet/core': LEYONET_CORE } },
  tsconfig: 'tsconfig.leyonet.json', // nicht die tsconfig.json des Submoduls (extends @tsconfig/svelte)
  server: {
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://127.0.0.1:8787' }, // Server (Plan v4 F): cd server && npm start
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: { input: { index: fileURLToPath(new URL('./index.html', import.meta.url)), admin: fileURLToPath(new URL('./admin.html', import.meta.url)) } },
  },
});
