import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, Input } from '@arco-design/web-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { nodesApi } from '@/services/nodes';
import type { NodeSummary } from '@/services/nodes';
import { shareLink, sharesApi } from '@/services/shares';
import type { Share, ShareInput } from '@/services/shares';
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
  const creating = !editing && Boolean(targetId);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [shares, setShares] = useState<Share[]>([]);
  const [target, setTarget] = useState<NodeSummary | null>(null);
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
  const [coverNodeId, setCoverNodeId] = useState<string | null>(null);
  const [coverFolderId, setCoverFolderId] = useState<string | null>(null);
  const [coverFolders, setCoverFolders] = useState<NodeSummary[]>([]);
  const [coverItems, setCoverItems] = useState<NodeSummary[]>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    Promise.all([sharesApi.list(), targetId ? nodesApi.detail(targetId) : Promise.resolve(null)]).then(([list, detail]) => {
      if (!active) return;
      setShares(list.items);
      if (detail) {
        setTarget(detail.node);
        setTitle(detail.node.name);
        setCoverFolderId(detail.node.type === 'folder' ? detail.node.id : null);
        if (detail.node.type === 'file' && ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(detail.node.mime ?? '') && detail.node.size > 0 && detail.node.size <= 2 * 1024 * 1024) setCoverNodeId(detail.node.id);
      }
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
        setCoverNodeId(share.coverNodeId);
        setCoverFolderId(share.targetType === 'folder' ? share.targetId : null);
      }
    }).catch((cause: unknown) => { if (active) setError(message(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, targetId]);

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
    if (!allowPreview && !allowDownload) { setError('预览和下载至少开启一项'); return; }
    if (!neverExpires && (!expires || new Date(expires).getTime() <= Date.now())) { setError('请选择未来的到期时间'); return; }
    if (!unlimited && (!Number.isInteger(Number(maxDownloads)) || Number(maxDownloads) < 1)) { setError('请输入至少 1 次的下载限额'); return; }
    if (!creating && !selected) return;
    const input: ShareInput = {
      slug: slug.trim().toLowerCase() || `journey-${crypto.randomUUID().slice(0, 12)}`,
      title: title.trim(), description: description.trim(), mode,
      coverNodeId: mode === 'activity' ? coverNodeId : null,
      requireLogin, expiresAt: neverExpires ? null : new Date(expires).toISOString(),
      allowPreview, allowDownload, maxDownloads: unlimited ? null : Number(maxDownloads),
      ...(password ? { password } : removePassword && selected ? { password: null } : {}),
    };
    setBusy(true);
    try {
      const result = selected ? await sharesApi.update(selected.id, input) : await sharesApi.create(targetId!, input);
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

  return <main className="share-workspace">
    <header className="share-top" data-agent-region="shares.header"><Link to="/files" className="share-brand" data-agent-id="shares.header.brand"><img src={`${import.meta.env.BASE_URL}brand-mark.svg`} alt="" />迹光 <span>/ 分享空间</span></Link><nav><Link to="/files" data-agent-id="shares.header.files">全部文件</Link><Link to="/settings/account" data-agent-id="shares.header.account">账号设置</Link></nav></header>
    <div className="share-container">
      <div className="share-heading"><div><small>SHARE YOUR JOURNEY</small><h1>{creating ? '创建分享' : editing ? '编辑分享' : '我的分享'}<span>.</span></h1><p>{creating || editing ? '让作品以你希望的方式被看见。' : '将旅途中的片刻，整理成一个可以分享的入口。'}</p></div><Link to={creating || editing ? '/shares' : '/files'} className="share-back" data-agent-id="shares.header.back">{creating || editing ? '← 我的分享' : '← 返回文件'}</Link></div>
      {loading && <p role="status">正在加载分享设置…</p>}
      {error && <div className="share-alert" role="alert">{error}</div>}
      {notice && <div className="share-success" role="status">{notice}</div>}
      {!loading && !creating && !editing && <>
        {!user?.publicHandle && <section className="share-panel"><h2>先设置公开用户名</h2><p>分享链接使用全站唯一的公开用户名，不暴露账号内部 ID。</p><Link className="share-primary" to="/settings/account" data-agent-id="shares.handle.setup">前往账号设置 →</Link></section>}
        {shares.length === 0 ? <section className="share-empty"><div aria-hidden="true">◇</div><h2>还没有分享内容</h2><p>在文件页打开文件或文件夹的「更多」菜单，就能创建作品分享或活动展示页。</p><Link to="/files" data-agent-id="shares.empty.files">去挑选素材 →</Link></section> : <section className="share-list" aria-label="分享列表" data-agent-region="shares.list">{shares.map((share) => <article className="share-list-card" key={share.id} data-agent-region={`shares.row.${share.id}`}>
          <div className="share-list-icon" aria-hidden="true">{share.mode === 'activity' ? '✦' : share.targetType === 'folder' ? '▤' : '▧'}</div><div className="share-list-details"><small>{share.mode === 'activity' ? '展示活动页' : share.targetType === 'folder' ? '文件夹分享' : '文件分享'} · {share.revokedAt ? '已取消' : share.expiresAt && Date.parse(share.expiresAt) <= Date.now() ? '已过期' : '生效中'}</small><h2>{share.title}</h2><p>{user?.publicHandle ?? '用户名'}/{share.slug}</p><span>访问 {share.viewCount} 次 · 下载链接签发 {share.downloadCount}{share.maxDownloads === null ? ' 次' : ` / ${share.maxDownloads} 次`}{share.hasPassword ? ' · 需提取码' : ''}{share.requireLogin ? ' · 需登录' : ''}</span></div>
          <div className="share-list-actions">{!share.revokedAt && <><button type="button" onClick={() => void copy(share)} data-agent-id={`shares.row.${share.id}.copy`}>复制链接</button><a href={shareLink(user?.publicHandle ?? '', share.slug)} target="_blank" rel="noopener noreferrer" data-agent-id={`shares.row.${share.id}.open`}>打开分享页 ↗</a><Link to={`/shares/${share.id}/edit`} data-agent-id={`shares.row.${share.id}.edit`}>编辑</Link><button type="button" className="share-danger" onClick={() => void revoke(share)} data-agent-id={`shares.row.${share.id}.revoke`} data-agent-danger="true">取消分享</button></>}</div>
        </article>)}</section>}
      </>}
      {!loading && (creating || editing) && (target || selected) && <form className="share-editor" onSubmit={(event) => void submit(event)} data-agent-region="shares.editor">
        <section className="share-panel"><small className="share-eyebrow">01 / PRESENTATION</small><h2>展示方式</h2><p>来源：{target?.name || (selected?.targetType === 'folder' ? '文件夹' : '文件')}。公开页只显示当前分享范围内的内容。</p>
          <div className="share-mode-picker" role="group" aria-label="展示样式"><button type="button" className={mode === 'standard' ? 'selected' : ''} aria-pressed={mode === 'standard'} onClick={() => setMode('standard')} data-agent-id="shares.editor.standard">▤<b>简洁分享</b><small>清楚地浏览与获取文件</small></button><button type="button" className={mode === 'activity' ? 'selected' : ''} aria-pressed={mode === 'activity'} onClick={() => setMode('activity')} data-agent-id="shares.editor.activity">✦<b>活动展示</b><small>封面、介绍与作品陈列</small></button></div>
          <div className="share-fields"><label>页面标题<Input value={title} maxLength={80} onChange={setTitle} placeholder="给这段旅程取个名字" data-agent-id="shares.editor.title" required /></label><label>介绍<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} placeholder="关于这次分享，想说些什么…" data-agent-id="shares.editor.description" rows={3} /></label></div>
          {mode === 'activity' && <div className="share-cover" data-agent-region="shares.cover"><h3>活动封面</h3><p>从分享范围选择不超过 2 MiB 的图片；无封面时使用文字主视觉。封面须允许预览才能显示。</p>{coverRoot && coverFolderId && <><div className="share-cover-nav"><button type="button" onClick={() => { setCoverFolderId(coverRoot); setCoverFolders([]); }} data-agent-id="shares.cover.root">分享根目录</button>{coverFolders.map((folder, index) => <button key={folder.id} type="button" onClick={() => { setCoverFolderId(folder.id); setCoverFolders(coverFolders.slice(0, index + 1)); }} data-agent-id={`shares.cover.folderPath.${folder.id}`}>/ {folder.name}</button>)}</div><div className="share-cover-options">{coverItems.map((item) => item.type === 'folder' ? <button key={item.id} type="button" onClick={() => { setCoverFolderId(item.id); setCoverFolders([...coverFolders, item]); }} data-agent-id={`shares.cover.folder.${item.id}`}>▤ {item.name} →</button> : ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(item.mime ?? '') && item.size > 0 && item.size <= 2 * 1024 * 1024 ? <button key={item.id} type="button" className={coverNodeId === item.id ? 'selected' : ''} aria-pressed={coverNodeId === item.id} onClick={() => setCoverNodeId(item.id)} data-agent-id={`shares.cover.image.${item.id}`}>▧ {item.name}</button> : null)}</div></>}{(coverNodeId || selected?.coverNodeId) && <button type="button" onClick={() => setCoverNodeId(null)} data-agent-id="shares.cover.clear">不使用封面</button>}</div>}
        </section>
        <section className="share-panel"><small className="share-eyebrow">02 / ADDRESS</small><h2>自定义分享路径</h2><p>每个用户的路径不能重复；改公开用户名后，旧用户名仍可访问原分享。</p><div className="share-url"><span>share.convenience.top/{user?.publicHandle ?? '用户名'}/</span><Input value={slug} onChange={setSlug} maxLength={48} placeholder="自定义路径（留空自动生成）" data-agent-id="shares.editor.slug" /></div><small>仅使用 1–48 位小写字母、数字和连字符，路径变更后原路径不再有效。</small></section>
        <section className="share-panel"><small className="share-eyebrow">03 / ACCESS</small><h2>访问与下载</h2>
          <div className="share-choice-grid"><label className="share-check"><input type="checkbox" checked={requireLogin} onChange={(event) => setRequireLogin(event.target.checked)} data-agent-id="shares.editor.requireLogin" />访问者必须登录</label><label className="share-check"><input type="checkbox" checked={allowPreview} onChange={(event) => setAllowPreview(event.target.checked)} data-agent-id="shares.editor.allowPreview" />允许在线预览</label><label className="share-check"><input type="checkbox" checked={allowDownload} onChange={(event) => setAllowDownload(event.target.checked)} data-agent-id="shares.editor.allowDownload" />允许申请下载链接</label></div>
          <div className="share-fields"><label>提取码（{selected?.hasPassword ? '留空保持原提取码' : '留空则无需提取码'}）<Input.Password value={password} onChange={setPassword} minLength={4} maxLength={128} visibilityToggle={false} placeholder="4–128 位，可选" data-agent-id="shares.editor.password" data-agent-ignore="true" autoComplete="new-password" /></label>{selected?.hasPassword && <label className="share-check"><input type="checkbox" checked={removePassword} onChange={(event) => setRemovePassword(event.target.checked)} data-agent-id="shares.editor.removePassword" />移除原提取码</label>}</div>
          <div className="share-fields share-limit"><label className="share-check"><input type="checkbox" checked={neverExpires} onChange={(event) => setNeverExpires(event.target.checked)} data-agent-id="shares.editor.neverExpires" />永不过期</label>{!neverExpires && <label>到期时间（本地时间）<input type="datetime-local" value={expires} onChange={(event) => setExpires(event.target.value)} data-agent-id="shares.editor.expiresAt" required /></label>}<label className="share-check"><input type="checkbox" checked={unlimited} onChange={(event) => setUnlimited(event.target.checked)} data-agent-id="shares.editor.unlimited" />不限下载链接签发次数</label>{!unlimited && <label>最多签发次数<input type="number" min={Math.max(1, selected?.downloadCount ?? 1)} max={1000000} value={maxDownloads} onChange={(event) => setMaxDownloads(event.target.value)} data-agent-id="shares.editor.maxDownloads" required /></label>}</div><p className="share-hint">下载次数按签发短时链接计数；同一链接有效期内可被重复使用。已展示在浏览器中的预览内容无法禁止保存。</p>
        </section>
        <div className="share-submit"><Link to="/shares" data-agent-id="shares.editor.cancel">取消</Link><Button type="primary" htmlType="submit" size="large" loading={busy} disabled={busy || !user?.publicHandle} data-agent-id="shares.editor.submit">{editing ? '保存分享设置' : '创建分享页'}</Button></div>
        {!user?.publicHandle && <p><Link to="/settings/account" data-agent-id="shares.editor.setupHandle">请先设置公开用户名 →</Link></p>}
      </form>}
    </div>
  </main>;
}
