/** Validated survey fields (BR-05 shape checks done by the DTOs; species existence and 50 m checked in the service). */
export interface SurveyFields {
  lon: number;
  lat: number;
  surveyed_on: string;
  cover_percent: number;
  species: string[];
  note: string | null;
}
export type CreateSurvey = SurveyFields;
/** PATCH: only the fields present in the body; omitted fields keep their stored value. */
export type UpdateSurvey = Partial<SurveyFields>;

export interface PageQuery {
  page: number;
  pageSize: number;
}

/** Row shape returned by SurveysRepository; creator columns are dropped by the serializer for anonymous callers. */
export interface SurveyRow extends SurveyFields {
  id: string;
  site_id: string;
  site_code: string;
  created_by_id: string;
  created_by_email: string;
}
