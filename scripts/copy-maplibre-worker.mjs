// MapLibre's worker is an ES module that imports a sibling "shared" module.
// Vite only emits the worker file, so we copy both into public/vendor/maplibre,
// and src/ui/map.ts points MapLibre at that folder.
import { copyFileSync, mkdirSync } from 'node:fs';

const src = 'node_modules/maplibre-gl/dist';
const dest = 'public/vendor/maplibre';
mkdirSync(dest, { recursive: true });
for (const f of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) copyFileSync(`${src}/${f}`, `${dest}/${f}`);
console.log('copied MapLibre worker files to', dest);
