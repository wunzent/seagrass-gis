import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createApp } from './app.module';
import { AppLogger } from './core/logger/app-logger';
import { buildOpenApiDocument, renderApiDocs } from './shared/openapi/openapi';

const logger = new AppLogger();

/** CLI: regenerate api-docs/ from the controllers. Needs no database. */
async function main() {
  const app = await createApp({
    query: async () => {
      throw new Error('docs generation does not query the database');
    },
  });
  const files = renderApiDocs(buildOpenApiDocument(app));
  await app.close();
  const root = resolve(__dirname, '../api-docs');
  await rm(root, { recursive: true, force: true });
  for (const [file, content] of files) {
    await mkdir(dirname(resolve(root, file)), { recursive: true });
    await writeFile(resolve(root, file), content, 'utf8');
  }
  logger.log(`api-docs: ${files.size} files written`);
}
void main().catch((error) => {
  logger.error(error);
  process.exitCode = 1;
});
