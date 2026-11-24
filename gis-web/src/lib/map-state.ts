// Bright survey marks follow gis-web/DESIGN.md.
export const POINT_STROKE = '#0077B6';
export const POINT_FILL = '#FFFFFF';
export const SITE_OUTLINE = '#1B2A3A';

// Sequential seagrass greens follow cover %; no_data is drawn hatched so it never reads as the lowest level.
export const statuses = {
  very_good: { label: 'ดีมาก', color: '#1E5A3C', range: '75% ขึ้นไป' },
  good: { label: 'ดี', color: '#3E8A55', range: '50 ถึง 74%' },
  fair: { label: 'ปานกลาง', color: '#8DBF73', range: '25 ถึง 49%' },
  poor: { label: 'เสื่อมโทรม', color: '#D9E8B8', range: 'ต่ำกว่า 25%' },
  no_data: { label: 'ไม่มีข้อมูลสำรวจ', color: '#F2EEE4', range: '' },
} as const;

export type Status = keyof typeof statuses;
export type Filters = { province: string; status: string; q: string };
export type ListState = { filters: Filters; page: number };
export type Bbox = [number, number, number, number];
export const emptyFilters: Filters = { province: '', status: '', q: '' };
export const PAGE_SIZE = 20;
export const ROUNDS_PAGE_SIZE = 100;

export function filterState(state: ListState, change: Partial<Filters>): ListState {
  const filters = { ...state.filters, ...change };
  if (
    (filters.status && !Object.hasOwn(statuses, filters.status)) ||
    (filters.province && !/^\d{2}$/.test(filters.province)) ||
    filters.q.length > 200 ||
    /[\u0000\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(filters.q)
  ) {
    throw new Error('กรุณาตรวจสอบตัวกรอง (คำค้นไม่เกิน 200 ตัวอักษร)');
  }
  return { filters, page: 1 };
}

function filterQuery(filters: Filters) {
  const query = new URLSearchParams();
  for (const key of ['province', 'status', 'q'] as const) if (filters[key]) query.set(key, filters[key]);
  return query;
}
export function listQuery(state: ListState) {
  const query = new URLSearchParams({ page: String(state.page), pageSize: String(PAGE_SIZE) });
  filterQuery(state.filters).forEach((value, key) => query.set(key, value));
  return query.toString();
}
export function validBbox(box: number[]): box is Bbox {
  return (
    box.length === 4 &&
    box.every(Number.isFinite) &&
    box[0] >= -180 &&
    box[2] <= 180 &&
    box[1] >= -90 &&
    box[3] <= 90 &&
    box[0] < box[2] &&
    box[1] < box[3]
  );
}
export function mapQuery(filters: Filters, box: Bbox) {
  if (!validBbox(box)) throw new Error('ขอบเขตแผนที่ไม่ถูกต้อง');
  const query = filterQuery(filters);
  query.set('bbox', box.join(','));
  return query.toString();
}
export function latestRequest() {
  let id = 0;
  let controller: AbortController | undefined;
  return {
    start() {
      controller?.abort();
      controller = new AbortController();
      const requestId = ++id;
      const signal = controller.signal;
      return { signal, current: () => requestId === id && !signal.aborted };
    },
    cancel() {
      ++id;
      controller?.abort();
    },
  };
}
/** Wait after the map stops moving before asking the API for the new bbox, so quick successive pans send one request. */
export const VIEWPORT_DEBOUNCE_MS = 600;
export function debounce<T>(callback: (value: T) => void, delay = 300) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    run(value: T) {
      clearTimeout(timer);
      timer = setTimeout(() => callback(value), delay);
    },
    cancel() {
      clearTimeout(timer);
    },
  };
}
