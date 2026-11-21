import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Run component effects with explicit renders and mocked browser/network boundaries.
export function componentHarness(path, mocks = {}, globals = {}) {
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
        tagName: type.toUpperCase(),
        focus() {
          const old = globals.document.activeElement;
          globals.document.activeElement = this;
          old?.dispatch?.('onBlurCapture', { target: old, relatedTarget: this });
          this.dispatch('onFocusCapture', { target: this });
        },
        dispatch(name, event) {
          for (let ancestor = current; ancestor; ancestor = ancestor.parent) ancestor.props?.[name]?.(event);
        },
        querySelector(selector) {
          const descendants = (node) => (node ? [node, ...(node.children ?? []).flatMap(descendants)] : []);
          return descendants(current).find((node) =>
            selector === 'button:not(:disabled)' ? node.type === 'button' && !node.host.disabled : node.type === 'span',
          )?.host;
        },
      };
      current.host.disabled = Boolean(value.props.disabled);
      if (current.host.disabled && globals.document.activeElement === current.host) {
        globals.document.activeElement = globals.document.body;
        current.host.dispatch('onBlurCapture', { target: current.host, relatedTarget: null });
      }
      hosts.set(value, current.host);
      if (value.props.ref) value.props.ref.current = current.host;
    }
    const children = Array.isArray(value) ? value : [value.props?.children];
    current.children = children.map((child, i) => reconcile(child, current.children?.[i], current));
    return current;
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const load = (name) => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
    if (name in mocks) return mocks[name];
    return require(name.startsWith('.') ? `${name}.ts` : name);
  };
  runInNewContext(code, { exports, require: load, console, Error, ...globals });
  return {
    exports,
    host: (node) => hosts.get(node),
    render(fn) {
      cursor = 0;
      effects = [];
      const tree = fn();
      if (globals.document) mounted = reconcile(tree, mounted);
      else for (const node of nodes(tree)) if (node.props?.ref) node.props.ref.current = {};
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
