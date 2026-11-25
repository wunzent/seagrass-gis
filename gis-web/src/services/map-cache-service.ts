import type { MemoryCache } from '../lib/map-cache.ts';
import { fetchJson } from './http-client.ts';

export async function fetchMapLayer<T>(key: string, signal: AbortSignal, cache?: MemoryCache): Promise<T> {
  signal.throwIfAborted();
  const cached = cache?.get<T>(key);
  if (cached !== undefined) return cached;
  const generation = cache?.generation;
  const data = await fetchJson<T>(key, signal);
  signal.throwIfAborted();
  if (cache?.generation === generation) cache?.set(key, data);
  return data;
}
