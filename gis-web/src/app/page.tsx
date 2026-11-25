import { MapWorkspaceBoundary as MapWorkspace } from '../features/map/map-workspace';
import { SessionControls } from '../features/auth/session-controls';
import { SessionRoute } from '../guards/session-guard';

export default function Home() {
  return (
    <MapWorkspace
      sessionControls={
        <SessionRoute
          checking={<SessionControls view="checking" />}
          account={<SessionControls view="account" />}
          guest={<SessionControls view="guest" />}
        />
      }
    />
  );
}
