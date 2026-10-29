import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Progress } from '@arco-design/web-react';
import { ApiError } from '@/services/api';
import { parseAutomaticLocation } from '@/services/media-location';
import type { AutomaticLocation, SelectedMedia } from '@/services/media-location';
import { joinPhoneOnce, phoneUploadsApi, uploadFromPhone } from '@/services/phone-uploads';
import type { PhoneStatus } from '@/services/phone-uploads';
import { UploadRegistrationError } from '@/services/uploads';
import type { UploadCredentials, UploadTaskController } from '@/services/uploads';
import '@/styles/phone-upload.css';

type Item = { id: string; media: SelectedMedia; batch: readonly SelectedMedia[]; status: 'queued' | 'uploading' | 'registering' | 'completed' | 'failed' | 'registration_failed'; progress: number; credentials: UploadCredentials | null; location: AutomaticLocation | null; error: string };
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024;
const MAX_FILES = 100;
const sessions = new Map<string, string>();

function failure(cause: unknown) {
  if (cause instanceof ApiError && (cause.code === 'PAIRING_INACTIVE' || cause.code === 'PAIRING_FORBIDDEN')) return '电脑授权已结束，请重新扫码';
  return cause instanceof Error ? cause.message : '操作失败，请稍后重试';
}

export default function PhoneUploadPage() {
  const { id = '' } = useParams();
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const itemsRef = useRef<Item[]>([]);
  const controllerRef = useRef<UploadTaskController | null>(null);
  const runningRef = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function updateItems(fn: (current: Item[]) => Item[]) {
    const next = fn(itemsRef.current);
    itemsRef.current = next;
    setItems(next);
  }
  function updateItem(itemId: string, patch: Partial<Item>) {
    updateItems((current) => current.map((item) => item.id === itemId ? { ...item, ...patch } : item));
  }

  useEffect(() => {
    if (!/^[a-f\d]{24}$/i.test(id)) { setError('扫码链接无效'); return; }
    let active = true;
    const storageKey = `phone-upload:${id}`;
    const secretKey = `${storageKey}:pending`;
    const secret = window.location.hash.slice(1) || window.sessionStorage.getItem(secretKey) || '';
    if (/^[A-Za-z0-9_-]{43}$/.test(secret)) window.sessionStorage.setItem(secretKey, secret);
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    let deviceToken = sessions.get(storageKey) || window.sessionStorage.getItem(storageKey);
    if (!deviceToken && /^[A-Za-z0-9_-]{43}$/.test(secret)) {
      deviceToken = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      sessions.set(storageKey, deviceToken);
      window.sessionStorage.setItem(storageKey, deviceToken);
    }
    if (deviceToken) {
      const savedDevice = deviceToken;
      const connect = () => joinPhoneOnce(id, secret, savedDevice).then((joined) => {
        window.sessionStorage.removeItem(secretKey);
        if (active) { setToken(savedDevice); setCode(joined.code); }
      }).catch((cause: unknown) => { if (active) setError(failure(cause)); });
      if (/^[A-Za-z0-9_-]{43}$/.test(secret)) {
        phoneUploadsApi.status(id, savedDevice).then((next) => {
          window.sessionStorage.removeItem(secretKey);
          if (active) { setToken(savedDevice); setStatus(next); setCode(next.code ?? ''); }
        }).catch(() => { void connect(); });
      } else { setToken(savedDevice); }
    } else { setError('扫码链接已失效，请在电脑上重新生成二维码'); }
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    if (!token || status?.status === 'revoked') return;
    let active = true;
    let fetching = false;
    const poll = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const next = await phoneUploadsApi.status(id, token);
        if (active) { setStatus(next); setCode(next.code ?? ''); setError(''); }
      } catch (cause) {
        if (active) {
          setError(failure(cause));
          if (cause instanceof ApiError && (cause.status === 403 || cause.status === 410)) setStatus((previous) => previous && { ...previous, status: 'revoked' });
        }
      } finally { fetching = false; }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [id, token, status?.status]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!runningRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('beforeunload', beforeUnload); controllerRef.current?.cancel(); };
  }, []);

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (itemsRef.current.length + files.length > MAX_FILES) { setError('每次扫码最多选择 100 个文件'); return; }
    if (files.some((file) => file.size > MAX_FILE_SIZE)) { setError('单个文件不能超过 5 GB'); return; }
    if (!files.length) return;
    setError('');
    const batchId = crypto.randomUUID();
    const batch = files.map((file) => ({ file, batchId }));
    updateItems((current) => [...current, ...batch.map((media) => ({ id: crypto.randomUUID(), media, batch, status: 'queued' as const, progress: 0, credentials: null, location: null, error: '' }))]);
  }

  async function startUpload() {
    if (runningRef.current || !token || status?.status !== 'approved') return;
    runningRef.current = true;
    setRunning(true);
    try {
      while (true) {
        const item = itemsRef.current.find((entry) => entry.status === 'queued');
        if (!item) break;
        updateItem(item.id, { status: 'uploading', progress: 0, error: '' });
        try {
          const location = await parseAutomaticLocation(item.media, item.batch);
          updateItem(item.id, { location });
          await uploadFromPhone(item.media.file, id, token, {
            onCredentials(credentials) { updateItem(item.id, { credentials }); },
            onTaskReady(controller) { controllerRef.current = controller; },
            onProgress(progress) { updateItem(item.id, { progress: progress.percent * 100 }); },
            onRegistering() { updateItem(item.id, { status: 'registering', progress: 100 }); },
            isCancelled() { return false; },
          }, location);
          controllerRef.current = null;
          updateItem(item.id, { status: 'completed', progress: 100, error: '', credentials: null });
        } catch (cause) {
          controllerRef.current = null;
          updateItem(item.id, { status: cause instanceof UploadRegistrationError ? 'registration_failed' : 'failed', progress: cause instanceof UploadRegistrationError ? 100 : 0, error: failure(cause) });
        }
      }
    } finally { runningRef.current = false; setRunning(false); }
  }

  async function retry(item: Item) {
    if (item.status === 'registration_failed' && item.credentials) {
      updateItem(item.id, { status: 'registering', error: '' });
      try {
        await phoneUploadsApi.complete(id, token, item.credentials.uploadId, item.location);
        updateItem(item.id, { status: 'completed', error: '', credentials: null });
      } catch (cause) { updateItem(item.id, { status: 'registration_failed', error: failure(cause) }); }
    } else {
      updateItem(item.id, { status: 'queued', error: '', progress: 0 });
      void startUpload();
    }
  }

  const approved = status?.status === 'approved';
  return (
    <main className="phone-upload-page" data-agent-region="phoneUpload.page">
      <div className="phone-upload-shell">
        <header className="phone-upload-brand"><img src={`${import.meta.env.BASE_URL}brand-mark.svg`} alt="" />迹光 <span>· 手机上传</span></header>
        <section className="phone-upload-card" data-agent-region="phoneUpload.pairing">
          <span className="phone-upload-eyebrow">PRIVATE TRANSFER</span>
          <h1>{approved ? '把旅途照片传到迹光' : status?.status === 'awaiting' ? '等待电脑确认' : '连接电脑上传'}</h1>
          {status?.status === 'awaiting' && <><p>请在电脑上核对下面的配对码，再点击“确认授权”。</p><strong className="phone-upload-code">{code}</strong></>}
          {approved && <p>已获得本次上传权限 · 上传到“{status.folderName}”。仅上传你亲自选择的照片或视频，电脑可以随时结束授权。</p>}
          {(status?.status === 'revoked' || status?.status === 'expired') && <p>本次扫码上传已结束，请让电脑重新生成二维码。</p>}
          {!status && !error && <p>正在连接电脑，请稍候…</p>}
          {error && <p className="phone-upload-error" role="alert">{error}</p>}
        </section>
        {(approved || items.length > 0) && <section className="phone-upload-card" data-agent-region="phoneUpload.files">
          <h2>选择手机文件</h2>
          <p>支持从系统相册选取多张照片或视频。文件从手机直接上传到私有云空间，不会写入电脑本地硬盘。</p>
          {approved && <><input ref={fileInput} className="phone-upload-hidden-input" type="file" accept="image/*,video/*,.srt" multiple aria-label="从手机相册选择照片或视频" data-agent-ignore="true" tabIndex={-1} onChange={chooseFiles} />
          <div className="phone-upload-toolbar"><Button htmlType="button" data-agent-id="phoneUpload.files.choose" onClick={() => fileInput.current?.click()}>选择照片或视频</Button><Button type="primary" htmlType="button" data-agent-id="phoneUpload.files.start" disabled={running || !items.some((item) => item.status === 'queued')} onClick={() => void startUpload()}>{running ? '上传中…' : '开始上传'}</Button></div></>}
          {items.length > 0 && <ul className="phone-upload-list" aria-live="polite">{items.map((item) => <li key={item.id} data-agent-region={`phoneUpload.files.row.${item.id}`}><div className="phone-upload-file-title"><b>{item.media.file.name}</b><small>{item.status === 'completed' ? '已完成' : item.status === 'registering' ? '正在登记' : item.status === 'uploading' ? '上传中' : item.status === 'queued' ? '等待上传' : '上传失败'}</small></div><Progress percent={item.progress} showText={false} strokeWidth={5} /><p>{item.error || `${(item.media.file.size / 1024 / 1024).toFixed(1)} MB`}</p>{(item.status === 'failed' || item.status === 'registration_failed') && <Button size="small" htmlType="button" data-agent-id={`phoneUpload.files.row.${item.id}.retry`} disabled={running || !approved} onClick={() => void retry(item)}>{item.status === 'registration_failed' ? '重试登记' : '重试上传'}</Button>}</li>)}</ul>}
        </section>}
        <p className="phone-upload-footnote">扫码上传最多 100 个文件、单文件不超过 5 GB。离开或刷新页面会中断当前传输。</p>
      </div>
    </main>
  );
}
