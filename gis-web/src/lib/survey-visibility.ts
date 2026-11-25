import type { SurveysGeoJSON } from './sites.ts';

export const SURVEY_MIN_ZOOM = 12;
const emptySurveys: SurveysGeoJSON = { type: 'FeatureCollection', features: [] };

/** False hides the layer, null shows the full viewport, and a code scopes it to one site. */
export function surveyScope(zoom: number, selectedSite: string | null, enabled: boolean) {
  return enabled ? (zoom >= SURVEY_MIN_ZOOM ? null : (selectedSite ?? false)) : false;
}

export function visibleSurveys(data: SurveysGeoJSON | undefined, scope: ReturnType<typeof surveyScope>) {
  if (scope === false) return emptySurveys;
  if (!data || scope === null) return data;
  return { ...data, features: data.features.filter((feature) => feature.properties.site_code === scope) };
}
