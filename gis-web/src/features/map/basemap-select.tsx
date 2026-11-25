'use client';

import { Label } from '../../components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from '../../components/ui/select';
import { BASEMAPS, isBasemap, type BasemapId } from '../../lib/basemaps';

export function BasemapSelect({ value, onChange }: { value: BasemapId; onChange: (value: BasemapId) => void }) {
  return (
    <div className="basemap-select">
      <Label htmlFor="basemap">แผนที่ฐาน</Label>
      <Select
        value={value}
        onValueChange={(next) => {
          if (isBasemap(next)) onChange(next);
        }}
      >
        <SelectTrigger id="basemap" className="bg-background" aria-label="แผนที่ฐาน">
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
    </div>
  );
}
