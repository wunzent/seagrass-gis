import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, Database } from '../core/database/database.module';
import { toDependencyError } from '../shared/errors/api-error';

/** Read-only master data (seeded by the importer; no API writes). Both tables are small and fixed, so no paging. */
@Injectable()
export class LookupsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private async run(sql: string) {
    try {
      return (await this.db.query(sql)).rows;
    } catch (error) {
      throw toDependencyError(error);
    }
  }

  async provinces() {
    return (await this.run(
      'SELECT code, name_th, ST_AsGeoJSON(geom)::json AS geometry FROM provinces ORDER BY code COLLATE "C" ASC',
    )) as { code: string; name_th: string; geometry: unknown }[];
  }

  async species() {
    return (await this.run('SELECT code, name_th, name_sci FROM species ORDER BY code COLLATE "C" ASC')) as {
      code: string;
      name_th: string;
      name_sci: string;
    }[];
  }
}
