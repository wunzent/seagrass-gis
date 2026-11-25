import assert from 'node:assert/strict';
import { test } from 'node:test';
import { surveyScope, visibleSurveys } from '../src/lib/survey-visibility.ts';

test('survey visibility is gated by zoom 12, selected site and the layer toggle', () => {
  assert.equal(surveyScope(11.999, null, true), false);
  assert.equal(surveyScope(12, null, true), null);
  assert.equal(surveyScope(14, 'TRG-001', true), null);
  assert.equal(surveyScope(7, 'TRG-001', true), 'TRG-001');
  assert.equal(surveyScope(14, 'TRG-001', false), false);
});

test('only the selected site’s points show below zoom 12, including cached viewport data', () => {
  const data = {
    type: 'FeatureCollection',
    features: [{ properties: { site_code: 'TRG-001' } }, { properties: { site_code: 'KBI-003' } }],
  };
  assert.equal(visibleSurveys(data, null), data);
  assert.deepEqual(visibleSurveys(data, false).features, []);
  assert.deepEqual(visibleSurveys(data, 'KBI-003').features, [data.features[1]]);
});
