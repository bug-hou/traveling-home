import { Modal } from '@arco-design/web-react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { returnLabel, returnTarget } from '@/services/navigation';
import { WorkspaceMobileNavigation, WorkspaceNavigation } from '@/components/WorkspaceNavigation';
import { nodesApi } from '@/services/nodes';
import type { NodeAccess, NodeLocation, NodeSummary } from '@/services/nodes';
import '@/styles/preview.css';

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[index]}`;
}

function mediaKind(mime: string | null, name = '') {
  if (mime?.startsWith('image/') || /\.jpe?g$/i.test(name)) return '照片';
  if (mime?.startsWith('video/') || /\.(mp4|mov)$/i.test(name)) return '视频';
  if (mime?.startsWith('audio/')) return '音频';
  return '文件';
}

const locationSourceLabel = { exif: 'EXIF 自动定位', srt: 'DJI SRT 自动定位', manual: '手动标记' };

function coordinate(value: number, positive: string, negative: string, axis: string) {
  return `${value === 0 ? axis : value > 0 ? positive : negative} ${Math.abs(value).toFixed(4)}°`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求失败，请稍后重试';
}

export default function PreviewPage() {
  const { nodeId } = useParams();
  const pageLocation = useLocation();
  const [detail, setDetail] = useState<{ node: NodeSummary; ancestors: NodeSummary[] } | null>(null);
  const [location, setLocation] = useState<NodeLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [loadRevision, setLoadRevision] = useState(0);
  const [access, setAccess] = useState<NodeAccess | null>(null);
  const [accessError, setAccessError] = useState('');
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessRevision, setAccessRevision] = useState(0);
  const [editor, setEditor] = useState(false);
  const [placeName, setPlaceName] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const node = detail?.node;
  const parentPath = node?.parentId ? `/files/${node.parentId}` : '/files';
  const candidate = returnTarget((pageLocation.state as { from?: unknown } | null)?.from, parentPath);
  const from = candidate.startsWith('/preview') ? parentPath : candidate;
  const backLabel = from === parentPath ? '返回所在目录' : `返回${returnLabel(from)}`;

  useEffect(() => {
    if (!nodeId) return;
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    setDetail(null);
    setLocation(null);
    setAccess(null);
    Promise.all([nodesApi.detail(nodeId, controller.signal), nodesApi.location(nodeId, controller.signal)])
      .then(([result, placement]) => {
        if (!active) return;
        if (result.node.type !== 'file' || result.node.status !== 'ready') throw new Error('该素材暂不可预览');
        setDetail(result);
        setLocation(placement.location);
      })
      .catch((error: unknown) => { if (active) setLoadError(errorMessage(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [nodeId, loadRevision]);

  useEffect(() => {
    if (!node) return;
    let active = true;
    const controller = new AbortController();
    setAccess(null);
    setAccessError('');
    setAccessLoading(true);
    nodesApi.access(node.id, 'preview', controller.signal)
      .then((result) => {
        if (!active) return;
        const lifetime = new Date(result.expiresAt).getTime() - Date.now() - 30_000;
        if (lifetime <= 0) throw new Error('访问链接已过期，请重试');
        setAccess(result);
      })
      .catch((error: unknown) => { if (active) setAccessError(errorMessage(error)); })
      .finally(() => { if (active) setAccessLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [node?.id, accessRevision]);

  useEffect(() => {
    if (!access) return;
    const lifetime = new Date(access.expiresAt).getTime() - Date.now() - 30_000;
    const timer = window.setTimeout(() => {
      setAccess(null);
      setAccessError('预览链接已到期，请重新获取');
    }, Math.max(0, lifetime));
    return () => window.clearTimeout(timer);
  }, [access]);

  function openEditor() {
    setPlaceName(location?.placeName ?? '');
    setLatitude(location ? String(location.latitude) : '');
    setLongitude(location ? String(location.longitude) : '');
    setFormError('');
    setEditor(true);
  }

  async function saveLocation(event: FormEvent) {
    event.preventDefault();
    if (!node || saving) return;
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setFormError('请输入有效坐标：纬度 −90～90，经度 −180～180。');
      return;
    }
    const place = placeName.trim();
    if (place.length > 60 || /[\x00-\x1f\x7f]/.test(placeName)) { setFormError('地点名称不能超过 60 字，且不能包含控制字符。'); return; }
    setSaving(true);
    setFormError('');
    try {
      const result = await nodesApi.saveLocation(node.id, { latitude: lat, longitude: lng, placeName: place || null });
      setLocation(result.location);
      setEditor(false);
      setNotice('位置已保存到你的私有素材；足迹地图与县级归属仍在建设中。');
    } catch (error) { setFormError(errorMessage(error)); }
    finally { setSaving(false); }
  }

  async function download() {
    if (!node) return;
    try {
      const result = await nodesApi.access(node.id, 'download');
      const link = document.createElement('a');
      link.href = result.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.click();
    } catch (error) { setNotice(errorMessage(error)); }
  }

  function mediaFailed() { setAccess(null); setAccessError('无法加载此素材，请重试或下载原文件'); }

  return <div className="preview-app">
    <aside className="preview-sidebar" aria-label="主导航" data-agent-region="preview.nav">
      <Link to="/" className="preview-brand" data-agent-id="nav.home.brand"><img src={`${import.meta.env.BASE_URL}brand-mark.svg`} alt="" />迹光</Link>
      <small className="preview-sidebar-caption">工作空间</small>
      <WorkspaceNavigation />
    </aside>
    <main className="preview-main">
      <header className="preview-topbar" data-agent-region="preview.header"><span>工作空间 / 全部文件 / <b>素材预览</b></span><span>仅你本人可见</span></header>
      <div className="preview-content">
        <div className="preview-heading"><div><Link to={from} data-agent-id="preview.header.back" className="preview-back">← {backLabel}</Link><small>YOUR TRAVEL LIBRARY</small><h1>每一帧，都有来处。</h1><p>查看素材，给旅途中未标记的照片和视频补上位置。</p></div>{node && <button type="button" className="preview-download" data-agent-id="preview.header.download" onClick={() => void download()}>↓ 下载原文件</button>}</div>
        {loading && <p className="preview-page-status" role="status">正在加载素材…</p>}
        {loadError && <div className="preview-page-status" role="alert"><p>{loadError}</p><button type="button" data-agent-id="preview.load.retry" onClick={() => setLoadRevision((value) => value + 1)}>重新加载</button><Link to="/files" data-agent-id="preview.load.back">返回全部文件</Link></div>}
        {node && <div className="preview-grid">
          <section className="preview-media-panel" data-agent-region="preview.media" aria-label="素材预览">
            <div className="preview-media-head"><span className="preview-file-icon" aria-hidden="true">{mediaKind(node.mime, node.name) === '照片' ? '▧' : mediaKind(node.mime, node.name) === '视频' ? '▶' : mediaKind(node.mime, node.name) === '音频' ? '♫' : '▤'}</span><div><small>{mediaKind(node.mime, node.name)} · 私有素材</small><h2 title={node.name}>{node.name}</h2></div><span className="preview-extension">{node.name.split('.').at(-1)?.toUpperCase().slice(0, 8) || 'FILE'}</span></div>
            <div className="preview-stage">
              <div className="preview-media-source" data-agent-ignore="true">{access?.previewable && access.mime.startsWith('image/') && <img src={access.url} alt={node.name} referrerPolicy="no-referrer" onError={mediaFailed} />}{access?.previewable && access.mime.startsWith('video/') && <video src={access.url} controls onError={mediaFailed} />}{access?.previewable && access.mime.startsWith('audio/') && <audio src={access.url} controls onError={mediaFailed} />}</div>
              {accessLoading && <p role="status">正在获取私有预览链接…</p>}
              {accessError && <div className="preview-stage-message" role="alert"><p>{accessError}</p><button type="button" data-agent-id="preview.media.retry" onClick={() => setAccessRevision((value) => value + 1)}>重新获取预览</button></div>}
              {access && !access.previewable && <p>此格式不支持在线预览，可以下载原文件。</p>}
            </div>
            <div className="preview-media-foot"><span>私有素材 · 预览链接短时有效，不会公开文件</span><span>01 / 01</span></div>
          </section>
          <div className="preview-details">
            <section className="preview-card" data-agent-region="preview.details"><div className="preview-card-title"><span>▤</span><div><small>THE DETAILS</small><h2>文件信息</h2></div></div><dl><div><dt>文件类型</dt><dd>{node.mime || '未知'}</dd></div><div><dt>文件大小</dt><dd>{formatSize(node.size)}</dd></div><div><dt>上传时间</dt><dd>{node.uploadedAt ? new Date(node.uploadedAt).toLocaleString('zh-CN') : '未知'}</dd></div><div><dt>拍摄时间</dt><dd>待解析</dd></div><div><dt>拍摄设备</dt><dd>待解析</dd></div></dl><p>仅新上传 JPEG 的 EXIF GPS 和同批唯一匹配的 DJI SRT 可用于自动定位；拍摄时间与设备仍未解析。</p></section>
            <section className="preview-card preview-location" data-agent-region="preview.location"><div className="preview-card-title"><span>⌖</span><div><small>WHERE IT HAPPENED</small><h2>拍摄位置</h2></div><em>{location ? locationSourceLabel[location.source] : '未定位'}</em></div><div className="preview-map-placeholder" aria-label="位置示意，未接入真实地图"><span aria-hidden="true">⌖</span><small>地图选点准备中 · 此处不是实际地图</small></div><div className="preview-location-info"><div><small>当前位置</small><strong>{location ? location.placeName || '已定位坐标' : '未定位'}</strong><span>{location ? `${coordinate(location.longitude, '东经', '西经', '经度')}，${coordinate(location.latitude, '北纬', '南纬', '纬度')}` : '可通过经纬度手动标记'}</span></div>{(mediaKind(node.mime, node.name) === '照片' || mediaKind(node.mime, node.name) === '视频') && <button type="button" data-agent-id="preview.location.edit" onClick={openEditor}>{location ? '修改位置' : '手动标记'}</button>}</div><p>自动与手动位置均为 WGS-84；手动标记优先，足迹地图与县级归属尚未接通。</p></section>
          </div>
        </div>}
        {notice && <p className="preview-notice" role="status">{notice}</p>}
      </div>
    </main>
    <WorkspaceMobileNavigation className="preview-mobile-nav" region="preview.mobileNav" />
    {editor && <Modal visible className="preview-editor-modal" getPopupContainer={() => document.querySelector('.preview-app') ?? document.body} data-agent-region="preview.editor" title="手动标记位置" closable={false} footer={null} maskClosable={false} escToExit={!saving} onCancel={() => { if (!saving) setEditor(false); }}><form onSubmit={(event) => void saveLocation(event)}><p>请输入素材拍摄地的 WGS-84 经纬度。{location && location.source !== 'manual' ? '保存后将以手动坐标取代自动定位。' : '当前暂不支持在地图上选点。'}</p><label>地点名称（可选）<input autoFocus value={placeName} maxLength={60} onChange={(event) => setPlaceName(event.target.value)} placeholder="例如：旅途中的山谷" data-agent-id="preview.editor.placeName" /></label><div className="preview-coordinate-fields"><label>经度（−180～180）<input type="number" step="any" min={-180} max={180} inputMode="decimal" value={longitude} onChange={(event) => setLongitude(event.target.value)} data-agent-id="preview.editor.longitude" required /></label><label>纬度（−90～90）<input type="number" step="any" min={-90} max={90} inputMode="decimal" value={latitude} onChange={(event) => setLatitude(event.target.value)} data-agent-id="preview.editor.latitude" required /></label></div><small>输入顺序：经度、纬度。地点名称不会被用来推断行政区。</small>{formError && <p role="alert" className="preview-form-error">{formError}</p>}<div className="preview-editor-actions"><button type="button" disabled={saving} data-agent-id="preview.editor.cancel" onClick={() => setEditor(false)}>取消</button><button type="submit" disabled={saving} data-agent-id="preview.editor.save" data-agent-danger={location ? 'true' : undefined}>{saving ? '保存中…' : '保存位置'}</button></div></form></Modal>}
  </div>;
}
