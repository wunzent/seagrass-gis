import { Button } from '../../components/ui/button';
import { statuses, type Status } from '../../lib/map-state';

export function Swatch({ status }: { status: Status }) {
  return <span className={`swatch swatch-${status}`} aria-hidden="true" />;
}
export function StatusLabel({ status }: { status: Status }) {
  const value = statuses[status] ?? statuses.no_data;
  return (
    <span className="status-label">
      <Swatch status={statuses[status] ? status : 'no_data'} />
      {value.label}
    </span>
  );
}
export function Failure({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <div className="error-box" role="alert">
      <p>{error.message}</p>
      <Button variant="outline" onClick={retry}>
        ลองใหม่
      </Button>
    </div>
  );
}
