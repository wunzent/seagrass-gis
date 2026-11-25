'use client';

import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Tabs, TabsContent } from '../../components/ui/tabs';
import { XIcon } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardAction, CardContent, CardFooter } from '../../components/ui/card';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { number, surveyRounds } from '../../lib/map-format';
import {
  debounce,
  emptyFilters,
  filterState,
  pageCount,
  pageSizeState,
  type Bbox,
  type Filters,
} from '../../lib/map-state';
import { DEFAULT_BASEMAP, readBasemap, saveBasemap, type BasemapId } from '../../lib/basemaps';
import { surveyScope, visibleSurveys } from '../../lib/survey-visibility';
import { parseMapUrl, serializeMapUrl } from '../../lib/map-url';
import { type SitesGeoJSON, type SurveysGeoJSON } from '../../lib/sites';
import { useSession } from '../../stores/session-context';
import { BasemapSelect } from './basemap-select';
import { FiltersPanel } from './filters-panel';
import { ListPagination } from './list-pagination';
import { Legend } from './legend';
import { Failure } from './map-ui';
import { SiteListPanel } from './site-list';
import { SitePopup } from './site-popup';
import { SitesTable } from './sites-table';
import { SurveyPopup } from './survey-popup';
import { RouteLoading } from '../shell/route-states';
import { TopNav } from './top-nav';
import { usePaginationFocus } from './use-pagination-focus';
import { useResource } from './use-resource';

import { ApiError } from '../../services/http-client';
import { useMapStore } from '../../stores/map-store';
import { sitesService } from '../../services/sites-service';
import { surveysService } from '../../services/surveys-service';
import { lookupsService } from '../../services/lookups-service';

const SiteMap = dynamic(() => import('./site-map'), {
  ssr: false,
  loading: () => (
    <Alert className="map-status" role="status">
      <AlertDescription>กำลังเปิดแผนที่…</AlertDescription>
    </Alert>
  ),
});
export function MapWorkspaceBoundary({ sessionControls }: { sessionControls: ReactNode }) {
  return (
    <Suspense fallback={<RouteLoading />}>
      <MapWorkspace sessionControls={sessionControls} />
    </Suspense>
  );
}

