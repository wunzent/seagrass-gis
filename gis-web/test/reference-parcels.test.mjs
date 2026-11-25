import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addReferenceParcels, setReferenceParcelsVisibility } from '../src/features/map/reference-parcels.ts';

test('reference parcel vector source uses same-origin tiles and starts hidden', () => {
  const calls = [];
  const map = {
    addSource: (...args) => calls.push(args),
    addLayer: (...args) => calls.push(args),
    setLayoutProperty: (...args) => calls.push(args),
  };
  addReferenceParcels(map, 'http://localhost:3200');
  const [[source, specification], [layer, before]] = calls;
  assert.equal(source, 'reference_parcels');
  assert.equal(specification.type, 'vector');
  assert.deepEqual(specification.tiles, ['http://localhost:3200/tiles/reference_parcels/{z}/{x}/{y}']);
  assert.equal(layer.source, source);
  assert.equal(layer['source-layer'], 'reference_parcels');
  assert.equal(layer.type, 'line');
  assert.equal(before, 'sites-fill');
  assert.equal(layer.layout.visibility, 'none');
  setReferenceParcelsVisibility(map, true);
  setReferenceParcelsVisibility(map, false);
  assert.deepEqual(calls.slice(2), [
    [layer.id, 'visibility', 'visible'],
    [layer.id, 'visibility', 'none'],
  ]);
});
