import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@arco-design/web-react';
import { ApiError } from '@/services/api';
import { notePairsApi } from '@/services/notes';
import type { PhoneNoteStatus } from '@/services/notes';
import '@/styles/shares.css';

const errorText = (cause: unknown) => cause instanceof Error ? cause.message : '操作失败，请稍后重试';

export default function PhoneNotePage() {
  const { id = '' } = useParams();
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<PhoneNoteStatus | null>(null);
  const [note, setNote] = useState<{ title: string; content: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!/^[a-f\d]{24}$/i.test(id)) { setError('扫码链接无效'); return; }
    let active = true;
    const key = `phone-note:${id}`;
    const fragment = window.location.hash.slice(1);
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    setCode(window.sessionStorage.getItem(`${key}:code`) ?? '');
    const secret = fragment || window.sessionStorage.getItem(`${key}:pending`) || '';
    if (/^[A-Za-z0-9_-]{43}$/.test(secret)) window.sessionStorage.setItem(`${key}:pending`, secret);
    let deviceToken = window.sessionStorage.getItem(key);
    if (!deviceToken && /^[A-Za-z0-9_-]{43}$/.test(secret)) {
      deviceToken = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      window.sessionStorage.setItem(key, deviceToken);
    }
    if (!deviceToken) { setError('扫码链接已失效，请在电脑上重新生成'); return; }
    const currentToken = deviceToken;
    const join = () => notePairsApi.join(id, secret, currentToken).then((joined) => {
      window.sessionStorage.removeItem(`${key}:pending`);
      window.sessionStorage.setItem(`${key}:code`, joined.code);
      if (active) { setToken(currentToken); setCode(joined.code); setStatus({ status: joined.status, approvedUntil: null }); }
    }).catch((cause: unknown) => { if (active) setError(errorText(cause)); });
    if (/^[A-Za-z0-9_-]{43}$/.test(secret)) {
      void notePairsApi.status(id, currentToken).then((next) => {
        window.sessionStorage.removeItem(`${key}:pending`);
        if (active) { setToken(currentToken); setStatus(next); }
      }).catch(join);
    } else { setToken(currentToken); }
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    if (!token || status?.status === 'revoked' || status?.status === 'expired') return;
    let active = true;
    let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await notePairsApi.status(id, token);
        if (!active) return;
        setStatus(next); setError('');
        if (next.status !== 'approved') { setNote(null); setCopied(false); }
        if (next.status === 'approved' && !note) {
          const result = await notePairsApi.content(id, token);
          if (active) setNote(result.note);
        }
      } catch (cause) {
        if (active) {
          setError(errorText(cause));
          if (cause instanceof ApiError && [403, 404, 410].includes(cause.status)) {
            setStatus({ status: 'revoked', approvedUntil: null }); setNote(null); setCopied(false);
            window.sessionStorage.removeItem(`phone-note:${id}:code`);
          }
        }
      } finally { pending = false; }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [id, token, status?.status, Boolean(note)]);

  async function copyText() {
    if (!note || status?.status !== 'approved') return;
    try { await navigator.clipboard.writeText(note.content); setCopied(true); }
    catch { setError('复制失败，请长按正文手动选中复制'); }
  }

  return <main className="phone-note-page" data-agent-region="phoneNote.main"><header><img src={`${import.meta.env.BASE_URL}brand-mark.svg`} alt="" /><strong>迹光</strong><span>安全取回笔记</span></header><section className="phone-note-card"><small>PHONE NOTES / 仅此一篇</small><h1>{note ? note.title : '从电脑取回文字'}</h1>
    {error && <p role="alert" className="share-alert">{error}</p>}
    {status?.status === 'awaiting' && <><p>请在电脑端核对下面的六位码，并确认允许这部手机读取。</p><strong className="phone-note-code" data-agent-ignore="true">{code || '••••••'}</strong></>}
    {status?.status === 'approved' && !note && <p role="status">电脑已确认，正在读取这篇笔记…</p>}
    {note && status?.status === 'approved' && <><p className="phone-note-text" data-agent-ignore="true">{note.content}</p><Button type="primary" size="large" htmlType="button" data-agent-id="phoneNote.content.copy" onClick={() => void copyText()}>{copied ? '已复制' : '复制文字'}</Button><p className="phone-note-hint">短时只读授权；复制到剪贴板后的内容不受撤销控制。</p></>}
    {(status?.status === 'revoked' || status?.status === 'expired') && <p>本次读取授权已结束，请在电脑上重新生成二维码。</p>}
    {!status && !error && <p role="status">正在连接电脑，请稍候…</p>}
  </section><footer>迹光 · 让旅途留下光</footer></main>;
}
