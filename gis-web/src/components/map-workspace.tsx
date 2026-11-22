'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import { Button } from './ui/button';
import { useResource } from './use-resource';
import { useSession } from './session-provider';
import { SessionControls } from './session-controls';
import {
  debounce,
  emptyFilters,
  filterState,
  listQuery,
  mapQuery,
  PAGE_SIZE,
  statuses,
  type Bbox,
  type Filters,
  type ListState,
  type Status,
} from '../lib/map-state';
import {
  ApiError,
  type ProvinceCollection,
  type Survey,
  type SurveyList,
  type SurveysGeoJSON,
  type SiteFeature,
  type SiteList,
  type SitesGeoJSON,
} from '../lib/sites';

const SiteMap = dynamic(() => import('./site-map'), {
  ssr: false,
  loading: () => (
    <p className="map-status" role="status">
      กำลังเปิดแผนที่…
    </p>
  ),
});
/** One request covers a site's survey history; rounds are grouped by survey date in the page. */
export const ROUNDS_PAGE_SIZE = 100;
const number = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });
const area = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const coordinate = new Intl.NumberFormat('en-US', { minimumFractionDigits: 5, maximumFractionDigits: 5 });

type Popup = { kind: 'site'; code: string } | { kind: 'survey'; survey: Survey & { site_code: string } };
type Round = { date: string; average: number; count: number };

export function surveyRounds(items: Survey[]): Round[] {
  const byDate = new Map<string, number[]>();
  for (const item of items) byDate.set(item.surveyed_on, [...(byDate.get(item.surveyed_on) ?? []), item.cover_percent]);
  return Array.from(byDate, ([date, covers]) => ({
    date,
    average: covers.reduce((sum, value) => sum + value, 0) / covers.length,
    count: covers.length,
  })).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function usePaginationFocus(loading: boolean, page: number, total: number | undefined) {
  const ref = useRef<HTMLElement>(null);
  const focused = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    const button = focused.current;
    // Native disabling can already have sent focus to body during this commit.
    if (
      !loading &&
      button?.disabled &&
      (document.activeElement === button || document.activeElement === document.body)
    ) {
      const target =
        ref.current?.querySelector<HTMLElement>('button:not(:disabled)') ??
        ref.current?.querySelector<HTMLElement>('span');
      target?.focus();
    }
  }, [loading, page, total]);
  return {
    ref,
    onFocusCapture(event: FocusEvent<HTMLElement>) {
      focused.current = event.target.tagName === 'BUTTON' ? (event.target as HTMLButtonElement) : null;
    },
    onBlurCapture(event: FocusEvent<HTMLElement>) {
      if (event.relatedTarget || !(event.target as HTMLButtonElement).disabled) focused.current = null;
    },
  };
}

function Swatch({ status }: { status: Status }) {
  return <span className={`swatch swatch-${status}`} aria-hidden="true" />;
}
function StatusLabel({ status }: { status: Status }) {
  const value = statuses[status] ?? statuses.no_data;
  return (
    <span className="status-label">
      <Swatch status={statuses[status] ? status : 'no_data'} />
      {value.label}
    </span>
  );
}
function Failure({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <div className="error-box" role="alert">
      <p>{error.message}</p>
      <Button variant="outline" onClick={retry}>
        ลองใหม่
      </Button>
    </div>
  );
}

