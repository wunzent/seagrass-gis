// Pure helpers for what the map draws on top of the canvas: survey clusters and the popup arrow.

/**
 * Survey points within 40 px merge into a numbered cluster only while zoomed out to about a 30 km scale bar (zoom 9 and
 * out at latitude 8°: 100 px ≈ 30 km at zoom 9, 15 km at zoom 10). From zoom 10 every point and polygon shows on its own.
 */
export const SURVEY_CLUSTER = { cluster: true, clusterRadius: 40, clusterMaxZoom: 9 } as const;

/** Half the width of the popup arrow (a square rotated 45°), in px. */
export const ARROW_SIZE = 8;
const ARROW_INSET = 12; // keep the arrow off the popup's rounded corners

type Box = { x: number; y: number; width: number; height: number };

/**
 * Where the arrow from the popup to its point goes, in canvas pixels: on the bottom edge when the popup sits above the
 * point, on the top edge when it sits below. Null when the popup covers the point (nothing to point at).
 */
export function popupArrow(point: { x: number; y: number }, box: Box) {
  const left = Math.min(Math.max(point.x, box.x + ARROW_INSET), box.x + box.width - ARROW_INSET) - ARROW_SIZE;
  if (box.y + box.height <= point.y) return { side: 'above' as const, left, top: box.y + box.height };
  if (box.y >= point.y) return { side: 'below' as const, left, top: box.y - ARROW_SIZE };
  return null;
}

const count = new Intl.NumberFormat('en-US');

export function clusterLabel(points: number) {
  return {
    text: count.format(points),
    aria: `กลุ่มจุดสำรวจ ${points} จุด คลิกเพื่อซูมเข้า`,
    size: points < 10 ? 'sm' : points < 50 ? 'md' : 'lg',
  } as const;
}
