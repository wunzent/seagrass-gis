import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, Database } from '../core/database/database.module';

@Injectable()
export class HealthRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async readStatus() {
    const { rows } = await this.db.query('SELECT 1 AS ready, postgis_lib_version() AS postgis');
    return { ready: rows[0]?.ready, postgis: String(rows[0]?.postgis ?? '') };
  }
}
