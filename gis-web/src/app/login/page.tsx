import { SessionRoute } from '../../guards/session-guard';
import { LoginForm } from '../../features/auth/login-form';
import { demoAccounts } from '../../lib/demo-accounts';

export const metadata = { title: 'เข้าสู่ระบบ | Seagrass' };
// Read DEMO_*_PASSWORD from the runtime environment per request, not values frozen at build time.
export const dynamic = 'force-dynamic';
export default function LoginPage() {
  const accounts = demoAccounts(process.env);
  return (
    <SessionRoute
      checking={<LoginForm accounts={accounts} />}
      account={<LoginForm guest={false} accounts={accounts} />}
      guest={<LoginForm guest accounts={accounts} />}
    />
  );
}
