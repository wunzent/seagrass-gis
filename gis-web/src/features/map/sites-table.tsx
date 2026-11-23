'use client';

import type { ReactNode } from 'react';
import { area } from '../../lib/map-format';
import type { SiteList } from '../../lib/sites';
import { StatusLabel } from './map-ui';

export function SitesTable({
  loadingList,
  filterFields,
  total,
  listState,
  list,
  chooseSite,
  provinceName,
  pagination,
}: {
  loadingList: boolean;
  filterFields: ReactNode;
  total: string;
  listState: ReactNode;
  list: { data?: SiteList };
  chooseSite: (code: string) => void;
  provinceName: (code: string) => string;
  pagination: ReactNode;
}) {
  return (
    <section className="table-view" aria-labelledby="table-heading" aria-busy={loadingList}>
      <h2 id="table-heading" className="sr-only">
        ตารางแหล่งหญ้าทะเล
      </h2>
      <div className="table-toolbar">
        <section className="filters filters-row" aria-label="ตัวกรองแหล่งหญ้าทะเล">
          {filterFields}
        </section>
        <span className="table-total" aria-live="polite">
          {total}
        </span>
      </div>
      {listState}
      {list.data && list.data.items.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">รหัส</th>
                <th scope="col">ชื่อแหล่ง</th>
                <th scope="col">จังหวัด</th>
                <th scope="col" className="num">
                  พื้นที่ (ไร่)
                </th>
                <th scope="col">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((site) => (
                <tr key={site.code}>
                  <td className="site-code">{site.code}</td>
                  <td>
                    <button type="button" className="table-link" onClick={() => chooseSite(site.code)}>
                      {site.name}
                    </button>
                  </td>
                  <td>{provinceName(site.province_code)}</td>
                  <td className="num">{area.format(site.area_rai)}</td>
                  <td>
                    <StatusLabel status={site.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pagination}
    </section>
  );
}
