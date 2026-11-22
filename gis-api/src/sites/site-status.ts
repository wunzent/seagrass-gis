import { SITE_STATUSES, type SiteStatus } from './entities/site.entity';

export const STATUS_THRESHOLDS = [
  { minimum: 75, status: 'very_good' },
  { minimum: 50, status: 'good' },
  { minimum: 25, status: 'fair' },
] as const;

for (const { minimum, status } of STATUS_THRESHOLDS) {
  if (!Number.isFinite(minimum) || !SITE_STATUSES.includes(status)) throw new Error('Invalid site status threshold');
}

export function siteStatus(average: number | null): SiteStatus {
  if (average === null) return 'no_data';
  return STATUS_THRESHOLDS.find(({ minimum }) => average >= minimum)?.status ?? 'poor';
}
