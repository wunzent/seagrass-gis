'use client';

import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type PointLike,
} from 'maplibre-gl';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  debounce,
  VIEWPORT_DEBOUNCE_MS,
  POINT_FILL,
  POINT_STROKE,
  SITE_OUTLINE,
  statuses,
  validBbox,
  type Bbox,
} from '../../lib/map-state';
import {
  geometryBounds,
  type ProvinceCollection,
  type SiteFeature,
  type SitesGeoJSON,
  type SurveysGeoJSON,
} from '../../lib/sites';
import { clusterLabel, popupArrow, SURVEY_CLUSTER } from '../../lib/map-overlay';
import { BASEMAPS, DEFAULT_BASEMAP, basemapOverlaySources, basemapSource, type BasemapId } from '../../lib/basemaps';

// Served from public/ by scripts/copy-maplibre-worker.mjs; the default URL is relative to the bundled chunk and 404s.
setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

const empty: SitesGeoJSON = { type: 'FeatureCollection', features: [] };
type Props = {
  data?: SitesGeoJSON;
  provinces?: ProvinceCollection;
  surveys?: SurveysGeoJSON;
  selection?: SiteFeature;
  onSelect: (code: string) => void;
  onViewport: (box: Bbox | null) => void;
  onDisplayChange?: (displayed: boolean, layer?: 'sites' | 'surveys') => void;
  onAvailabilityChange?: (available: boolean) => void;
  onDeselect?: () => void;
  onSelectSurvey?: (id: string) => void;
  selectedSurveyId?: string | null;
  /** Detail popup rendered by the parent inside the map container; positioned here at the selected location. */
  popupElement?: HTMLElement | null;
  /** `site:<code>` or `survey:<id>`; a survey popup carries its own point. */
  popup?: { key: string; point?: [number, number] } | null;
  /** Raster basemap under the data layers; switching keeps the map, its camera and its data. */
  basemap?: BasemapId;
};

/** A survey point within this many pixels of a click wins over the polygon under it. */
export const POINT_HIT_RADIUS = 8;
const idFilter = (id: string): ExpressionSpecification => ['==', ['to-string', ['get', 'id']], id];
const SITE_LAYERS = ['sites-fill', 'sites-nodata'];

function hatchImage() {
  // 8px diagonal ink hatch on paper, the no_data fill (see wireframe Visual Direction).
  const size = 8;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const line = (x + y) % size < 2;
      data.set(line ? [138, 143, 148, 255] : [242, 238, 228, 235], (y * size + x) * 4);
    }
  return { width: size, height: size, data };
}

const OVERLAY_PREFIX = 'basemap-overlay-';

/** Adds the basemap and its overlays (same id for source and layer), below `before` when given. */
function addBasemap(instance: MapLibreMap, id: BasemapId, before?: string) {
  instance.addSource('basemap', basemapSource(id));
  instance.addLayer({ id: 'basemap', type: 'raster', source: 'basemap' }, before);
  basemapOverlaySources(id).forEach((source, index) => {
    const layer = OVERLAY_PREFIX + index;
    instance.addSource(layer, source);
    instance.addLayer({ id: layer, type: 'raster', source: layer }, before);
  });
}

function removeBasemap(instance: MapLibreMap, id: BasemapId) {
  for (let index = basemapOverlaySources(id).length - 1; index >= 0; index--) {
    instance.removeLayer(OVERLAY_PREFIX + index);
    instance.removeSource(OVERLAY_PREFIX + index);
  }
  instance.removeLayer('basemap');
  instance.removeSource('basemap');
}

const BASEMAP_FAILURE = 'โหลดแผนที่พื้นหลังไม่สำเร็จ ยังเลือกแหล่งจากตารางและอ่านรายละเอียดได้';

