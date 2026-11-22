import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('input and select borders use a dedicated token with at least 3:1 contrast on white', () => {
  const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /--field-border:\s*#848d97;/i);
  const rgb = [0x8c, 0x95, 0x9f].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  const contrast = 1.05 / (luminance + 0.05);
  assert.ok(contrast >= 3, `Field border contrast ${contrast}:1`);
  for (const selector of ['.filters input', '.filters select', '.login-panel input']) {
    const block = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, selectors]) =>
      selectors.split(',').some((item) => item.trim() === selector),
    );
    assert.ok(block, selector);
    assert.match(block[2], /border: 1px solid var\(--field-border\)/);
  }
  assert.match(css, /--border:\s*#d0d7de;/i);
  assert.match(css, /\.demo-divider\s*\{[^}]*border-bottom: 1px solid var\(--border\)/);
});

test('disabled login inputs use the neutral surface', () => {
  const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.login-panel input:disabled\s*\{[^}]*background: var\(--surface\)/);
});

test('bright surfaces use defined tokens, including opaque popups and selected rows', () => {
  const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');
  const defined = new Set([...css.matchAll(/(--[\w-]+):/g)].map((match) => match[1]));
  defined.add('--font-plex');
  for (const [, token] of css.matchAll(/var\((--[\w-]+)\)/g)) assert.ok(defined.has(token), `Undefined ${token}`);
  assert.match(css, /\.site-rows li\.selected-row\s*\{[^}]*background: var\(--primary-soft\)/);
  assert.match(css, /\.map-popup\s*\{[^}]*background: var\(--bg\)/);
});
