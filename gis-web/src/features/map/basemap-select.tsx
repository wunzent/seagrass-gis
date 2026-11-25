'use client';

import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from '../../components/ui/select';
import { BASEMAPS, isBasemap, type BasemapId } from '../../lib/basemaps';

export function BasemapSelect({ value, onChange }: { value: BasemapId; onChange: (value: BasemapId) => void }) {
  return (
    <label className="basemap-select">
      <span>แผนที่ฐาน</span>
      <Select
        value={value}
        onValueChange={(next) => {
          if (isBasemap(next)) onChange(next);
        }}
      >
        <SelectTrigger aria-label="แผนที่ฐาน">
          <SelectValue>{BASEMAPS[value].label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {Object.entries(BASEMAPS).map(([id, item]) => (
              <SelectItem key={id} value={id}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </label>
  );
}
