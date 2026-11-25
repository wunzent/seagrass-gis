'use client';

import { BASEMAPS, isBasemap, type BasemapId } from '../../lib/basemaps';

export function BasemapSelect({ value, onChange }: { value: BasemapId; onChange: (value: BasemapId) => void }) {
  return (
    <label className="basemap-select">
      <span>แผนที่ฐาน</span>
      <select
        aria-label="แผนที่ฐาน"
        value={value}
        onChange={(event) => {
          if (isBasemap(event.target.value)) onChange(event.target.value);
        }}
      >
        {Object.entries(BASEMAPS).map(([id, item]) => (
          <option key={id} value={id}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}
