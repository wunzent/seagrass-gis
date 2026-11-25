import { validBbox, type Bbox } from './map-state.ts';

export const MAP_GRID_DEGREES = 0.25;
export const MAP_CACHE_TTL_MS = 5 * 60 * 1000;
export const MAP_CACHE_MAX_ENTRIES = 200;

export function snapBbox(bbox: Bbox): Bbox {
  if (!validBbox(bbox)) throw new Error('ขอบเขตแผนที่ไม่ถูกต้อง');
  return bbox.map((value, index) => {
    const snap = index < 2 ? Math.floor : Math.ceil;
    return snap(value / MAP_GRID_DEGREES) * MAP_GRID_DEGREES || 0;
  }) as Bbox;
}

/** A mount owns its cache; clear also invalidates writes from requests already in flight. */
export function createMemoryCache({ now = Date.now }: { now?: () => number } = {}) {
  const entries = new Map<string, { value: unknown; expires: number }>();
  let generation = 0;
  return {
    get generation() {
      return generation;
    },
    get size() {
      return entries.size;
    },
    get<T>(key: string): T | undefined {
      const entry = entries.get(key);
      if (!entry) return;
      entries.delete(key);
      if (entry.expires <= now()) return;
      entries.set(key, entry);
      return entry.value as T;
    },
    set(key: string, value: unknown) {
      entries.delete(key);
      entries.set(key, { value, expires: now() + MAP_CACHE_TTL_MS });
      while (entries.size > MAP_CACHE_MAX_ENTRIES) entries.delete(entries.keys().next().value!);
    },
    clear() {
      entries.clear();
      generation++;
    },
  };
}
export type MemoryCache = ReturnType<typeof createMemoryCache>;
