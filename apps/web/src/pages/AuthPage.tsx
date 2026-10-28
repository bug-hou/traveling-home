import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Input } from '@arco-design/web-react';
import { ApiError } from '@/services/api';
import { useAuth } from '@/features/auth/AuthProvider';
import { returnTarget } from '@/services/navigation';
import '@/styles/auth.css';

type IconName = 'mail' | 'lock' | 'user' | 'eye' | 'eyeOff' | 'pin' | 'cloud' | 'video' | 'layers' | 'shield';

function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const common = { className: `auth-icon ${className}`, viewBox: '0 0 24 24', 'aria-hidden': true as const };
  switch (name) {
    case 'mail':
      return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;
    case 'lock':
      return <svg {...common}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
    case 'user':
      return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></svg>;
    case 'eye':
      return <svg {...common}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>;
    case 'eyeOff':
      return <svg {...common}><path d="M3 3l18 18M10.6 6.1A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.7C3.9 8.5 2 12 2 12s3.6 7 10 7c1.6 0 3-.4 4.3-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>;
    case 'pin':
      return <svg {...common}><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>;
    case 'cloud':
      return <svg {...common}><path d="M7 18a4.5 4.5 0 0 1-.6-8.97A6 6 0 0 1 18 10a4 4 0 0 1-.5 8z" /></svg>;
    case 'video':
      return <svg {...common}><rect x="3" y="6" width="13" height="12" rx="2.5" /><path d="m16 10.5 5-3v9l-5-3" /></svg>;
    case 'layers':
      return <svg {...common}><path d="m12 3 9 5-9 5-9-5 9-5z" /><path d="m3 13 9 5 9-5" /></svg>;
    case 'shield':
      return <svg {...common}><path d="M12 3 5 6v5.5c0 4.3 3 8 7 9.5 4-1.5 7-5.2 7-9.5V6l-7-3z" /><path d="m9 12 2 2 4-4" /></svg>;
  }
}

function Brand({ mobile = false }: { mobile?: boolean }) {
  return (
    <Link className={`auth-brand${mobile ? ' auth-brand--mobile' : ''}`} to="/login" aria-label="迹光首页" data-agent-id={mobile ? 'auth.mobile.brand' : 'auth.header.brand'}>
      <img src={`${import.meta.env.BASE_URL}brand-mark.svg`} alt="" />
      <span className="auth-brand__name">迹光</span>
      <span className="auth-brand__sub">旅行素材网盘</span>
    </Link>
  );
}

function JourneyArt() {
  return (
    <div className="journey-art" aria-hidden="true">
      <svg className="journey-art__map" viewBox="0 0 400 260" fill="none">
        <g stroke="currentColor" strokeOpacity=".2" strokeWidth="1.2" strokeLinejoin="round">
          <path d="m40 60 60-20 50 30-20 50-60 10z" />
          <path d="m250 40 70-10 40 50-30 40-60-10z" />
          <path d="m60 170 60-20 50 40-30 45-60-5z" />
        </g>
        <g fill="currentColor" fillOpacity=".22" stroke="currentColor" strokeOpacity=".55" strokeWidth="1.3" strokeLinejoin="round">
          <path d="m150 70 60-18 40-12 20 70-50 20-50-10-40 0z" />
          <path d="m220 130 50-20 60 10 20 55-50 30-60-15z" />
          <path d="m130 120 40 0 50 10 20 60-50 25-50-25 10-40z" />
        </g>
        <path className="journey-art__route" d="M50 215c50-25 70-40 120-55s80-30 115-70 45-30 65-40" />
        <g className="journey-art__points">
          <circle cx="170" cy="160" r="7" /><circle cx="285" cy="90" r="7" /><circle cx="350" cy="50" r="7" />
        </g>
      </svg>
      <div className="journey-art__caption"><Icon name="pin" /> 川西环线 · 2026</div>
      <div className="journey-art__photo"><span className="journey-art__sun" /><span className="journey-art__mountain journey-art__mountain--back" /><span className="journey-art__mountain journey-art__mountain--front" /><span className="journey-art__photo-label">稻城亚丁 · 日落</span></div>
      <div className="journey-art__upload"><span className="journey-art__upload-icon"><Icon name="video" /></span><span className="journey-art__upload-meta"><b>DJI_0231.MP4</b><i><em /></i><small>断点续传 · 上传中 68%</small></span></div>
      <div className="journey-art__stats"><small>已走过</small><div><span><b>12</b>省</span><span><b>46</b>市</span><span><b>87</b>县区</span></div></div>
      <span className="journey-art__float journey-art__float--one"><Icon name="pin" /> 自动读取坐标</span>
      <span className="journey-art__float journey-art__float--two"><Icon name="cloud" /> 私有云存储</span>
    </div>
  );
}

