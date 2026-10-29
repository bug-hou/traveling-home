import { useEffect, useState } from 'react';
import { Button } from '@arco-design/web-react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { phoneUploadsApi } from '@/services/phone-uploads';
import type { PairStatus, PhonePair } from '@/services/phone-uploads';

export default function PhonePairPanel({ parentId, folderName, onActiveChange }: {
  parentId: string | null;
  folderName: string;
  onActiveChange(active: boolean): void;
}) {
  const [pair, setPair] = useState<PhonePair | null>(null);
  const [status, setStatus] = useState<PairStatus | null>(null);
  const [qr, setQr] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    phoneUploadsApi.active(parentId).then((found) => {
      if (active && found.id) {
        setPair({ id: found.id, secret: '', joinUntil: '' });
        onActiveChange(true);
      }
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : '无法恢复扫码会话'); })
      .finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, [parentId, onActiveChange]);

  useEffect(() => {
    if (!pair?.secret) return;
    let active = true;
    const url = new URL(`phone-upload/${pair.id}`, new URL(import.meta.env.BASE_URL, window.location.origin));
    url.hash = pair.secret;
    QRCode.toDataURL(url.toString(), { width: 256, margin: 2, errorCorrectionLevel: 'M' })
      .then((value) => { if (active) setQr(value); })
      .catch(() => { if (active) setError('无法生成二维码，请结束本次会话后重试'); });
    return () => { active = false; };
  }, [pair]);

  useEffect(() => {
    if (!pair || status?.status === 'expired' || status?.status === 'revoked') return;
    let active = true;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const next = await phoneUploadsApi.read(pair.id);
        if (active) {
          setStatus(next);
          setError('');
          if (next.status === 'expired' || next.status === 'revoked') onActiveChange(false);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : '无法读取扫码状态');
      } finally { polling = false; }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [pair, status?.status, onActiveChange]);

  async function create() {
    setBusy(true);
    setError('');
    try {
      const active = await phoneUploadsApi.active(parentId);
      if (active.id) {
        setPair({ id: active.id, secret: '', joinUntil: '' });
        setStatus(null);
        setQr('');
      } else {
        const next = await phoneUploadsApi.create(parentId);
        setPair(next);
        setQr('');
        setStatus({ status: 'pending', code: null, approvedUntil: null, completedCount: 0, recentFiles: [] });
      }
      onActiveChange(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法生成二维码');
    } finally { setBusy(false); }
  }

  async function approve() {
    if (!pair) return;
    setBusy(true);
    setError('');
    try {
      const next = await phoneUploadsApi.approve(pair.id);
      setStatus((previous) => previous && { ...previous, status: 'approved', code: null, approvedUntil: next.approvedUntil });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '授权失败，请重试');
    } finally { setBusy(false); }
  }

  async function revoke() {
    if (!pair) return;
    setBusy(true);
    setError('');
    try {
      await phoneUploadsApi.revoke(pair.id);
      setStatus((previous) => previous && { ...previous, status: 'revoked', code: null });
      onActiveChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法结束授权，请重试');
    } finally { setBusy(false); }
  }

  const current = status?.status;
  return (
    <section className="phone-pair-card" data-agent-region="upload.phonePair">
      <div className="phone-pair-heading"><span className="phone-pair-mark" aria-hidden="true">▦</span><div><h2>从手机上传</h2><p>手机无需登录，扫码后由这台电脑确认，文件会进入“{folderName}”。</p></div></div>
      {(!pair || current === 'expired' || current === 'revoked') ? (
        <div className="phone-pair-actions">
          {pair && <p role="status">本次二维码已{current === 'revoked' ? '结束' : '过期'}，可重新生成。</p>}
          <Button type="primary" htmlType="button" loading={busy || restoring} disabled={restoring} data-agent-id="upload.phonePair.create" onClick={() => void create()}>生成手机上传二维码</Button>
        </div>
      ) : (
        <div className="phone-pair-body">
          {qr && current !== 'approved' && <img className="phone-pair-qr" src={qr} alt="手机上传二维码" data-agent-ignore="true" />}
          <div className="phone-pair-detail" aria-live="polite">
            {current === 'pending' && <p>{qr ? '请用手机相机扫码，二维码约 5 分钟内有效。' : '已恢复扫码会话；原二维码不可再次显示。如需扫码请结束会话后重新生成。'}</p>}
            {current === 'awaiting' && <><p>手机已扫码，请核对手机上的配对码，再点击确认。</p><strong className="phone-pair-code">{status?.code}</strong><Button type="primary" htmlType="button" loading={busy} data-agent-id="upload.phonePair.approve" onClick={() => void approve()}>确认授权这部手机</Button></>}
            {current === 'approved' && <><p>已授权手机上传到“{folderName}”，授权有效期约 1 小时。</p><b>手机已完成 {status?.completedCount ?? 0} 个文件</b>{Boolean(status?.recentFiles.length) && <ul className="phone-pair-files" aria-label="最近完成的手机上传">{status?.recentFiles.map((file) => <li key={file.id} title={file.name}>{file.name}</li>)}</ul>}<Link to={parentId ? `/files/${parentId}` : '/files'} target="_blank" rel="noopener noreferrer" data-agent-id="upload.phonePair.viewFiles">在新标签页查看目录 →</Link></>}
            <Button htmlType="button" status="danger" data-agent-id="upload.phonePair.revoke" data-agent-danger="true" onClick={() => void revoke()} disabled={busy}>结束本次扫码上传</Button>
          </div>
        </div>
      )}
      {error && <p className="phone-pair-error" role="alert">{error}</p>}
    </section>
  );
}
