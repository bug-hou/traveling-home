import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { WorkspaceMobileNavigation, WorkspaceNavigation } from '@/components/WorkspaceNavigation';
import { navigationSource, returnLabel, returnTarget } from '@/services/navigation';
import { Button, Checkbox, Input, InputNumber, Modal } from '@arco-design/web-react';
import QRCode from 'qrcode';
import { useAuth } from '@/features/auth/AuthProvider';
import { nodesApi } from '@/services/nodes';
import type { NodeSummary } from '@/services/nodes';
import { notesApi } from '@/services/notes';
import type { PrivateNote } from '@/services/notes';
import { filterShares, shareLink, shareStatus, sharesApi } from '@/services/shares';
import type { Share, ShareFilter, ShareInput } from '@/services/shares';
import '@/styles/shares.css';

function localTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
const message = (error: unknown) => error instanceof Error ? error.message : '操作失败，请稍后重试';

export default function SharesPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const targetId = params.get('targetId');
  const editing = Boolean(id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const pageLocation = useLocation();
  const creating = !editing && pageLocation.pathname.endsWith('/shares/new');
  const creatingNote = creating && params.get('targetType') === 'note';
  const missingTarget = creating && !targetId;
  const editorBack = creating ? returnTarget((pageLocation.state as { from?: unknown } | null)?.from, creatingNote ? '/notes' : '/shares') : '/shares';
  const editorBackLabel = creating && editorBack !== '/shares' ? `返回${returnLabel(editorBack)}` : '返回分享列表';
  const [shares, setShares] = useState<Share[]>([]);
  const [listFilter, setListFilter] = useState<ShareFilter>('all');
  const [listQuery, setListQuery] = useState('');
  const [target, setTarget] = useState<NodeSummary | null>(null);
  const [noteTarget, setNoteTarget] = useState<PrivateNote | null>(null);
  const [selected, setSelected] = useState<Share | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<'standard' | 'activity'>('standard');
  const [password, setPassword] = useState('');
  const [removePassword, setRemovePassword] = useState(false);
  const [requireLogin, setRequireLogin] = useState(false);
  const [neverExpires, setNeverExpires] = useState(true);
  const [expires, setExpires] = useState('');
  const [allowPreview, setAllowPreview] = useState(true);
  const [allowDownload, setAllowDownload] = useState(true);
  const [unlimited, setUnlimited] = useState(true);
  const [maxDownloads, setMaxDownloads] = useState('');
  const [unlimitedViews, setUnlimitedViews] = useState(true);
  const [maxViews, setMaxViews] = useState('');
  const [coverNodeId, setCoverNodeId] = useState<string | null>(null);
  const [coverFolderId, setCoverFolderId] = useState<string | null>(null);
  const [coverFolders, setCoverFolders] = useState<NodeSummary[]>([]);
  const [coverItems, setCoverItems] = useState<NodeSummary[]>([]);
  const [qrShare, setQrShare] = useState<Share | null>(null);
  const [qrImage, setQrImage] = useState('');
  const [qrBusy, setQrBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setTarget(null);
    setNoteTarget(null);
    setSelected(null);
    Promise.all([
      sharesApi.list(),
      creating && targetId && !creatingNote ? nodesApi.detail(targetId) : Promise.resolve(null),
      creating && targetId && creatingNote ? notesApi.detail(targetId).then(({ note }) => note) : Promise.resolve(null),
    ]).then(([list, detail, note]) => {
      if (!active) return;
      setShares(list.items);
      if (detail) {
        setTarget(detail.node);
        setTitle(detail.node.name);
        setCoverFolderId(detail.node.type === 'folder' ? detail.node.id : null);
        if (detail.node.type === 'file' && ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(detail.node.mime ?? '') && detail.node.size > 0 && detail.node.size <= 2 * 1024 * 1024) setCoverNodeId(detail.node.id);
      }
      if (note) { setNoteTarget(note); setTitle(note.title); setMode('standard'); setAllowPreview(true); setAllowDownload(false); setRequireLogin(false); }
      if (creatingNote && !note) setError('笔记不存在或无法分享，请返回随手记重新选择。');
      if (id) {
        const share = list.items.find((item) => item.id === id);
        if (!share) { setError('分享不存在或不在当前列表中'); return; }
        setSelected(share);
        setTitle(share.title);
        setSlug(share.slug);
        setDescription(share.description);
        setMode(share.mode);
        setRequireLogin(share.requireLogin);
        setNeverExpires(!share.expiresAt);
        setExpires(localTime(share.expiresAt));
        setAllowPreview(share.allowPreview);
        setAllowDownload(share.allowDownload);
        setUnlimited(share.maxDownloads === null);
        setMaxDownloads(share.maxDownloads === null ? '' : String(share.maxDownloads));
        setUnlimitedViews(share.maxViews == null);
        setMaxViews(share.maxViews == null ? '' : String(share.maxViews));
        setCoverNodeId(share.coverNodeId);
        setCoverFolderId(share.targetType === 'folder' ? share.targetId : null);
      }
    }).catch((cause: unknown) => { if (active) setError(message(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, targetId, creating, creatingNote]);

  const isNote = creatingNote || selected?.targetType === 'note';
  const filteredShares = useMemo(() => filterShares(shares, listFilter, listQuery), [shares, listFilter, listQuery]);
  const activeCount = shares.filter((share) => shareStatus(share) === 'active').length;
  const coverRoot = selected?.targetType === 'folder' ? selected.targetId : target?.type === 'folder' ? target.id : null;
  useEffect(() => {
    if (!coverRoot || mode !== 'activity' || !coverFolderId) return;
    let active = true;
    nodesApi.list(coverFolderId).then(({ items }) => { if (active) setCoverItems(items); })
      .catch(() => { if (active) setCoverItems([]); });
    return () => { active = false; };
  }, [coverRoot, coverFolderId, mode]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!isNote && !allowPreview && !allowDownload) { setError('预览和下载至少开启一项'); return; }
    if (!neverExpires && (!expires || new Date(expires).getTime() <= Date.now())) { setError('请选择未来的到期时间'); return; }
    if (!isNote && !unlimited && (!Number.isInteger(Number(maxDownloads)) || Number(maxDownloads) < 1)) { setError('请输入至少 1 次的下载限额'); return; }
    if (isNote && !unlimitedViews && (!maxViews || !Number.isInteger(Number(maxViews)) || Number(maxViews) < Math.max(1, selected?.viewCount ?? 1) || Number(maxViews) > 1_000_000)) { setError(`访问上限应为已阅读次数以上的整数，最多 100 万次`); return; }
    if (!creating && !selected) return;
    const input: ShareInput = {
      slug: slug.trim().toLowerCase() || `journey-${crypto.randomUUID().slice(0, 12)}`,
      title: title.trim(), description: description.trim(), mode: isNote ? 'standard' : mode,
      coverNodeId: isNote ? null : mode === 'activity' ? coverNodeId : null,
      requireLogin: isNote ? false : requireLogin, expiresAt: neverExpires ? null : new Date(expires).toISOString(),
      allowPreview: isNote ? true : allowPreview, allowDownload: isNote ? false : allowDownload, maxDownloads: isNote || unlimited ? null : Number(maxDownloads),
      ...(isNote ? { maxViews: unlimitedViews ? null : Number(maxViews) } : {}),
      ...(password ? { password } : removePassword && selected ? { password: null } : {}),
    };
    setBusy(true);
    try {
      const result = selected ? await sharesApi.update(selected.id, input, isNote ? 'note' : undefined) : await sharesApi.create(targetId!, input, isNote ? 'note' : undefined);
      navigate('/shares', { replace: true, state: { created: result.share.slug } });
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  async function revoke(share: Share) {
    if (!window.confirm(`确定取消「${share.title}」的分享吗？已签发的临时访问地址会在短时间内过期。`)) return;
    try {
      await sharesApi.revoke(share.id);
      setShares((items) => items.map((item) => item.id === share.id ? { ...item, revokedAt: new Date().toISOString() } : item));
      setNotice('已取消分享');
    } catch (cause) { setError(message(cause)); }
  }

  async function copy(share: Share) {
    if (!user?.publicHandle) return;
    try { await navigator.clipboard.writeText(shareLink(user.publicHandle, share.slug)); setNotice('链接已复制'); }
    catch { setError('复制失败，请使用「打开分享页」并从地址栏复制'); }
  }

  async function showQr(share: Share) {
    if (!user?.publicHandle) return;
    setQrShare(share);
    setQrImage('');
    setQrBusy(true);
    setError('');
    try {
      const image = await QRCode.toDataURL(shareLink(user.publicHandle, share.slug), { width: 320, margin: 2, errorCorrectionLevel: 'M' });
      setQrImage(image);
    } catch { setError('二维码生成失败，请复制分享链接重试'); setQrShare(null); }
    finally { setQrBusy(false); }
  }

  function downloadQr() {
    if (!qrImage || !qrShare) return;
    const link = document.createElement('a');
    link.href = qrImage;
    link.download = `jiguang-share-${qrShare.slug}.png`;
    link.click();
  }

  async function copyQr() {
    if (!qrImage || !qrShare) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': fetch(qrImage).then((response) => response.blob()) })]);
      setNotice('二维码图片已复制');
    } catch { setError('当前浏览器无法复制二维码图片，请下载 PNG 后分享'); }
  }

  return <div className="share-workspace">
    <aside className="share-sidebar" aria-label="工作空间侧栏" data-agent-region="shares.sidebar">
      <Link to="/" className="share-brand" data-agent-id="nav.home.brand"><img src={`${import.meta.env.BASE_URL}brand-mark.svg`} alt="" /><strong>迹光</strong><span>个人空间</span></Link>
      <span className="share-sidebar-caption">我的空间</span>
      <WorkspaceNavigation />
      <div className="share-sidebar-note"><span aria-hidden="true">✦</span><b>把旅途分享出去</b><p>选择文件或文件夹，给你的作品一个专属入口。</p><Link to="/files" data-agent-id="shares.sidebar.pickFiles">选择文件 →</Link></div>

    </aside>
    <div className="share-main">
      <header className="share-top" data-agent-region="shares.header"><span>工作空间 <span aria-hidden="true">/</span> <b>{creating ? '创建分享' : editing ? '编辑分享' : '我的分享'}</b></span><nav><Link to="/files" data-agent-id="shares.header.files">全部文件</Link><Link to="/settings/account" state={navigationSource(pageLocation.pathname, pageLocation.search, pageLocation.state)} data-agent-id="shares.header.account" aria-label="账号设置" className="share-header-avatar">{(user?.nickname || '旅').slice(0, 1)}</Link></nav></header>
      <main className="share-container">
        <div className="share-heading"><div><small>SHARING / 迹光云空间</small><h1>{creating ? '创建分享' : editing ? '编辑分享' : '我的分享'}</h1><p>{creating || editing ? '设置专属链接、访问权限与作品展示方式。' : '查看你的分享状态，把每一份精彩妥善送达。'}</p></div><Link to={creating || editing ? editorBack : '/files'} className="share-back" data-agent-id="shares.header.back">{creating || editing ? `← ${editorBackLabel}` : '前往文件空间 →'}</Link></div>
      {missingTarget && <div className="share-alert" role="alert">请先选择要分享的{creatingNote ? '笔记' : '文件或文件夹'}。 <Link to={creatingNote ? '/notes' : '/files'} data-agent-id="shares.editor.pickFiles">去选择 →</Link></div>}
      {loading && <p role="status">正在加载分享设置…</p>}
      {error && <div className="share-alert" role="alert">{error}</div>}
      {notice && <div className="share-success" role="status">{notice}</div>}
      {!loading && !creating && !editing && !missingTarget && <>
        {!user?.publicHandle && <section className="share-setup" data-agent-region="shares.handle"><div><strong>先设置公开用户名</strong><p>为你的分享创建一个独一无二的地址，账号内部 ID 不会公开。</p></div><Link className="share-primary" to="/settings/account" state={navigationSource(pageLocation.pathname, pageLocation.search, pageLocation.state)} data-agent-id="shares.handle.setup">设置用户名 →</Link></section>}
        <section className="share-overview" aria-label="分享概览" data-agent-region="shares.overview"><div><span>全部分享</span><strong>{shares.length}</strong><small>已创建的链接</small></div><div><span>生效中</span><strong>{activeCount}</strong><small>可继续访问</small></div><div><span>累计访问</span><strong>{shares.reduce((total, share) => total + share.viewCount, 0)}</strong><small>已记录的打开次数</small></div></section>
        <section className="share-list" aria-label="分享列表" data-agent-region="shares.list">
          <div className="share-list-toolbar"><div><h2>我的分享</h2><p>文件、文件夹和笔记的公开链接 · 共 {shares.length} 项</p></div><Link to="/files" className="share-primary" data-agent-id="shares.list.create">＋ 创建分享</Link></div>
          <div className="share-filter-bar" data-agent-region="shares.filters"><div className="share-filter-tabs" role="group" aria-label="分享状态">{([['all', '全部'], ['active', '生效中'], ['exhausted', '次数用尽'], ['expired', '已过期'], ['revoked', '已取消']] as const).map(([value, label]) => <button type="button" key={value} className={listFilter === value ? 'is-active' : ''} aria-pressed={listFilter === value} onClick={() => setListFilter(value)} data-agent-id={`shares.filters.${value}`}>{label}</button>)}</div><label className="share-search"><Input.Search type="search" value={listQuery} onChange={setListQuery} prefix={<span aria-hidden="true">⌕</span>} suffix={null} placeholder="搜索名称或链接路径" aria-label="搜索分享名称或链接路径" data-agent-id="shares.filters.search" /></label></div>
          {shares.length === 0 ? <div className="share-empty"><div aria-hidden="true">◇</div><h3>还没有分享内容</h3><p>到文件空间挑选一个文件或文件夹，创建你的第一个分享。</p><Link to="/files" data-agent-id="shares.empty.files">去挑选素材 →</Link></div> : <>
            <div className="share-list-labels" aria-hidden="true"><span>名称 / 地址</span><span>访问数据</span><span>有效期</span><span>操作</span></div>
            {filteredShares.length === 0 ? <div className="share-no-results" role="status">没有找到符合条件的分享，试试其他状态或关键词。</div> : filteredShares.map((share) => { const status = shareStatus(share); return <article className="share-list-card" key={share.id} data-agent-region={`shares.row.${share.id}`}>
              <div className="share-list-details"><span className={`share-list-icon share-list-icon--${share.mode}`} aria-hidden="true">{share.targetType === 'note' ? '✎' : share.mode === 'activity' ? '✦' : share.targetType === 'folder' ? '▤' : '▧'}</span><div className="share-list-copy"><div className="share-list-name"><h3 title={share.title}>{share.title}</h3><span className={`share-status share-status--${status}`}>{status === 'active' ? '生效中' : status === 'exhausted' ? '次数用尽' : status === 'expired' ? '已过期' : '已取消'}</span></div><p title={share.slug}>{user?.publicHandle ?? '用户名'}/{share.slug}</p><small>{share.targetType === 'note' ? '文字笔记' : share.mode === 'activity' ? '活动展示' : share.targetType === 'folder' ? '文件夹' : '文件'}{share.hasPassword ? ' · 提取码' : ''}{share.requireLogin ? ' · 需登录' : ''} · 创建于 {new Date(share.createdAt).toLocaleDateString('zh-CN')}</small></div></div>
              <div className="share-list-metrics"><span>{share.targetType === 'note' ? '已阅读' : '访问'} <b>{share.viewCount}{share.targetType === 'note' && share.maxViews !== null ? ` / ${share.maxViews}` : ''}</b> 次</span>{share.targetType !== 'note' && <span>下载签发 <b>{share.downloadCount}{share.maxDownloads !== null ? ` / ${share.maxDownloads}` : ''}</b> 次</span>}</div>
              <div className="share-list-expiry"><span>{share.expiresAt ? new Date(share.expiresAt).toLocaleDateString('zh-CN') : '永不过期'}</span><small>{share.targetType === 'note' ? share.maxViews !== null && share.viewCount >= share.maxViews ? '访问次数已用尽' : '只读笔记' : share.allowDownload ? '允许下载' : '仅可浏览'}</small></div>
              <div className="share-list-actions">{status !== 'revoked' && <><button type="button" className="share-action-main" onClick={() => void copy(share)} data-agent-id={`shares.row.${share.id}.copy`}>复制链接</button><button type="button" onClick={() => void showQr(share)} data-agent-id={`shares.row.${share.id}.qr`}>二维码</button><a href={shareLink(user?.publicHandle ?? '', share.slug)} target="_blank" rel="noopener noreferrer" data-agent-id={`shares.row.${share.id}.open`}>打开 ↗</a><Link to={`/shares/${share.id}/edit`} data-agent-id={`shares.row.${share.id}.edit`}>设置</Link><button type="button" className="share-danger" onClick={() => void revoke(share)} data-agent-id={`shares.row.${share.id}.revoke`} data-agent-danger="true">取消</button></>}</div>
            </article>; })}
          </>}
        </section>
      </>}
      {!loading && (creating || editing) && (target || noteTarget || selected) && <form className="share-editor" onSubmit={(event) => void submit(event)} data-agent-region="shares.editor">
        <div className="share-editor-fields">
        <div className="share-source"><span className="share-source-icon" aria-hidden="true">{isNote ? '✎' : (target?.type || selected?.targetType) === 'folder' ? '▤' : '▧'}</span><div><small>正在分享 · {isNote ? '文字笔记' : (target?.type || selected?.targetType) === 'folder' ? '文件夹' : '文件'}</small><strong>{noteTarget?.title || target?.name || selected?.title || '当前内容'}</strong></div><span className="share-source-badge">{isNote ? '私有空间中的原笔记' : '私有空间中的原文件'}</span></div>
        <section className="share-panel"><div className="share-section-title"><span>01</span><div><h2>展示内容</h2><p>选一种让访客看到作品的方式。</p></div></div>
          {isNote ? <p className="share-hint">文字笔记将以只读页面展示，不包含文件下载或活动封面。</p> : <div className="share-mode-picker" role="group" aria-label="展示样式"><button type="button" className={mode === 'standard' ? 'selected' : ''} aria-pressed={mode === 'standard'} onClick={() => setMode('standard')} data-agent-id="shares.editor.standard"><span aria-hidden="true">▤</span><b>文件分享</b><small>网盘式目录浏览，重点呈现文件与下载</small></button><button type="button" className={mode === 'activity' ? 'selected' : ''} aria-pressed={mode === 'activity'} onClick={() => setMode('activity')} data-agent-id="shares.editor.activity"><span aria-hidden="true">✦</span><b>活动展示</b><small>封面和作品画廊，适合记录一次旅程</small></button></div>}
          <div className="share-fields"><label>页面标题<Input value={title} maxLength={80} onChange={setTitle} placeholder="给这段旅程取个名字" data-agent-id="shares.editor.title" required /></label><label>介绍<Input.TextArea value={description} onChange={setDescription} maxLength={1000} placeholder="关于这次分享，想说些什么…" data-agent-id="shares.editor.description" rows={3} /></label></div>
          {!isNote && mode === 'activity' && <div className="share-cover" data-agent-region="shares.cover"><h3>活动封面</h3><p>从分享范围选择不超过 2 MiB 的图片；无封面时使用文字主视觉。封面须允许预览才能显示。</p>{coverRoot && coverFolderId && <><div className="share-cover-nav"><button type="button" onClick={() => { setCoverFolderId(coverRoot); setCoverFolders([]); }} data-agent-id="shares.cover.root">分享根目录</button>{coverFolders.map((folder, index) => <button key={folder.id} type="button" onClick={() => { setCoverFolderId(folder.id); setCoverFolders(coverFolders.slice(0, index + 1)); }} data-agent-id={`shares.cover.folderPath.${folder.id}`}>/ {folder.name}</button>)}</div><div className="share-cover-options">{coverItems.map((item) => item.type === 'folder' ? <button key={item.id} type="button" onClick={() => { setCoverFolderId(item.id); setCoverFolders([...coverFolders, item]); }} data-agent-id={`shares.cover.folder.${item.id}`}>▤ {item.name} →</button> : ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(item.mime ?? '') && item.size > 0 && item.size <= 2 * 1024 * 1024 ? <button key={item.id} type="button" className={coverNodeId === item.id ? 'selected' : ''} aria-pressed={coverNodeId === item.id} onClick={() => setCoverNodeId(item.id)} data-agent-id={`shares.cover.image.${item.id}`}>▧ {item.name}</button> : null)}</div></>}{(coverNodeId || selected?.coverNodeId) && <button type="button" onClick={() => setCoverNodeId(null)} data-agent-id="shares.cover.clear">不使用封面</button>}</div>}
        </section>
        <section className="share-panel"><div className="share-section-title"><span>02</span><div><h2>分享链接</h2><p>设置一个好记的地址，让访客更容易找到。</p></div></div><div className="share-url"><span>share.convenience.top/{user?.publicHandle ?? '用户名'}/</span><Input value={slug} onChange={setSlug} maxLength={48} placeholder="自定义路径（留空自动生成）" data-agent-id="shares.editor.slug" /></div><small className="share-field-help">仅使用小写字母、数字和连字符，最多 48 位；修改路径后旧路径失效。改公开用户名后旧链接仍可使用。</small></section>
        <section className="share-panel"><div className="share-section-title"><span>03</span><div><h2>访问权限</h2><p>{isNote ? '设置提取码和有效期，分享页仅允许只读复制。' : '谁能打开、能否预览和下载，都由你决定。'}</p></div></div>
          {!isNote && <div className="share-choice-grid"><Checkbox className="share-check" checked={requireLogin} onChange={setRequireLogin} data-agent-id="shares.editor.requireLogin"><span><b>需要登录</b><small>访客登录后才能打开</small></span></Checkbox><Checkbox className="share-check" checked={allowPreview} onChange={setAllowPreview} data-agent-id="shares.editor.allowPreview"><span><b>允许在线预览</b><small>可在页面查看支持的媒体</small></span></Checkbox><Checkbox className="share-check" checked={allowDownload} onChange={setAllowDownload} data-agent-id="shares.editor.allowDownload"><span><b>允许下载</b><small>为访客签发短时下载链接</small></span></Checkbox></div>}
          <div className="share-fields"><label>提取码（{selected?.hasPassword ? '留空保持原提取码' : '留空则无需提取码'}）<Input.Password value={password} onChange={setPassword} minLength={4} maxLength={128} visibilityToggle={false} placeholder="4–128 位，可选" data-agent-id="shares.editor.password" data-agent-ignore="true" autoComplete="new-password" /></label>{selected?.hasPassword && <Checkbox className="share-check" checked={removePassword} onChange={setRemovePassword} data-agent-id="shares.editor.removePassword">移除原提取码</Checkbox>}</div>
          <div className="share-fields share-limit">
            <Checkbox className="share-check" checked={neverExpires} onChange={setNeverExpires} data-agent-id="shares.editor.neverExpires">永不过期</Checkbox>
            {!neverExpires && <label>到期时间（本地时间）<input type="datetime-local" value={expires} onChange={(event) => setExpires(event.target.value)} data-agent-id="shares.editor.expiresAt" required /></label>}
            {!isNote && <Checkbox className="share-check" checked={unlimited} onChange={setUnlimited} data-agent-id="shares.editor.unlimited">不限下载链接签发次数</Checkbox>}
            {!isNote && !unlimited && <label>最多签发次数<InputNumber min={Math.max(1, selected?.downloadCount ?? 1)} max={1000000} precision={0} value={maxDownloads} onChange={(value) => setMaxDownloads(Number.isFinite(value) ? String(value) : '')} data-agent-id="shares.editor.maxDownloads" aria-label="最多签发次数" required /></label>}
            {isNote && <Checkbox className="share-check" checked={unlimitedViews} onChange={setUnlimitedViews} data-agent-id="shares.editor.unlimitedViews">不限笔记阅读次数</Checkbox>}
            {isNote && !unlimitedViews && <label>最多阅读次数<InputNumber min={Math.max(1, selected?.viewCount ?? 1)} max={1000000} precision={0} value={maxViews} onChange={(value) => setMaxViews(Number.isFinite(value) ? String(value) : '')} data-agent-id="shares.editor.maxViews" aria-label="最多阅读次数" required /></label>}
          </div><p className="share-hint">{isNote ? '笔记按成功读取正文的次数计数（刷新或重复打开均计次），达到上限后不能再读取；提取码和到期时间另行生效。二维码不含提取码。' : '下载次数按签发短时链接计数；同一链接有效期内可被重复使用。已展示在浏览器中的预览内容无法禁止保存。'}</p>
        </section>
        </div>
        <aside className="share-editor-aside" aria-label="分享设置概要" data-agent-region="shares.editorSummary"><div className="share-summary-card"><small>页面预览 · {isNote ? '笔记只读' : mode === 'activity' ? '活动展示' : '文件分享'}</small><div className="share-summary-visual" aria-hidden="true">{isNote ? '✎' : mode === 'activity' ? '✦' : '▤'}</div><h2>{title.trim() || '你的分享标题'}</h2><p>{description.trim() || (isNote ? '打开链接，阅读你公开分享的文字。' : mode === 'activity' ? '用照片与故事呈现旅途的精彩。' : '打开链接，就能浏览你分享的文件。')}</p><div className="share-summary-tags"><span>{requireLogin ? '需要登录' : '链接可访问'}</span><span>{password || selected?.hasPassword && !removePassword ? '需要提取码' : '无需提取码'}</span><span>{isNote ? unlimitedViews ? '阅读不限次' : `最多阅读 ${maxViews || '待设置'} 次` : allowDownload ? '允许下载' : '仅供预览'}</span></div></div><div className="share-summary-help"><b>链接将会显示为</b><p>share.convenience.top/{user?.publicHandle ?? '用户名'}/{slug.trim().toLowerCase() || '自动生成路径'}</p><small>仅作为设置预览，保存后才能访问。</small></div></aside>
        <div className="share-submit"><span>所有变更需要保存后才会生效。</span><div><Link to={editorBack} data-agent-id="shares.editor.cancel">取消</Link><Button type="primary" htmlType="submit" size="large" loading={busy} disabled={busy || !user?.publicHandle} data-agent-id="shares.editor.submit">{editing ? '保存设置' : '创建分享'}</Button></div></div>
        {!user?.publicHandle && <p className="share-setup-required"><Link to="/settings/account" state={navigationSource(pageLocation.pathname, pageLocation.search, pageLocation.state)} data-agent-id="shares.editor.setupHandle">请先设置公开用户名 →</Link></p>}
      </form>}
      </main>
      <WorkspaceMobileNavigation className="share-mobile-nav" region="shares.mobileNav" />
    </div>
    <Modal visible={Boolean(qrShare)} footer={null} closable={false} onCancel={() => setQrShare(null)} title="分享二维码" data-agent-region="shares.qr" className="share-qr-modal">
      <p>扫码访问「{qrShare?.title}」。二维码只包含公开分享链接，不包含提取码或正文；分享过期或取消后链接将不可访问。</p>
      {qrShare?.targetType === 'note' && qrShare.maxViews !== null && <p role="status">笔记已阅读 {qrShare.viewCount} / {qrShare.maxViews} 次。{qrShare.viewCount >= qrShare.maxViews ? '已达上限，扫码后无法再读取正文；可到分享设置调整。' : '每次成功读取正文（含刷新）都会占用一次额度。'}</p>}
      {qrBusy ? <p role="status">正在生成二维码…</p> : qrImage && <img src={qrImage} alt="公开分享链接二维码" />}
      {qrShare && user?.publicHandle && <p className="share-qr-url">{shareLink(user.publicHandle, qrShare.slug)}</p>}
      <div className="share-qr-actions"><Button htmlType="button" disabled={!qrImage} data-agent-id="shares.qr.copy" onClick={() => void copyQr()}>复制二维码</Button><Button htmlType="button" disabled={!qrImage} data-agent-id="shares.qr.download" onClick={downloadQr}>下载 PNG</Button><Button htmlType="button" type="primary" data-agent-id="shares.qr.close" onClick={() => setQrShare(null)}>完成</Button></div>
    </Modal>
  </div>;
}
