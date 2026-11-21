'use client';

import { useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, NavigationControl, setWorkerUrl, type GeoJSONSource, type ExpressionSpecification } from 'maplibre-gl';
import { debounce, statuses, validBbox, type Bbox } from '../lib/map-state';
import { geometryBounds, type SiteFeature, type SitesGeoJSON } from '../lib/sites';

// Served from public/ by scripts/copy-maplibre-worker.mjs; the default URL is relative to the bundled chunk and 404s.
setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

const empty: SitesGeoJSON = { type: 'FeatureCollection', features: [] };
type Props = { data?: SitesGeoJSON; selection?: SiteFeature; onSelect: (code: string) => void; onViewport: (box: Bbox | null) => void };

export default function SiteMap({ data, selection, onSelect, onViewport }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const camera = useRef<{ center: [number, number]; zoom: number }>({ center: [99.2, 8.1], zoom: 6.2 });
  const fittedSelection = useRef<SiteFeature | undefined>(undefined);
  const callbacks = useRef({ onSelect, onViewport });
  callbacks.current = { onSelect, onViewport };
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState('');
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!container.current) return;
    setReady(false); setFailure('');
    callbacks.current.onViewport(null);
    const updateViewport = debounce(() => {
      const bounds = map.current?.getBounds();
      if (!bounds) return;
      const bbox = [Math.max(-180, bounds.getWest()), Math.max(-90, bounds.getSouth()), Math.min(180, bounds.getEast()), Math.min(90, bounds.getNorth())];
      if (validBbox(bbox)) callbacks.current.onViewport(bbox);
    });
    let instance: MapLibreMap;
    const erroredTiles = new Set<string>();
    try {
      instance = new MapLibreMap({ container: container.current, ...camera.current, renderWorldCopies: false,
        style: { version: 8, sources: {}, layers: [{ id: 'sea', type: 'background', paint: { 'background-color': '#e3eff2' } }] },
      });
      map.current = instance;
      instance.addControl(new NavigationControl({ showCompass: false }), 'top-right');
      instance.on('load', () => {
        instance.addSource('basemap', { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });
        instance.addLayer({ id: 'basemap', type: 'raster', source: 'basemap' });
        instance.addSource('sites', { type: 'geojson', data: empty });
        const colors: ExpressionSpecification = ['match', ['get', 'status'],
          'very_good', statuses.very_good.color, 'good', statuses.good.color,
          'fair', statuses.fair.color, 'poor', statuses.poor.color,
          statuses.no_data.color];
        instance.addLayer({ id: 'sites-fill', type: 'fill', source: 'sites', paint: { 'fill-color': colors, 'fill-opacity': 0.65 } });
        instance.addLayer({ id: 'sites-line', type: 'line', source: 'sites', paint: { 'line-color': '#183b43', 'line-width': 1.5 } });
        instance.addLayer({ id: 'selected', type: 'line', source: 'sites', filter: ['==', ['get', 'code'], ''], paint: { 'line-color': '#081c22', 'line-width': 4 } });
        instance.on('click', 'sites-fill', event => {
          const code = event.features?.[0]?.properties?.code;
          if (typeof code === 'string') callbacks.current.onSelect(code);
        });
        instance.on('mouseenter', 'sites-fill', () => { instance.getCanvas().style.cursor = 'pointer'; });
        instance.on('mouseleave', 'sites-fill', () => { instance.getCanvas().style.cursor = ''; });
        setReady(true); updateViewport.run(undefined);
      });
      instance.on('movestart', () => { callbacks.current.onViewport(null); updateViewport.cancel(); });
      instance.on('moveend', () => {
        camera.current = { center: instance.getCenter().toArray(), zoom: instance.getZoom() };
        updateViewport.run(undefined);
      });
      instance.on('error', event => {
        if ('sourceId' in event && event.sourceId === 'basemap') {
          const tile = (event as { tile?: { tileID: { key: string } } }).tile;
          erroredTiles.add(tile?.tileID.key ?? 'unknown');
          setFailure('โหลดแผนที่พื้นหลังไม่สำเร็จ ยังเลือกแหล่งจากตารางและอ่านรายละเอียดได้');
        } else console.error(event.error);
      });
      instance.on('sourcedata', event => {
        if (event.sourceId === 'basemap' && event.tile?.state === 'loaded') erroredTiles.delete(event.tile.tileID.key);
      });
      instance.on('idle', () => { if (!erroredTiles.size && instance.isSourceLoaded('basemap')) setFailure(''); });
    } catch {
      setFailure('อุปกรณ์นี้เปิดแผนที่ไม่ได้ ยังใช้ตารางและรายละเอียดได้');
      callbacks.current.onViewport(null);
    }
    const observer = new ResizeObserver(() => map.current?.resize());
    observer.observe(container.current);
    return () => {
      observer.disconnect(); updateViewport.cancel();
      if (map.current) camera.current = { center: map.current.getCenter().toArray(), zoom: map.current.getZoom() };
      map.current?.remove(); map.current = null;
    };
  }, [generation]);

  useEffect(() => {
    if (!ready || !data) return;
    (map.current?.getSource('sites') as GeoJSONSource | undefined)?.setData(data);
  }, [data, ready]);
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    instance.setFilter('selected', ['==', ['get', 'code'], selection?.properties.code ?? '']);
    if (selection && fittedSelection.current !== selection) {
      fittedSelection.current = selection;
      const bounds = geometryBounds(selection);
      if (validBbox(bounds)) instance.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 48, maxZoom: 14, duration: 500 });
    }
    if (!selection) fittedSelection.current = undefined;
  }, [selection, ready]);

  return <>
    {failure && <div className="map-warning" role="status">{failure} <button className="underline" onClick={() => setGeneration(value => value + 1)}>ลองเปิดแผนที่ใหม่</button></div>}
    {!ready && !failure && <p className="map-warning" role="status">กำลังเปิดแผนที่…</p>}
    <div ref={container} className="map-canvas" role="region" aria-label="แผนที่แหล่งหญ้าทะเล ใช้ปุ่มลูกศรเลื่อนแผนที่ หรือเลือกแหล่งจากตาราง" />
  </>;
}
