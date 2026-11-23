import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { componentHarness } from './component-harness.mjs';

function fixture(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gis-harness-'));
  const write = (name, source) => {
    const file = path.join(dir, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, source);
    return file;
  };
  try {
    run(write);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test('harness resolves mocks by absolute module identity across different relative imports', () =>
  fixture((write) => {
    const dep = write('dep.ts', 'export const value = "real";');
    write('nested/child.tsx', 'import { value } from "../dep"; export const Child = () => value;');
    const entry = write(
      'entry.tsx',
      'import { value } from "./dep"; import { Child } from "./nested/child"; export const result = [value, Child()];',
    );
    const h = componentHarness(pathToFileURL(entry), { [dep]: { value: 'mock' } });
    assert.deepEqual(Array.from(h.exports.result), ['mock', 'mock']);
  }));
test('harness reports unresolved relative module and importer clearly', () =>
  fixture((write) => {
    const entry = write('entry.tsx', 'import { value } from "./missing"; export { value };');
    assert.throws(() => componentHarness(pathToFileURL(entry)), /Cannot resolve "\.\/missing" from .*entry\.tsx/);
  }));
test('harness inlines only the explicitly supplied fixtures', () =>
  fixture((write) => {
    const child = write('child.tsx', 'export function Child() { return <span>child</span>; }');
    const entry = write('entry.tsx', 'import { Child } from "./child"; export const View = () => <Child />;');
    const plain = componentHarness(pathToFileURL(entry));
    assert.equal(typeof plain.render(() => plain.exports.View()).type, 'function');
    const inline = componentHarness(pathToFileURL(entry), {}, {}, { inlineFixtures: [child] });
    assert.equal(inline.render(() => inline.exports.View()).type, 'span');
  }));

test('harness rejects an explicitly undefined mock with the target path', () =>
  fixture((write) => {
    const dep = write('dep.ts', 'export const value = "real";');
    const entry = write('entry.tsx', 'import { value } from "./dep"; export { value };');
    assert.throws(() => componentHarness(pathToFileURL(entry), { [dep]: undefined }), /Undefined mock for .*dep\.ts/);
  }));

for (const name of ['unused.ts', 'dep.tss'])
  test(`harness rejects unused or mistyped absolute mock ${name}`, () =>
    fixture((write) => {
      write('dep.ts', 'export const value = "real";');
      const entry = write('entry.tsx', 'import { value } from "./dep"; export { value };');
      const unused = path.join(path.dirname(entry), name);
      assert.throws(
        () => componentHarness(pathToFileURL(entry), { [unused]: { value: 'mock' } }),
        /Unused absolute mock/,
      );
    }));
