'use client';

import { Alert, AlertDescription } from '../../components/ui/alert';
import { area, number, surveyRounds } from '../../lib/map-format';
import type { SiteFeature, SurveyList } from '../../lib/sites';
import { Failure, StatusLabel } from './map-ui';

export function SitePopup({
  detail,
  missing,
  retryDetail,
  selected,
  provinceName,
  history,
  historyMissing,
  retryHistory,
  rounds,
}: {
  detail: { loading: boolean; error?: Error };
  missing: boolean;
  retryDetail: () => void;
  selected?: SiteFeature;
  provinceName: (code: string) => string;
  history: { loading: boolean; error?: Error; data?: SurveyList };
  historyMissing: boolean;
  retryHistory: () => void;
  rounds: ReturnType<typeof surveyRounds>;
}) {
  return (
    <div className="popup-body">
      {detail.loading && (
        <Alert role="status">
          <AlertDescription>กำลังโหลดรายละเอียด…</AlertDescription>
        </Alert>
      )}
      {detail.error && !missing && <Failure error={detail.error} retry={retryDetail} />}
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
        {history.loading && (
          <Alert role="status">
            <AlertDescription>กำลังโหลดประวัติการสำรวจ…</AlertDescription>
          </Alert>
        )}
        {history.error && !historyMissing && <Failure error={history.error} retry={retryHistory} />}
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
            <Alert role="status">
              <AlertDescription>ยังไม่มีข้อมูลการสำรวจ</AlertDescription>
            </Alert>
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
  );
}
