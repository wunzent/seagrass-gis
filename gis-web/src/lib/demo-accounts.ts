import type { DemoRole } from './session';

// Demo-only values match the defaults in .env.example.
export const DEMO_ACCOUNTS = [
  { role: 'viewer', label: 'Viewer', email: 'viewer@demo.local', password: 'viewer-demo-only' },
  { role: 'editor', label: 'Editor', email: 'editor@demo.local', password: 'editor-demo-only' },
  { role: 'admin', label: 'Admin', email: 'admin@demo.local', password: 'admin-demo-only' },
] as const satisfies readonly { role: DemoRole; label: string; email: string; password: string }[];

export const ADMIN_DEMO_ACCOUNT = DEMO_ACCOUNTS[2];
