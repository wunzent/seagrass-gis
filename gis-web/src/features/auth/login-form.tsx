'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
import { Input } from '../../components/ui/input';
import { useSession } from '../../stores/session-context';
import { SessionControls } from './session-controls';
import { validateLogin } from '../../lib/session';
import { adminDemoAccount, DEMO_ACCOUNTS, type DemoAccount } from '../../lib/demo-accounts';
import { EyeIcon, MailIcon } from '../../assets/icons/login-icons';

export function LoginForm({
  guest,
  accounts = DEMO_ACCOUNTS,
}: { guest?: boolean; accounts?: readonly DemoAccount[] } = {}) {
  const router = useRouter();
  const { store, session, phase, busy, logoutPending, error } = useSession();
  const [email, setEmail] = useState<string>(() => adminDemoAccount(accounts).email);
  const [password, setPassword] = useState<string>(() => adminDemoAccount(accounts).password);
  const [showPassword, setShowPassword] = useState(false);
  const [fields, setFields] = useState({ email: '', password: '' });
  const summary = useRef<HTMLDivElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
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
            <form onSubmit={submit} noValidate aria-busy={busy === 'login'}>
              <ul className="demo-accounts" aria-label="บัญชีสาธิตสำหรับกรอกฟอร์ม">
                {accounts.map((account) => (
                  <li key={account.role}>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      disabled={Boolean(busy) || logoutPending || phase === 'checking'}
                      onClick={() => {
                        setEmail(account.email);
                        setPassword(account.password);
                        setFields({ email: '', password: '' });
                      }}
                    >
                      <span className="sr-only">ใช้บัญชีสาธิต </span>
                      {account.label}
                    </Button>
                    <span>
                      {' '}
                      Email:{' '}
                      <span className="demo-value">
                        <strong>{account.email}</strong>
                      </span>{' '}
                      / Pass:{' '}
                      <span className="demo-value">
                        <strong>{account.password}</strong>
                      </span>
                    </span>
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
                <Label htmlFor="email">
                  <MailIcon /> Email
                </Label>
                <Input
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
              </div>
              {fields.email && (
                <p className="field-error" id="email-error">
                  {fields.email}
                </p>
              )}
              <div className="login-field">
                <Label htmlFor="password">Password</Label>
                <div className="flex items-center gap-2">
                  <Input
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
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    aria-label="แสดงรหัสผ่าน"
                    aria-pressed={showPassword}
                    aria-controls="password"
                    disabled={Boolean(busy)}
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    <EyeIcon visible={showPassword} />
                  </Button>
                </div>
              </div>
              {fields.password && (
                <p className="field-error" id="password-error">
                  {fields.password}
                </p>
              )}
              <Button type="submit" disabled={Boolean(busy) || logoutPending || phase === 'checking'}>
                {busy === 'login' ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
              </Button>
              <Button className="self-start" variant="link" nativeButton={false} render={<Link href="/" />}>
                กลับไปแผนที่โดยไม่เข้าสู่ระบบ
              </Button>
            </form>
          </>
        ) : (
          <Button className="self-start" variant="link" nativeButton={false} render={<Link href="/" />}>
            กลับไปแผนที่
          </Button>
        )}
      </section>
    </main>
  );
}
