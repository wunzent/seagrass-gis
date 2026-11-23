'use client';

import { emptyFilters, statuses, type Filters } from '../../lib/map-state';

export function FiltersPanel({
  draft,
  provinces,
  change,
  validation,
}: {
  draft: Filters;
  provinces: Map<string, string>;
  change: (next: Partial<Filters>) => void;
  validation: string;
}) {
  return (
    <>
      <label>
        <span>จังหวัด</span>
        <select value={draft.province} onChange={(e) => change({ province: e.target.value })}>
          <option value="">ทุกจังหวัด</option>
          {Array.from(provinces, ([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
          {draft.province && !provinces.has(draft.province) && <option value={draft.province}>{draft.province}</option>}
        </select>
      </label>
      <label>
        <span>สถานะ</span>
        <select value={draft.status} onChange={(e) => change({ status: e.target.value })}>
          <option value="">ทุกสถานะ</option>
          {Object.entries(statuses).map(([value, item]) => (
            <option value={value} key={value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>ค้นหาแหล่ง</span>
        <input
          type="search"
          value={draft.q}
          maxLength={200}
          placeholder="ชื่อแหล่งหรือรหัส"
          onChange={(e) => change({ q: e.target.value })}
        />
      </label>
      <button type="button" className="text-button" onClick={() => change(emptyFilters)}>
        ล้างตัวกรอง
      </button>
      {validation && (
        <p className="filter-error" role="alert">
          {validation}
        </p>
      )}
    </>
  );
}
