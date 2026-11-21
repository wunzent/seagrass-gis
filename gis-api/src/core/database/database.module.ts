import { DynamicModule, Global, Module, OnApplicationShutdown } from '@nestjs/common';
import type { PoolClient } from 'pg';

/** Minimal pg surface used by repositories; a pg Pool satisfies it, tests may pass a stub. */
export interface Database {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  connect?: () => Promise<PoolClient>;
}

export const DATABASE = Symbol('DATABASE');

/** Global: every repository injects `@Inject(DATABASE)`; only repositories may use it. */
@Global()
@Module({})
export class DatabaseModule {
  static forRoot(database: Database, onShutdown: () => Promise<void> = async () => {}): DynamicModule {
    const shutdown: OnApplicationShutdown = { onApplicationShutdown: onShutdown };
    return {
      module: DatabaseModule,
      providers: [
        { provide: DATABASE, useValue: database },
        { provide: 'DATABASE_SHUTDOWN', useValue: shutdown },
      ],
      exports: [DATABASE],
    };
  }
}
