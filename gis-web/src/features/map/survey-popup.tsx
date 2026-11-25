'use client';

import { coordinate, number } from '../../lib/map-format';
import type { Survey } from '../../lib/sites';

export function SurveyPopup({
  survey,
  siteName,
}: {
  survey: Survey & { site_code: string };
  siteName: (code: string) => string | undefined;
}) {
  return (
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
  );
}
