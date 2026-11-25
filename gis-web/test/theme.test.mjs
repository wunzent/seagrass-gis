import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('input and select borders use a dedicated token with at least 3:1 contrast on white', () => {
  const css = readFileSync(new URL('../src/assets/styles/globals.css', import.meta.url), 'utf8');
  assert.match(css, /--field-border:\s*#848d97;/i);
  const rgb = [0x84, 0x8d, 0x97].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  const contrast = 1.05 / (luminance + 0.05);
  assert.ok(contrast >= 3, `Field border contrast ${contrast}:1`);
  for (const selector of ['.filters input', ".filters [data-slot='select-trigger']", '.login-panel input']) {
    const block = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(
      ([, selectors, rules]) => selectors.split(',').some((item) => item.trim() === selector) && /border:/.test(rules),
    );
    assert.ok(block, selector);
    assert.match(block[2], /border: 1px solid var\(--field-border\)/);
  }
  assert.match(css, /--border:\s*#d0d7de;/i);
  assert.doesNotMatch(css, /\.demo-login|\.demo-divider/);
});

test('disabled login inputs use the neutral surface', () => {
  const css = readFileSync(new URL('../src/assets/styles/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.login-panel input:disabled\s*\{[^}]*background: var\(--surface\)/);
});

test('bright surfaces use defined tokens, including opaque popups and selected rows', () => {
  const css = readFileSync(new URL('../src/assets/styles/globals.css', import.meta.url), 'utf8');
  const defined = new Set([...css.matchAll(/(--[\w-]+):/g)].map((match) => match[1]));
  defined.add('--font-plex');
  for (const [, token] of css.matchAll(/var\((--[\w-]+)\)/g)) assert.ok(defined.has(token), `Undefined ${token}`);
  assert.match(css, /\.site-rows li\.selected-row\s*\{[^}]*background: var\(--primary-soft\)/);
  assert.match(css, /\.map-popup\s*\{[^}]*background: var\(--bg\)/);
});

test('login account and outlined-field styles use theme tokens and touch-sized controls', () => {
  const css = readFileSync(new URL('../src/assets/styles/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.demo-accounts\s*\{[^}]*background: var\(--primary-soft\)[^}]*color: var\(--text\)/);
  assert.match(css, /\.demo-accounts\s*\{[^}]*font-size: 13px;/);
  assert.doesNotMatch(css, /\.demo-accounts\s*\{[^}]*font-size: 0\.85rem/);
  assert.match(css, /\.demo-accounts button\s*\{[^}]*overflow-wrap: anywhere/);
  assert.doesNotMatch(css, /\.demo-accounts button\s*\{[^}]*min-height/);
  assert.match(css, /\.login-field label\s*\{[^}]*transform: translateY\(-50%\)/);
  assert.match(css, /\.login-field input:focus-visible\s*\{[^}]*outline-color: var\(--primary\)/);
  assert.match(css, /\.password-toggle\s*\{[^}]*width: 44px;[^}]*height: 44px;/);
});

test('demo values stay unbroken and disabled notched labels match the input surface', () => {
  const css = readFileSync(new URL('../src/assets/styles/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.demo-accounts \.demo-value\s*\{[^}]*white-space: nowrap/);
  assert.match(css, /\.login-field:has\(input:disabled\) label\s*\{[^}]*background: var\(--surface\)/);
});
