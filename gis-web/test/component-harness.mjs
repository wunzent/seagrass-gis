import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import pathModule from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Run component effects with explicit renders and mocked browser/network boundaries.
export function componentHarness(path, mocks = {}, globals = {}, { inlineFixtures = [] } = {}) {
  const usedMocks = new Set();
  const mock = (target) => {
    if (mocks[target] === undefined) throw new Error(`Undefined mock for ${target}`);
    usedMocks.add(target);
    return mocks[target];
  };
  const inlineFiles = new Set(inlineFixtures.map((file) => pathModule.resolve(file)));
  const slots = [];
  let cursor = 0;
  let effects = [];
  const memo = (fn, deps) => {
    const index = cursor++;
    if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i])))
      slots[index] = { value: fn(), deps };
    return slots[index].value;
  };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [
        slots[index],
        (value) => {
          slots[index] = typeof value === 'function' ? value(slots[index]) : value;
        },
      ];
    },
    useRef: (initial) => memo(() => ({ current: initial }), []),
    useMemo: memo,
    useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect(fn, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) {
        const old = slots[index];
        effects.push(() => {
          old?.cleanup?.();
          slots[index] = { deps, cleanup: fn() };
        });
      }
    },
  };
  react.useLayoutEffect = react.useEffect;
  react.useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot();
  const file = new URL(path, import.meta.url);
  const require = createRequire(file);
  const exports = {};
  const hosts = new WeakMap();
  let mounted;
  // Optional host simulation: preserve identity by React type/key/child position,
  // including fragments, and model native disabling dropping keyboard focus.
  const reconcile = (value, previous, parent) => {
    const type = Array.isArray(value) ? 'array' : value?.type;
    if (!type) return;
    const key = value.key;
    const current = previous?.type === type && previous.key === key ? previous : { type, key };
    current.parent = parent;
    current.props = value.props;
    if (typeof type === 'string' && type !== 'fragment' && type !== 'array') {
      current.host ??= {
        // The Select fixture identifies its primitive in the tree but renders a native button in browsers.
        tagName: type === 'select-trigger' ? 'BUTTON' : type.toUpperCase(),
        focus() {
          const old = globals.document.activeElement;
          globals.document.activeElement = this;
          old?.dispatch?.('onBlurCapture', { target: old, relatedTarget: this });
          this.dispatch('onFocusCapture', { target: this });
        },
        dispatch(name, event) {
          for (let ancestor = current; ancestor; ancestor = ancestor.parent) ancestor.props?.[name]?.(event);
        },
        closest(selector) {
          // Class selectors only (".name"), enough for the components under test.
          for (let ancestor = current; ancestor; ancestor = ancestor.parent)
            if (
              String(ancestor.props?.className ?? '')
                .split(' ')
                .includes(selector.slice(1))
            )
              return ancestor.host ?? {};
          return null;
        },
        querySelector(selector) {
          const descendants = (node) => (node ? [node, ...(node.children ?? []).flatMap(descendants)] : []);
          return descendants(current).find((node) =>
            selector === 'button:not(:disabled)'
              ? node.host?.tagName === 'BUTTON' && !node.host.disabled
              : selector === '.pagination-navigation button:not(:disabled)'
                ? node.host?.tagName === 'BUTTON' && !node.host.disabled && node.host.closest('.pagination-navigation')
                : selector === '[aria-live]'
                  ? Boolean(node.props?.['aria-live'])
                  : node.type === 'span',
          )?.host;
        },
      };
      current.host.disabled = Boolean(value.props.disabled);
      if (current.host.disabled && globals.document.activeElement === current.host) {
        globals.document.activeElement = globals.document.body;
        current.host.dispatch('onBlurCapture', { target: current.host, relatedTarget: null });
      }
      hosts.set(value, current.host);
      if (typeof value.props.ref === 'function') value.props.ref(current.host);
      else if (value.props.ref) value.props.ref.current = current.host;
    }
    const children = Array.isArray(value) ? value : [value.props?.children];
    current.children = children.map((child, i) => reconcile(child, current.children?.[i], current));
    return current;
  };
  const jsx = (type, props, key) =>
    typeof type === 'function' && type.inlineFixture ? type(props) : { type, props, key };
  const modules = new Map();
  const evaluate = (filePath, entry = false) => {
    if (modules.has(filePath)) return modules.get(filePath);
    const result = entry ? exports : {};
    modules.set(filePath, result);
    const code = ts.transpileModule(readFileSync(filePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const load = (name) => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
      if (!name.startsWith('.') && Object.hasOwn(mocks, name)) return mock(name);
      if (name.startsWith('.')) {
        const base = pathModule.resolve(pathModule.dirname(filePath), name);
        const target = [base, base + '.ts', base + '.tsx'].find((candidate) => existsSync(candidate));
        if (!target) throw new Error(`Cannot resolve ${JSON.stringify(name)} from ${filePath}`);
        if (Object.hasOwn(mocks, target)) return mock(target);
        if (target.endsWith('.ts') && !/from ['"]react['"]/.test(readFileSync(target, 'utf8'))) return require(target);
        const loaded = evaluate(target);
        if (inlineFiles.has(target))
          for (const value of Object.values(loaded)) if (typeof value === 'function') value.inlineFixture = true;
        return loaded;
      }
      return require(name);
    };
    runInNewContext(code, { exports: result, require: load, console, Error, ...globals });
    return result;
  };
  evaluate(fileURLToPath(file), true);
  for (const target of Object.keys(mocks))
    if (pathModule.isAbsolute(target) && !usedMocks.has(target)) throw new Error(`Unused absolute mock: ${target}`);
  return {
    exports,
    host: (node) => hosts.get(node),
    render(fn) {
      cursor = 0;
      effects = [];
      const tree = fn();
      if (globals.document) mounted = reconcile(tree, mounted);
      else
        for (const node of nodes(tree))
          if (typeof node.props?.ref === 'function') node.props.ref({});
          else if (node.props?.ref) node.props.ref.current = {};
      effects.forEach((effect) => effect());
      return tree;
    },
  };
}
export function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
