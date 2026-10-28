import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Modal } from '@arco-design/web-react';
import { ApiError } from '@/services/api';
import { sharesApi } from '@/services/shares';
import type { PublicBrowse, PublicNode } from '@/services/shares';
import type { NodeAccess } from '@/services/nodes';
import '@/styles/shares.css';

const message = (error: unknown) => error instanceof Error ? error.message : '暂时无法打开分享，请稍后重试';
function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let number = bytes / 1024; let index = 0;
  while (number >= 1024 && index < units.length - 1) { number /= 1024; index++; }
  return `${number.toFixed(1)} ${units[index]}`;
}

export default function PublicSharePage() {
  const { handle = '', slug = '' } = useParams();
  const [passwordInput, setPasswordInput] = useState('');
  const [password, setPassword] = useState<string | undefined>();
  const [needsPassword, setNeedsPassword] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [data, setData] = useState<PublicBrowse | null>(null);
  const [view, setView] = useState<'list' | 'grid' | null>(null);
  const [folderId, setFolderId] = useState<string | undefined>();
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ node: PublicNode; access: NodeAccess } | null>(null);
  const [cover, setCover] = useState<string | null>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  const [retry, setRetry] = useState(0);
  const [accessError, setAccessError] = useState('');
  const [accessBusy, setAccessBusy] = useState(false);
  const currentView = view ?? (data?.share.mode === 'activity' ? 'grid' : 'list');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    sharesApi.browse(handle, slug, password, folderId, offset).then((result) => {
      if (!active) return;
      setData((previous) => offset && previous ? { ...result, items: [...previous.items, ...result.items] } : result);
      setNeedsPassword(false);
      setNeedsLogin(false);
    }).catch((cause: unknown) => {
      if (!active) return;
      if (cause instanceof ApiError && cause.code === 'PASSWORD_REQUIRED') { setNeedsPassword(true); setPassword(undefined); setError(password ? '提取码不正确，请重新输入' : ''); }
      else if (cause instanceof ApiError && cause.status === 401) { setNeedsLogin(true); setError(''); }
      else setError(message(cause));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [handle, slug, password, folderId, offset, retry]);

  useEffect(() => {
    if (!data?.share.coverNodeId || !data.share.allowPreview || folderId || cover) return;
    let active = true;
    sharesApi.access(handle, slug, data.share.coverNodeId, 'preview', password).then((result) => {
      if (active && result.mime.startsWith('image/')) setCover(result.url);
    }).catch(() => {});
    return () => { active = false; };
  }, [data?.share.coverNodeId, data?.share.allowPreview, folderId, handle, slug, password, cover]);

  useEffect(() => {
    if (!data || currentView !== 'grid' || !data.share.allowPreview) return;
    let active = true;
    const candidates = (data.root.type === 'file' ? [data.root] : data.items)
      .filter((item) => item.type === 'file' && ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(item.mime ?? '') && item.size > 0 && item.size <= 2 * 1024 * 1024 && !images[item.id])
      .slice(0, 6);
    async function load() {
      for (let start = 0; start < candidates.length; start += 2) {
        if (!active) break;
        const results = await Promise.all(candidates.slice(start, start + 2).map(async (item) => {
          try { return [item.id, (await sharesApi.access(handle, slug, item.id, 'preview', password)).url] as const; }
          catch { return null; }
        }));
        if (active) setImages((previous) => ({ ...previous, ...Object.fromEntries(results.filter((entry) => entry !== null)) }));
      }
    }
    void load();
    return () => { active = false; };
  }, [data?.root.id, data?.items, data?.share.allowPreview, currentView, handle, slug, password]);

  function unlock(event: FormEvent) {
    event.preventDefault();
    if (passwordInput.length < 4) return;
    setData(null); setFolderId(undefined); setOffset(0);
    setPassword(passwordInput);
    setPasswordInput('');
  }

  function enterFolder(id?: string) {
    setData(null); setError(''); setFolderId(id); setOffset(0);
  }

  async function access(node: PublicNode, purpose: 'preview' | 'download') {
    if (accessBusy) return;
    setAccessError(''); setAccessBusy(true);
    try {
      const result = await sharesApi.access(handle, slug, node.id, purpose, password);
      if (purpose === 'preview') setPreview({ node, access: result });
      else {
        const link = document.createElement('a');
        link.href = result.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.click();
        setData((previous) => previous ? { ...previous, share: { ...previous.share, downloadCount: previous.share.downloadCount + 1 } } : previous);
      }
    } catch (cause) { setAccessError(message(cause)); }
    finally { setAccessBusy(false); }
  }

  const loginUrl = import.meta.env.DEV ? '/login' : 'https://api.convenience.top/app/login';
  const homeUrl = import.meta.env.DEV ? '/' : 'https://api.convenience.top/app/';
  return <main className={`public-share ${data?.share.mode === 'activity' ? 'public-share--activity' : ''}`}>
    <header className="public-top" data-agent-region="publicShare.header"><a href={homeUrl} className="share-brand" data-agent-id="publicShare.header.brand"><img src={`${import.meta.env.BASE_URL}brand-mark.svg`} alt="" />迹光<span>分享空间</span></a><span>每一段旅程，都值得被好好收藏</span></header>
    {loading && !data && <div className="public-status" role="status">正在打开这段旅程…</div>}
    {needsLogin && <section className="public-gate" data-agent-region="publicShare.gate"><span aria-hidden="true">◇</span><h1>先登录，再继续</h1><p>分享者将这份内容设为仅登录用户可查看。登录后返回这个链接即可。</p><a href={loginUrl} data-agent-id="publicShare.gate.login">前往登录 →</a></section>}
    {needsPassword && <section className="public-gate" data-agent-region="publicShare.gate"><span aria-hidden="true">◇</span><h1>这段旅程有一把钥匙</h1><p>请输入分享者提供的提取码，打开这份作品。</p><form onSubmit={unlock}><label htmlFor="share-code">分享提取码</label><input id="share-code" type="password" value={passwordInput} onChange={(event) => setPasswordInput(event.target.value)} minLength={4} maxLength={128} autoComplete="off" data-agent-id="publicShare.gate.password" data-agent-ignore="true" required /><Button htmlType="submit" type="primary" data-agent-id="publicShare.gate.submit">打开分享</Button></form>{error && <p role="alert">{error}</p>}</section>}
    {!needsPassword && !needsLogin && error && !data && <section className="public-gate" role="alert"><span aria-hidden="true">⌁</span><h1>暂时打不开这个分享</h1><p>{error}</p><button type="button" onClick={() => { setError(''); setRetry((value) => value + 1); }} data-agent-id="publicShare.error.retry">重试</button></section>}
    {data && <div className="public-layout">
      <section className="public-hero" data-agent-region="publicShare.hero"><div className="public-hero-content"><div className="public-owner"><span className="public-owner-avatar" aria-hidden="true">{(data.share.ownerName || '旅').slice(0, 1)}</span><span><b>{data.share.ownerName}</b> 分享给你的{data.share.mode === 'activity' ? '活动作品' : '文件'}</span></div><h1>{data.share.title}</h1><p>{data.share.description || '把一路的风景，留在这里与你分享。'}</p><div className="public-hero-meta"><span>◇ {data.root.type === 'folder' ? '文件夹分享' : '文件分享'}</span><span>◷ {data.share.expiresAt ? `有效期至 ${new Date(data.share.expiresAt).toLocaleString('zh-CN')}` : '长期有效'}</span>{data.share.allowDownload && <span>↓ 允许下载</span>}</div></div><div className="public-cover" data-agent-ignore="true">{cover ? <img src={cover} alt="分享封面" referrerPolicy="no-referrer" onError={() => setCover(null)} /> : <span aria-hidden="true">{data.share.mode === 'activity' ? '✦' : data.root.type === 'folder' ? '▤' : '▧'}</span>}</div></section>
      <section className="public-gallery" data-agent-region="publicShare.gallery"><div className="public-gallery-heading"><div><small>{data.share.mode === 'activity' ? '作品集' : '分享文件'}</small><h2>{data.root.type === 'file' ? '文件详情' : folderId ? '文件夹内容' : '全部文件'}</h2></div><div className="public-gallery-controls"><span>{data.root.type === 'folder' ? `${data.total} 项内容` : '1 项内容'}</span><div className="public-view-switch" role="group" aria-label="文件视图"><button type="button" onClick={() => setView('list')} aria-label="列表视图" aria-pressed={currentView === 'list'} data-agent-id="publicShare.gallery.listView">☷</button><button type="button" onClick={() => setView('grid')} aria-label="网格视图" aria-pressed={currentView === 'grid'} data-agent-id="publicShare.gallery.gridView">▦</button></div></div></div>
        {data.root.type === 'folder' && <nav className="public-breadcrumbs" aria-label="文件夹路径"><button type="button" onClick={() => enterFolder()} data-agent-id="publicShare.gallery.root">全部文件</button>{data.breadcrumbs.slice(1).map((item) => <button type="button" key={item.id} onClick={() => enterFolder(item.id)} data-agent-id={`publicShare.gallery.path.${item.id}`}>/ {item.name}</button>)}</nav>}
        {currentView === 'list' && <div className="public-list-columns" aria-hidden="true"><span>名称</span><span>大小</span><span>操作</span></div>}
        <div className={`public-items public-items--${currentView}`}>{(data.root.type === 'file' ? [data.root] : data.items).map((item) => <article className="public-item" key={item.id} data-agent-region={`publicShare.row.${item.id}`}><div className="public-item-main"><div className={`public-item-icon public-item-icon--${item.type}`} aria-hidden="true" data-agent-ignore="true">{images[item.id] && currentView === 'grid' ? <img src={images[item.id]} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImages((previous) => { const next = { ...previous }; delete next[item.id]; return next; })} /> : item.type === 'folder' ? '▤' : item.mime?.startsWith('image/') ? '▧' : item.mime?.startsWith('video/') ? '▶' : item.mime?.startsWith('audio/') ? '♫' : '▣'}</div><div className="public-item-detail"><b title={item.name}>{item.name}</b><small>{item.type === 'folder' ? '文件夹' : item.mime?.startsWith('image/') ? '图片' : item.mime?.startsWith('video/') ? '视频' : item.mime?.startsWith('audio/') ? '音频' : '文件'}{currentView === 'grid' && item.type === 'file' ? ` · ${size(item.size)}` : ''}</small></div></div><span className="public-item-size">{item.type === 'folder' ? '—' : size(item.size)}</span><div className="public-item-actions">{item.type === 'folder' ? <button type="button" onClick={() => enterFolder(item.id)} data-agent-id={`publicShare.row.${item.id}.open`}>打开文件夹 →</button> : <>{data.share.allowPreview && <button type="button" disabled={accessBusy} onClick={() => void access(item, 'preview')} data-agent-id={`publicShare.row.${item.id}.preview`}>预览</button>}{data.share.allowDownload && <button type="button" disabled={accessBusy || data.share.maxDownloads !== null && data.share.downloadCount >= data.share.maxDownloads} onClick={() => void access(item, 'download')} data-agent-id={`publicShare.row.${item.id}.download`}>下载</button>}</>}</div></article>)}</div>
        {data.root.type === 'folder' && data.items.length === 0 && <p className="public-empty">这里暂时没有内容。</p>}
        {data.root.type === 'folder' && data.items.length < data.total && <button type="button" className="public-load" disabled={loading} onClick={() => setOffset(data.items.length)} data-agent-id="publicShare.gallery.more">加载更多</button>}
        {accessError && <p className="share-alert" role="alert">{accessError}</p>}
        <p className="share-hint">{data.share.allowDownload ? `下载链接已签发 ${data.share.downloadCount}${data.share.maxDownloads === null ? ' 次' : ` / ${data.share.maxDownloads} 次`}` : '分享者未开放下载'} · 文件保存在私有空间，访问链接仅短时间有效。</p>
      </section>
    </div>}
    {preview && <Modal visible className="share-preview-modal" title={preview.node.name} footer={null} onCancel={() => setPreview(null)} data-agent-region="publicShare.preview" closable={false} maskClosable={false}><button type="button" onClick={() => setPreview(null)} data-agent-id="publicShare.preview.close" aria-label="关闭预览" className="share-preview-close">关闭</button><div data-agent-ignore="true" className="share-preview-media">{preview.access.mime.startsWith('image/') ? <img src={preview.access.url} alt={preview.node.name} referrerPolicy="no-referrer" /> : preview.access.mime.startsWith('video/') ? <video src={preview.access.url} controls controlsList="nodownload" /> : preview.access.mime.startsWith('audio/') ? <audio src={preview.access.url} controls controlsList="nodownload" /> : <p>当前文件不支持在线预览。</p>}</div><p className="share-hint">在线预览无法防止浏览器保存已获取的内容。</p></Modal>}
    <footer className="public-footer">迹光 · 让旅途留下光</footer>
  </main>;
}
