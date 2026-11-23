'use client';

import { statuses, type Status } from '../../lib/map-state';
import { Swatch } from './map-ui';

export function Legend() {
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
          <span className="survey-mark" aria-hidden="true" />
          จุดสำรวจ
        </li>
      </ul>
    </div>
  );
}
