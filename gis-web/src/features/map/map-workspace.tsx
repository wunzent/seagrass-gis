'use client';

import { Alert, AlertDescription } from '../../components/ui/alert';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import dynamic from 'next/dynamic';
import {
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
import { debounce, emptyFilters, filterState, pageSizeState, type Bbox, type Filters } from '../../lib/map-state';
import { DEFAULT_BASEMAP, readBasemap, saveBasemap, type BasemapId } from '../../lib/basemaps';
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
  const { draft, setDraft, state, setState, bbox, setBbox, popup, setPopup, view, setView, resources, layerCache } =
    useMapStore();
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
  const selectedRow = useRef<HTMLButtonElement>(null);
  const sitesHeading = useRef<HTMLHeadingElement>(null);
  const mapHeading = useRef<HTMLHeadingElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
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
  const commitFilters = useMemo(
    () => debounce<Filters>((filters) => setState((previous) => filterState(previous, filters))),
    [setState],
  );
  useEffect(() => () => commitFilters.cancel(), [commitFilters]);
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
  const geojson = useResource(
    !pending && bbox ? sitesService.geojsonKey(state.filters, bbox) : null,
    loadSites,
    mapRetry,
    resources.sites,
  );
  const surveys = useResource(
    !pending && bbox ? surveysService.geojsonKey(state.filters, bbox) : null,
    loadSurveys,
    surveysRetry,
    resources.surveys,
  );
  const [displayedLayers, setDisplayedLayers] = useState({ sites: false, surveys: false });
  const onDisplayChange = useCallback((displayed: boolean, layer: 'sites' | 'surveys' = 'sites') => {
    setDisplayedLayers((previous) => (displayed ? { ...previous, [layer]: true } : { sites: false, surveys: false }));
  }, []);
  const code = popup?.kind === 'site' ? popup.code : null;
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
    if (!list.data) return;
    const shown = { total: list.data.total, page: list.data.page, pageSize: requestedPageSize.current };
    // Keep the last page totals while a new page loads.
    setListPagination(shown);
  }, [list.data]);
  // SiteMap keeps drawing the last collections while a layer reloads or fails; lookups use the same data.
  const [shownSurveys, setShownSurveys] = useState<SurveysGeoJSON>();
  const [shownSites, setShownSites] = useState<SitesGeoJSON>();
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: mirror what the map still draws
    if (surveys.data) setShownSurveys(surveys.data);
    // A point that fresh data no longer contains is gone from the map, so its popup closes too.
    if (surveys.data)
      setPopup((current) =>
        current?.kind === 'survey' &&
        !surveys.data?.features.some((feature) => String(feature.properties.id) === String(current.survey.id))
          ? null
          : current,
      );
  }, [surveys.data, setPopup]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: mirror what the map still draws
    if (geojson.data) setShownSites(geojson.data);
  }, [geojson.data]);
  // Range and page count describe the rows on screen: data for the current key was asked with state.pageSize; while
  // another size loads they keep the size of the last response.
  const listPages = list.data
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
      setPopup(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: explain the cleared selection when the site no longer exists
      setSelectionNotice('ไม่พบแหล่งนี้แล้ว กรุณาเลือกรายการใหม่');
      focusDetail.current = false;
      const active = document.activeElement;
      if (!active || active === document.body || active.closest?.('.map-popup')) mapHeading.current?.focus();
    }
  }, [missing, setPopup]);
  const onViewport = useCallback((value: Bbox | null) => setBbox(value), [setBbox]);
  const select = useCallback(
    (value: string) => {
      setSelectionNotice('');
      setPopup({ kind: 'site', code: value });
      setDetailRetry((n) => n + 1);
      setHistoryRetry((n) => n + 1);
    },
    [setPopup],
  );
  const surveyFeatures = (surveys.data ?? shownSurveys)?.features;
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
  const deselect = useCallback(() => setPopup(null), [setPopup]);
  function chooseSite(value: string) {
    select(value);
    focusDetail.current = true;
    setView('map');
  }
  function switchView(next: 'map' | 'table') {
    focusDetail.current = false;
    setView(next);
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
    const inPopup = document.activeElement?.closest?.('.map-popup');
    const target = [selectedRow.current, mapHeading.current, sitesHeading.current].find(
      (element) => element?.getClientRects().length,
    );
    setPopup(null);
    if (inPopup) target?.focus();
  }

  function change(next: Partial<Filters>) {
    const filters = { ...draft, ...next };
    setDraft(filters);
    try {
      filterState(state, filters);
      setValidation('');
      commitFilters.run(filters);
    } catch (error) {
      commitFilters.cancel();
      setValidation(error instanceof Error ? error.message : 'ตัวกรองไม่ถูกต้อง');
    }
    setPopup(null);
    setSelectionNotice('');
  }
  const loadingList = !validation && (pending || list.loading);
  const listInert = loadingList || Boolean(validation);
  const listFocus = usePaginationFocus(loadingList, state.page, listPages?.total);
  const loadingMap = mapAvailable && !validation && (pending || !bbox || geojson.loading || surveys.loading);
  const selected = missing ? undefined : detail.data;
  const staleNotice = [
    displayedLayers.sites && (pending || !bbox || geojson.loading || geojson.error || validation)
      ? 'พื้นที่เดิมอาจไม่ใช่ข้อมูลล่าสุด'
      : '',
    displayedLayers.surveys && (pending || !bbox || surveys.loading || surveys.error || validation)
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
      {list.data && !list.data.items.length && (
        <Alert role="status" className="empty-state">
          <AlertDescription>ไม่พบแหล่งที่ตรงกับตัวกรอง</AlertDescription>
          <button type="button" className="text-button" onClick={() => change(emptyFilters)}>
            ล้างตัวกรอง
          </button>
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
      goTo={(page) => setState((previous) => ({ ...previous, page }))}
      setPageSize={(pageSize) => setState((previous) => pageSizeState(previous, pageSize))}
      focus={listFocus}
    />
  );
  const total = list.data ? `${number.format(list.data.total)} แหล่ง` : '';

  return (
    <div className="app">
      <TopNav view={view} switchView={switchView} sessionControls={sessionControls} navigationRef={navigationRef} />
      <main>
        <div className={`map-layout ${view === 'map' ? '' : 'view-hidden'}`}>
          {view === 'map' && (
            <aside className="sidebar" aria-label="ตัวกรองและรายการแหล่ง">
              <section className="filters" aria-label="ตัวกรองแหล่งหญ้าทะเล">
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
              <Alert
                role="status"
                className="map-progress-alert w-auto max-w-[75%]"
                hidden={!loadingMap && !staleNotice && !geojson.data}
              >
                <span className="map-progress" aria-live="polite" aria-atomic="true">
                  {loadingMap
                    ? `กำลังปรับขอบเขต / โหลดข้อมูล…${staleNotice ? ` ${staleNotice}` : ''}`
                    : geojson.error || surveys.error || validation
                      ? staleNotice
                      : geojson.data
                        ? `${geojson.data.features.length} แหล่งในมุมมอง`
                        : ''}
                </span>
              </Alert>
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
                surveys={surveys.data}
                selection={selected}
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
              {popup && (
                <section
                  ref={setPopupElement}
                  className="map-popup"
                  role="dialog"
                  aria-labelledby="detail-heading"
                  aria-busy={popup.kind === 'site' && (detail.loading || history.loading)}
                >
                  <Card className="popup-card [--card-spacing:0px] gap-0 overflow-visible rounded-none ring-0">
                    <CardHeader className="popup-heading flex items-center justify-between">
                      <CardTitle>
                        <h2 id="detail-heading" ref={detailHeading} tabIndex={-1}>
                          {survey
                            ? `จุดสำรวจ ${survey.surveyed_on}`
                            : `${code}${selected ? ` ${selected.properties.name}` : ''}`}
                        </h2>
                      </CardTitle>
                      <button type="button" className="popup-close" aria-label="ปิดรายละเอียด" onClick={closePopup}>
                        ×
                      </button>
                    </CardHeader>
                    <CardContent className="p-0">
                      {survey ? (
                        <SurveyPopup
                          survey={survey}
                          siteName={siteName}
                          openSite={(code) => {
                            focusDetail.current = true;
                            select(code);
                          }}
                        />
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
                  </Card>
                </section>
              )}
              <Legend />
            </div>
          </section>
        </div>
        {view === 'table' && (
          <SitesTable
            loadingList={loadingList}
            filterFields={filterFields}
            total={total}
            listState={listState}
            list={list}
            chooseSite={chooseSite}
            provinceName={provinceName}
            pagination={pagination}
          />
        )}
      </main>
    </div>
  );
}