const POPUP_GAP = 14;
const POPUP_MARGIN = 8;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export default function SiteMap({
  data,
  provinces,
  surveys,
  selection,
  onSelect,
  onViewport,
  onDisplayChange,
  onAvailabilityChange,
  onDeselect,
  onSelectSurvey,
  selectedSurveyId = null,
  popupElement = null,
  popup = null,
  basemap = DEFAULT_BASEMAP,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const camera = useRef<{ center: [number, number]; zoom: number }>({ center: [98.75, 7.85], zoom: 7.3 });
  const fittedSelection = useRef<SiteFeature | undefined>(undefined);
  const pendingFit = useRef<() => void>(() => {});
  // Where the popup points: the clicked location for map clicks, else the selection's bounds centre.
  const lastClick = useRef<{ key: string; lngLat: [number, number] } | null>(null);
  const anchor = useRef<[number, number] | null>(null);
  const selectedSurvey = useRef(selectedSurveyId);
  const callbacks = useRef({ onSelect, onViewport, onDisplayChange, onAvailabilityChange, onDeselect, onSelectSurvey });
  // eslint-disable-next-line react-hooks/refs -- intentional: latest-callback ref pattern keeps map listeners stable
  callbacks.current = { onSelect, onViewport, onDisplayChange, onAvailabilityChange, onDeselect, onSelectSurvey };
  const popupTarget = useRef(popupElement);
  // eslint-disable-next-line react-hooks/refs -- intentional: map move listeners read the latest popup element
  popupTarget.current = popupElement;
  // The popup is never hidden: without a usable map or anchor (map failed, details still loading or failed)
  // it sits at the canvas's top-left so details, loading text and retry stay reachable.
  // Arrow from the popup to its anchor; an element inside the map container, created with the map.
  const arrowElement = useRef<HTMLElement | null>(null);
  const placePopup = useRef(() => {
    const element = popupTarget.current;
    const arrow = arrowElement.current;
    if (arrow) arrow.hidden = true;
    if (!element) return;
    const instance = map.current;
    const box = instance?.getContainer() ?? container.current;
    // Offset by the canvas position inside the map container (a warning banner can sit above it).
    const top = container.current?.offsetTop ?? 0;
    if (box?.clientHeight) element.style.maxHeight = `${Math.max(0, box.clientHeight - 2 * POPUP_MARGIN)}px`;
    let x = POPUP_MARGIN;
    let y = POPUP_MARGIN;
    if (instance && anchor.current && box?.clientWidth && box.clientHeight) {
      const point = instance.project(anchor.current);
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const maxY = box.clientHeight - height - POPUP_MARGIN;
      x = clamp(point.x - width / 2, POPUP_MARGIN, box.clientWidth - width - POPUP_MARGIN);
      const above = point.y - height - POPUP_GAP;
      y = above >= POPUP_MARGIN ? clamp(above, POPUP_MARGIN, maxY) : clamp(point.y + POPUP_GAP, POPUP_MARGIN, maxY);
      const place = arrow && popupArrow(point, { x, y, width, height });
      if (arrow && place) {
        arrow.className = `map-popup-arrow ${place.side}`;
        arrow.style.transform = `translate(${Math.round(place.left)}px, ${Math.round(place.top)}px)`;
        arrow.hidden = false;
      }
    }
    element.style.transform = `translate(${Math.round(x)}px, ${Math.round(y + top)}px)`;
  });
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState('');
  const [generation, setGeneration] = useState(0);
  // The basemap wanted now and the one the current map draws; a new map (retry) loads the wanted one.
  const wantedBasemap = useRef(basemap);
  // eslint-disable-next-line react-hooks/refs -- intentional: the load listener reads the latest choice
  wantedBasemap.current = basemap;
  const drawnBasemap = useRef<BasemapId | null>(null);
  const erroredTiles = useRef(new Set<string>());

  useEffect(() => {
    if (!container.current) return;
    setReady(false);
    setFailure('');
    callbacks.current.onDisplayChange?.(false);
    callbacks.current.onAvailabilityChange?.(true);
    callbacks.current.onViewport(null);
    const updateViewport = debounce(() => {
      const bounds = map.current?.getBounds();
      if (!bounds) return;
      const bbox = [
        Math.max(-180, bounds.getWest()),
        Math.max(-90, bounds.getSouth()),
        Math.min(180, bounds.getEast()),
        Math.min(90, bounds.getNorth()),
      ];
      if (validBbox(bbox)) callbacks.current.onViewport(bbox);
    }, VIEWPORT_DEBOUNCE_MS);
    let instance: MapLibreMap;
    const errored = new Set<string>();
    erroredTiles.current = errored;
    drawnBasemap.current = null;
    try {
      instance = new MapLibreMap({
        container: container.current,
        ...camera.current,
        renderWorldCopies: false,
        style: {
          version: 8,
          sources: {},
          layers: [{ id: 'sea', type: 'background', paint: { 'background-color': '#DCE7EA' } }],
        },
      });
      map.current = instance;
      const mapBox = instance.getContainer();
      const documentOf = mapBox.ownerDocument;
      const arrow = documentOf.createElement('div');
      arrow.className = 'map-popup-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.hidden = true;
      mapBox.appendChild(arrow);
      arrowElement.current = arrow;
      instance.addControl(new NavigationControl({ showCompass: false }), 'top-right');
      instance.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
      instance.on('load', () => {
        drawnBasemap.current = wantedBasemap.current;
        addBasemap(instance, drawnBasemap.current);
        instance.addSource('provinces', { type: 'geojson', data: empty });
        instance.addLayer({
          id: 'provinces-line',
          type: 'line',
          source: 'provinces',
          paint: { 'line-color': '#8A7F68', 'line-width': 1.2, 'line-dasharray': [3, 2] },
        });
        instance.addSource('sites', { type: 'geojson', data: empty });
        const colors: ExpressionSpecification = [
          'match',
          ['get', 'status'],
          'very_good',
          statuses.very_good.color,
          'good',
          statuses.good.color,
          'fair',
          statuses.fair.color,
          'poor',
          statuses.poor.color,
          statuses.no_data.color,
        ];
        instance.addLayer({
          id: 'sites-fill',
          type: 'fill',
          source: 'sites',
          filter: ['!=', ['get', 'status'], 'no_data'],
          paint: { 'fill-color': colors, 'fill-opacity': 0.78 },
        });
        let hatch = true;
        try {
          instance.addImage('no-data-hatch', hatchImage());
        } catch {
          hatch = false; // A missing pattern draws nothing, so fall back to the plain paper fill.
        }
        instance.addLayer({
          id: 'sites-nodata',
          type: 'fill',
          source: 'sites',
          filter: ['==', ['get', 'status'], 'no_data'],
          paint: hatch
            ? { 'fill-pattern': 'no-data-hatch', 'fill-opacity': 0.9 }
            : { 'fill-color': statuses.no_data.color, 'fill-opacity': 0.9 },
        });
        instance.addLayer({
          id: 'sites-line',
          type: 'line',
          source: 'sites',
          paint: { 'line-color': SITE_OUTLINE, 'line-width': 1.2 },
        });
        instance.addLayer({
          id: 'selected',
          type: 'line',
          source: 'sites',
          filter: ['==', ['get', 'code'], ''],
          paint: { 'line-color': POINT_STROKE, 'line-width': 3.5 },
        });
        instance.addSource('surveys', { type: 'geojson', data: empty, ...SURVEY_CLUSTER });
        instance.addLayer({
          id: 'surveys-circle',
          type: 'circle',
          source: 'surveys',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': POINT_FILL,
            'circle-radius': 4.5,
            'circle-stroke-color': POINT_STROKE,
            'circle-stroke-width': 1.5,
          },
        });
        instance.addLayer({
          id: 'surveys-hover',
          type: 'circle',
          source: 'surveys',
          filter: idFilter(''),
          paint: {
            'circle-color': POINT_FILL,
            'circle-radius': 7,
            'circle-stroke-color': POINT_STROKE,
            'circle-stroke-width': 2,
          },
        });
        instance.addLayer({
          id: 'surveys-selected',
          type: 'circle',
          source: 'surveys',
          filter: idFilter(selectedSurvey.current ?? ''),
          paint: {
            'circle-color': POINT_STROKE,
            'circle-radius': 6.5,
            'circle-stroke-color': POINT_FILL,
            'circle-stroke-width': 2,
          },
        });
        // A point within POINT_HIT_RADIUS px beats the polygon under it; among several, the nearest to the cursor wins.
        const nearestPoint = (point: { x: number; y: number }) => {
          const box: [PointLike, PointLike] = [
            [point.x - POINT_HIT_RADIUS, point.y - POINT_HIT_RADIUS],
            [point.x + POINT_HIT_RADIUS, point.y + POINT_HIT_RADIUS],
          ];
          let best: { feature: MapGeoJSONFeature; distance: number } | null = null;
          for (const feature of instance.queryRenderedFeatures(box, { layers: ['surveys-circle'] })) {
            const coordinates = (feature.geometry as { coordinates?: [number, number] }).coordinates;
            const at = coordinates ? instance.project(coordinates) : point;
            const distance = Math.hypot(at.x - point.x, at.y - point.y);
            if (distance <= POINT_HIT_RADIUS && (!best || distance < best.distance)) best = { feature, distance };
          }
          return best?.feature;
        };
        const siteAt = (point: { x: number; y: number }) =>
          instance.queryRenderedFeatures([point.x, point.y], { layers: SITE_LAYERS })[0]?.properties?.code;
        instance.on('click', (event) => {
          const id = nearestPoint(event.point)?.properties?.id;
          if (id !== undefined && id !== null) {
            callbacks.current.onSelectSurvey?.(String(id));
            return;
          }
          const code = siteAt(event.point);
          if (typeof code === 'string') {
            const lngLat = event.lngLat?.toArray?.();
            lastClick.current = lngLat ? { key: 'site:' + code, lngLat: [lngLat[0], lngLat[1]] } : null;
            callbacks.current.onSelect(code);
          } else callbacks.current.onDeselect?.();
        });
        instance.on('mousemove', (event) => {
          const survey = nearestPoint(event.point);
          const id = survey?.properties?.id;
          instance.setFilter('surveys-hover', idFilter(id === undefined || id === null ? '' : String(id)));
          instance.getCanvas().style.cursor = survey || siteAt(event.point) ? 'pointer' : '';
        });
        instance.on('mouseout', () => instance.setFilter('surveys-hover', idFilter('')));
        // Clusters are numbered buttons (HTML markers: the style has no glyphs for map text); a click zooms in.
        const clusterMarkers = new Map<number, Marker>();
        instance.on('render', () => {
          const seen = new Set<number>();
          for (const feature of instance.querySourceFeatures('surveys', { filter: ['has', 'point_count'] })) {
            const clusterId = feature.properties?.cluster_id;
            const coordinates = (feature.geometry as { coordinates?: [number, number] }).coordinates;
            if (typeof clusterId !== 'number' || seen.has(clusterId) || !coordinates) continue;
            seen.add(clusterId);
            if (clusterMarkers.has(clusterId)) continue;
            const label = clusterLabel(Number(feature.properties?.point_count));
            const button = documentOf.createElement('button');
            button.setAttribute('type', 'button');
            button.className = `survey-cluster ${label.size}`;
            button.textContent = label.text;
            button.setAttribute('aria-label', label.aria);
            button.addEventListener('click', (event) => {
              event.stopPropagation();
              // One click shows the whole group: fit all its points and zoom at least past the clustering zoom.
              void (instance.getSource('surveys') as GeoJSONSource)
                .getClusterLeaves(clusterId, Infinity, 0)
                .then((leaves) => {
                  const points = leaves
                    .map((leaf) => (leaf.geometry as { coordinates?: [number, number] }).coordinates)
                    .filter((point): point is [number, number] => Array.isArray(point));
                  if (!points.length) points.push(coordinates);
                  const lons = points.map((point) => point[0]);
                  const lats = points.map((point) => point[1]);
                  const camera = instance.cameraForBounds(
                    [
                      [Math.min(...lons), Math.min(...lats)],
                      [Math.max(...lons), Math.max(...lats)],
                    ],
                    { padding: 60, maxZoom: 14 },
                  );
                  instance.easeTo({
                    center:
                      (camera?.center as { toArray?: () => [number, number] } | undefined)?.toArray?.() ?? coordinates,
                    zoom: Math.max(camera?.zoom ?? 0, SURVEY_CLUSTER.clusterMaxZoom + 1),
                  });
                })
                .catch(() => undefined);
            });
            clusterMarkers.set(clusterId, new Marker({ element: button }).setLngLat(coordinates).addTo(instance));
          }
          for (const [clusterId, marker] of clusterMarkers)
            if (!seen.has(clusterId)) {
              marker.remove();
              clusterMarkers.delete(clusterId);
            }
        });
        setReady(true);
        updateViewport.run(undefined);
      });
      instance.on('movestart', () => {
        callbacks.current.onViewport(null);
        updateViewport.cancel();
      });
      instance.on('move', () => placePopup.current());
      instance.on('moveend', () => {
        camera.current = { center: instance.getCenter().toArray(), zoom: instance.getZoom() };
        updateViewport.run(undefined);
      });
      instance.on('error', (event) => {
        if ('sourceId' in event && event.sourceId === 'basemap') {
          const tile = (event as { tile?: { tileID: { key: string } } }).tile;
          errored.add(tile?.tileID.key ?? 'unknown');
          setFailure(BASEMAP_FAILURE);
          // A missing road/label overlay tile leaves the imagery usable, so it raises no warning.
        } else if (!('sourceId' in event && String(event.sourceId).startsWith(OVERLAY_PREFIX)))
          console.error(event.error);
      });
      instance.on('sourcedata', (event) => {
        if (event.sourceId === 'basemap' && event.tile?.state === 'loaded') errored.delete(event.tile.tileID.key);
      });
      instance.on('idle', () => {
        const covering = new Set(
          instance
            .coveringTiles({
              tileSize: 256,
              maxzoom: BASEMAPS[drawnBasemap.current ?? DEFAULT_BASEMAP].maxzoom,
              roundZoom: true,
            })
            .map((tile) => tile.key),
        );
        for (const key of errored) if (key !== 'unknown' && !covering.has(key)) errored.delete(key);
        if (!errored.size && instance.isSourceLoaded('basemap')) setFailure('');
      });
    } catch {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: map init failure is reported once from the mount effect
      setFailure('อุปกรณ์นี้เปิดแผนที่ไม่ได้ ยังใช้ตารางและรายละเอียดได้');
      callbacks.current.onViewport(null);
      callbacks.current.onAvailabilityChange?.(false);
    }
    const observer = new ResizeObserver(() => {
      map.current?.resize();
      pendingFit.current();
      placePopup.current();
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      updateViewport.cancel();
      if (map.current) camera.current = { center: map.current.getCenter().toArray(), zoom: map.current.getZoom() };
      map.current?.remove();
      map.current = null;
    };
  }, [generation]);

  useEffect(() => {
    const instance = map.current;
    const drawn = drawnBasemap.current;
    if (!ready || !instance || drawn === basemap || drawn === null) return;
    // Swap only the raster source; the data layers, camera and popup stay as they are.
    removeBasemap(instance, drawn);
    addBasemap(instance, basemap, 'provinces-line');
    drawnBasemap.current = basemap;
    erroredTiles.current.clear();
    setFailure((current) => (current === BASEMAP_FAILURE ? '' : current));
  }, [basemap, ready]);

  useEffect(() => {
    if (!ready || !data) return;
    (map.current?.getSource('sites') as GeoJSONSource | undefined)?.setData(data);
    callbacks.current.onDisplayChange?.(true, 'sites');
  }, [data, ready]);
  useEffect(() => {
    if (!ready || !provinces) return;
    (map.current?.getSource('provinces') as GeoJSONSource | undefined)?.setData(provinces);
  }, [provinces, ready]);
  useEffect(() => {
    if (!ready || !surveys) return;
    (map.current?.getSource('surveys') as GeoJSONSource | undefined)?.setData(surveys);
    callbacks.current.onDisplayChange?.(true, 'surveys');
  }, [surveys, ready]);
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    instance.setFilter('selected', ['==', ['get', 'code'], selection?.properties.code ?? '']);
    if (!selection) fittedSelection.current = undefined;
    const fit = () => {
      if (!selection || fittedSelection.current === selection || map.current !== instance) return;
      // A hidden map (mobile list tab) has a zero-size canvas and MapLibre skips the camera move; retry on resize.
      const box = instance.getContainer();
      if (!box.clientWidth || !box.clientHeight) return;
      fittedSelection.current = selection;
      const bounds = geometryBounds(selection);
      if (validBbox(bounds))
        instance.fitBounds(
          [
            [bounds[0], bounds[1]],
            [bounds[2], bounds[3]],
          ],
          { padding: 48, maxZoom: 14, duration: 500 },
        );
    };
    pendingFit.current = fit;
    fit();
  }, [selection, ready]);

  useEffect(() => {
    selectedSurvey.current = selectedSurveyId;
    if (ready) map.current?.setFilter('surveys-selected', idFilter(selectedSurveyId ?? ''));
  }, [selectedSurveyId, ready]);

  // Anchor the popup: a survey's own point, the clicked location for a polygon click, else the selection centre.
  // Re-place it whenever it opens, its content resizes or the map moves.
  const popupKey = popup?.key ?? null;
  const popupLng = popup?.point?.[0];
  const popupLat = popup?.point?.[1];
  useLayoutEffect(() => {
    if (lastClick.current?.key !== popupKey) lastClick.current = null;
    const click = lastClick.current;
    const siteCode = popupKey?.startsWith('site:') ? popupKey.slice(5) : null;
    if (!popupKey) anchor.current = null;
    else if (popupLng !== undefined && popupLat !== undefined) anchor.current = [popupLng, popupLat];
    else if (click) anchor.current = click.lngLat;
    else if (siteCode && selection?.properties.code === siteCode) {
      const bounds = geometryBounds(selection);
      anchor.current = validBbox(bounds) ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] : null;
    } else anchor.current = null;
    placePopup.current();
    if (!popupElement) return;
    const observer = new ResizeObserver(() => placePopup.current());
    observer.observe(popupElement);
    return () => observer.disconnect();
  }, [popupKey, popupLng, popupLat, popupElement, selection, ready, failure]);

  return (
    <>
      {failure && (
        <div className="map-warning" role="status">
          {failure}{' '}
          <button type="button" className="text-button" onClick={() => setGeneration((value) => value + 1)}>
            ลองเปิดแผนที่ใหม่
          </button>
        </div>
      )}
      {!ready && !failure && (
        <p className="map-warning" role="status">
          กำลังเปิดแผนที่…
        </p>
      )}
      <div
        ref={container}
        className="map-canvas"
        role="region"
        aria-label="แผนที่แหล่งหญ้าทะเล ใช้ปุ่มลูกศรเลื่อนแผนที่ หรือเลือกแหล่งจากตาราง"
      />
    </>
  );
}