function Feedback({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'warning' | 'success' }) {
  return <Alert className="auth-feedback" type={tone} content={children} role="alert" />;
}

export default function AuthPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { login, register } = useAuth();
  const isRegister = location.pathname === '/register';
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ tone: 'error' | 'warning'; message: string } | null>(null);
  const [registrationClosed, setRegistrationClosed] = useState(false);

  useEffect(() => {
    setNotice(null);
    setFieldErrors({});
    setRegistrationClosed(false);
    setShowPassword(false);
  }, [location.pathname]);

  function clearFieldError(field: string) {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setNotice(null);
  }

  function validate() {
    const errors: Record<string, string> = {};
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
      errors.email = '请输入有效的邮箱地址';
    }
    if (!password) errors.password = '请输入密码';
    else if (isRegister && password.length < 8) errors.password = '密码至少需要 8 位';
    else if (password.length > 128) errors.password = '密码最长为 128 位';
    if (isRegister && nickname.trim().length > 30) errors.nickname = '昵称不能超过 30 个字';
    setFieldErrors(errors);
    const first = ['nickname', 'email', 'password'].find((field) => errors[field]);
    if (first) document.getElementById(`auth-${first}`)?.focus();
    return !first;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    if (!validate()) return;

    setBusy(true);
    try {
      if (isRegister) {
        await register({
          email: email.trim().toLowerCase(),
          password,
          ...(nickname.trim() ? { nickname: nickname.trim() } : {}),
        });
      } else {
        await login(email.trim().toLowerCase(), password);
      }
      const from = (location.state as { from?: string } | null)?.from;
      navigate(returnTarget(from, '/'), { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'REGISTRATION_CLOSED') {
          setRegistrationClosed(true);
          return;
        }
        if (error.code === 'EMAIL_TAKEN') {
          setFieldErrors({ email: '该邮箱已注册，可直接登录' });
          return;
        }
        if (error.code === 'INVALID_INPUT') {
          setFieldErrors(Object.fromEntries(error.details.map((item) => [item.field, item.message])));
          return;
        }
        if (error.code === 'INVALID_CREDENTIALS') {
          setNotice({ tone: 'error', message: '邮箱或密码不正确，请检查后重试' });
          return;
        }
        if (error.code === 'TOO_MANY_ATTEMPTS') {
          setNotice({ tone: 'warning', message: '尝试次数过多，请 15 分钟后再试' });
          return;
        }
        if (error.code === 'ACCOUNT_DISABLED') {
          setNotice({ tone: 'error', message: '该账号当前不可用，请联系管理员' });
          return;
        }
        setNotice({ tone: 'error', message: error.message });
      } else {
        setNotice({ tone: 'error', message: '暂时无法连接服务，请检查网络后重试' });
      }
    } finally {
      setBusy(false);
    }
  }

  const pageTitle = isRegister ? '开启你的下一段旅程' : '欢迎回来';
  const pageSubtitle = isRegister ? '创建账号，收好每一次出发' : '登录后继续整理你的旅行素材';

  return (
    <main className="auth-page">
      <div className="auth-atmosphere" aria-hidden="true" />
      <header className="auth-topbar" data-agent-region="auth.header"><Brand /><span className="auth-topbar__hint">把每一段旅程，好好收藏</span></header>

      <section className="auth-layout">
        <div className="auth-hero" data-agent-region="auth.hero">
          <p className="auth-eyebrow"><span /> 为旅行创作者而生</p>
          <h1>走过的路，<br /><em>值得被记住。</em></h1>
          <p className="auth-hero__description">把旅途中的照片、视频与航拍素材好好收起。整理每一段故事，慢慢画出属于自己的旅行地图。</p>
          <JourneyArt />
          <div className="auth-hero__foot"><Icon name="shield" /> 私密存储 <span /> 大疆素材友好 <span /> 足迹自动归档</div>
        </div>

        <section className="auth-card" aria-labelledby="auth-heading" data-agent-region="auth.card">
          <div className="auth-card__mobile-brand"><Brand mobile /></div>
          <div className="auth-card__sheet">
          <nav className="auth-tabs" data-view={isRegister ? 'register' : 'login'} data-agent-region="auth.tabs" aria-label="账号操作">
            <Link className={!isRegister ? 'is-active' : ''} to="/login" data-agent-id="auth.tabs.login" aria-current={!isRegister ? 'page' : undefined}>登录</Link>
            <Link className={isRegister ? 'is-active' : ''} to="/register" data-agent-id="auth.tabs.register" aria-current={isRegister ? 'page' : undefined}>注册</Link>
            <span className="auth-tabs__indicator" aria-hidden="true" />
          </nav>

          {registrationClosed ? (
            <div className="auth-closed">
              <span className="auth-closed__icon"><Icon name="lock" /></span>
              <h2 id="auth-heading">暂未开放注册</h2>
              <p>当前账号仅限邀请使用。如果你已有账号，可以直接登录。</p>
              <Link className="auth-primary auth-primary--link" to="/login" data-agent-id="register.closed.backToLogin">返回登录</Link>
            </div>
          ) : (
            <>
              <div className="auth-heading">
                <h2 id="auth-heading">{pageTitle}</h2>
                <p>{pageSubtitle}</p>
              </div>

              {notice && <Feedback tone={notice.tone}>{notice.message}</Feedback>}

              <form className="auth-form" onSubmit={handleSubmit} noValidate data-agent-region={isRegister ? 'register.form' : 'login.form'}>
                {isRegister && (
                  <div className={`auth-field${fieldErrors.nickname ? ' has-error' : ''}`}>
                    <label htmlFor="auth-nickname">昵称 <small>选填</small></label>
                    <div className="auth-control"><Icon name="user" /><Input id="auth-nickname" data-agent-id="register.form.nickname" autoComplete="nickname" maxLength={30} value={nickname} onChange={(value) => { setNickname(value); clearFieldError('nickname'); }} placeholder="怎么称呼你" status={fieldErrors.nickname ? 'error' : undefined} aria-invalid={Boolean(fieldErrors.nickname)} aria-describedby={fieldErrors.nickname ? 'auth-nickname-error' : undefined} /></div>
                    {fieldErrors.nickname && <small id="auth-nickname-error" className="auth-field__error">{fieldErrors.nickname}</small>}
                  </div>
                )}

                <div className={`auth-field${fieldErrors.email ? ' has-error' : ''}`}>
                  <label htmlFor="auth-email">邮箱</label>
                  <div className="auth-control"><Icon name="mail" /><Input id="auth-email" data-agent-id={`${isRegister ? 'register' : 'login'}.form.email`} type="email" inputMode="email" autoComplete={isRegister ? 'email' : 'username'} autoCapitalize="none" spellCheck={false} value={email} onChange={(value) => { setEmail(value); clearFieldError('email'); }} placeholder="name@example.com" status={fieldErrors.email ? 'error' : undefined} aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? 'auth-email-error' : undefined} /></div>
                  {fieldErrors.email && <small id="auth-email-error" className="auth-field__error">{fieldErrors.email}</small>}
                </div>

                <div className={`auth-field${fieldErrors.password ? ' has-error' : ''}`}>
                  <label htmlFor="auth-password">密码</label>
                  <div className="auth-control"><Icon name="lock" /><Input.Password id="auth-password" data-agent-id={`${isRegister ? 'register' : 'login'}.form.password`} data-agent-ignore="true" visibility={showPassword} visibilityToggle={false} autoComplete={isRegister ? 'new-password' : 'current-password'} value={password} onChange={(value) => { setPassword(value); clearFieldError('password'); }} placeholder={isRegister ? '至少 8 位' : '请输入密码'} status={fieldErrors.password ? 'error' : undefined} aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? 'auth-password-error' : isRegister ? 'auth-password-hint' : undefined} />
                    <button className="auth-eye" type="button" data-agent-id={`${isRegister ? 'register' : 'login'}.form.togglePassword`} data-agent-label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword}><Icon name={showPassword ? 'eyeOff' : 'eye'} /></button>
                  </div>
                  {fieldErrors.password && <small id="auth-password-error" className="auth-field__error">{fieldErrors.password}</small>}
                  {isRegister && !fieldErrors.password && <small id="auth-password-hint" className="auth-field__hint">8–128 位，建议使用不重复的密码</small>}
                </div>

                <Button className="auth-primary" type="primary" htmlType="submit" loading={busy} data-agent-id={`${isRegister ? 'register' : 'login'}.form.submit`} disabled={busy} aria-disabled={busy}>
                  {busy ? isRegister ? '正在创建账号…' : '正在登录…' : isRegister ? '创建账号' : '登录'}
                </Button>
              </form>

              <p className="auth-switch">{isRegister ? '已经有账号？' : '还没有账号？'} <Link to={isRegister ? '/login' : '/register'} data-agent-id={isRegister ? 'register.switch.login' : 'login.switch.register'}>{isRegister ? '去登录' : '创建一个'}</Link></p>
              <div className="auth-benefits"><span><Icon name="shield" /> 私密存储</span><span><Icon name="cloud" /> 大文件友好</span><span><Icon name="pin" /> 足迹归档</span></div>
            </>
          )}
          </div>
        </section>
      </section>

      <footer className="auth-footer">© 2026 迹光 <span>为每一次出发，留一份坐标</span></footer>
    </main>
  );
}
