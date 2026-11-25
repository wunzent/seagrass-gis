'use client';

import type { ReactNode } from 'react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/table';
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">รหัส</TableHead>
                <TableHead scope="col">ชื่อแหล่ง</TableHead>
                <TableHead scope="col">จังหวัด</TableHead>
                <TableHead scope="col" className="num">
                  พื้นที่ (ไร่)
                </TableHead>
                <TableHead scope="col">สถานะ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((site) => (
                <TableRow key={site.code}>
                  <TableCell className="site-code">{site.code}</TableCell>
                  <TableCell>
                    <button type="button" className="table-link" onClick={() => chooseSite(site.code)}>
                      {site.name}
                    </button>
                  </TableCell>
                  <TableCell>{provinceName(site.province_code)}</TableCell>
                  <TableCell className="num">{area.format(site.area_rai)}</TableCell>
                  <TableCell>
                    <StatusLabel status={site.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {pagination}
    </section>
  );
}
