// Raster basemaps the map can switch between. Every tile host here is also allowed by the CSP in next.config.ts.
export const BASEMAPS = {
  streets: {
    label: 'แผนที่ถนน',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    maxzoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    overlays: [],
  },
  satellite: {
    label: 'ภาพดาวเทียม',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    maxzoom: 19,
    attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    // Transparent Esri reference tiles drawn over the imagery: roads, then boundaries and place names.
    overlays: [
      {
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
        ],
      },
      {
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        ],
      },
    ],
  },
} as const;

export type BasemapId = keyof typeof BASEMAPS;
export const DEFAULT_BASEMAP: BasemapId = 'streets';
export const BASEMAP_STORAGE_KEY = 'gis-basemap';

export const TILE_HOSTS: readonly string[] = [
  ...new Set(
    Object.values(BASEMAPS).flatMap((item) =>
      [...item.tiles, ...item.overlays.flatMap((overlay) => overlay.tiles)].map((url) => new URL(url).origin),
    ),
  ),
];

export function isBasemap(value: unknown): value is BasemapId {
  return typeof value === 'string' && Object.hasOwn(BASEMAPS, value);
}

export function basemapSource(id: BasemapId) {
  const { tiles, maxzoom, attribution } = BASEMAPS[id];
  return { type: 'raster' as const, tiles: [...tiles], tileSize: 256, maxzoom, attribution };
}

/** Label/road layers drawn on top of a basemap, in order; their attribution is the basemap's. */
export function basemapOverlaySources(id: BasemapId) {
  const { overlays, maxzoom } = BASEMAPS[id];
  return overlays.map((overlay) => ({ type: 'raster' as const, tiles: [...overlay.tiles], tileSize: 256, maxzoom }));
}

/** The basemap this browser chose last; storage can be missing or blocked, so any failure means the default. */
export function readBasemap(storage: () => Storage | undefined): BasemapId {
  try {
    const value = storage()?.getItem(BASEMAP_STORAGE_KEY);
    return isBasemap(value) ? value : DEFAULT_BASEMAP;
  } catch {
    return DEFAULT_BASEMAP;
  }
}

export function saveBasemap(storage: () => Storage | undefined, id: BasemapId) {
  try {
    storage()?.setItem(BASEMAP_STORAGE_KEY, id);
  } catch {
    // A per-browser convenience only: the map works the same without it.
  }
}
