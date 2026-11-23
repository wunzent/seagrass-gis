import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson';
import type { Status } from './map-state';

export type Site = {
  code: string;
  name: string;
  province_code: string;
  area_rai: number;
  status: Status;
  version: number;
};
export type SiteProperties = Site & {
  latestSurvey: { surveyed_on: string; average_cover_percent: number; count: number } | null;
};
export type SiteFeature = Feature<Polygon | MultiPolygon, SiteProperties>;
export type SitesGeoJSON = FeatureCollection<Polygon | MultiPolygon, SiteProperties>;
export type SiteList = { items: Site[]; total: number; page: number };
export type ProvinceCollection = FeatureCollection<Polygon | MultiPolygon, { code: string; name_th: string }>;
export type Survey = {
  id: string | number;
  lon: number;
  lat: number;
  surveyed_on: string;
  cover_percent: number;
  species: string[];
  note: string | null;
  created_by?: { id: string; email: string };
};
export type SurveysGeoJSON = FeatureCollection<Point, Survey & { site_code: string }>;
export type SurveyList = { items: Survey[]; total: number; page: number };

export function geometryBounds(feature: SiteFeature): [number, number, number, number] {
  const positions =
    feature.geometry.type === 'Polygon' ? feature.geometry.coordinates.flat() : feature.geometry.coordinates.flat(2);
  return positions.reduce<[number, number, number, number]>(
    (bounds, [x, y]) => [
      Math.min(bounds[0], x),
      Math.min(bounds[1], y),
      Math.max(bounds[2], x),
      Math.max(bounds[3], y),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}
