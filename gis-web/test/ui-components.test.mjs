import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { componentHarness, nodes } from './component-harness.mjs';
import { fileURLToPath } from 'node:url';
const source = (file) => fileURLToPath(new URL('../src/components/ui/' + file, import.meta.url));
test('shadcn uses the Base UI button and Tailwind v4 registry configuration', () => {
  const config = JSON.parse(readFileSync(new URL('../components.json', import.meta.url), 'utf8'));
  assert.equal(config.style, 'base-nova');
  assert.equal(config.tailwind.config, '');
  assert.match(readFileSync(source('button.tsx'), 'utf8'), /@base-ui\/react\/button/);
});
test('shadcn default Alert allows polite status while destructive Alert stays assertive', () => {
  const h = componentHarness('../src/components/ui/alert.tsx');
  const polite = h.exports.Alert({ role: 'status', children: 'ข้อความ' });
  assert.equal(polite.props.role, 'status');
  assert.equal(polite.props['data-slot'], 'alert');
  assert.match(polite.props.className, /bg-card/);
  assert.equal(h.exports.Alert({ variant: 'destructive' }).props.role, 'alert');
});
test('shadcn Table keeps table semantics inside its local scroll container', () => {
  const h = componentHarness('../src/components/ui/table.tsx');
  const tree = nodes(h.exports.Table({ 'aria-label': 'แหล่ง' }));
  assert.equal(tree.find((n) => n.type === 'table').props['aria-label'], 'แหล่ง');
  assert.equal(tree[0].props['data-slot'], 'table-container');
});
test('Base UI Select uses accessible primitives and all seven components are present', () => {
  const select = readFileSync(source('select.tsx'), 'utf8');
  assert.match(select, /@base-ui\/react\/select/);
  for (const name of ['pagination', 'alert', 'select', 'input', 'table', 'badge', 'card'])
    assert.match(readFileSync(source(name + '.tsx'), 'utf8'), /data-slot|slot:/);
});
