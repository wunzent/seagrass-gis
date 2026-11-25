'use client';

import type { ReactNode, RefObject } from 'react';
import { Button } from '../../components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/card';
import { statuses } from '../../lib/map-state';
import type { SiteList } from '../../lib/sites';
import { StatusLabel, Swatch } from './map-ui';

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
      <Card className="site-list-card [--card-spacing:0px] gap-0 overflow-visible rounded-none bg-background ring-0">
        <CardHeader className="list-heading flex items-baseline justify-between">
          <CardTitle>
            <h2 id="sites-heading" ref={sitesHeading} tabIndex={-1}>
              แหล่งหญ้าทะเล
            </h2>
          </CardTitle>
          <CardDescription aria-live="polite">{total}</CardDescription>
        </CardHeader>
        <CardContent>
          {listState}
          {list.data && list.data.items.length > 0 && (
            <ul className="site-rows">
              {list.data.items.map((site) => (
                <li key={site.code} className={`relative ${code === site.code ? 'bg-accent' : 'hover:bg-muted'}`}>
                  <div className="site-meta">
                    <span className="site-code">{site.code}</span>
                    <StatusLabel status={site.status} />
                  </div>
                  <Button
                    variant="ghost"
                    ref={code === site.code ? selectedRow : undefined}
                    className="site-button w-full justify-start after:absolute after:inset-0 aria-pressed:hover:bg-accent"
                    aria-label={`${site.code} ${site.name} ${(statuses[site.status] ?? statuses.no_data).label}`}
                    aria-pressed={code === site.code}
                    onClick={() => chooseSite(site.code)}
                  >
                    <Swatch status={statuses[site.status] ? site.status : 'no_data'} />
                    <span className="truncate">{site.name}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {pagination}
        </CardContent>
      </Card>
    </section>
  );
}
