'use client';

import { Button } from '../../components/ui/button';
import { statuses, type Status } from '../../lib/map-state';
import { Swatch } from './map-ui';

export function Legend({ surveysEnabled, toggleSurveys }: { surveysEnabled: boolean; toggleSurveys: () => void }) {
  return (
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
          <Button
            variant="outline"
            size="sm"
            aria-label="จุดสำรวจ"
            aria-pressed={surveysEnabled}
            aria-describedby="survey-layer-hint"
            onClick={toggleSurveys}
          >
            <span className="survey-mark" aria-hidden="true" />
            จุดสำรวจ
          </Button>
        </li>
      </ul>
      <p id="survey-layer-hint" className="mt-1 max-w-32">
        แสดงเมื่อซูมระดับ 12 ขึ้นไป หรือเลือกแหล่ง
      </p>
    </div>
  );
}
