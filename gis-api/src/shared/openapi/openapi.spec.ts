import * as fs from 'node:fs';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';
import { Test } from '@nestjs/testing';
import { appModule } from '../../app.module';
import { buildOpenApiDocument, renderApiDocs, setupDocs } from './openapi';

const stub = {
  query: async () => {
    throw new Error('no database in docs tests');
  },
};

async function makeApp() {
  const moduleRef = await Test.createTestingModule({ imports: [appModule(stub)] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  setupDocs(app);
  return app;
}

describe('api docs', () => {
  it('committed api-docs/ matches the spec generated from controllers', async () => {
    const app = await makeApp();
    await app.init();
    try {
      const document = buildOpenApiDocument(app);
      const expected = renderApiDocs(document);
      const root = path.resolve(process.cwd(), 'api-docs');
      const listed = (dir: string): string[] =>
        fs
          .readdirSync(dir, { withFileTypes: true })
          .flatMap((e) =>
            e.isDirectory()
              ? listed(path.join(dir, e.name))
              : [path.relative(root, path.join(dir, e.name)).split(path.sep).join('/')],
          );
      expect(listed(root).sort()).toEqual([...expected.keys()].sort());
      for (const [file, content] of expected)
        expect([file, fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')]).toEqual([file, content]);
      // Every documented operation has a summary and at least one error response.
      const operations = Object.entries(document.paths).flatMap(([p, item]) =>
        Object.entries(item as Record<string, any>).map(([m, op]) => [`${m.toUpperCase()} ${p}`, op] as const),
      );
      expect(operations.map(([k]) => k).sort()).toEqual([
        'DELETE /sites/{code}',
        'DELETE /surveys/{id}',
        'GET /auth/me',
        'GET /health',
        'GET /provinces.geojson',
        'GET /sites',
        'GET /sites.geojson',
        'GET /sites/{code}',
        'GET /sites/{code}/surveys',
        'GET /species',
        'GET /surveys.geojson',
        'PATCH /sites/{code}',
        'PATCH /surveys/{id}',
        'POST /auth/login',
        'POST /auth/logout',
        'POST /sites',
        'POST /sites/{code}/surveys',
      ]);
      for (const [key, op] of operations) {
        expect([key, Boolean(op.summary)]).toEqual([key, true]);
        expect([key, Object.keys(op.responses).some((code) => Number(code) >= 400)]).toEqual([key, true]);
      }
    } finally {
      await app.close();
    }
  });

  it('Swagger UI and the generated spec are served at /docs', async () => {
    const app = await makeApp();
    await app.listen(0, '127.0.0.1');
    try {
      const base = await app.getUrl();
      const ui = await fetch(`${base}/docs`);
      expect(ui.status).toBe(200);
      expect(await ui.text()).toMatch(/swagger-ui/i);
      const spec: any = await (await fetch(`${base}/docs/openapi.json`)).json();
      expect(spec.components.securitySchemes.gis_access.in).toBe('cookie');
      expect(spec.paths['/sites']).toBeTruthy();
    } finally {
      await app.close();
    }
  });

  it('Swagger UI adds X-CSRF-Protection: 1 to non-GET try-it-out requests', async () => {
    const app = await makeApp();
    await app.listen(0, '127.0.0.1');
    try {
      const init = await (await fetch(`${await app.getUrl()}/docs/swagger-ui-init.js`)).text();
      // Run the served init script with a stub SwaggerUIBundle to capture the options the browser would get.
      let options: any;
      const bundle = Object.assign((o: unknown) => ((options = o), {}), { presets: { apis: {} }, plugins: {} });
      const window: any = { location: { origin: 'http://localhost:3001' } };
      runInNewContext(init, { window, SwaggerUIBundle: bundle, SwaggerUIStandalonePreset: {} });
      window.onload();
      const intercept = (method: string) => options.requestInterceptor({ method, url: '/sites', headers: {} }).headers;
      for (const method of ['POST', 'PATCH', 'DELETE', 'post'])
        expect([method, intercept(method)['X-CSRF-Protection']]).toEqual([method, '1']);
      for (const method of ['GET', 'HEAD', 'OPTIONS']) expect([method, intercept(method)]).toEqual([method, {}]);
    } finally {
      await app.close();
    }
  });
});
