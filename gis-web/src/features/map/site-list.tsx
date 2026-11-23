'use client';

import type { ReactNode, RefObject } from 'react';
import { statuses } from '../../lib/map-state';
import type { SiteList } from '../../lib/sites';
import { Swatch } from './map-ui';

export function SiteListPanel({
  loadingList,
  sitesHeading,
  total,
  listState,
  list,
  code,
  selectedRow,
  chooseSite,
  pagination,
}: {
  loadingList: boolean;
  sitesHeading: RefObject<HTMLHeadingElement | null>;
  total: string;
  listState: ReactNode;
  list: { data?: SiteList };
  code: string | null;
  selectedRow: RefObject<HTMLButtonElement | null>;
  chooseSite: (code: string) => void;
  pagination: ReactNode;
}) {
  return (
    <section className="site-list" aria-labelledby="sites-heading" aria-busy={loadingList}>
      <div className="list-heading">
        <h2 id="sites-heading" ref={sitesHeading} tabIndex={-1}>
          แหล่งหญ้าทะเล
        </h2>
        <span aria-live="polite">{total}</span>
      </div>
      {listState}
      {list.data && list.data.items.length > 0 && (
        <ul className="site-rows">
          {list.data.items.map((site) => (
            <li key={site.code} className={code === site.code ? 'selected-row' : ''}>
              <button
                type="button"
                ref={code === site.code ? selectedRow : undefined}
                className="site-button"
                aria-pressed={code === site.code}
                onClick={() => chooseSite(site.code)}
              >
                <span className="site-meta">
                  <span className="site-code">{site.code}</span>
                  <span>{(statuses[site.status] ?? statuses.no_data).label}</span>
                </span>
                <span className="site-name">
                  <Swatch status={statuses[site.status] ? site.status : 'no_data'} />
                  <span>{site.name}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {pagination}
    </section>
  );
}
