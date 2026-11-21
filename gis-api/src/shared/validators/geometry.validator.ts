export class RowRejection extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export function reject(code: string, message: string): never {
  throw new RowRejection(code, message);
}
export function text(value: unknown, field: string, max = 1000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0'))
    reject('INVALID_FIELD', `Invalid ${field}`);
  return value;
}
export type Geometry = { type: string; coordinates: unknown };
export function validateCrs(value: unknown): void {
  if (value === undefined || value === null) return;
  if (!value || typeof value !== 'object') reject('INVALID_CRS', 'Source CRS must be EPSG:4326');
  const crs = value as { type?: unknown; properties?: { name?: unknown } };
  if (
    crs.type !== 'name' ||
    !['EPSG:4326', 'urn:ogc:def:crs:EPSG::4326', 'urn:ogc:def:crs:OGC:1.3:CRS84'].includes(String(crs.properties?.name))
  )
    reject('INVALID_CRS', 'Source CRS must be EPSG:4326; reprojection is not supported');
}
export function validateGeometry(value: unknown, kind: 'point' | 'polygon'): Geometry {
  if (!value || typeof value !== 'object') reject('INVALID_GEOMETRY', 'Missing geometry');
  const g = value as Geometry;
  validateCrs((value as { crs?: unknown }).crs);
  function point(p: unknown): asserts p is number[] {
    if (
      !Array.isArray(p) ||
      p.length !== 2 ||
      !p.every((n) => typeof n === 'number' && Number.isFinite(n)) ||
      Math.abs(p[0]) > 180 ||
      Math.abs(p[1]) > 90
    )
      reject('INVALID_GEOMETRY', 'Coordinates must be finite longitude/latitude in EPSG:4326');
  }
  if (kind === 'point') {
    if (g.type !== 'Point') reject('INVALID_GEOMETRY', 'Expected Point');
    point(g.coordinates);
    return g;
  }
  if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') reject('INVALID_GEOMETRY', 'Expected Polygon or MultiPolygon');
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  if (!Array.isArray(polygons) || polygons.length === 0) reject('INVALID_GEOMETRY', 'Empty polygon');
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) reject('INVALID_GEOMETRY', 'Empty polygon');
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) reject('INVALID_GEOMETRY', 'Ring requires four positions');
      for (const p of ring) point(p);
      if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])
        reject('INVALID_GEOMETRY', 'Ring must be closed');
    }
  }
  return { type: 'MultiPolygon', coordinates: polygons };
}
export function bangkokToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
/** BR-05 date (importer and API): YYYY-MM-DD, a real calendar date (no year 0000), not later than `today`. */
export function isSurveyDate(date: unknown, today = bangkokToday()): date is string {
  return (
    typeof date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !date.startsWith('0000-') &&
    Number.isFinite(Date.parse(`${date}T00:00:00Z`)) &&
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date &&
    date <= today
  );
}
export function validateSurvey(row: Record<string, string>, known: Set<string>, today = bangkokToday()) {
  const date = row.surveyed_on;
  if (!isSurveyDate(date, today))
    reject('INVALID_DATE', 'Survey date must be a real calendar date not later than today in Asia/Bangkok');
  function numeric(value: string, field: string) {
    if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Number(value)))
      reject('INVALID_FIELD', `Invalid ${field}`);
    return Number(value);
  }
  const cover = numeric(row.cover_percent, 'cover_percent');
  if (cover < 0 || cover > 100) reject('INVALID_COVER', 'Cover must be between 0 and 100');
  const geom = validateGeometry(
    { type: 'Point', coordinates: [numeric(row.lon, 'lon'), numeric(row.lat, 'lat')] },
    'point',
  );
  const species = [...new Set(text(row.species, 'species').split('|'))];
  if (species.some((s) => !known.has(s))) reject('UNKNOWN_SPECIES', 'Unknown species code');
  return { date, cover, geom, species };
}
