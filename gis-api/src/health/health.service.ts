import { Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors';
import { HealthRepository } from './health.repository';

@Injectable()
export class HealthService {
  constructor(private readonly health: HealthRepository) {}

  /** Real DB round trip; any failure or non-3.x PostGIS is reported as 503 without details. */
  async check() {
    try {
      const status = await this.health.readStatus();
      const version = status.postgis.match(/^(3\.\d+)(?:\.|$)/);
      if (status.ready !== 1 || !version) throw new Error('Dependency not ready');
      return { db: 'ok', postgis: version[1] };
    } catch {
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Database service is unavailable');
    }
  }
}
