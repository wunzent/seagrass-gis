import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Run component effects with explicit renders and mocked browser/network boundaries.
export function componentHarness(path, mocks = {}, globals = {}) {
  const slots = []; let cursor = 0; let effects = [];
  const memo = (fn, deps) => {
    const index = cursor++;
    if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) slots[index] = { value: fn(), deps };
    return slots[index].value;
  };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef: initial => memo(() => ({ current: initial }), []),
    useMemo: memo,
    useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect(fn, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) {
        const old = slots[index];
        effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; });
      }
    },
  };
  const file = new URL(path, import.meta.url);
  const require = createRequire(file);
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const load = name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
    if (name in mocks) return mocks[name];
    return require(name.startsWith('.') ? `${name}.ts` : name);
  };
  runInNewContext(code, { exports, require: load, console, Error, ...globals });
  return { exports, render(fn) {
    cursor = 0; effects = [];
    const tree = fn();
    for (const node of nodes(tree)) if (node.props?.ref) node.props.ref.current = {};
    effects.forEach(effect => effect());
    return tree;
  } };
}
export function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
