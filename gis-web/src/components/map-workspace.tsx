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
  SURVEY_POINT_COLOR,
  statuses,
  type Bbox,
  type Filters,
  type ListState,
  type Status,
} from '../lib/map-state';
import {
  ApiError,
  type ProvinceCollection,
  type SurveyList,
  type SurveysGeoJSON,
  type SiteFeature,
  type SiteList,
  type SitesGeoJSON,
} from '../lib/sites';

const SiteMap = dynamic(() => import('./site-map'), {
  ssr: false,
  loading: () => (
    <p className="p-6" role="status">
      กำลังเปิดแผนที่…
    </p>
  ),
});
const HISTORY_PAGE_SIZE = 5;
const number = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });

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

function StatusLabel({ status }: { status: Status }) {
  const value = statuses[status] ?? statuses.no_data;
  return (
    <span className="status-label">
      <span className="status-dot" style={{ backgroundColor: value.color }} aria-hidden="true" />
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
  const [code, setCode] = useState<string | null>(null);
  const [tab, setTab] = useState<'map' | 'table'>('map');
  const [listRetry, setListRetry] = useState(0);
  const [mapRetry, setMapRetry] = useState(0);
  const [surveysRetry, setSurveysRetry] = useState(0);
  const [detailRetry, setDetailRetry] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyRetry, setHistoryRetry] = useState(0);
  const [listPagination, setListPagination] = useState<{ total: number; page: number }>();
  const [historyPagination, setHistoryPagination] = useState<{ code: string | null; total: number; page: number }>();
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
  const detail = useResource<SiteFeature>(code ? `/api/sites/${encodeURIComponent(code)}` : null, detailRetry);
  const history = useResource<SurveyList>(
    code ? `/api/sites/${encodeURIComponent(code)}/surveys?page=${historyPage}&pageSize=${HISTORY_PAGE_SIZE}` : null,
    historyRetry,
  );
  useEffect(() => {
    if (list.data) setListPagination({ total: list.data.total, page: list.data.page });
  }, [list.data]);
  useEffect(() => {
    if (history.data) setHistoryPagination({ code, total: history.data.total, page: history.data.page });
  }, [history.data, code]);
  const listPages = list.data ?? listPagination;
  const historyPages = history.data ?? (historyPagination?.code === code ? historyPagination : undefined);
  const historyMissing = history.error instanceof ApiError && history.error.status === 404;
  const missing = detail.error instanceof ApiError && detail.error.status === 404;
  useEffect(() => {
    if (missing) {
      setCode(null);
      setSelectionNotice('ไม่พบแหล่งนี้แล้ว กรุณาเลือกรายการใหม่');
    }
  }, [missing]);
  const onViewport = useCallback((value: Bbox | null) => setBbox(value), []);
  const select = useCallback((value: string) => {
    setSelectionNotice('');
    setCode(value);
    setHistoryPage(1);
    setDetailRetry((n) => n + 1);
  }, []);

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
    setCode(null);
    setSelectionNotice('');
  }
  const loadingList = !validation && (pending || list.loading);
  const listInert = loadingList || Boolean(validation);
  const listFocus = usePaginationFocus(loadingList, state.page, listPages?.total);
  const historyFocus = usePaginationFocus(history.loading, historyPage, historyPages?.total);
  const loadingMap = !validation && (pending || !bbox || geojson.loading || surveys.loading);
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

  return (
    <main className="workspace">
      <header className="page-header">
        <div>
          <p className="eyebrow">SEAGRASS · ANDAMAN</p>
          <h1>ติดตามแหล่งหญ้าทะเล</h1>
          <p className="subtitle">สำรวจพื้นที่และสถานะจากการสำรวจล่าสุด</p>
        </div>
        <SessionControls />
      </header>
      <section className="filters" aria-label="ตัวกรองแหล่งหญ้าทะเล">
        <label>
          จังหวัด
          <select value={draft.province} onChange={(e) => change({ province: e.target.value })}>
            <option value="">ทุกจังหวัด</option>
            {Array.from(provinces, ([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
            {draft.province && !provinces.has(draft.province) && (
              <option value={draft.province}>{draft.province}</option>
            )}
          </select>
        </label>
        <label>
          สถานะ
          <select value={draft.status} onChange={(e) => change({ status: e.target.value })}>
            <option value="">ทุกสถานะ</option>
            {Object.entries(statuses).map(([value, item]) => (
              <option value={value} key={value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="search-label">
          ค้นหาแหล่ง
          <input
            type="search"
            value={draft.q}
            maxLength={200}
            placeholder="ชื่อแหล่งหรือรหัส"
            onChange={(e) => change({ q: e.target.value })}
          />
        </label>
        <Button variant="outline" onClick={() => change(emptyFilters)}>
          ล้างตัวกรอง
        </Button>
        {validation && (
          <p className="filter-error" role="alert">
            {validation}
          </p>
        )}
      </section>
      <div className="mobile-tabs" role="group" aria-label="มุมมอง">
        <Button
          variant={tab === 'map' ? 'default' : 'outline'}
          aria-pressed={tab === 'map'}
          onClick={() => setTab('map')}
        >
          แผนที่
        </Button>
        <Button
          variant={tab === 'table' ? 'default' : 'outline'}
          aria-pressed={tab === 'table'}
          onClick={() => setTab('table')}
        >
          รายการแหล่ง
        </Button>
      </div>
      <div className="panels">
        <section
          className={`table-panel ${tab === 'map' ? 'mobile-hidden' : ''}`}
          aria-labelledby="sites-heading"
          aria-busy={loadingList}
        >
          <div className="panel-heading">
            <h2 id="sites-heading">แหล่งหญ้าทะเล</h2>
            <span aria-live="polite">{list.data ? `${number.format(list.data.total)} แหล่ง` : '—'}</span>
          </div>
          {loadingList && (
            <div className="loading-state" role="status">
              <p>กำลังโหลดรายการ…</p>
              <div className="skeleton" />
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
          )}
          {list.error && <Failure error={list.error} retry={() => setListRetry((n) => n + 1)} />}
          {list.data && (
            <>
              {!list.data.items.length ? (
                <div className="empty-state">
                  <h3>ไม่พบข้อมูล</h3>
                  <p>ลองเปลี่ยนคำค้นหรือเลือกตัวกรองใหม่</p>
                  <Button variant="outline" onClick={() => change(emptyFilters)}>
                    ล้างตัวกรอง
                  </Button>
                </div>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">รหัส / ชื่อแหล่ง</th>
                        <th scope="col">สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.data.items.map((site) => (
                        <tr key={site.code} className={code === site.code ? 'selected-row' : ''}>
                          <td>
                            <button
                              className="site-button"
                              onClick={() => select(site.code)}
                              aria-pressed={code === site.code}
                            >
                              <span className="site-code">{site.code}</span>
                              <span>{site.name}</span>
                            </button>
                            <span className="site-meta">
                              {provinceName(site.province_code)} · {number.format(site.area_rai)} ไร่
                            </span>
                          </td>
                          <td>
                            <StatusLabel status={site.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          {listPages && (
            <nav key="list-pagination" className="pagination" aria-label="หน้ารายการแหล่ง" {...listFocus}>
              <Button
                variant="outline"
                disabled={!loadingList && state.page <= 1}
                aria-disabled={listInert || state.page <= 1}
                onClick={() => {
                  if (listInert || state.page <= 1) return;
                  setState((previous) => ({ ...previous, page: previous.page - 1 }));
                }}
              >
                ก่อนหน้า
              </Button>
              <span tabIndex={-1}>
                หน้า {listPages.page} / {Math.max(1, Math.ceil(listPages.total / PAGE_SIZE))}
              </span>
              <Button
                variant="outline"
                disabled={!loadingList && state.page * PAGE_SIZE >= listPages.total}
                aria-disabled={listInert || state.page * PAGE_SIZE >= listPages.total}
                onClick={() => {
                  if (listInert || state.page * PAGE_SIZE >= listPages.total) return;
                  setState((previous) => ({ ...previous, page: previous.page + 1 }));
                }}
              >
                ถัดไป
              </Button>
            </nav>
          )}
        </section>
        <section
          className={`map-panel ${tab === 'table' ? 'mobile-hidden' : ''}`}
          aria-labelledby="map-heading"
          aria-busy={loadingMap}
        >
          <div className="panel-heading">
            <h2 id="map-heading">แผนที่แหล่ง</h2>
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
          <div className="map-container">
            <SiteMap
              data={geojson.data}
              provinces={provinceResource.data}
              surveys={surveys.data}
              selection={selected}
              onSelect={select}
              onViewport={onViewport}
              onDisplayChange={onDisplayChange}
            />
          </div>
          <ul className="legend" aria-label="คำอธิบายแผนที่">
            <li>
              <span className="status-label">
                <span className="status-dot" style={{ backgroundColor: SURVEY_POINT_COLOR }} aria-hidden="true" />
                จุดสำรวจ
              </span>
            </li>
            {Object.keys(statuses).map((status) => (
              <li key={status}>
                <StatusLabel status={status as Status} />
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section className="detail-panel" aria-labelledby="detail-heading" aria-busy={detail.loading}>
        <div className="panel-heading">
          <h2 id="detail-heading">รายละเอียดแหล่ง</h2>
          {code && (
            <Button variant="outline" onClick={() => setCode(null)}>
              ปิดรายละเอียด
            </Button>
          )}
        </div>
        {selectionNotice && (
          <p className="p-5" role="alert">
            {selectionNotice}
          </p>
        )}
        {!code && <p className="detail-placeholder">เลือกแหล่งจากตารางหรือพื้นที่บนแผนที่เพื่อดูรายละเอียด</p>}
        {detail.loading && (
          <p className="p-5" role="status">
            กำลังโหลดรายละเอียด…
          </p>
        )}
        {detail.error &&
          (missing ? (
            <p className="p-5" role="alert">
              {detail.error.message}
            </p>
          ) : (
            <Failure error={detail.error} retry={() => setDetailRetry((n) => n + 1)} />
          ))}
        {selected && (
          <div className="detail-content">
            <div>
              <p className="site-code">{selected.properties.code}</p>
              <h3>{selected.properties.name}</h3>
              <StatusLabel status={selected.properties.status} />
            </div>
            <dl>
              <div>
                <dt>จังหวัด</dt>
                <dd>{provinceName(selected.properties.province_code)}</dd>
              </div>
              <div>
                <dt>พื้นที่</dt>
                <dd>{number.format(selected.properties.area_rai)} ไร่</dd>
              </div>
              <div>
                <dt>สำรวจล่าสุด</dt>
                <dd>{selected.properties.latestSurvey?.surveyed_on ?? 'ยังไม่มีข้อมูล'}</dd>
              </div>
              <div>
                <dt>การปกคลุมเฉลี่ย</dt>
                <dd>
                  {selected.properties.latestSurvey
                    ? `${number.format(selected.properties.latestSurvey.average_cover_percent)}% (${selected.properties.latestSurvey.count} จุด)`
                    : 'ยังไม่มีข้อมูล'}
                </dd>
              </div>
            </dl>
          </div>
        )}
        {code && !missing && (
          <section className="survey-history" aria-labelledby="history-heading" aria-busy={history.loading}>
            <h3 id="history-heading">ประวัติการสำรวจ</h3>
            {history.loading && <p role="status">กำลังโหลดประวัติการสำรวจ…</p>}
            {history.error && !historyMissing && (
              <Failure error={history.error} retry={() => setHistoryRetry((n) => n + 1)} />
            )}
            {history.data && (
              <>
                {!history.data.items.length ? (
                  <p>ยังไม่มีข้อมูลการสำรวจ</p>
                ) : (
                  <ul className="history-list">
                    {history.data.items.map((survey) => (
                      <li key={survey.id}>
                        <h4>
                          วันที่สำรวจ <time dateTime={survey.surveyed_on}>{survey.surveyed_on}</time>
                        </h4>
                        <dl>
                          <div>
                            <dt>% ความครอบคลุม</dt>
                            <dd>{number.format(survey.cover_percent)}%</dd>
                          </div>
                          <div>
                            <dt>ชนิดหญ้าทะเล</dt>
                            <dd>{survey.species.join(', ') || '—'}</dd>
                          </div>
                          <div>
                            <dt>หมายเหตุ</dt>
                            <dd>{survey.note || '—'}</dd>
                          </div>
                          {survey.created_by && (
                            <div>
                              <dt>ผู้บันทึก</dt>
                              <dd>{survey.created_by.email}</dd>
                            </div>
                          )}
                        </dl>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {historyPages && !historyMissing && (
              <nav key="history-pagination" className="pagination" aria-label="หน้าประวัติการสำรวจ" {...historyFocus}>
                <Button
                  variant="outline"
                  disabled={!history.loading && historyPage <= 1}
                  aria-disabled={history.loading || historyPage <= 1}
                  onClick={() => {
                    if (history.loading || historyPage <= 1) return;
                    setHistoryPage((page) => page - 1);
                  }}
                >
                  ก่อนหน้า
                </Button>
                <span tabIndex={-1}>
                  หน้า {historyPages.page} / {Math.max(1, Math.ceil(historyPages.total / HISTORY_PAGE_SIZE))}
                </span>
                <Button
                  variant="outline"
                  disabled={!history.loading && historyPage * HISTORY_PAGE_SIZE >= historyPages.total}
                  aria-disabled={history.loading || historyPage * HISTORY_PAGE_SIZE >= historyPages.total}
                  onClick={() => {
                    if (history.loading || historyPage * HISTORY_PAGE_SIZE >= historyPages.total) return;
                    setHistoryPage((page) => page + 1);
                  }}
                >
                  ถัดไป
                </Button>
              </nav>
            )}
          </section>
        )}
      </section>
      <footer className="page-footer">
        ข้อมูลตัวอย่างจากชุดนำเข้าระบบ · สถานะอ้างอิงการปกคลุมเฉลี่ยในวันสำรวจล่าสุด
      </footer>
    </main>
  );
}
