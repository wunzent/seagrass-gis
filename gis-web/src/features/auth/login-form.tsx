'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { useSession } from '../../stores/session-context';
import { SessionControls } from './session-controls';
import { validateLogin, type DemoRole } from '../../lib/session';
import { ADMIN_DEMO_ACCOUNT, DEMO_ACCOUNTS } from '../../lib/demo-accounts';
import { EyeIcon, MailIcon } from '../../assets/icons/login-icons';

const demoAccounts: { role: DemoRole; label: string; description: string }[] = [
  { role: 'viewer', label: 'Viewer', description: 'อ่านข้อมูล และเห็นผู้บันทึก' },
  { role: 'editor', label: 'Editor', description: 'แก้ชื่อแหล่ง และจัดการ survey' },
  { role: 'admin', label: 'Admin', description: 'จัดการแหล่งทั้งหมด' },
];

export function LoginForm({ guest }: { guest?: boolean } = {}) {
  const router = useRouter();
  const { store, session, phase, busy, logoutPending, error } = useSession();
  const [email, setEmail] = useState<string>(ADMIN_DEMO_ACCOUNT.email);
  const [password, setPassword] = useState<string>(ADMIN_DEMO_ACCOUNT.password);
  const [showPassword, setShowPassword] = useState(false);
  const [fields, setFields] = useState({ email: '', password: '' });
  const [roles, setRoles] = useState<DemoRole[] | null>(null);
  const [pendingRole, setPendingRole] = useState<DemoRole | null>(null);
  useEffect(() => {
    let active = true;
    void store.demoRoles().then((available) => {
      if (active) setRoles(available);
    });
    return () => {
      active = false;
    };
  }, [store]);
  const summary = useRef<HTMLDivElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  async function demoLogin(role: DemoRole) {
    if (busy || logoutPending || phase === 'checking') return;
    setPendingRole(role);
    const success = await store.demoLogin(role);
    setPendingRole(null);
    setPassword('');
    if (success) router.replace('/');
    else summary.current?.focus();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = validateLogin(email, password);
    setFields(invalid);
    if (invalid.email || invalid.password) {
      (invalid.email ? emailInput : passwordInput).current?.focus();
      return;
    }
    if (busy || logoutPending || phase === 'checking') return;
    const success = await store.login(email, password);
    setPassword('');
    if (success) router.replace('/');
    else summary.current?.focus();
  }
  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-heading">
        <p className="product-name">ติดตามแหล่งหญ้าทะเล</p>
        <h1 id="login-heading">เข้าสู่ระบบ</h1>
        <p className="subtitle">เข้าสู่ระบบด้วยบัญชีที่ได้รับ หรือกลับไปดูข้อมูลสาธารณะ</p>
        {session || logoutPending || phase === 'checking' ? <SessionControls /> : null}
        {(guest ?? !session) ? (
          <>
            {roles && roles.length > 0 && (
              <div className="demo-login" role="group" aria-labelledby="demo-heading" aria-busy={pendingRole !== null}>
                <h2 id="demo-heading">บัญชีสาธิต กดเพื่อเข้าสู่ระบบทันที</h2>
                {demoAccounts
                  .filter(({ role }) => roles.includes(role))
                  .map(({ role, label, description }) => (
                    <Button
                      key={role}
                      type="button"
                      variant="outline"
                      className="demo-login-button"
                      aria-label={label}
                      disabled={Boolean(busy) || logoutPending || phase === 'checking'}
                      onClick={() => demoLogin(role)}
                    >
                      <span>{pendingRole === role ? 'กำลังเข้าสู่ระบบ…' : label}</span>
                      <span>{description}</span>
                    </Button>
                  ))}
                <p className="demo-divider">หรือกรอกเอง</p>
              </div>
            )}
            <form onSubmit={submit} noValidate aria-busy={busy === 'login'}>
              <ul className="demo-accounts" aria-label="บัญชีสาธิตสำหรับกรอกฟอร์ม">
                {DEMO_ACCOUNTS.map((account) => (
                  <li key={account.role}>
                    <button
                      type="button"
                      disabled={Boolean(busy) || logoutPending || phase === 'checking'}
                      onClick={() => {
                        setEmail(account.email);
                        setPassword(account.password);
                        setFields({ email: '', password: '' });
                      }}
                    >
                      <span className="sr-only">ใช้บัญชีสาธิต </span>
                      {account.label} Email:{' '}
                      <span className="demo-value">
                        <strong>{account.email}</strong>
                      </span>{' '}
                      / Pass:{' '}
                      <span className="demo-value">
                        <strong>{account.password}</strong>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div
                ref={summary}
                tabIndex={-1}
                className={error && !logoutPending ? 'login-error' : ''}
                role={error && !logoutPending ? 'alert' : undefined}
              >
                {!logoutPending && error}
              </div>
              <div className="login-field">
                <label htmlFor="email">Email</label>
                <input
                  ref={emailInput}
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-invalid={Boolean(fields.email)}
                  aria-describedby={fields.email ? 'email-error' : undefined}
                  disabled={Boolean(busy)}
                />
                <span className="login-field-icon">
                  <MailIcon />
                </span>
              </div>
              {fields.email && (
                <p className="field-error" id="email-error">
                  {fields.email}
                </p>
              )}
              <div className="login-field">
                <label htmlFor="password">Password</label>
                <input
                  ref={passwordInput}
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={Boolean(fields.password)}
                  aria-describedby={fields.password ? 'password-error' : undefined}
                  disabled={Boolean(busy)}
                />
                <button
                  className="password-toggle"
                  type="button"
                  aria-label="แสดงรหัสผ่าน"
                  aria-pressed={showPassword}
                  aria-controls="password"
                  disabled={Boolean(busy)}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  <EyeIcon visible={showPassword} />
                </button>
              </div>
              {fields.password && (
                <p className="field-error" id="password-error">
                  {fields.password}
                </p>
              )}
              <Button type="submit" disabled={Boolean(busy) || logoutPending || phase === 'checking'}>
                {busy === 'login' ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
              </Button>
              <Link className="session-link" href="/">
                กลับไปแผนที่โดยไม่เข้าสู่ระบบ
              </Link>
            </form>
          </>
        ) : (
          <Link className="session-link" href="/">
            กลับไปแผนที่
          </Link>
        )}
      </section>
    </main>
  );
}
