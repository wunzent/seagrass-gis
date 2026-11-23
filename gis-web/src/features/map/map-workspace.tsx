'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { number, surveyRounds } from '../../lib/map-format';
import { debounce, emptyFilters, filterState, PAGE_SIZE, type Bbox, type Filters } from '../../lib/map-state';
import { type SitesGeoJSON, type SurveysGeoJSON } from '../../lib/sites';
import { useSession } from '../../stores/session-context';
import { FiltersPanel } from './filters-panel';
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
    <p className="map-status" role="status">
      กำลังเปิดแผนที่…
    </p>
  ),
});
export default function MapWorkspace({ sessionControls }: { sessionControls?: ReactNode } = {}) {
  const { generation } = useSession();
  return <MapContent key={generation} sessionControls={sessionControls} />;
}
function MapContent({ sessionControls }: { sessionControls?: ReactNode } = {}) {
  const { draft, setDraft, state, setState, bbox, setBbox, popup, setPopup, view, setView, resources } = useMapStore();
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
  const [listPagination, setListPagination] = useState<{ total: number; page: number }>();
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
    (signal: AbortSignal) => sitesService.geojson(state.filters, bbox!, signal),
    [state.filters, bbox],
  );
  const loadSurveys = useCallback(
    (signal: AbortSignal) => surveysService.geojson(state.filters, bbox!, signal),
    [state.filters, bbox],
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: keep last page totals while a new page loads
    if (list.data) setListPagination({ total: list.data.total, page: list.data.page });
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
  const listPages = list.data ?? listPagination;
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
          <p>กำลังโหลดรายการ…</p>
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      )}
      {list.error && <Failure error={list.error} retry={() => setListRetry((n) => n + 1)} />}
      {list.data && !list.data.items.length && (
        <div className="empty-state">
          <p>ไม่พบแหล่งที่ตรงกับตัวกรอง</p>
          <button type="button" className="text-button" onClick={() => change(emptyFilters)}>
            ล้างตัวกรอง
          </button>
        </div>
      )}
    </>
  );
  const pagination = listPages && (
    <nav key="list-pagination" className="pagination" aria-label="หน้ารายการแหล่ง" {...listFocus}>
      <button
        type="button"
        className="text-button"
        disabled={!loadingList && state.page <= 1}
        aria-disabled={listInert || state.page <= 1}
        onClick={() => {
          if (listInert || state.page <= 1) return;
          setState((previous) => ({ ...previous, page: previous.page - 1 }));
        }}
      >
        ก่อนหน้า
      </button>
      <span tabIndex={-1}>
        หน้า {listPages.page} / {Math.max(1, Math.ceil(listPages.total / PAGE_SIZE))}
      </span>
      <button
        type="button"
        className="text-button"
        disabled={!loadingList && state.page * PAGE_SIZE >= listPages.total}
        aria-disabled={listInert || state.page * PAGE_SIZE >= listPages.total}
        onClick={() => {
          if (listInert || state.page * PAGE_SIZE >= listPages.total) return;
          setState((previous) => ({ ...previous, page: previous.page + 1 }));
        }}
      >
        ถัดไป
      </button>
    </nav>
  );
  const total = list.data ? `${number.format(list.data.total)} แหล่ง` : '';

  return (
    <div className="app">
      <TopNav view={view} switchView={switchView} sessionControls={sessionControls} />
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
              <span className="map-progress" aria-live="polite" aria-atomic="true">
                {loadingMap
                  ? `กำลังปรับขอบเขต / โหลดข้อมูล…${staleNotice ? ` ${staleNotice}` : ''}`
                  : geojson.error || surveys.error || validation
                    ? staleNotice
                    : geojson.data
                      ? `${geojson.data.features.length} แหล่งในมุมมอง`
                      : ''}
              </span>
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
              <p className="map-notice" role="alert">
                {selectionNotice}
              </p>
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
              />
              {popup && (
                <section
                  ref={setPopupElement}
                  className="map-popup"
                  role="dialog"
                  aria-labelledby="detail-heading"
                  aria-busy={popup.kind === 'site' && (detail.loading || history.loading)}
                >
                  <div className="popup-heading">
                    <h2 id="detail-heading" ref={detailHeading} tabIndex={-1}>
                      {survey
                        ? `จุดสำรวจ ${survey.surveyed_on}`
                        : `${code}${selected ? ` ${selected.properties.name}` : ''}`}
                    </h2>
                    <button type="button" className="popup-close" aria-label="ปิดรายละเอียด" onClick={closePopup}>
                      ×
                    </button>
                  </div>
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