export default function MapWorkspace() {
  const { generation } = useSession();
  return <MapContent key={generation} />;
}
function MapContent() {
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [state, setState] = useState<ListState>({ filters: emptyFilters, page: 1 });
  const [validation, setValidation] = useState('');
  const [selectionNotice, setSelectionNotice] = useState('');
  const [bbox, setBbox] = useState<Bbox | null>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [view, setView] = useState<'map' | 'table'>('map');
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
    [],
  );
  useEffect(() => () => commitFilters.cancel(), [commitFilters]);
  const pending = JSON.stringify(draft) !== JSON.stringify(state.filters) || Boolean(validation);
  const provinceResource = useResource<ProvinceCollection>('/api/provinces.geojson', 0);
  const provinces = useMemo(
    () =>
      new Map(
        (provinceResource.data?.features ?? []).map((feature) => [feature.properties.code, feature.properties.name_th]),
      ),
    [provinceResource.data],
  );
  const provinceName = (code: string) => provinces.get(code) ?? code;
  const list = useResource<SiteList>(pending ? null : `/api/sites?${listQuery(state)}`, listRetry);
  const geojson = useResource<SitesGeoJSON>(
    !pending && bbox ? `/api/sites.geojson?${mapQuery(state.filters, bbox)}` : null,
    mapRetry,
  );
  const surveys = useResource<SurveysGeoJSON>(
    !pending && bbox ? `/api/surveys.geojson?${mapQuery(state.filters, bbox)}` : null,
    surveysRetry,
  );
  const [displayedLayers, setDisplayedLayers] = useState({ sites: false, surveys: false });
  const onDisplayChange = useCallback((displayed: boolean, layer: 'sites' | 'surveys' = 'sites') => {
    setDisplayedLayers((previous) => (displayed ? { ...previous, [layer]: true } : { sites: false, surveys: false }));
  }, []);
  const code = popup?.kind === 'site' ? popup.code : null;
  const survey = popup?.kind === 'survey' ? popup.survey : null;
  const detail = useResource<SiteFeature>(code ? `/api/sites/${encodeURIComponent(code)}` : null, detailRetry);
  const history = useResource<SurveyList>(
    code ? `/api/sites/${encodeURIComponent(code)}/surveys?page=1&pageSize=${ROUNDS_PAGE_SIZE}` : null,
    historyRetry,
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
  }, [surveys.data]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: mirror what the map still draws
    if (geojson.data) setShownSites(geojson.data);
  }, [geojson.data]);
  const listPages = list.data ?? listPagination;
  const historyMissing = history.error instanceof ApiError && history.error.status === 404;
  const missing = detail.error instanceof ApiError && detail.error.status === 404;
  useEffect(() => {
    if (missing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset selection when the site no longer exists
      setPopup(null);
      setSelectionNotice('ไม่พบแหล่งนี้แล้ว กรุณาเลือกรายการใหม่');
      focusDetail.current = false;
      const active = document.activeElement;
      if (!active || active === document.body || active.closest?.('.map-popup')) mapHeading.current?.focus();
    }
  }, [missing]);
  const onViewport = useCallback((value: Bbox | null) => setBbox(value), []);
  const select = useCallback((value: string) => {
    setSelectionNotice('');
    setPopup({ kind: 'site', code: value });
    setDetailRetry((n) => n + 1);
    setHistoryRetry((n) => n + 1);
  }, []);
  const surveyFeatures = (surveys.data ?? shownSurveys)?.features;
  const selectSurvey = useCallback(
    (id: string) => {
      const feature = surveyFeatures?.find((item) => String(item.properties.id) === id);
      if (!feature) return;
      setSelectionNotice('');
      const [lon, lat] = feature.geometry.coordinates;
      setPopup({ kind: 'survey', survey: { ...feature.properties, lon, lat } });
    },
    [surveyFeatures],
  );
  const deselect = useCallback(() => setPopup(null), []);
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

  const filterFields = (
    <>
      <label>
        <span>จังหวัด</span>
        <select value={draft.province} onChange={(e) => change({ province: e.target.value })}>
          <option value="">ทุกจังหวัด</option>
          {Array.from(provinces, ([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
          {draft.province && !provinces.has(draft.province) && <option value={draft.province}>{draft.province}</option>}
        </select>
      </label>
      <label>
        <span>สถานะ</span>
        <select value={draft.status} onChange={(e) => change({ status: e.target.value })}>
          <option value="">ทุกสถานะ</option>
          {Object.entries(statuses).map(([value, item]) => (
            <option value={value} key={value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>ค้นหาแหล่ง</span>
        <input
          type="search"
          value={draft.q}
          maxLength={200}
          placeholder="ชื่อแหล่งหรือรหัส"
          onChange={(e) => change({ q: e.target.value })}
        />
      </label>
      <button type="button" className="text-button" onClick={() => change(emptyFilters)}>
        ล้างตัวกรอง
      </button>
      {validation && (
        <p className="filter-error" role="alert">
          {validation}
        </p>
      )}
    </>
  );
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
      <header className="topbar">
        <h1>ติดตามแหล่งหญ้าทะเล</h1>
        <nav className="topbar-nav" aria-label="เมนูหลัก">
          <button
            type="button"
            className="nav-item"
            aria-current={view === 'map' ? 'page' : undefined}
            onClick={() => switchView('map')}
          >
            แผนที่
          </button>
          <button
            type="button"
            className="nav-item"
            aria-current={view === 'table' ? 'page' : undefined}
            onClick={() => switchView('table')}
          >
            ตารางแหล่งหญ้าทะเล
          </button>
        </nav>
        <SessionControls />
      </header>
      <main>
        <div className={`map-layout ${view === 'map' ? '' : 'view-hidden'}`}>
          {view === 'map' && (
            <aside className="sidebar" aria-label="ตัวกรองและรายการแหล่ง">
              <section className="filters" aria-label="ตัวกรองแหล่งหญ้าทะเล">
                {filterFields}
              </section>
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
                    <div className="popup-body">
                      <dl className="facts">
                        <div>
                          <dt>แหล่ง</dt>
                          <dd>
                            {survey.site_code}
                            {siteName(survey.site_code) ? ` ${siteName(survey.site_code)}` : ''}
                          </dd>
                        </div>
                        <div>
                          <dt>การปกคลุม</dt>
                          <dd className="num">{number.format(survey.cover_percent)}%</dd>
                        </div>
                        <div>
                          <dt>ชนิดหญ้าทะเล</dt>
                          <dd>{survey.species.join(', ') || 'ไม่มี'}</dd>
                        </div>
                        <div>
                          <dt>หมายเหตุ</dt>
                          <dd>{survey.note || 'ไม่มี'}</dd>
                        </div>
                        {survey.created_by && (
                          <div className="wide">
                            <dt>ผู้บันทึก</dt>
                            <dd>{survey.created_by.email}</dd>
                          </div>
                        )}
                        <div className="wide">
                          <dt>พิกัด</dt>
                          <dd className="num">
                            {coordinate.format(survey.lon)}, {coordinate.format(survey.lat)}
                          </dd>
                        </div>
                      </dl>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          focusDetail.current = true;
                          select(survey.site_code);
                        }}
                      >
                        ดูรายละเอียดแหล่ง {survey.site_code}
                      </button>
                    </div>
                  ) : (
                    <div className="popup-body">
                      {detail.loading && <p role="status">กำลังโหลดรายละเอียด…</p>}
                      {detail.error && !missing && (
                        <Failure error={detail.error} retry={() => setDetailRetry((n) => n + 1)} />
                      )}
                      {selected && (
                        <dl className="facts">
                          <div>
                            <dt>สถานะ</dt>
                            <dd>
                              <StatusLabel status={selected.properties.status} />
                            </dd>
                          </div>
                          <div>
                            <dt>จังหวัด</dt>
                            <dd>{provinceName(selected.properties.province_code)}</dd>
                          </div>
                          <div>
                            <dt>พื้นที่</dt>
                            <dd className="num">{area.format(selected.properties.area_rai)} ไร่</dd>
                          </div>
                          <div>
                            <dt>ปกคลุมเฉลี่ยรอบล่าสุด</dt>
                            <dd className="num">
                              {selected.properties.latestSurvey
                                ? `${number.format(selected.properties.latestSurvey.average_cover_percent)}% (${selected.properties.latestSurvey.count} จุด)`
                                : 'ไม่มี'}
                            </dd>
                          </div>
                        </dl>
                      )}
                      <section className="rounds" aria-labelledby="history-heading" aria-busy={history.loading}>
                        <h3 id="history-heading">ประวัติการสำรวจ</h3>
                        {history.loading && <p role="status">กำลังโหลดประวัติการสำรวจ…</p>}
                        {history.error && !historyMissing && (
                          <Failure error={history.error} retry={() => setHistoryRetry((n) => n + 1)} />
                        )}
                        {history.data &&
                          (rounds.length ? (
                            <ol className="round-list">
                              {rounds.map((round) => (
                                <li key={round.date}>
                                  <time dateTime={round.date}>{round.date}</time>
                                  <span className="num">
                                    {number.format(round.average)}% ({round.count} จุด)
                                  </span>
                                </li>
                              ))}
                            </ol>
                          ) : (
                            <p>ยังไม่มีข้อมูลการสำรวจ</p>
                          ))}
                        {history.data && history.data.total > history.data.items.length && (
                          <p className="note">
                            {rounds.length < surveyRounds(history.data.items).length
                              ? 'แสดงเฉพาะรอบที่ข้อมูลครบ'
                              : 'รอบนี้อาจแสดงข้อมูลไม่ครบ'}{' '}
                            จาก {history.data.items.length} จุดล่าสุด จากทั้งหมด {number.format(history.data.total)} จุด
                          </p>
                        )}
                      </section>
                    </div>
                  )}
                </section>
              )}
              <div className="legend" role="group" aria-label="คำอธิบายแผนที่">
                <p>การปกคลุม (รอบล่าสุด)</p>
                <ul>
                  {Object.entries(statuses).map(([status, item]) => (
                    <li key={status}>
                      <Swatch status={status as Status} />
                      {item.label}
                      {item.range ? ` ${item.range}` : ''}
                    </li>
                  ))}
                  <li>
                    <span className="survey-mark" aria-hidden="true" />
                    จุดสำรวจ
                  </li>
                </ul>
              </div>
            </div>
          </section>
        </div>
        {view === 'table' && (
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
        )}
      </main>
    </div>
  );
}
