'use client';

import type { FocusEvent, RefObject } from 'react';
import { number } from '../../lib/map-format';
import { PAGE_SIZES, pageCount } from '../../lib/map-state';

type Props = {
  page: number;
  pageSize: number;
  total: number;
  /** Shown page and its size, from the last response; `page` and `pageSize` are the ones asked for. */
  shownPage: number;
  shownPageSize: number;
  /** Disabled for interaction (loading or invalid filters) without moving focus. */
  inert: boolean;
  loading: boolean;
  goTo: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  focus: {
    ref: RefObject<HTMLElement | null>;
    onFocusCapture: (event: FocusEvent<HTMLElement>) => void;
    onBlurCapture: (event: FocusEvent<HTMLElement>) => void;
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
  focus,
}: Props) {
  const pages = pageCount(total, shownPageSize);
  const first = total ? (shownPage - 1) * shownPageSize + 1 : 0;
  const last = Math.min(total, shownPage * shownPageSize);
  return (
    <nav key="list-pagination" className="pagination" aria-label="หน้ารายการแหล่ง" {...focus}>
      <button
        type="button"
        className="text-button"
        disabled={!loading && page <= 1}
        aria-disabled={inert || page <= 1}
        onClick={() => {
          if (!inert && page > 1) goTo(page - 1);
        }}
      >
        ก่อนหน้า
      </button>
      <span tabIndex={-1}>
        หน้า {shownPage} / {pages}
      </span>
      <button
        type="button"
        className="text-button"
        disabled={!loading && page * pageSize >= total}
        aria-disabled={inert || page * pageSize >= total}
        onClick={() => {
          if (!inert && page * pageSize < total) goTo(page + 1);
        }}
      >
        ถัดไป
      </button>
      <div className="pagination-options">
        <small aria-live="polite">
          {number.format(first)}–{number.format(last)} จาก {number.format(total)}
        </small>
        <label>
          ไปหน้า
          <select
            aria-label="ไปหน้า"
            aria-disabled={inert}
            value={shownPage}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (!inert && Number.isInteger(next) && next >= 1 && next <= pages) goTo(next);
            }}
          >
            {Array.from({ length: pages }, (_, index) => (
              <option key={index + 1} value={index + 1}>
                {index + 1}
              </option>
            ))}
          </select>
        </label>
        <label>
          ต่อหน้า
          <select
            aria-label="จำนวนต่อหน้า"
            aria-disabled={inert}
            value={pageSize}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (!inert && (PAGE_SIZES as readonly number[]).includes(next)) setPageSize(next);
            }}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>
    </nav>
  );
}
