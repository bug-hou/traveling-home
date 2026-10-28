import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Button, Input } from '@arco-design/web-react';
import { ApiError } from '@/services/api';
import { useAuth } from '@/features/auth/AuthProvider';
import '@/styles/account.css';

export default function AccountPage() {
  const { user, logout, changePassword, changeHandle } = useAuth();
  const navigate = useNavigate();
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [handle, setHandle] = useState(user?.publicHandle ?? '');
  const [handleBusy, setHandleBusy] = useState(false);
  const [handleMessage, setHandleMessage] = useState('');

  async function saveHandle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHandleBusy(true);
    setHandleMessage('');
    try {
      await changeHandle(handle.trim().toLowerCase());
      setHandleMessage('公开用户名已保存；旧分享链接继续有效。');
    } catch (error) {
      setHandleMessage(error instanceof Error ? error.message : '保存失败，请重试');
    } finally { setHandleBusy(false); }
  }

  function closePasswordForm() {
    if (busy) return;
    setShowPasswordForm(false);
    setCurrentPassword('');
    setNewPassword('');
    setPasswordError('');
    setPasswordSuccess(false);
  }

  async function handleLogout() {
    setLogoutBusy(true);
    setLogoutError('');
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch {
      setLogoutError('退出请求未完成，请检查网络后重试。为避免会话仍有效，本页不会伪装成已退出。');
    } finally {
      setLogoutBusy(false);
    }
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError('');
    setPasswordSuccess(false);
    if (newPassword.length < 8 || newPassword.length > 128) {
      setPasswordError('新密码需要为 8–128 位');
      return;
    }
    setBusy(true);
    try {
      await changePassword({ currentPassword, newPassword });
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
    } catch (error) {
      if (error instanceof ApiError) {
        setPasswordError(error.code === 'WRONG_PASSWORD' ? '当前密码不正确' : error.message);
      } else {
        setPasswordError('暂时无法连接服务，请重试');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="account-page">
      <header className="account-topbar" data-agent-region="account.header">
        <Link className="account-brand" to="/" aria-label="迹光" data-agent-id="account.header.brand">
          <img src={`${import.meta.env.BASE_URL}brand-mark.svg`} alt="" /><b>迹光</b><span>旅行素材网盘</span>
        </Link>
        <Button className="account-logout" htmlType="button" data-agent-id="account.header.logout" onClick={handleLogout} loading={logoutBusy} disabled={logoutBusy} aria-disabled={logoutBusy}>{logoutBusy ? '正在退出…' : '退出登录'}</Button>
      </header>

      <div className="account-content">
        {logoutError && <Alert className="account-alert" type="error" content={logoutError} role="alert" />}
        <div className="account-intro">
          <p className="account-eyebrow">你的旅程，从这里开始</p>
          <h1>欢迎回来，{user?.nickname || '旅行者'}</h1>
          <p>账号已连接。接下来，你的素材库与足迹地图会在这里汇合。</p>
        </div>

        <section className="account-profile" data-agent-region="account.profile">
          <div className="account-avatar" aria-hidden="true">{(user?.nickname || user?.email || '旅').slice(0, 1).toUpperCase()}</div>
          <div className="account-profile__info"><small>当前登录账号</small><b>{user?.email}</b><span>{user?.role === 'admin' ? '管理员' : '个人账号'}</span></div>
          <span className="account-online"><i /> 已登录</span>
        </section>

        <section className="account-next">
          <div className="account-next__icon" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><rect x="4" y="4" width="40" height="40" rx="13" fill="currentColor" opacity=".1"/><path d="M13 30.5 20 23l5 4 9-11" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/><circle cx="34" cy="16" r="3" fill="currentColor"/><path d="M13 35h22" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></div>
          <div><h2>开始整理你的旅行素材</h2><p>在文件空间浏览和整理已上传的照片、视频与音频。</p></div>
          <div className="account-next__actions"><Link className="account-next__link" to="/files" data-agent-id="account.next.openFiles">查看文件 <span aria-hidden="true">→</span></Link><Link className="account-next__link" to="/upload" data-agent-id="account.next.openUpload">开始上传 <span aria-hidden="true">↑</span></Link></div>
        </section>

        <section className="account-security" data-agent-region="account.handle">
          <div><h2>分享链接用户名</h2><p>全站唯一，修改后旧链接保留；账号内部 ID 不会变化。</p></div>
          <Link className="account-next__link" to="/shares" data-agent-id="account.handle.openShares">我的分享 →</Link>
          <form className="account-password-form" onSubmit={saveHandle}>
            <label>公开用户名<Input value={handle} onChange={setHandle} minLength={3} maxLength={30} placeholder="例如 travel-notes" data-agent-id="account.handle.input" autoComplete="off" /></label>
            <small>以字母开头，3–30 位小写字母、数字或连字符；网址为 share.convenience.top/用户名/自定义路径</small>
            {handleMessage && <p role="status">{handleMessage}</p>}
            <div className="account-form-actions"><Button htmlType="submit" type="primary" loading={handleBusy} disabled={handleBusy || handle.trim() === user?.publicHandle} data-agent-id="account.handle.save">保存用户名</Button></div>
          </form>
        </section>

        <section className="account-security" data-agent-region="account.security">
          <div><h2>账号安全</h2><p>保护账号访问与个人素材</p></div>
          {!showPasswordForm && <Button className="account-secondary" htmlType="button" data-agent-id="account.security.openPasswordForm" onClick={() => setShowPasswordForm(true)}>修改密码</Button>}
          {showPasswordForm && (
            <form className="account-password-form" onSubmit={handleChangePassword} data-agent-region="account.passwordForm">
              <label>当前密码<Input.Password data-agent-id="account.passwordForm.currentPassword" data-agent-ignore="true" visibilityToggle={false} autoFocus autoComplete="current-password" value={currentPassword} onChange={setCurrentPassword} required /></label>
              <label>新密码<Input.Password data-agent-id="account.passwordForm.newPassword" data-agent-ignore="true" visibilityToggle={false} autoComplete="new-password" minLength={8} maxLength={128} value={newPassword} onChange={setNewPassword} required /></label>
              {passwordError && <Alert className="account-alert" type="error" content={passwordError} role="alert" />}
              {passwordSuccess && <Alert className="account-alert" type="success" content="密码已更新，其他设备需要重新登录。" role="status" />}
              <div className="account-form-actions"><Button className="account-secondary" htmlType="button" data-agent-id="account.passwordForm.cancel" disabled={busy} onClick={closePasswordForm}>取消</Button><Button className="account-primary" type="primary" htmlType="submit" data-agent-id="account.passwordForm.submit" loading={busy} disabled={busy} aria-disabled={busy}>{busy ? '保存中…' : '保存新密码'}</Button></div>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
