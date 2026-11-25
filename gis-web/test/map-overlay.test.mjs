import assert from 'node:assert/strict';
import { test } from 'node:test';
import { popupArrow, ARROW_SIZE } from '../src/lib/map-overlay.ts';

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
