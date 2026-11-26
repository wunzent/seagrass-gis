'use client';

import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
import { Input } from '../../components/ui/input';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from '../../components/ui/select';
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
      <div className="filter-field">
        <Label htmlFor="province-filter">จังหวัด</Label>
        <Select
          value={draft.province}
          onValueChange={(value) => {
            if (value !== null) change({ province: value });
          }}
        >
          <SelectTrigger id="province-filter" className="w-full" aria-label="จังหวัด">
            <SelectValue>{provinces.get(draft.province) ?? (draft.province || 'ทุกจังหวัด')}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="">ทุกจังหวัด</SelectItem>
              {Array.from(provinces, ([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
              {draft.province && !provinces.has(draft.province) && (
                <SelectItem value={draft.province}>{draft.province}</SelectItem>
              )}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="filter-field">
        <Label htmlFor="status-filter">สถานะ</Label>
        <Select
          value={draft.status}
          onValueChange={(value) => {
            if (value !== null) change({ status: value });
          }}
        >
          <SelectTrigger id="status-filter" className="w-full" aria-label="สถานะ">
            <SelectValue>{statuses[draft.status as keyof typeof statuses]?.label ?? 'ทุกสถานะ'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="">ทุกสถานะ</SelectItem>
              {Object.entries(statuses).map(([value, item]) => (
                <SelectItem value={value} key={value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="filter-field">
        <Label htmlFor="search-filter">ค้นหาแหล่ง</Label>
        <Input
          id="search-filter"
          type="search"
          value={draft.q}
          maxLength={200}
          placeholder="ชื่อแหล่งหรือรหัส"
          onChange={(e) => change({ q: e.target.value })}
        />
      </div>
      <Button
        variant="link"
        size="sm"
        className="justify-self-start in-[.sidebar]:px-0"
        onClick={() => change(emptyFilters)}
      >
        ล้างตัวกรอง
      </Button>
      {validation && (
        <div className="filter-error">
          <Alert variant="destructive">
            <AlertDescription>{validation}</AlertDescription>
          </Alert>
        </div>
      )}
    </>
  );
}
