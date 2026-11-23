import { SessionRoute } from '../../guards/session-guard';
import { LoginForm } from '../../features/auth/login-form';

export const metadata = { title: 'เข้าสู่ระบบ | Seagrass' };
export default function LoginPage() {
  return <SessionRoute checking={<LoginForm />} account={<LoginForm guest={false} />} guest={<LoginForm guest />} />;
}
