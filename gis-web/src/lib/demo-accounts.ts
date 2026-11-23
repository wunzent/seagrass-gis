import type { DemoRole } from './session';

export type DemoAccount = { role: DemoRole; label: string; email: string; password: string };
export type DemoAccountEnv = Readonly<Record<string, string | undefined>>;

// Same variables and demo-only defaults as the api service in docker-compose.yml and .env.example.
const DEFINITIONS = [
  {
    role: 'viewer',
    label: 'Viewer',
    email: 'viewer@demo.local',
    env: 'DEMO_VIEWER_PASSWORD',
    fallback: 'viewer-demo-only',
  },
  {
    role: 'editor',
    label: 'Editor',
    email: 'editor@demo.local',
    env: 'DEMO_EDITOR_PASSWORD',
    fallback: 'editor-demo-only',
  },
  { role: 'admin', label: 'Admin', email: 'admin@demo.local', env: 'DEMO_ADMIN_PASSWORD', fallback: 'admin-demo-only' },
] as const satisfies readonly (Omit<DemoAccount, 'password'> & { env: string; fallback: string })[];

/** Pure: builds viewer/editor/admin from DEMO_*_PASSWORD; unset or empty values use the demo-only default. */
export function demoAccounts(env: DemoAccountEnv = {}): DemoAccount[] {
  return DEFINITIONS.map(({ role, label, email, env: name, fallback }) => ({
    role,
    label,
    email,
    password: env[name] || fallback,
  }));
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = demoAccounts();

export const ADMIN_DEMO_ACCOUNT: DemoAccount = DEMO_ACCOUNTS[2];

export function adminDemoAccount(accounts: readonly DemoAccount[]): DemoAccount {
  return accounts.find((account) => account.role === 'admin') ?? ADMIN_DEMO_ACCOUNT;
}
