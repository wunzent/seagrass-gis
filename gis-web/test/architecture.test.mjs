import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root = fileURLToPath(new URL('../src/', import.meta.url));
export const sourceExtension = /\.(ts|tsx|js|jsx|mjs)$/;
const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(path.join(dir, entry.name))
      : sourceExtension.test(entry.name)
        ? [path.join(dir, entry.name)]
        : [],
  );
const allowed = {
  app: ['app', 'features', 'guards', 'lib', 'assets'],
  guards: ['guards', 'stores', 'lib'],
  features: ['features', 'guards', 'services', 'stores', 'components', 'lib', 'assets'],
  services: ['services', 'lib'],
  stores: ['stores', 'lib'],
  components: ['components'],
  lib: ['lib'],
  assets: ['assets'],
};
// React adapters are explicit exceptions; state containers remain framework-free.
const reactStores = new Set(['stores/map-store.ts', 'stores/session-context.tsx']);
const packages = {
  app: ['next', 'react'],
  guards: ['react'],
  features: ['react', 'react-dom', 'next/link', 'next/navigation', 'next/dynamic', 'maplibre-gl'],
  services: [],
  stores: ['react'],
  components: [
    'react',
    'class-variance-authority',
    'clsx',
    'tailwind-merge',
    'lucide-react',
    '@base-ui/react/select',
    '@base-ui/react/input',
    '@base-ui/react/merge-props',
    '@base-ui/react/use-render',
  ],
  lib: ['geojson'],
  assets: ['next/font/google'],
};
export function checkArchitectureSource(relative, text) {
  const file = path.join(root, relative);
  const layer = relative.split('/')[0];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const pure = layer === 'services' || layer === 'lib' || (layer === 'stores' && !reactStores.has(relative));
  const checkImport = (name, typeOnly = false) => {
    if (pure) {
      assert.ok(!/^(react|next)(\/|$)/.test(name), relative + ': React/framework in pure layer');
      assert.ok(!/^(react|react-dom|next)(\/|$)/.test(name), relative + ': React/framework in pure layer');
    }
    if (name.startsWith('.') || name.startsWith('@/')) {
      const targetPath = name.startsWith('@/')
        ? path.join(root, name.slice(2))
        : path.resolve(path.dirname(file), name);
      const resolved = path.relative(root, targetPath).replaceAll('\\', '/').replace(sourceExtension, '');
      if (resolved === 'lib/proxy')
        assert.ok(relative.startsWith('app/api/'), relative + ': proxy belongs to app/api only');
      const target = path.relative(root, targetPath).replaceAll('\\', '/').split('/')[0];
      // Services may use store contracts as erased types, never runtime values.
      if (!(layer === 'services' && target === 'stores' && typeOnly))
        assert.ok(allowed[layer]?.includes(target), relative + ' -> ' + name);
      if (['lib', 'services', 'stores'].includes(layer) && !typeOnly && name.startsWith('.'))
        assert.ok(name.endsWith('.ts'), relative + ': relative value import requires .ts: ' + name);
    } else assert.ok(packages[layer]?.includes(name), relative + ': package not allowed: ' + name);
    if (layer === 'app' && name === 'next') assert.ok(typeOnly, relative + ': next types only');
    if (layer === 'lib' && name === 'geojson') assert.ok(typeOnly, relative + ': geojson types only');
    if (layer === 'app') assert.ok(name !== 'react' || typeOnly, relative + ': route business state');
  };
  const visit = (node) => {
    if (
      (ts.isIdentifier(node) &&
        ['fetch', 'XMLHttpRequest', 'sendBeacon', 'EventSource', 'WebSocket'].includes(node.text)) ||
      (ts.isElementAccessExpression(node) &&
        ts.isStringLiteral(node.argumentExpression) &&
        ['fetch', 'XMLHttpRequest', 'sendBeacon', 'EventSource', 'WebSocket'].includes(node.argumentExpression.text))
    )
      assert.ok(layer === 'services' || relative === 'lib/proxy.ts', relative + ': transport outside service');
    if (
      layer !== 'services' &&
      relative !== 'lib/proxy.ts' &&
      !relative.startsWith('app/api/') &&
      (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
    )
      assert.ok(!node.text.includes('/api/'), relative + ': API URL belongs in service');
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const bindings = node.importClause?.namedBindings;
      const typeOnly = Boolean(
        node.isTypeOnly ||
        node.importClause?.isTypeOnly ||
        (bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length &&
          !node.importClause.name &&
          bindings.elements.every((element) => element.isTypeOnly)) ||
        (node.exportClause &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.length &&
          node.exportClause.elements.every((element) => element.isTypeOnly)),
      );
      const name = node.moduleSpecifier.text;
      if (layer === 'app')
        assert.ok(!/^(react)$/.test(name) || node.importClause?.isTypeOnly, relative + ': route business state');
      checkImport(name, typeOnly);
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      assert.ok(
        node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0]),
        relative + ': module target must be a static string',
      );
      checkImport(node.arguments[0].text);
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      assert.ok(
        node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression),
        relative + ': module target must be a static string',
      );
      checkImport(node.moduleReference.expression.text, node.isTypeOnly);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
