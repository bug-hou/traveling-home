import { Modal } from '@arco-design/web-react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { WorkspaceMobileNavigation, WorkspaceNavigation } from '@/components/WorkspaceNavigation';
import { useAuth } from '@/features/auth/AuthProvider';
import { homeApi } from '@/services/home';
import type { HomeSummary, ModuleStatus, RecentFile } from '@/services/home';
import { nodesApi } from '@/services/nodes';
import type { NodeAccess } from '@/services/nodes';
import '@/styles/home.css';

const PHOTO_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const SMALL_IMAGE = 2 * 1024 * 1024;
const MAX_IMAGE = 30 * 1024 * 1024;
const getHomePopupContainer = () => document.querySelector('.home-page') ?? document.body;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = bytes / 1024;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index++; }
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[index]}`;
}

function valueOrState(status: ModuleStatus | undefined, value: string | number | null | undefined) {
  if (!status) return '加载中';
  if (status === 'not_ready') return '准备中';
  if (status === 'unavailable') return '暂不可用';
  return value ?? '—';
}

function fileKind(file: RecentFile) {
  if (file.mime?.startsWith('image/')) return '图片';
  if (file.mime?.startsWith('video/')) return '视频';
  if (file.mime?.startsWith('audio/')) return '音频';
  return '文件';
}

function RecentImage({ file }: { file: RecentFile }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const eligible = PHOTO_MIMES.has(file.mime?.toLowerCase() ?? '') && file.size > 0 && file.size <= MAX_IMAGE;
  useEffect(() => {
    if (!eligible) return;
    let active = true;
    let expiryTimer: number | undefined;
    const controller = new AbortController();
    nodesApi.access(file.id, file.size <= SMALL_IMAGE ? 'preview' : 'thumbnail', controller.signal)
      .then((result) => {
        if (!active || !result.previewable || !result.mime.startsWith('image/')) return;
        const lifetime = new Date(result.expiresAt).getTime() - Date.now() - 30_000;
        if (lifetime <= 0) return;
        setUrl(result.url);
        expiryTimer = window.setTimeout(() => { if (active) { setUrl(null); setLoaded(false); } }, lifetime);
      })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; controller.abort(); window.clearTimeout(expiryTimer); };
  }, [eligible, file.id, file.size]);
  return <span className="home-media-art" data-agent-ignore="true">
    <span aria-hidden="true">{fileKind(file) === '视频' ? '▶' : fileKind(file) === '音频' ? '♫' : '▧'}</span>
    {url && !failed && <img src={url} alt="" aria-hidden="true" loading="lazy" decoding="async" referrerPolicy="no-referrer" className={loaded ? 'is-loaded' : ''} onLoad={() => setLoaded(true)} onError={() => { setFailed(true); setUrl(null); }} />}
    <small>{fileKind(file)}</small>
  </span>;
}

export default function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<RecentFile | null>(null);
  const [access, setAccess] = useState<NodeAccess | null>(null);
  const [previewError, setPreviewError] = useState('');

  useEffect(() => {
    let active = true;
    homeApi.summary().then((result) => { if (active) { setSummary(result); setError(''); } })
      .catch((cause: unknown) => { if (active) { setSummary(null); setError(cause instanceof Error ? cause.message : '首页暂时无法加载'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);

  useEffect(() => {
    if (!preview) return;
    let active = true;
    setAccess(null);
    setPreviewError('');
    nodesApi.access(preview.id, 'preview').then((result) => { if (active) setAccess(result); })
      .catch((cause: unknown) => { if (active) setPreviewError(cause instanceof Error ? cause.message : '无法获取预览链接'); });
    return () => { active = false; };
  }, [preview]);

  function searchFiles(event: FormEvent) {
    event.preventDefault();
    if (search.trim()) navigate(`/files?${new URLSearchParams({ q: search.trim().slice(0, 100) })}`);
  }

  function retry() { setLoading(true); setRevision((value) => value + 1); }
  function closePreview() { setPreview(null); setAccess(null); }
  async function download() {
    if (!preview) return;
    try {
      const signed = await nodesApi.access(preview.id, 'download');
      const anchor = document.createElement('a');
      anchor.href = signed.url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.click();
    } catch (cause) { setPreviewError(cause instanceof Error ? cause.message : '下载暂不可用'); }
  }

  const now = new Date();
  const greeting = now.getHours() < 11 ? '早上好' : now.getHours() < 18 ? '下午好' : '晚上好';
  const date = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(now);
  const files = summary?.files;
  const storage = summary?.storage;
  const footprint = summary?.footprint;
  const trips = summary?.trips;
  const firstUpload = files?.status === 'empty';

  return <div className="home-page">
    <aside className="home-sidebar" data-agent-region="home.nav" aria-label="工作空间">
      <Link to="/" className="home-brand" data-agent-id="nav.home.brand"><img src={`${import.meta.env.BASE_URL}brand-mark.svg`} alt="" />迹光</Link>
      <small className="home-caption">工作空间</small>
      <WorkspaceNavigation />
      <div className="home-sidebar-bottom">
        <div className="home-storage-mini"><span>云端空间</span><strong>{valueOrState(storage?.status, storage?.usedBytes == null ? null : formatBytes(storage.usedBytes))}</strong><small>已入库文件占用 · 暂无配额限制</small></div>
        <Link to="/settings/account" className="home-profile" data-agent-id="nav.account"><span>{(user?.nickname || '旅').slice(0, 1)}</span><b>{user?.nickname || '个人空间'}</b><small>账号设置 →</small></Link>
      </div>
    </aside>
    <main className="home-main">
      <header className="home-topbar" data-agent-region="home.header"><span className="home-breadcrumb">工作空间 / <b>首页</b></span><div className="home-topbar-actions"><form onSubmit={searchFiles} role="search"><input value={search} onChange={(event) => setSearch(event.target.value)} data-agent-id="home.header.search" aria-label="搜索文件名称" placeholder="搜索文件名称" maxLength={100} /><button type="submit" data-agent-id="home.header.searchSubmit" aria-label="搜索文件">⌕</button></form><Link to="/upload" className="home-upload" data-agent-id="home.header.upload">↑ <span>上传素材</span></Link></div></header>
      <div className="home-dashboard">
        <section className="home-welcome" data-agent-region="home.welcome"><div><small>{date} &nbsp; / &nbsp; 个人工作空间</small><h1>{greeting}，{user?.nickname || '旅行者'}。</h1><p>照片、足迹与旅途，都在这里好好收藏。</p></div>{firstUpload && <Link to="/upload" data-agent-id="home.welcome.upload">上传第一批素材 →</Link>}</section>
        <section className="home-hero"><div className="home-hero-copy"><small>迹光 / 旅行素材空间</small><h2>走过的路，<br />值得被记住。</h2><p>收好每一帧风景，整理每一段旅途。<br />从这里开始，慢慢画出自己的旅行地图。</p><Link to="/upload" data-agent-id="home.hero.upload">开始整理 <span>→</span></Link></div><div className="home-hero-art" aria-hidden="true"><div className="home-hero-print"><div className="home-hero-landscape"><span className="home-hero-sun" /><span className="home-hero-ridge home-hero-ridge--back" /><span className="home-hero-ridge home-hero-ridge--front" /></div><div className="home-hero-print-caption"><span>01 / JOURNAL</span><span>让旅途，留在这里</span></div></div><small>COLLECT · REMEMBER · EXPLORE</small></div></section>
        {(error || storage?.status === 'unavailable' || files?.status === 'unavailable') && <div className="home-alert" role="alert">{error || '部分数据暂不可用'}<button type="button" onClick={retry} data-agent-id="home.summary.retry">重新加载</button></div>}
        {loading && <p className="home-status" role="status">正在汇总你的旅行素材…</p>}
        {firstUpload && <section className="home-onboarding" data-agent-region="home.onboarding"><span>↑</span><div><small>从这里开始</small><b>先上传一份旅行素材</b><p>上传完成后，首页会自动汇总空间和最近素材。</p></div><Link to="/upload" data-agent-id="home.onboarding.upload">选择素材上传 →</Link></section>}
        <section className="home-stats" data-agent-region="home.overview" aria-label="空间概览">
          <article><span className="home-stat-icon">▤</span><small>素材总数</small><b>{valueOrState(files?.status, files?.totalFiles)}</b><span>照片 · 视频 · 音频</span></article>
          <article><span className="home-stat-icon home-stat-icon--blue">◉</span><small>已使用空间</small><b>{valueOrState(storage?.status, storage?.usedBytes == null ? null : formatBytes(storage.usedBytes))}</b><span>已登记的活动文件</span></article>
          <article><span className="home-stat-icon home-stat-icon--coral">⌖</span><small>点亮县区</small><b>{valueOrState(footprint?.status, footprint?.countyCount)}</b><span>位置解析尚未接通</span></article>
          <article><span className="home-stat-icon home-stat-icon--gold">▦</span><small>旅行记录</small><b>{valueOrState(trips?.status, trips?.count)}</b><span>旅行功能正在准备中</span></article>
        </section>
        <div className="home-content-grid">
          <section className="home-panel home-footprint" data-agent-region="home.footprint"><div className="home-panel-heading"><div><small>MY FOOTPRINT</small><h2>我的足迹</h2></div><span>准备中</span></div><div className="home-placeholder"><span aria-hidden="true">⌖</span><strong>你的足迹地图，等第一枚坐标</strong><p>位置解析和县级归属仍在建设中，暂不会把素材统计为已点亮地区。</p></div></section>
          <section className="home-panel home-space" data-agent-region="home.storage"><div className="home-panel-heading"><div><small>YOUR CLOUD</small><h2>云端空间</h2></div></div>{storage?.status === 'ready' || storage?.status === 'empty' ? <div className="home-space-details"><div className="home-space-ring"><strong>{formatBytes(storage.usedBytes ?? 0)}</strong><small>已用空间</small></div><p>未设置空间配额；仅统计已入库且未删除的文件。</p><div className="home-breakdown">{([['视频', storage.breakdown?.videoBytes], ['图片', storage.breakdown?.imageBytes], ['音频', storage.breakdown?.audioBytes], ['其他', storage.breakdown?.otherBytes]] as const).map(([label, value]) => <div key={label}><span>{label}</span><b>{formatBytes(value ?? 0)}</b></div>)}</div><Link to="/files" data-agent-id="home.storage.viewFiles">查看全部文件 →</Link></div> : <div className="home-placeholder"><span aria-hidden="true">◉</span><strong>{storage?.status === 'unavailable' ? '空间数据暂不可用' : '空间情况即将呈现'}</strong><p>上传后，这里会显示已使用空间和素材类型。</p></div>}</section>
          <section className="home-panel home-recents" data-agent-region="home.recentFiles"><div className="home-panel-heading"><div><small>RECENTLY ADDED</small><h2>最近素材</h2></div><Link to="/files" data-agent-id="home.recentFiles.all">全部素材 →</Link></div>{files?.status === 'ready' && files.recent.length ? <div className="home-media-grid">{files.recent.map((file) => <button type="button" className="home-media-card" key={file.id} data-agent-id={`home.recentFiles.open.${file.id}`} onClick={() => setPreview(file)}><RecentImage file={file} /><b title={file.name}>{file.name}</b><small>{file.uploadedAt ? new Date(file.uploadedAt).toLocaleDateString('zh-CN') : '上传日期未知'} · {formatBytes(file.size)}</small></button>)}</div> : <div className="home-placeholder"><span aria-hidden="true">▤</span><strong>{files?.status === 'unavailable' ? '最近素材暂不可用' : files?.status === 'not_ready' ? '最近素材准备中' : '最近素材会出现在这里'}</strong><p>已上传的照片、视频和音频可以从这里继续浏览。</p></div>}</section>
          <section className="home-panel home-trips" data-agent-region="home.recentTrips"><div className="home-panel-heading"><div><small>YOUR JOURNEYS</small><h2>最近旅行</h2></div><span>准备中</span></div><div className="home-placeholder"><span aria-hidden="true">▦</span><strong>下一段旅行，等你出发</strong><p>旅行记录能力尚未接通，暂不展示示例旅程。</p></div></section>
        </div>
        <footer className="home-footer">每一段旅程，都会成为你自己的地图。 <span>数据仅存于你的私人空间</span></footer>
      </div>
    </main>
    <WorkspaceMobileNavigation className="home-mobile-nav" region="home.nav" />
    {preview && <Modal visible className="home-preview-modal" getPopupContainer={getHomePopupContainer} data-agent-region="home.preview" title={preview.name} closable={false} footer={null} maskClosable={false} onCancel={closePreview}><button type="button" className="home-preview-close" aria-label="关闭预览" data-agent-id="home.preview.close" onClick={closePreview}>×</button><div className="home-preview-body" data-agent-ignore="true">{previewError && <p role="alert">{previewError}</p>}{!access && !previewError && <p>正在获取私有访问链接…</p>}{access && (access.previewable ? access.mime.startsWith('image/') ? <img src={access.url} alt={preview.name} referrerPolicy="no-referrer" onError={() => setPreviewError('图片无法加载，请下载原文件')} /> : access.mime.startsWith('video/') ? <video src={access.url} controls onError={() => setPreviewError('视频暂无法播放，请下载原文件')} /> : access.mime.startsWith('audio/') ? <audio src={access.url} controls onError={() => setPreviewError('音频暂无法播放，请下载原文件')} /> : null : <p>当前格式不支持在线预览，可以下载原文件。</p>)}</div><div className="home-preview-actions"><span>{formatBytes(preview.size)} · {fileKind(preview)}</span><button type="button" data-agent-id="home.preview.download" onClick={() => void download()}>下载原文件</button></div></Modal>}
  </div>;
}
