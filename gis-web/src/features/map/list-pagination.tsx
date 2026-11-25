'use client';

import { useRef, type FocusEvent, type RefObject } from 'react';
import { number } from '../../lib/map-format';
import { PAGE_SIZES } from '../../lib/map-state';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup } from '../../components/ui/select';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
} from '../../components/ui/pagination';

type Props = {
  page: number;
  pageSize: number;
  total: number;
  /** Shown page and its size, from the last response; `page` and `pageSize` are the ones asked for. */
  shownPage: number;
  shownPageSize: number;
  /** Disabled for interaction while loading or filters are invalid. */
  inert: boolean;
  loading: boolean;
  goTo: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  focus: {
    ref: RefObject<HTMLDivElement | null>;
    onFocusCapture: (event: FocusEvent<HTMLElement>) => void;
    onBlurCapture: (event: FocusEvent<HTMLElement>) => void;
    rememberSelection: (button: HTMLButtonElement | null) => void;
  };
};

export function ListPagination({
  page,
  pageSize,
  total,
  shownPage,
  shownPageSize,
  inert,
  loading,
  goTo,
  setPageSize,
  focus: { ref: paginationRef, onFocusCapture, onBlurCapture, rememberSelection },
}: Props) {
  const sizeTrigger = useRef<HTMLButtonElement>(null);
  const disabled = inert || loading;
  const first = total ? (shownPage - 1) * shownPageSize + 1 : 0;
  const last = Math.min(total, shownPage * shownPageSize);
  return (
    <div
      key="list-pagination"
      className="pagination"
      aria-label="หน้ารายการแหล่ง"
      ref={paginationRef}
      onFocusCapture={onFocusCapture}
      onBlurCapture={onBlurCapture}
    >
      <Select
        value={pageSize}
        disabled={disabled}
        onValueChange={(value) => {
          if (!disabled && value !== null && (PAGE_SIZES as readonly number[]).includes(value)) {
            rememberSelection(sizeTrigger.current);
            setPageSize(value);
          }
        }}
      >
        <SelectTrigger size="sm" ref={sizeTrigger} disabled={disabled} aria-label="จำนวนต่อหน้า">
          <SelectValue>{pageSize} ต่อหน้า</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={size}>
                {size} ต่อหน้า
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <small className="whitespace-nowrap text-sm text-muted-foreground" aria-live="polite" tabIndex={-1}>
        {number.format(first)}–{number.format(last)} จาก {number.format(total)}
      </small>
      <Pagination className="pagination-navigation mx-0 w-auto" aria-label="เปลี่ยนหน้ารายการแหล่ง">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              asButton
              type="button"
              text=""
              size="icon-sm"
              aria-label="หน้าก่อนหน้า"
              disabled={disabled || page <= 1}
              aria-disabled={disabled || page <= 1}
              onClick={() => {
                if (!disabled && page > 1) goTo(page - 1);
              }}
            />
          </PaginationItem>
          <PaginationItem>
            <PaginationNext
              asButton
              type="button"
              text=""
              size="icon-sm"
              aria-label="หน้าถัดไป"
              disabled={disabled || page * pageSize >= total}
              aria-disabled={disabled || page * pageSize >= total}
              onClick={() => {
                if (!disabled && page * pageSize < total) goTo(page + 1);
              }}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
