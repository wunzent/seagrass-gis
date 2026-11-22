'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type MapGeoJSONFeature,
  type PointLike,
  type GeoJSONSource,
  type ExpressionSpecification,
} from 'maplibre-gl';
import { debounce, POINT_STROKE, POINT_FILL, SITE_OUTLINE, statuses, validBbox, type Bbox } from '../lib/map-state';
import {
  geometryBounds,
  type ProvinceCollection,
  type SurveysGeoJSON,
  type SiteFeature,
  type SitesGeoJSON,
} from '../lib/sites';

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
  const placePopup = useRef(() => {
    const element = popupTarget.current;
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
    }
    element.style.transform = `translate(${Math.round(x)}px, ${Math.round(y + top)}px)`;
  });
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState('');
  const [generation, setGeneration] = useState(0);

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
    });
    let instance: MapLibreMap;
    const erroredTiles = new Set<string>();
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
      instance.addControl(new NavigationControl({ showCompass: false }), 'top-right');
      instance.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
      instance.on('load', () => {
        instance.addSource('basemap', {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          maxzoom: 19,
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        });
        instance.addLayer({
          id: 'basemap',
          type: 'raster',
          source: 'basemap',
        });
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
        instance.addSource('surveys', { type: 'geojson', data: empty });
        instance.addLayer({
          id: 'surveys-circle',
          type: 'circle',
          source: 'surveys',
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
          erroredTiles.add(tile?.tileID.key ?? 'unknown');
          setFailure('โหลดแผนที่พื้นหลังไม่สำเร็จ ยังเลือกแหล่งจากตารางและอ่านรายละเอียดได้');
        } else console.error(event.error);
      });
      instance.on('sourcedata', (event) => {
        if (event.sourceId === 'basemap' && event.tile?.state === 'loaded') erroredTiles.delete(event.tile.tileID.key);
      });
      instance.on('idle', () => {
        const covering = new Set(
          instance.coveringTiles({ tileSize: 256, maxzoom: 19, roundZoom: true }).map((tile) => tile.key),
        );
        for (const key of erroredTiles) if (key !== 'unknown' && !covering.has(key)) erroredTiles.delete(key);
        if (!erroredTiles.size && instance.isSourceLoaded('basemap')) setFailure('');
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
