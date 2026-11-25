import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import type { Pool, PoolClient } from 'pg';
import { open } from 'shapefile';
import { reportCsv, type ReportRow } from './import-formats';

const BASENAME = 'seagrass_large_utm';
export const REFERENCE_ARCHIVE = BASENAME + '.zip';
export const REFERENCE_SOURCE_SRID = 32647;
const MAX_MEMBER_BYTES = 32 * 1024 * 1024;
const BATCH_SIZE = 500;

type Ring = number[][];
type ParcelGeometry = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] };
type Parcel = { row: number; ref_id: number | null; density: string | null; geometry: ParcelGeometry | null };

function validRing(ring: Ring) {
  return (
    ring.length >= 4 &&
    ring.every((point) => point.length === 2 && point.every(Number.isFinite)) &&
    ring[0].every((coordinate, axis) => coordinate === ring[ring.length - 1][axis])
  );
}

export function parseReferenceFeature(feature: { properties: unknown; geometry: unknown }, row: number): Parcel {
  const { REF_ID, DENSITY } = (feature.properties ?? {}) as Record<string, unknown>;
  const shape = feature.geometry as ParcelGeometry | null;
  const polygons =
    shape?.type === 'Polygon' ? [shape.coordinates] : shape?.type === 'MultiPolygon' ? shape.coordinates : [];
  const geometry =
    polygons.length && polygons.every((rings) => rings.length > 0 && rings.every(validRing)) ? shape : null;
  return {
    row,
    ref_id: typeof REF_ID === 'number' && Number.isSafeInteger(REF_ID) ? REF_ID : null,
    density: typeof DENSITY === 'string' ? DENSITY.trim() || null : null,
    geometry,
  };
}

export async function* readReferenceFeatures(archive: string): AsyncGenerator<Parcel> {
  const names = new Set(['shp', 'shx', 'dbf'].map((extension) => BASENAME + '.' + extension));
  const files = unzipSync(await readFile(archive), {
    filter: ({ name, originalSize }) => names.has(name) && originalSize <= MAX_MEMBER_BYTES,
  });
  const dir = await mkdtemp(join(tmpdir(), 'gis-reference-parcels-'));
  try {
    for (const name of names) {
      if (!files[name]?.length) throw new Error(`Missing or oversized archive member: ${name}`);
      await writeFile(join(dir, name), files[name], { flag: 'wx' });
    }
    // This reader returns the original XY coordinates. Assign the CRS only when loading into PostGIS.
    const source = await open(join(dir, BASENAME + '.shp'), join(dir, BASENAME + '.dbf'));
    try {
      let row = 0;
      for (let next = await source.read(); !next.done; next = await source.read()) {
        yield parseReferenceFeature(next.value, ++row);
      }
    } finally {
      await source.cancel();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const reasons = {
  INVALID_FIELDS: 'REF_ID and DENSITY are required',
  INVALID_GEOMETRY: 'Expected a valid, nonempty polygon in EPSG:32647 and EPSG:4326',
  DUPLICATE_KEY: 'First source occurrence wins, including invalid first occurrence',
};
type Reason = keyof typeof reasons;

async function insertBatch(client: PoolClient, batch: Parcel[]) {
  return client.query<{ row: number; reason: Reason | null; inserted: boolean }>(
    `WITH source AS MATERIALIZED (
       SELECT row, ref_id, density, ST_SetSRID(ST_GeomFromGeoJSON(geometry), $2) AS utm
       FROM jsonb_to_recordset($1) AS rowdata(row integer, ref_id bigint, density text, geometry jsonb)
     ), projected AS MATERIALIZED (
       SELECT row, ref_id, density, CASE WHEN NOT ST_IsEmpty(utm) AND ST_IsValid(utm, 0)
         THEN ST_Multi(ST_Transform(utm, 4326)) END AS geom
       FROM source
     ), validated AS MATERIALIZED (
       SELECT *, CASE WHEN ref_id IS NULL OR density IS NULL THEN 'INVALID_FIELDS'
         WHEN geom IS NULL OR ST_IsEmpty(geom) OR NOT ST_IsValid(geom, 0) THEN 'INVALID_GEOMETRY' END AS reason
       FROM projected
     ), inserted AS (
       INSERT INTO reference_parcels (ref_id, density, geom)
       SELECT ref_id, density, geom FROM validated WHERE reason IS NULL ORDER BY ref_id
       ON CONFLICT (ref_id) DO NOTHING RETURNING ref_id
     )
     SELECT row, reason, inserted.ref_id IS NOT NULL AS inserted
     FROM validated LEFT JOIN inserted USING (ref_id)`,
    [JSON.stringify(batch), REFERENCE_SOURCE_SRID],
  );
}

export async function importReferenceParcels(pool: Pool, seedDir: string, reportDir: string) {
  const report = join(reportDir, 'reference_import_report.csv');
  const temporaryReport = report + '.' + randomUUID();
  const rejections: ReportRow[] = [];
  const summary = { accepted: 0, already_present: 0, rejected: 0 };
  const seen = new Set<number>();
  const batch: Parcel[] = [];
  const client = await pool.connect();

  function reject(parcel: Parcel, reason: Reason) {
    rejections.push({
      source_file: REFERENCE_ARCHIVE,
      row: parcel.row,
      key: parcel.ref_id?.toString() ?? '',
      reason_code: reason,
      reason: reasons[reason],
    });
  }

  async function flush() {
    const byRow = new Map(batch.map((parcel) => [parcel.row, parcel]));
    for (const result of (await insertBatch(client, batch)).rows) {
      if (result.reason) reject(byRow.get(result.row)!, result.reason);
      else if (result.inserted) summary.accepted++;
      else summary.already_present++;
    }
    batch.length = 0;
  }

  try {
    await client.query('BEGIN');
    // Serialize reruns of this importer without sharing the core migration or seed-import locks.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('seagrass_reference_parcels'))`);
    for await (const parcel of readReferenceFeatures(join(seedDir, REFERENCE_ARCHIVE))) {
      if (parcel.ref_id !== null) {
        if (seen.has(parcel.ref_id)) {
          reject(parcel, 'DUPLICATE_KEY');
          continue;
        }
        seen.add(parcel.ref_id);
      }
      batch.push(parcel);
      if (batch.length === BATCH_SIZE) await flush();
    }
    if (batch.length) await flush();
    // Martin can use current spatial statistics for its first request after a fresh import.
    if (summary.accepted) await client.query('ANALYZE reference_parcels');
    summary.rejected = rejections.length;
    await mkdir(reportDir, { recursive: true });
    await writeFile(temporaryReport, reportCsv(rejections.sort((a, b) => a.row - b.row)), { flag: 'wx' });
    await client.query('COMMIT');
    await rename(temporaryReport, report);
    return summary;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await rm(temporaryReport, { force: true });
  }
}
