import { Badge } from '../../components/ui/badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { statuses, type Status } from '../../lib/map-state';

export function Swatch({ status }: { status: Status }) {
  return <span className={`swatch swatch-${status}`} aria-hidden="true" />;
}
export function StatusLabel({ status }: { status: Status }) {
  const value = statuses[status] ?? statuses.no_data;
  return (
    <Badge variant="outline" className="status-label">
      <Swatch status={statuses[status] ? status : 'no_data'} />
      {value.label}
    </Badge>
  );
}
export function Failure({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <Alert variant="destructive" className="error-box">
      <AlertDescription>{error.message}</AlertDescription>
      <Button variant="outline" onClick={retry}>
        ลองใหม่
      </Button>
    </Alert>
  );
}
