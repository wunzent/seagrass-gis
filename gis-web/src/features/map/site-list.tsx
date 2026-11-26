'use client';

import type { ReactNode, RefObject } from 'react';
import { Button } from '../../components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../../components/ui/card';
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
        <CardHeader className="list-heading flex items-baseline justify-between px-3 py-2.5">
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
                <li
                  key={site.code}
                  className={`relative grid gap-1 border-b px-3 py-2.5 last:border-b-0 ${code === site.code ? 'bg-accent' : 'hover:bg-muted'}`}
                >
                  <div className="site-meta items-center">
                    <span className="site-code">{site.code}</span>
                    <StatusLabel status={site.status} />
                  </div>
                  <Button
                    variant="ghost"
                    ref={code === site.code ? selectedRow : undefined}
                    className="site-button h-auto w-full min-w-0 justify-start border-0 px-0 after:absolute after:inset-0 aria-pressed:hover:bg-accent"
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
        </CardContent>
        {pagination && (
          <CardFooter className="site-list-footer z-10 rounded-none bg-background px-3 py-3 md:sticky md:bottom-0">
            {pagination}
          </CardFooter>
        )}
      </Card>
    </section>
  );
}
