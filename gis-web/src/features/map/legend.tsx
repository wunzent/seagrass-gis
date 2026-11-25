'use client';

import { Button } from '../../components/ui/button';
import { statuses, type Status } from '../../lib/map-state';
import { REFERENCE_PARCELS_LABEL } from './reference-parcels';
import { Swatch } from './map-ui';

export function Legend({
  surveysEnabled,
  toggleSurveys,
  referenceParcelsEnabled,
  toggleReferenceParcels,
}: {
  surveysEnabled: boolean;
  toggleSurveys: () => void;
  referenceParcelsEnabled: boolean;
  toggleReferenceParcels: () => void;
}) {
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
        <li className="flex-col items-start">
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
          <p id="survey-layer-hint" className="max-w-32">
            แสดงเมื่อซูมระดับ 12 ขึ้นไป หรือเลือกแหล่ง
          </p>
        </li>
        <li>
          <Button variant="outline" size="sm" aria-pressed={referenceParcelsEnabled} onClick={toggleReferenceParcels}>
            <span className="h-px w-2.5 bg-muted-foreground" aria-hidden="true" />
            {REFERENCE_PARCELS_LABEL}
          </Button>
        </li>
      </ul>
    </div>
  );
}
