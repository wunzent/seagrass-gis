import type { Map } from 'maplibre-gl';

const SOURCE = 'reference_parcels';
const LAYER = 'reference-parcels-line';
export const REFERENCE_PARCELS_LABEL = 'แปลงอ้างอิง (ขั้น 9)';

export function addReferenceParcels(map: Pick<Map, 'addSource' | 'addLayer'>, origin: string) {
  map.addSource(SOURCE, {
    type: 'vector',
    tiles: [`${origin}/tiles/${SOURCE}/{z}/{x}/{y}`],
    minzoom: 7,
    maxzoom: 16,
  });
  map.addLayer(
    {
      id: LAYER,
      type: 'line',
      source: SOURCE,
      'source-layer': SOURCE,
      layout: { visibility: 'none' },
      paint: { 'line-color': '#57606A', 'line-opacity': 0.65, 'line-width': 1.15 },
    },
    'sites-fill',
  );
}

export function setReferenceParcelsVisibility(map: Pick<Map, 'setLayoutProperty'>, visible: boolean) {
  map.setLayoutProperty(LAYER, 'visibility', visible ? 'visible' : 'none');
}
