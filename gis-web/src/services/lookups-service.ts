import { fetchJson } from './http-client.ts';
import type { ProvinceCollection } from '../lib/sites.ts';
const provincesKey = () => '/api/provinces.geojson';
export const lookupsService = {
  provincesKey,
  provinces: (signal: AbortSignal) => fetchJson<ProvinceCollection>(provincesKey(), signal),
};
