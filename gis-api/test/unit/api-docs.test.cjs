const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../../dist/app.module');
const { buildOpenApiDocument, renderApiDocs } = require('../../dist/common/openapi');

const stub = { query: async () => { throw new Error('no database in docs tests'); } };

test('committed api-docs/ matches the spec generated from controllers', async () => {
  const app = await createApp(stub);
  try {
    const document = buildOpenApiDocument(app);
    const expected = renderApiDocs(document);
    const root = path.resolve(__dirname, '../../api-docs');
    const listed = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
      ? listed(path.join(dir, e.name)) : [path.relative(root, path.join(dir, e.name)).split(path.sep).join('/')]);
    assert.deepEqual(listed(root).sort(), [...expected.keys()].sort(), 'run `npm run docs:generate`');
    for (const [file, content] of expected) assert.equal(fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n'), content, file);
    // Every documented operation has a summary and at least one error response.
    const operations = Object.entries(document.paths).flatMap(([p, item]) => Object.entries(item).map(([m, op]) => [`${m.toUpperCase()} ${p}`, op]));
    assert.deepEqual(operations.map(([k]) => k).sort(), ['GET /auth/me', 'GET /health', 'GET /sites', 'GET /sites.geojson', 'GET /sites/{code}', 'POST /auth/login', 'POST /auth/logout']);
    for (const [key, op] of operations) {
      assert.ok(op.summary, `${key} summary`);
      assert.ok(Object.keys(op.responses).some(code => Number(code) >= 400), `${key} error responses`);
    }
  } finally { await app.close(); }
});

test('Swagger UI and the generated spec are served at /docs', async () => {
  const app = await createApp(stub);
  await app.listen(0, '127.0.0.1');
  try {
    const base = await app.getUrl();
    const ui = await fetch(`${base}/docs`);
    assert.equal(ui.status, 200);
    assert.match(await ui.text(), /swagger-ui/i);
    const spec = await (await fetch(`${base}/docs/openapi.json`)).json();
    assert.equal(spec.components.securitySchemes.gis_access.in, 'cookie');
    assert.ok(spec.paths['/sites']);
  } finally { await app.close(); }
});