test('web layers keep transport, React and route state at their owning boundaries', () => {
  for (const file of files(root))
    checkArchitectureSource(path.relative(root, file).replaceAll('\\', '/'), readFileSync(file, 'utf8'));
});
test('checker scans every supported source extension', () => {
  for (const extension of ['ts', 'tsx', 'js', 'jsx', 'mjs']) assert.ok(sourceExtension.test('sample.' + extension));
});
test('type-only service store contracts and explicit React adapters are allowed', () => {
  assert.doesNotThrow(() => checkArchitectureSource('services/a.ts', 'import type { State } from "../stores/a";'));
  assert.doesNotThrow(() => checkArchitectureSource('stores/map-store.ts', 'import { useState } from "react";'));
  assert.doesNotThrow(() => checkArchitectureSource('services/a.ts', 'const request = fetch;'));
  assert.doesNotThrow(() =>
    checkArchitectureSource(
      'app/api/a/route.ts',
      'import { proxyRequest } from "@/lib/proxy"; const url = "/api/sites";',
    ),
  );
  assert.doesNotThrow(() => checkArchitectureSource('lib/proxy.ts', 'const url = "/api/sites";'));
  assert.doesNotThrow(() => checkArchitectureSource('services/a.ts', 'const url = "/api/sites";'));
  assert.doesNotThrow(() => checkArchitectureSource('app/layout.tsx', 'import type { Metadata } from "next";'));
});
const badSamples = [
  ['features/a.ts', 'import { proxyRequest } from "../lib/proxy";'],
  ['features/a.ts', 'import { proxyRequest } from "@/lib/proxy.ts";'],
  ['services/a.ts', 'import { proxyRequest } from "../lib/proxy.ts";'],
  ['app/page.tsx', 'export { proxyRequest } from "../lib/proxy";'],
  ['guards/a.ts', 'import("../lib/proxy");'],
  ['stores/a.ts', 'require("../lib/proxy.ts");'],
  ['lib/a.ts', 'import proxy = require("./proxy.ts");'],
  ['features/a.ts', 'import axios from "axios";'],
  ['features/a.ts', 'import x from "next/server";'],
  ['services/a.ts', 'import x from "axios";'],
  ['stores/a.ts', 'import x from "axios";'],
  ['lib/a.ts', 'import x from "axios";'],
  ['app/page.tsx', 'import x from "axios";'],
  ['app/page.tsx', 'import x from "react-dom";'],
  ['app/page.tsx', 'import x from "next";'],
  ['lib/a.ts', 'import x from "geojson";'],
  ['guards/a.ts', 'import x from "axios";'],
  ['components/a.tsx', 'import x from "axios";'],
  ['assets/a.ts', 'import x from "axios";'],
  ...['app/page.tsx', 'guards/a.ts', 'stores/a.ts', 'lib/a.ts', 'components/a.tsx', 'assets/a.ts'].map((file) => [
    file,
    'const url = "/api/sites";',
  ]),
  ['features/a.ts', 'const request = fetch;'],
  ['assets/icons/a.tsx', 'import { store } from "../../stores/session-store";'],
  ['assets/fonts/a.ts', 'const request = fetch;'],
  ['services/a.ts', 'import { icon } from "../assets/icons/a.ts";'],
  ['features/a.ts', 'const request = globalThis.fetch;'],
  ['features/a.ts', 'const request = window["fetch"];'],
  ['features/a.ts', 'new XMLHttpRequest();'],
  ['features/a.ts', 'navigator.sendBeacon("/api/a");'],
  ['features/a.ts', 'new EventSource("/events");'],
  ['features/a.ts', 'new WebSocket("/socket");'],
  ['stores/a.ts', 'import { api } from "../services/a.ts";'],
  ['stores/a.ts', 'import("../services/a.ts");'],
  ['stores/a.ts', 'require("../services/a.ts");'],
  ['stores/a.ts', 'import api = require("../services/a.ts");'],
  ['lib/a.js', 'import React from "react-dom/client";'],
  ['services/a.jsx', 'const React = require("react");'],
  ['stores/a.mjs', 'import("next/navigation");'],
  ['features/a.tsx', 'const url = "/api/sites";'],
  ['features/a.ts', 'const url = `/api/sites/${code}`;'],
  ['services/a.ts', 'import { data } from "../lib/a";'],
  ['services/a.ts', 'export { data } from "../lib/a";'],
  ['lib/a.ts', 'import("./b");'],
  ['stores/a.ts', 'require("./b");'],
  ['services/a.ts', 'import { store } from "../stores/a.ts";'],
  ['features/a.ts', 'import(target);'],
  ['features/a.ts', 'require(target);'],
];
for (const [file, source] of badSamples)
  test(`architecture rejects ${file}: ${source}`, () => {
    assert.throws(() => checkArchitectureSource(file, source));
  });
