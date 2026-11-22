import { siteStatus } from './site-status';
import { jest } from '@jest/globals';
import { SITE_VIEW } from './sites.repository';

describe('siteStatus (unrounded latest-day average)', () => {
  it.each([
    [null, 'no_data'],
    [0, 'poor'],
    [24.999, 'poor'],
    [25, 'fair'],
    [49.99, 'fair'],
    [50, 'good'],
    [74.99, 'good'],
    [74.995, 'good'],
    [75, 'very_good'],
    [100, 'very_good'],
  ] as const)('%s -> %s', (average, expected) => {
    expect(siteStatus(average)).toBe(expected);
  });
});

describe('status SQL constants', () => {
  it('generates the CASE from unrounded averages with the exact thresholds and statuses', () => {
    expect(SITE_VIEW.match(/CASE[\s\S]*?END AS status/)?.[0].replace(/\s+/g, ' ')).toBe(
      "CASE WHEN l.average IS NULL THEN 'no_data' WHEN l.average >= 75 THEN 'very_good' WHEN l.average >= 50 THEN 'good' WHEN l.average >= 25 THEN 'fair' ELSE 'poor' END AS status",
    );
  });

  it('rejects a non-finite threshold at module load', async () => {
    const finite = jest.spyOn(Number, 'isFinite').mockReturnValue(false);
    try {
      await jest.isolateModulesAsync(async () => {
        await expect(import('./site-status')).rejects.toThrow('Invalid site status threshold');
      });
    } finally {
      finite.mockRestore();
    }
  });

  it('rejects a status outside SITE_STATUSES at module load', async () => {
    jest.unstable_mockModule('./entities/site.entity', () => ({ SITE_STATUSES: ['no_data', 'poor'] }));
    try {
      await jest.isolateModulesAsync(async () => {
        await expect(import('./site-status')).rejects.toThrow('Invalid site status threshold');
      });
    } finally {
      jest.unstable_unmockModule('./entities/site.entity');
    }
  });
});
