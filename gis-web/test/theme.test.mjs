import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../src/assets/styles/globals.css');

test('stock control styles use the project color tokens and have no legacy sizing overrides', () => {
  assert.match(css, /--input:\s*#848d97;/i);
  const [r, g, b] = [0x84, 0x8d, 0x97].map((channel) => ((channel / 255 + 0.055) / 1.055) ** 2.4);
  assert.ok(1.05 / (r * 0.2126 + g * 0.7152 + b * 0.0722 + 0.05) >= 3);
  assert.match(css, /--border:\s*#d0d7de;/i);
  assert.match(css, /--ring:\s*var\(--primary\);/);
  assert.doesNotMatch(css, /min-(?:height|width):\s*44px|\.session-link|\.text-button|\[data-slot='select-trigger'\]/);
  assert.doesNotMatch(css, /\.demo-login|\.demo-divider/);
});

test('sidebar, map heading and table share the background surface', () => {
  const defined = new Set([...css.matchAll(/(--[\w-]+):/g)].map((match) => match[1]));
  defined.add('--font-plex');
  for (const [, token] of css.matchAll(/var\((--[\w-]+)\)/g)) assert.ok(defined.has(token), `Undefined ${token}`);
  for (const selector of ['sidebar', 'map-heading', 'table-view']) {
    assert.match(css, new RegExp(`\\.${selector}\\s*\\{[^}]*background: var\\(--background\\)`));
  }
  assert.doesNotMatch(css, /\.map-popup\s*\{[^}]*background:/);
  assert.match(css, /\.demo-accounts \.demo-value\s*\{[^}]*white-space: nowrap/);
});

test('Next processes the Tailwind v4 entry through the PostCSS adapter', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const { devDependencies } = JSON.parse(read('../package.json'));
  assert.match(devDependencies.tailwindcss, /^4\.\d+\.\d+$/);
  assert.equal(devDependencies['@tailwindcss/postcss'], devDependencies.tailwindcss);
  assert.match(read('../postcss.config.mjs'), /@tailwindcss\/postcss/);
  assert.match(read('../src/app/layout.tsx'), /import ['"][^'"]*\/globals\.css['"]/);
  assert.match(read('../src/assets/styles/globals.css'), /@import ['"]tailwindcss['"]/);
});
