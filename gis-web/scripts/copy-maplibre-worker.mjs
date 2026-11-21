// MapLibre 6 loads its worker relative to its own module URL, which a bundled chunk breaks
// (/_next/static/chunks/maplibre-gl-worker.mjs is not emitted). Serve the worker from public/ instead;
// site-map.tsx points setWorkerUrl() at this path.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve('maplibre-gl/dist/maplibre-gl-worker.mjs'));
mkdirSync('public/maplibre', { recursive: true });
copyFileSync(join(dist, 'maplibre-gl-worker.mjs'), 'public/maplibre/maplibre-gl-worker.mjs');
