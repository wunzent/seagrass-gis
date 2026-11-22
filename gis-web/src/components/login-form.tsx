'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { Button } from './ui/button';
import { useSession } from './session-provider';
import { SessionControls } from './session-controls';
import { validateLogin } from '../lib/session';

export function LoginForm() {
  const router = useRouter();
  const { store, session, phase, busy, logoutPending, error } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
        {session ? (
          <Link className="session-link" href="/">
            กลับไปแผนที่
          </Link>
        ) : (
          <form onSubmit={submit} noValidate aria-busy={busy === 'login'}>
            <div
              ref={summary}
              tabIndex={-1}
              className={error && !logoutPending ? 'login-error' : ''}
              role={error && !logoutPending ? 'alert' : undefined}
            >
              {!logoutPending && error}
            </div>
            <label htmlFor="email">อีเมล</label>
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
            {fields.email && (
              <p className="field-error" id="email-error">
                {fields.email}
              </p>
            )}
            <label htmlFor="password">รหัสผ่าน</label>
            <input
              ref={passwordInput}
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(fields.password)}
              aria-describedby={fields.password ? 'password-error' : undefined}
              disabled={Boolean(busy)}
            />
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
        )}
      </section>
    </main>
  );
}
