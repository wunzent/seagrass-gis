import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { componentHarness, nodes } from './component-harness.mjs';

const sourceFile = (path) => fileURLToPath(new URL(`../src/${path}`, import.meta.url));
const textOf = (tree) =>
  nodes(tree)
    .flatMap((node) => [node.props?.children])
    .flat(Infinity)
    .filter((value) => typeof value === 'string')
    .join(' ');
const harness = () =>
  componentHarness('../src/features/shell/route-states.tsx', {
    'next/link': { default: 'a', __esModule: true },
    [sourceFile('components/ui/button.tsx')]: { Button: 'button' },
  });

test('route loading page announces loading as a status', () => {
  const tree = harness().exports.RouteLoading();
  const box = nodes(tree).find((node) => node.props?.role === 'status');
  assert.ok(box);
  assert.match(textOf(tree), /กำลังโหลด/);
});

test('route error page shows a fixed message, retries with reset and links home without leaking details', () => {
  let resets = 0;
  const tree = harness().exports.RouteError({ error: new Error('secret stack detail'), reset: () => resets++ });
  assert.ok(nodes(tree).some((node) => node.props?.role === 'alert'));
  assert.match(textOf(tree), /เกิดข้อผิดพลาด/);
  assert.doesNotMatch(textOf(tree), /secret stack detail/);
  nodes(tree)
    .find((node) => node.type === 'button')
    .props.onClick();
  assert.equal(resets, 1);
  assert.ok(nodes(tree).some((node) => node.type === 'a' && node.props.href === '/'));
});

test('not-found page explains the empty result and links home', () => {
  const tree = harness().exports.RouteNotFound();
  assert.match(textOf(tree), /ไม่พบหน้า/);
  assert.ok(nodes(tree).some((node) => node.type === 'a' && node.props.href === '/'));
});

test('app routes use Next file conventions for loading, error and not-found', () => {
  const read = (name) => readFileSync(sourceFile(`app/${name}`), 'utf8');
  assert.match(read('loading.tsx'), /RouteLoading as default/);
  assert.match(read('error.tsx'), /^'use client';/);
  assert.match(read('error.tsx'), /RouteError as default/);
  assert.match(read('not-found.tsx'), /RouteNotFound as default/);
});
