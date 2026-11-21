import { Test } from '@nestjs/testing';
import { appModule } from './app.module';

describe('AppModule HTTP safety', () => {
  it('dependency failure and unknown route use safe envelope; close awaits resource cleanup', async () => {
    let closed = false;
    const moduleRef = await Test.createTestingModule({
      imports: [
        appModule(
          {
            query: async () => {
              throw new Error('password=secret');
            },
          },
          {
            onShutdown: async () => {
              closed = true;
            },
          },
        ),
      ],
    }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    try {
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      const response = await fetch(`${base}/health`, { headers: { Cookie: 'gis_access=invalid' } });
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Database service is unavailable', details: {} },
      });
      const missing = await fetch(`${base}/missing`);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'Resource not found', details: {} },
      });
    } finally {
      await app.close();
    }
    expect(closed).toBe(true);
  });
});
