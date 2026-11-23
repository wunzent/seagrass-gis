import { createExternalStore } from './external-store.ts';
import { latestRequest } from '../lib/map-state.ts';
import { publicData } from '../lib/session.ts';
export type ResourceIdentity = { key: string | null; retry: number; generation: number };
type ResourceContext = {
  authenticated: boolean;
  isCurrent: (generation: number) => boolean;
  isUnauthorized: (error: unknown) => boolean;
  unauthorized: () => void;
};
export function createResourceStore<T>() {
  const sink = createExternalStore<{ identity: ResourceIdentity; data?: T; error?: Error } | undefined>(undefined);
  const requests = latestRequest();
  let identity: ResourceIdentity | undefined;
  return {
    ...sink,
    identity(key: string | null, retry: number, generation: number) {
      if (!identity || identity.key !== key || identity.retry !== retry || identity.generation !== generation)
        identity = { key, retry, generation };
      return identity;
    },
    load(current: ResourceIdentity, loader: (signal: AbortSignal) => Promise<T>, context: ResourceContext) {
      if (!current.key) {
        requests.cancel();
        return;
      }
      const request = requests.start();
      loader(request.signal).then(
        (data) => {
          if (request.current() && context.isCurrent(current.generation))
            sink.setState({ identity: current, data: context.authenticated ? data : publicData(data) });
        },
        (error) => {
          if (request.current() && context.isCurrent(current.generation)) {
            if (context.authenticated && context.isUnauthorized(error)) {
              context.unauthorized();
              return;
            }
            sink.setState({
              identity: current,
              error: error instanceof Error ? error : new Error('โหลดข้อมูลไม่สำเร็จ'),
            });
          }
        },
      );
      return () => requests.cancel();
    },
    read(current: ResourceIdentity, requested: boolean, isCurrent: (generation: number) => boolean) {
      const result = sink.getSnapshot();
      const accepted =
        current.key && result?.identity === current && isCurrent(current.generation) ? result : undefined;
      return { data: accepted?.data, error: accepted?.error, loading: Boolean(requested && !accepted) };
    },
  };
}
export type ResourceStore<T> = ReturnType<typeof createResourceStore<T>>;
