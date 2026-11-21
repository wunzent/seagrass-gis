import { DynamicModule, Global, Module } from '@nestjs/common';
import { Database, DatabaseModule } from './database/database.module';
import { AppLogger } from './logger/app-logger';

/** Application-wide infrastructure, imported once by AppModule: the database handle (global) and the operator logger. */
@Global()
@Module({})
export class CoreModule {
  static forRoot(database: Database, onShutdown?: () => Promise<void>): DynamicModule {
    return {
      module: CoreModule,
      imports: [DatabaseModule.forRoot(database, onShutdown)],
      providers: [AppLogger],
      exports: [DatabaseModule, AppLogger],
    };
  }
}
