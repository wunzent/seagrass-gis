import assert from 'node:assert/strict';
import { test } from 'node:test';
import { popupArrow, clusterLabel, SURVEY_CLUSTER, ARROW_SIZE } from '../src/lib/map-overlay.ts';

test('popup arrow sits on the popup edge that faces the point and points at it', () => {
  const box = { x: 100, y: 20, width: 300, height: 200 };
  // Popup above the point: arrow on its bottom edge, pointing down.
  assert.deepEqual(popupArrow({ x: 250, y: 260 }, box), { side: 'above', left: 250 - ARROW_SIZE, top: 220 });
  // Popup below the point: arrow on its top edge, pointing up.
  assert.deepEqual(popupArrow({ x: 250, y: 5 }, { ...box, y: 19 }), {
    side: 'below',
    left: 250 - ARROW_SIZE,
    top: 19 - ARROW_SIZE,
  });
  // The arrow never leaves the popup's rounded corners, even when the point is beside the box.
  assert.equal(popupArrow({ x: 0, y: 300 }, box).left, 100 + 12 - ARROW_SIZE);
  assert.equal(popupArrow({ x: 999, y: 300 }, box).left, 400 - 12 - ARROW_SIZE);
  // A popup that covers the point (no room either side) shows no arrow.
  assert.equal(popupArrow({ x: 250, y: 100 }, box), null);
});

test('cluster labels give the count and the action', () => {
  assert.deepEqual(clusterLabel(3), { text: '3', aria: 'กลุ่มจุดสำรวจ 3 จุด คลิกเพื่อซูมเข้า', size: 'sm' });
  assert.equal(clusterLabel(10).size, 'md');
  assert.equal(clusterLabel(50).size, 'lg');
  assert.equal(clusterLabel(1200).text, '1,200');
});

test('survey clusters only while the 100 px scale bar spans about 30 km or more (zoom 9 and out)', () => {
  assert.deepEqual(SURVEY_CLUSTER, { cluster: true, clusterRadius: 40, clusterMaxZoom: 9 });
  // Web Mercator ground resolution at the Andaman sites (latitude 8°): 100 px at zoom 8 is >= 30 km, at zoom 10 < 30 km.
  const metresPer100px = (zoom) => (100 * 156543.03 * Math.cos((8 * Math.PI) / 180)) / 2 ** zoom;
  assert.ok(metresPer100px(SURVEY_CLUSTER.clusterMaxZoom) >= 30_000);
  assert.ok(metresPer100px(SURVEY_CLUSTER.clusterMaxZoom + 1) < 30_000);
});
