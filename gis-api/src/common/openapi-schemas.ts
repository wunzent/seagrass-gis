import { SITE_STATUSES } from '../sites/site.model';

/** Shared OpenAPI component schemas; controllers reference them with `ref()`. Generated into api-docs/components/. */
export const ref = (name: keyof typeof SCHEMAS) => ({ $ref: `#/components/schemas/${name}` });

const error = (code: string) => ({
  allOf: [{ $ref: '#/components/schemas/ErrorBody' }], example: { error: { code, message: '...', details: {} } },
});

export const SCHEMAS = {
  ErrorBody: {
    type: 'object', required: ['error'],
    properties: { error: { type: 'object', required: ['code', 'message', 'details'], properties: {
      code: { type: 'string', example: 'VALIDATION_ERROR' }, message: { type: 'string' }, details: { type: 'object' },
    } } },
  },
  Health: { type: 'object', required: ['db', 'postgis'], properties: { db: { type: 'string', enum: ['ok'] }, postgis: { type: 'string', example: '3.5' } } },
  SiteSummary: {
    type: 'object', required: ['code', 'name', 'province_code', 'area_rai', 'status', 'version'],
    properties: {
      code: { type: 'string', maxLength: 64, example: 'KBI-001' }, name: { type: 'string' },
      province_code: { type: 'string', example: '81' }, area_rai: { type: 'number', description: 'ไร่ ปัด 2 ตำแหน่ง' },
      status: { type: 'string', enum: [...SITE_STATUSES] }, version: { type: 'integer', minimum: 1 },
    },
  },
  SitesPage: {
    type: 'object', required: ['items', 'total', 'page'],
    properties: { items: { type: 'array', items: { $ref: '#/components/schemas/SiteSummary' } }, total: { type: 'integer' }, page: { type: 'integer' } },
  },
  LatestSurvey: {
    type: 'object', required: ['surveyed_on', 'average_cover_percent', 'count'],
    properties: { surveyed_on: { type: 'string', format: 'date' }, average_cover_percent: { type: 'number' }, count: { type: 'integer' } },
  },
  SiteFeature: {
    type: 'object', required: ['type', 'geometry', 'properties'],
    properties: {
      type: { type: 'string', enum: ['Feature'] },
      geometry: { type: 'object', description: 'GeoJSON MultiPolygon, SRID 4326, [lon,lat]' },
      properties: { allOf: [{ $ref: '#/components/schemas/SiteSummary' }, { type: 'object', required: ['id', 'latestSurvey'], properties: {
        id: { type: 'string', format: 'uuid' },
        latestSurvey: { allOf: [{ $ref: '#/components/schemas/LatestSurvey' }], nullable: true },
      } }] },
    },
  },
  SiteFeatureCollection: {
    type: 'object', required: ['type', 'features'],
    properties: { type: { type: 'string', enum: ['FeatureCollection'] }, features: { type: 'array', items: { $ref: '#/components/schemas/SiteFeature' } } },
  },
  User: {
    type: 'object', required: ['id', 'email', 'role'],
    properties: { id: { type: 'string', format: 'uuid' }, email: { type: 'string', format: 'email' }, role: { type: 'string', enum: ['viewer', 'editor', 'admin'] } },
  },
  LoginRequest: {
    type: 'object', required: ['email', 'password'], additionalProperties: false,
    properties: { email: { type: 'string', maxLength: 254, example: 'admin@demo.local' }, password: { type: 'string', maxLength: 256 } },
  },
  LoginResponse: {
    type: 'object', required: ['user', 'expires_in', 'expires_at'],
    properties: { user: { $ref: '#/components/schemas/User' }, expires_in: { type: 'integer', enum: [900] }, expires_at: { type: 'string', format: 'date-time' } },
  },
  MeResponse: {
    type: 'object', required: ['user', 'expires_at'],
    properties: { user: { $ref: '#/components/schemas/User' }, expires_at: { type: 'string', format: 'date-time' } },
  },
} as const;

export const errorResponse = (status: number, codes: string[]) =>
  ({ status, description: codes.join(' | '), schema: error(codes[0]) });