export default function MapWorkspace({ sessionControls }: { sessionControls?: ReactNode } = {}) {
  const { generation, expiryNotice } = useSession();
  const savedNavViewRef = useRef<string | null>(null);
  return (
    <MapContent
      key={generation}
      sessionControls={sessionControls}
      savedNavViewRef={savedNavViewRef}
      restoreNavigationFocus={Boolean(expiryNotice)}
    />
  );
}
function MapContent({
  sessionControls,
  savedNavViewRef,
  restoreNavigationFocus,
}: {
  sessionControls?: ReactNode;
  savedNavViewRef?: RefObject<string | null>;
  restoreNavigationFocus?: boolean;
}) {
  const router = useRouter();
  const query = useSearchParams();
  const initial = useMemo(() => parseMapUrl(query), [query]);
  const lastUrl = useRef(serializeMapUrl(initial).toString());
  const {
    draft,
    setDraft,
    state,
    setState,
    bbox,
    setBbox,
    popup,
    setPopup,
    selectedSite,
    selectSite,
    view,
    setView,
    resources,
    layerCache,
    getSnapshot,
    restoreUrl,
  } = useMapStore(initial);
  const writeUrl = useCallback(
    (mode: 'push' | 'replace') => {
      const { state: list, selectedSite: site, view } = getSnapshot();
      const query = serializeMapUrl({ list, site, view }).toString();
      if (query === lastUrl.current) return;
      lastUrl.current = query;
      router[mode](query ? '/?' + query : '/', { scroll: false });
    },
    [getSnapshot, router],
  );
  // Session generation remounts MapContent; discard the old identity's cached payloads too.
  useEffect(() => () => layerCache.clear(), [layerCache]);
  const navigationRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const navigation = navigationRef.current;
    if (!savedNavViewRef || !navigation) return;
    const buttons = Array.from(navigation.querySelectorAll<HTMLButtonElement>('button[data-view]'));
    const previous = savedNavViewRef.current;
    savedNavViewRef.current = null;
    if (restoreNavigationFocus && previous && document.activeElement === document.body) {
      buttons.find((button) => button.dataset.view === previous)?.focus();
    }
    return () => {
      // The keyed reset removes the old DOM. Carry only focus on the public view controls across expiry.
      savedNavViewRef.current = buttons.find((button) => button === document.activeElement)?.dataset.view ?? null;
    };
  }, [savedNavViewRef, restoreNavigationFocus]);
  const [validation, setValidation] = useState('');
  const [selectionNotice, setSelectionNotice] = useState('');
  const [mapAvailable, setMapAvailable] = useState(true);
  const [zoom, setZoom] = useState(0);
  const [surveysEnabled, setSurveysEnabled] = useState(true);
  const scope = surveyScope(zoom, selectedSite, surveysEnabled && view === 'map');
  const surveysVisible = scope !== false;
  const selectedRow = useRef<HTMLButtonElement>(null);
  const sitesHeading = useRef<HTMLHeadingElement>(null);
  const mapHeading = useRef<HTMLHeadingElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const tableHeading = useRef<HTMLHeadingElement>(null);
  const [popupElement, setPopupElement] = useState<HTMLElement | null>(null);
  const focusDetail = useRef(false);
  const [listRetry, setListRetry] = useState(0);
  const [mapRetry, setMapRetry] = useState(0);
  const [surveysRetry, setSurveysRetry] = useState(0);
  const [detailRetry, setDetailRetry] = useState(0);
  const [historyRetry, setHistoryRetry] = useState(0);
  // The size asked for when the shown list arrived (the API answers {items, total, page} without pageSize).
  const requestedPageSize = useRef(state.pageSize);
  // eslint-disable-next-line react-hooks/refs -- intentional: read by the list effect when new data lands
  requestedPageSize.current = state.pageSize;
  const [listPagination, setListPagination] = useState<{ total: number; page: number; pageSize: number }>();
  const [basemap, setBasemap] = useState<BasemapId>(DEFAULT_BASEMAP);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: read the browser's choice after hydration
    setBasemap(readBasemap(() => globalThis.localStorage));
  }, []);
  const chooseBasemap = useCallback((value: BasemapId) => {
    setBasemap(value);
    saveBasemap(() => globalThis.localStorage, value);
  }, []);
  const commitFilters = useMemo(() => debounce<() => void>((commit) => commit()), []);
  useEffect(() => {
    const restore = () => {
      const state = parseMapUrl(new URLSearchParams(window.location.search));
      lastUrl.current = serializeMapUrl(state).toString();
      commitFilters.cancel();
      focusDetail.current = false;
      setSelectionNotice('');
      setValidation('');
      restoreUrl(state);
    };
    if (typeof window !== 'undefined') window.addEventListener('popstate', restore);
    return () => {
      commitFilters.cancel();
      if (typeof window !== 'undefined') window.removeEventListener('popstate', restore);
    };
  }, [commitFilters, restoreUrl]);
  const pending = JSON.stringify(draft) !== JSON.stringify(state.filters) || Boolean(validation);
  const provinceResource = useResource(lookupsService.provincesKey(), lookupsService.provinces, 0, resources.provinces);
  const provinces = useMemo(
    () =>
      new Map(
        (provinceResource.data?.features ?? []).map((feature) => [feature.properties.code, feature.properties.name_th]),
      ),
    [provinceResource.data],
  );
  const provinceName = (code: string) => provinces.get(code) ?? code;
  const loadList = useCallback((signal: AbortSignal) => sitesService.list(state, signal), [state]);
  const loadSites = useCallback(
    (signal: AbortSignal) => sitesService.geojson(state.filters, bbox!, signal, layerCache),
    [state.filters, bbox, layerCache],
  );
  const loadSurveys = useCallback(
    (signal: AbortSignal) => surveysService.geojson(state.filters, bbox!, signal, layerCache),
    [state.filters, bbox, layerCache],
  );
  const list = useResource(pending ? null : sitesService.listKey(state), loadList, listRetry, resources.list);
  const lastPage = list.data ? pageCount(list.data.total, state.pageSize) : undefined;
  const pageOutOfRange = lastPage !== undefined && state.page > lastPage;
  const geojson = useResource(
    !pending && bbox ? sitesService.geojsonKey(state.filters, bbox) : null,
    loadSites,
    mapRetry,
    resources.sites,
  );
  const surveys = useResource(
    surveysVisible && !pending && bbox ? surveysService.geojsonKey(state.filters, bbox) : null,
    loadSurveys,
    surveysRetry,
    resources.surveys,
  );
  const [displayedLayers, setDisplayedLayers] = useState({ sites: false, surveys: false });
  const onDisplayChange = useCallback((displayed: boolean, layer?: 'sites' | 'surveys') => {
    setDisplayedLayers((previous) =>
      displayed || layer ? { ...previous, [layer ?? 'sites']: displayed } : { sites: false, surveys: false },
    );
  }, []);
  const code = selectedSite;
  const survey = popup?.kind === 'survey' ? popup.survey : null;
  const loadDetail = useCallback((signal: AbortSignal) => sitesService.get(code!, signal), [code]);
  const loadHistory = useCallback((signal: AbortSignal) => surveysService.history(code!, signal), [code]);
  const detail = useResource(code ? sitesService.getKey(code) : null, loadDetail, detailRetry, resources.detail);
  const history = useResource(
    code ? surveysService.historyKey(code) : null,
    loadHistory,
    historyRetry,
    resources.history,
  );
  const rounds = useMemo(() => {
    if (!history.data) return [];
    const all = surveyRounds(history.data.items);
    // Rows come newest first; when some are missing the oldest listed round may be partial.
    return history.data.total > history.data.items.length && all.length > 1 ? all.slice(0, -1) : all;
  }, [history.data]);
  useEffect(() => {
    if (pageOutOfRange) {
      setState((previous) => ({ ...previous, page: lastPage }));
      writeUrl('replace');
    }
  }, [lastPage, pageOutOfRange, setState, writeUrl]);
  useEffect(() => {
    if (!list.data) return;
    const shown = { total: list.data.total, page: list.data.page, pageSize: requestedPageSize.current };
    // Keep the last valid response while a new page loads.
    if (shown.page <= pageCount(shown.total, shown.pageSize)) setListPagination(shown);
  }, [list.data]);
  // SiteMap keeps drawing the last collections while a layer reloads or fails; lookups use the same data.
  const [shownSurveys, setShownSurveys] = useState<SurveysGeoJSON>();
  const [shownSites, setShownSites] = useState<SitesGeoJSON>();
  const visiblePoints = useMemo(
    () => visibleSurveys(surveys.data ?? shownSurveys, scope),
    [surveys.data, shownSurveys, scope],
  );
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: keep the last viewport payload during loading
    if (surveys.data) setShownSurveys(surveys.data);
  }, [surveys.data]);
  useEffect(() => {
    // Close a survey popup if its marker disappears. Keep any selected site's popup.
    setPopup((current) =>
      current?.kind === 'survey' &&
      !visiblePoints?.features.some((feature) => String(feature.properties.id) === String(current.survey.id))
        ? selectedSite
          ? { kind: 'site', code: selectedSite }
          : null
        : current,
    );
  }, [visiblePoints, selectedSite, setPopup]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: mirror what the map still draws
    if (geojson.data) setShownSites(geojson.data);
  }, [geojson.data]);
  // Range and page count describe the rows on screen: data for the current key was asked with state.pageSize; while
  // another size loads they keep the size of the last response.
  const listPages =
    list.data && !pageOutOfRange
      ? {
          total: list.data.total,
          page: list.data.page,
          pageSize: state.pageSize,
        }
      : listPagination;
  const historyMissing = history.error instanceof ApiError && history.error.status === 404;
  const missing = detail.error instanceof ApiError && detail.error.status === 404;
  useEffect(() => {
    if (missing) {
      selectSite(null);
      writeUrl('replace');
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: explain the cleared selection when the site no longer exists
      setSelectionNotice('ไม่พบแหล่งนี้แล้ว กรุณาเลือกรายการใหม่');
      focusDetail.current = false;
      const active = document.activeElement;
      if (!active || active === document.body || active.closest?.('.detail-popup'))
        (view === 'map' ? mapHeading : tableHeading).current?.focus();
    }
  }, [missing, selectSite, view, writeUrl]);
  const onViewport = useCallback((value: Bbox | null) => setBbox(value), [setBbox]);
  const select = useCallback(
    (value: string, nextView?: 'map' | 'table') => {
      setSelectionNotice('');
      selectSite(value);
      if (nextView) setView(nextView);
      writeUrl('push');
      setDetailRetry((n) => n + 1);
      setHistoryRetry((n) => n + 1);
    },
    [selectSite, setView, writeUrl],
  );
  const surveyFeatures = visiblePoints?.features;
  const selectSurvey = useCallback(
    (id: string) => {
      const feature = surveyFeatures?.find((item) => String(item.properties.id) === id);
      if (!feature) return;
      setSelectionNotice('');
      const [lon, lat] = feature.geometry.coordinates;
      setPopup({ kind: 'survey', survey: { ...feature.properties, lon, lat } });
    },
    [surveyFeatures, setPopup],
  );
  const deselect = useCallback(() => {
    selectSite(null);
    writeUrl('push');
  }, [selectSite, writeUrl]);
  function chooseSite(value: string) {
    focusDetail.current = true;
    select(value, 'map');
  }
  function switchView(next: 'map' | 'table') {
    focusDetail.current = false;
    if (popup?.kind === 'survey') selectSite(selectedSite);
    setView(next);
    writeUrl('push');
  }
  useLayoutEffect(() => {
    // A list or table selection moves keyboard focus into the popup once it is mounted.
    if (!popup) focusDetail.current = false;
    if (popup && view === 'map' && focusDetail.current) {
      detailHeading.current?.focus();
      if (document.activeElement === detailHeading.current) focusDetail.current = false;
    }
  }, [popup, view, detail.data]);
  function closePopup() {
    // Focus inside the popup would be lost when it unmounts: move it to the selected row, else the nearest visible
    // heading. Focus elsewhere (the canvas, map controls) stays where it is.
    const inPopup = document.activeElement?.closest?.('.detail-popup');
    const target = [selectedRow.current, mapHeading.current, sitesHeading.current, tableHeading.current].find(
      (element) => element?.getClientRects().length,
    );
    deselect();
    if (inPopup) target?.focus();
  }

  function change(next: Partial<Filters>) {
    const filters = { ...draft, ...next };
    setDraft(filters);
    selectSite(null);
    try {
      filterState(state, filters);
      setValidation('');
      commitFilters.run(() => {
        setState((previous) => filterState(previous, filters));
        writeUrl('replace');
      });
    } catch (error) {
      commitFilters.cancel();
      setValidation(error instanceof Error ? error.message : 'ตัวกรองไม่ถูกต้อง');
    }
    setSelectionNotice('');
  }
  const loadingList = !validation && (pending || list.loading || pageOutOfRange);
  const listInert = loadingList || Boolean(validation);
  const listFocus = usePaginationFocus(loadingList, state.page, listPages?.total);
  const loadingMap = mapAvailable && !validation && (pending || !bbox || geojson.loading || surveys.loading);
  const selected = missing ? undefined : detail.data;
  const staleNotice = [
    displayedLayers.sites && (pending || !bbox || geojson.loading || geojson.error || validation)
      ? 'พื้นที่เดิมอาจไม่ใช่ข้อมูลล่าสุด'
      : '',
    surveysVisible && displayedLayers.surveys && (pending || !bbox || surveys.loading || surveys.error || validation)
      ? 'จุดสำรวจเดิมอาจไม่ใช่ข้อมูลล่าสุด'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  const siteName = (siteCode: string) =>
    (geojson.data ?? shownSites)?.features.find((feature) => feature.properties.code === siteCode)?.properties.name ??
    list.data?.items.find((item) => item.code === siteCode)?.name;
  const mapPopup = popup
    ? popup.kind === 'site'
      ? { key: `site:${popup.code}` }
      : { key: `survey:${popup.survey.id}`, point: [popup.survey.lon, popup.survey.lat] as [number, number] }
    : null;

  const filterFields = <FiltersPanel draft={draft} provinces={provinces} change={change} validation={validation} />;
  const listState = (
    <>
      {loadingList && (
        <div className="loading-state" role="status">
          <Alert role="status">
            <AlertDescription>กำลังโหลดรายการ…</AlertDescription>
          </Alert>
        </div>
      )}
      {list.error && <Failure error={list.error} retry={() => setListRetry((n) => n + 1)} />}
      {list.data && !pageOutOfRange && !list.data.items.length && (
        <Alert role="status" className="empty-state">
          <AlertDescription>ไม่พบแหล่งที่ตรงกับตัวกรอง</AlertDescription>
          <Button variant="link" size="sm" className="justify-self-start" onClick={() => change(emptyFilters)}>
            ล้างตัวกรอง
          </Button>
        </Alert>
      )}
    </>
  );
  const pagination = listPages && (
    <ListPagination
      key="list-pagination"
      page={state.page}
      pageSize={state.pageSize}
      total={listPages.total}
      shownPage={listPages.page}
      shownPageSize={listPages.pageSize}
      inert={listInert}
      loading={loadingList}
      goTo={(page) => {
        setState((previous) => ({ ...previous, page }));
        writeUrl('push');
      }}
      setPageSize={(pageSize) => {
        setState((previous) => pageSizeState(previous, pageSize));
        writeUrl('push');
      }}
      focus={listFocus}
    />
  );
  const total = list.data ? `${number.format(list.data.total)} แหล่ง` : '';

  const detailPopup = popup && (
    <section
      ref={view === 'map' ? setPopupElement : undefined}
      className={view === 'map' ? 'detail-popup map-popup rounded-xl' : 'detail-popup table-detail'}
      role="dialog"
      aria-labelledby="detail-heading"
      aria-busy={popup.kind === 'site' && (detail.loading || history.loading)}
      onKeyDown={
        view === 'table'
          ? (event) => {
              if (event.key === 'Escape') closePopup();
            }
          : undefined
      }
    >
      <Card className="max-h-[inherit]">
        <CardHeader>
          <CardTitle className="min-w-0 wrap-anywhere">
            <h2 id="detail-heading" className="text-inherit" ref={detailHeading} tabIndex={-1}>
              {survey ? `จุดสำรวจ ${survey.surveyed_on}` : `${code}${selected ? ` ${selected.properties.name}` : ''}`}
            </h2>
          </CardTitle>
          <CardAction>
            <Button variant="ghost" size="icon-sm" aria-label="ปิด" onClick={closePopup}>
              <XIcon aria-hidden="true" />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="min-h-0 overflow-y-auto">
          {survey ? (
            <SurveyPopup survey={survey} siteName={siteName} />
          ) : (
            <SitePopup
              detail={detail}
              missing={missing}
              retryDetail={() => setDetailRetry((n) => n + 1)}
              selected={selected}
              provinceName={provinceName}
              history={history}
              historyMissing={historyMissing}
              retryHistory={() => setHistoryRetry((n) => n + 1)}
              rounds={rounds}
            />
          )}
        </CardContent>
        {survey && (
          <CardFooter>
            <Button
              variant="link"
              size="sm"
              className="max-w-full justify-start"
              onClick={() => {
                focusDetail.current = true;
                select(survey.site_code);
              }}
            >
              <span className="truncate">ดูรายละเอียดแหล่ง {survey.site_code}</span>
            </Button>
          </CardFooter>
        )}
      </Card>
    </section>
  );

  return (
    <Tabs
      className="app"
      value={view}
      onValueChange={(value) => {
        if (value === 'map' || value === 'table') switchView(value);
      }}
    >
      <TopNav view={view} sessionControls={sessionControls} navigationRef={navigationRef} />
      <main>
        <TabsContent value="map" keepMounted className={`map-layout ${view === 'map' ? '' : 'view-hidden'}`}>
          {view === 'map' && (
            <aside className="sidebar" aria-label="ตัวกรองและรายการแหล่ง">
              <section className="filters border-b pb-4" aria-label="ตัวกรองแหล่งหญ้าทะเล">
                {filterFields}
              </section>
              <SiteListPanel
                loadingList={loadingList}
                sitesHeading={sitesHeading}
                total={total}
                listState={listState}
                list={list}
                code={code}
                selectedRow={selectedRow}
                chooseSite={chooseSite}
                pagination={pagination}
              />
            </aside>
          )}
          <section className="map-panel" aria-labelledby="map-heading" aria-busy={loadingMap}>
            <div className="map-heading">
              <h2 id="map-heading" ref={mapHeading} tabIndex={-1}>
                แผนที่
              </h2>
              <div className="map-progress" role="status" aria-live="polite" aria-atomic="true">
                {loadingMap ? (
                  `กำลังปรับขอบเขต / โหลดข้อมูล…${staleNotice ? ` ${staleNotice}` : ''}`
                ) : geojson.error || surveys.error || validation ? (
                  staleNotice
                ) : geojson.data ? (
                  <Badge variant="outline">{geojson.data.features.length} แหล่งในมุมมอง</Badge>
                ) : (
                  ''
                )}
              </div>
            </div>
            {(geojson.error || surveys.error) && (
              <Failure
                error={
                  new Error(
                    geojson.error && surveys.error
                      ? 'โหลดพื้นที่และจุดสำรวจไม่สำเร็จ'
                      : geojson.error
                        ? 'โหลดพื้นที่ไม่สำเร็จ'
                        : 'โหลดจุดสำรวจไม่สำเร็จ',
                  )
                }
                retry={() => {
                  if (geojson.error) setMapRetry((n) => n + 1);
                  if (surveys.error) setSurveysRetry((n) => n + 1);
                }}
              />
            )}
            {selectionNotice && (
              <Alert className="map-notice">
                <AlertDescription>{selectionNotice}</AlertDescription>
              </Alert>
            )}
            <div
              className="map-container"
              onKeyDown={(event) => {
                if (event.key === 'Escape' && popup) closePopup();
              }}
            >
              <SiteMap
                data={geojson.data}
                provinces={provinceResource.data}
                surveys={visiblePoints}
                surveysVisible={surveysVisible}
                onZoom={setZoom}
                selection={view === 'map' ? selected : undefined}
                onSelect={select}
                onSelectSurvey={selectSurvey}
                selectedSurveyId={survey ? String(survey.id) : null}
                onViewport={onViewport}
                onDisplayChange={onDisplayChange}
                onAvailabilityChange={setMapAvailable}
                onDeselect={deselect}
                popupElement={popupElement}
                popup={mapPopup}
                basemap={basemap}
              />
              {mapAvailable && view === 'map' && <BasemapSelect value={basemap} onChange={chooseBasemap} />}
              {view === 'map' && detailPopup}
              <Legend surveysEnabled={surveysEnabled} toggleSurveys={() => setSurveysEnabled((enabled) => !enabled)} />
            </div>
          </section>
        </TabsContent>
        {view === 'table' && (
          <TabsContent value="table">
            {selectionNotice && (
              <Alert className="map-notice">
                <AlertDescription>{selectionNotice}</AlertDescription>
              </Alert>
            )}
            {detailPopup}
            <SitesTable
              loadingList={loadingList}
              headingRef={tableHeading}
              filterFields={filterFields}
              total={total}
              listState={listState}
              list={list}
              chooseSite={chooseSite}
              provinceName={provinceName}
              pagination={pagination}
            />
          </TabsContent>
        )}
      </main>
    </Tabs>
  );
}
