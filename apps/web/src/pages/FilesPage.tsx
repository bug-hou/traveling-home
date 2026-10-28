import { useEffect, useRef, useState } from 'react';
import type { DragEvent, FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Dropdown, Menu, Modal, Select } from '@arco-design/web-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { nodesApi } from '@/services/nodes';
import type { NodeAccess, NodeSort, NodeSummary } from '@/services/nodes';
import '@/styles/files.css';

type Action = { kind: 'create' | 'rename' | 'move' | 'delete'; node?: NodeSummary };
type Folder = { id: string | null; name: string };

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`;
}

function kind(node: NodeSummary) {
  if (node.type === 'folder') return '目录';
  if (node.mime?.startsWith('image/')) return '图片';
  if (node.mime?.startsWith('video/')) return '视频';
  if (node.mime?.startsWith('audio/')) return '音频';
  return '文件';
}

function message(error: unknown) {
  return error instanceof Error ? error.message : '请求失败，请稍后重试';
}

const SORT_OPTIONS: { label: string; value: NodeSort }[] = [
  { label: '名称 A-Z', value: 'name' },
  { label: '最近修改', value: 'updated' },
  { label: '大小优先', value: 'size' },
  { label: '最早创建', value: 'created' },
];
const getFilesPopupContainer = () => document.querySelector('.files-app') ?? document.body;

const CARD_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const CARD_IMAGE_ORIGINAL_MAX_BYTES = 2 * 1024 * 1024;
const CARD_IMAGE_THUMBNAIL_MAX_BYTES = 30 * 1024 * 1024;
const CARD_IMAGE_CONCURRENCY = 3;
const thumbnailQueue: { run: () => Promise<void>; cancelled: boolean }[] = [];
let activeThumbnails = 0;

function drainThumbnailQueue() {
  while (activeThumbnails < CARD_IMAGE_CONCURRENCY && thumbnailQueue.length) {
    const job = thumbnailQueue.shift();
    if (!job || job.cancelled) continue;
    activeThumbnails++;
    void job.run().finally(() => {
      activeThumbnails--;
      drainThumbnailQueue();
    });
  }
}

function scheduleThumbnail(run: () => Promise<void>) {
  const job = { run, cancelled: false };
  thumbnailQueue.push(job);
  drainThumbnailQueue();
  return () => { job.cancelled = true; };
}

function FileThumbnail({ node }: { node: NodeSummary }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    if (!('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '100px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || src || failed) return;
    let active = true;
    const controller = new AbortController();
    const cancel = scheduleThumbnail(async () => {
      if (!active) return;
      try {
        const result = await nodesApi.access(node.id, node.size <= CARD_IMAGE_ORIGINAL_MAX_BYTES ? 'preview' : 'thumbnail', controller.signal);
        if (!active) return;
        if (!result.previewable || !CARD_IMAGE_MIMES.has(result.mime.toLowerCase())) {
          setFailed(true);
          return;
        }
        const expiresIn = new Date(result.expiresAt).getTime() - Date.now() - 30_000;
        if (expiresIn <= 0) { setFailed(true); return; }
        setExpiresAt(new Date(result.expiresAt).getTime());
        setSrc(result.url);
      } catch {
        if (active) setFailed(true);
      }
    });
    return () => {
      active = false;
      cancel();
      controller.abort();
    };
  }, [visible, src, failed, node.id]);

  useEffect(() => {
    if (!src) return;
    const timer = window.setTimeout(() => {
      setReady(false);
      setSrc(null);
    }, Math.max(0, expiresAt - Date.now() - 30_000));
    return () => window.clearTimeout(timer);
  }, [src, expiresAt]);

  return <span ref={containerRef} className="files-thumb files-thumb--图片" data-agent-ignore="true" title={failed ? '图片预览暂不可用，请点击文件查看详情' : undefined}>
    {!ready && <span aria-hidden="true">▧</span>}
    {src && <img src={src} alt="" aria-hidden="true" loading="lazy" decoding="async" referrerPolicy="no-referrer" className={ready ? 'is-ready' : ''} onLoad={() => setReady(true)} onError={() => { setFailed(true); setReady(false); setSrc(null); }} />}
    <small>{failed ? '预览暂不可用' : '图片'}</small>
  </span>;
}

export default function FilesPage() {
  const { folderId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get('q')?.trim() ?? '';
  const { user } = useAuth();
  const [path, setPath] = useState<Folder[]>([{ id: null, name: '全部文件' }]);
  const [items, setItems] = useState<NodeSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<NodeSort>('name');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [input, setInput] = useState(initialSearch);
  const [query, setQuery] = useState(initialSearch);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [targetPath, setTargetPath] = useState<Folder[]>([{ id: null, name: '全部文件' }]);
  const [folders, setFolders] = useState<NodeSummary[]>([]);
  const [targetOffset, setTargetOffset] = useState(0);
  const [targetTotal, setTargetTotal] = useState(0);
  const [targetLoading, setTargetLoading] = useState(false);
  const [preview, setPreview] = useState<NodeSummary | null>(null);
  const [access, setAccess] = useState<NodeAccess | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [dragOver, setDragOver] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const currentFolder = folderId ?? null;
  const target = targetPath[targetPath.length - 1];

  useEffect(() => {
    if (!folderId) { setPath([{ id: null, name: '全部文件' }]); return; }
    let active = true;
    nodesApi.detail(folderId).then(({ node, ancestors }) => {
      if (active) setPath([{ id: null, name: '全部文件' }, ...ancestors.map((entry) => ({ id: entry.id, name: entry.name })), { id: node.id, name: node.name }]);
    }).catch((cause: unknown) => { if (active) setError(message(cause)); });
    return () => { active = false; };
  }, [folderId, reload]);

  useEffect(() => { setInput(initialSearch); setQuery(initialSearch); }, [initialSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(input.trim()), 280);
    return () => window.clearTimeout(timer);
  }, [input]);

  useEffect(() => { setItems([]); setOffset(0); setMenuId(null); }, [currentFolder, query, sort]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const request = query ? nodesApi.search(query, offset) : nodesApi.list(currentFolder, offset, sort);
    request.then((result) => {
      if (!active) return;
      setItems((previous) => offset === 0 ? result.items : [...previous, ...result.items]);
      setTotal(result.total);
    }).catch((cause: unknown) => { if (active) setError(message(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [currentFolder, query, sort, offset, reload]);

  useEffect(() => {
    if (action?.kind !== 'move') return;
    let active = true;
    setTargetLoading(true);
    nodesApi.list(target.id, targetOffset).then((result) => {
      if (active) {
        setFolders((previous) => targetOffset === 0 ? result.items.filter((item) => item.type === 'folder') : [...previous, ...result.items.filter((item) => item.type === 'folder')]);
        setTargetTotal(result.total);
      }
    }).catch((cause: unknown) => { if (active) setActionError(message(cause)); })
      .finally(() => { if (active) setTargetLoading(false); });
    return () => { active = false; };
  }, [action?.kind, target.id, targetOffset, reload]);

  useEffect(() => {
    if (!preview) return;
    let active = true;
    setPreviewLoading(true);
    setPreviewError('');
    setAccess(null);
    nodesApi.access(preview.id, 'preview').then((result) => { if (active) setAccess(result); })
      .catch((cause: unknown) => { if (active) setPreviewError(message(cause)); })
      .finally(() => { if (active) setPreviewLoading(false); });
    return () => { active = false; };
  }, [preview]);

  useEffect(() => {
    function onSearchShortcut(event: KeyboardEvent) {
      if (!document.querySelector('.files-app [role="dialog"]') && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onSearchShortcut);
    return () => window.removeEventListener('keydown', onSearchShortcut);
  }, []);

  useEffect(() => {
    if (action || preview || !returnFocusRef.current) return;
    const control = returnFocusRef.current;
    returnFocusRef.current = null;
    if (control.isConnected) control.focus();
    else searchRef.current?.focus();
  }, [action, preview]);

  function openAction(next: Action) {
    returnFocusRef.current = next.node
      ? [...document.querySelectorAll<HTMLElement>('.files-more')].find((button) => button.getAttribute('data-agent-id') === `files.row.${next.node?.id}.more`) ?? null
      : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMenuId(null);
    setActionError('');
    setName(next.node?.name ?? '');
    setTargetPath([{ id: null, name: '全部文件' }]);
    setTargetOffset(0);
    setFolders([]);
    setAction(next);
  }

  function openPreview(node: NodeSummary) {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPreview(node);
  }

  function refresh() { setOffset(0); setReload((value) => value + 1); }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!action || busy) return;
    const value = name.trim();
    if (action.kind !== 'delete' && action.kind !== 'move' && (!value || value.length > 255 || /[\\/\0]/.test(value) || value === '.' || value === '..')) {
      setActionError('名称需为 1–255 字符，不能包含 /、\\ 或仅为 .、..'); return;
    }
    if (action.kind === 'move' && (target.id === action.node?.id || target.id === action.node?.parentId)) {
      setActionError('请选择其他目标文件夹'); return;
    }
    setBusy(true);
    setActionError('');
    try {
      if (action.kind === 'create') await nodesApi.createFolder(value, currentFolder);
      if (action.kind === 'rename' && action.node) await nodesApi.rename(action.node.id, value);
      if (action.kind === 'move' && action.node) await nodesApi.move(action.node.id, target.id);
      if (action.kind === 'delete' && action.node) await nodesApi.remove(action.node.id);
      setNotice(action.kind === 'delete' ? '已移入回收站' : '更改已保存');
      setAction(null);
      refresh();
    } catch (cause) { setActionError(message(cause)); }
    finally { setBusy(false); }
  }

  async function moveNode(node: NodeSummary, parentId: string | null) {
    if (node.id === parentId || node.parentId === parentId) return;
    try { await nodesApi.move(node.id, parentId); setNotice('已移动到目标目录'); refresh(); }
    catch (cause) { setNotice(message(cause)); }
  }

  function onDrop(event: DragEvent, targetId: string | null) {
    if (!event.dataTransfer.types.includes('application/x-movehome-node')) return;
    event.preventDefault();
    setDragOver(null);
    const id = event.dataTransfer.getData('application/x-movehome-node');
    const node = items.find((item) => item.id === id);
    if (node) void moveNode(node, targetId);
  }

  function dropProps(id: string | null) {
    return {
      onDragOver(event: DragEvent) { if (event.dataTransfer.types.includes('application/x-movehome-node')) { event.preventDefault(); setDragOver(id ?? 'root'); } },
      onDragLeave() { setDragOver(null); },
      onDrop(event: DragEvent) { onDrop(event, id); },
    };
  }

  function download() {
    if (!preview) return;
    void nodesApi.access(preview.id, 'download').then((result) => {
      const link = document.createElement('a');
      link.href = result.url;
      link.rel = 'noreferrer noopener';
      link.target = '_blank';
      link.click();
    }).catch((cause: unknown) => setPreviewError(message(cause)));
  }

  return <div className="files-app">
    <aside className="files-sidebar" aria-label="主导航" data-agent-region="files.nav">
      <Link to="/files" className="files-brand" data-agent-id="nav.files.brand"><img src={`${import.meta.env.BASE_URL}brand-mark.svg`} alt="" />迹光</Link>
      <small className="files-sidebar-caption">工作空间</small>
      <nav aria-label="工作空间">
        <Link to="/" data-agent-id="nav.home">⌂ <span>首页</span></Link>
        <Link to="/files" className="active" aria-current="page" data-agent-id="nav.files" {...dropProps(null)}>▤ <span>全部文件</span></Link>
        <button type="button" disabled data-agent-id="nav.map">⌖ <span>足迹地图</span></button>
        <button type="button" disabled data-agent-id="nav.trips">▦ <span>旅行</span></button>
        <button type="button" disabled data-agent-id="nav.trash">⌫ <span>回收站</span></button>
      </nav>
      <div className="files-quick"><small>快速访问</small>{path.slice(1).map((entry) => <Link key={entry.id} to={`/files/${entry.id}`} data-agent-id={`files.nav.folder.${entry.id}`} {...dropProps(entry.id)}>▤ {entry.name}</Link>)}</div>
      <Link className="files-profile" to="/settings/account" data-agent-id="nav.account"><span>{(user?.nickname || '旅').slice(0, 1)}</span><b>{user?.nickname || '个人空间'}</b><small>账号设置 →</small></Link>
    </aside>
    <main className="files-main">
      <header className="files-topbar" data-agent-region="files.header"><span>WORKSPACE / <b>全部文件</b></span><Link to="/settings/account" data-agent-id="files.header.account" aria-label="账号设置">{(user?.nickname || '旅').slice(0, 1)}</Link></header>
      <div className="files-content">
        <section className="files-heading"><div><small>YOUR TRAVEL LIBRARY</small><h1>全部文件<span>.</span></h1><p>把旅途中的每一帧，放在容易找到的地方。</p></div><Link className="files-upload" to={`/upload${currentFolder ? `?parentId=${currentFolder}` : ''}`} data-agent-id="files.header.upload">↑ 上传素材</Link></section>
        <div className="files-intro" data-agent-region="files.intro"><span className="files-folder-symbol">▤</span><div><b>让好素材，住进好目录。</b><small>站内文件可拖入文件夹或上方路径；上传本地文件请点击「上传素材」。</small></div></div>
        <section className="files-section-heading" data-agent-region="files.breadcrumbs"><div><nav aria-label="文件夹路径">{path.map((entry, index) => <span key={entry.id ?? 'root'}>{index > 0 && ' / '}{index === path.length - 1 ? <strong>{entry.name}</strong> : <Link to={entry.id ? `/files/${entry.id}` : '/files'} data-agent-id={`files.path.${entry.id ?? 'root'}`} {...dropProps(entry.id)}>{entry.name}</Link>}</span>)}</nav><h2>{query ? '搜索结果' : path[path.length - 1]?.name === '全部文件' ? '我的文件' : path[path.length - 1]?.name}</h2><small>{query ? '按文件名搜索所有目录' : '当前目录'}</small></div><button type="button" data-agent-id="files.toolbar.createFolder" onClick={() => openAction({ kind: 'create' })}>＋ 新建文件夹</button></section>
        <section className="files-library" aria-label="文件管理" data-agent-region="files.library">
          <div className="files-toolbar" data-agent-region="files.toolbar">
            <label className="files-search"><span aria-hidden="true">⌕</span><input ref={searchRef} type="search" value={input} onChange={(event) => setInput(event.target.value)} placeholder="搜索文件或文件夹名称" aria-label="搜索文件或文件夹名称" data-agent-id="files.toolbar.search" /><kbd>⌘ K</kbd></label>
            <div className="files-toolbar-end"><label id="files-sort-label" htmlFor="files-sort">排序</label><Select id="files-sort" className="files-sort" size="large" value={sort} showSearch={false} onChange={(value: NodeSort) => setSort(value)} disabled={Boolean(query)} aria-labelledby="files-sort-label" data-agent-id="files.toolbar.sort" getPopupContainer={getFilesPopupContainer} dropdownMenuClassName="files-sort-menu" dropdownRender={(menu) => <div data-agent-region="files.toolbar.sortOptions">{menu}</div>}>
              {SORT_OPTIONS.map((option) => <Select.Option key={option.value} value={option.value} data-agent-id={`files.toolbar.sortOption.${option.value}`}>{option.label}</Select.Option>)}
            </Select><div className="files-view-toggle" role="group" aria-label="视图切换"><button type="button" data-agent-id="files.toolbar.grid" data-agent-label="网格视图" aria-label="网格视图" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>▦</button><button type="button" data-agent-id="files.toolbar.list" data-agent-label="列表视图" aria-label="列表视图" aria-pressed={view === 'list'} onClick={() => setView('list')}>☷</button></div></div>
          </div>
          <div className="files-count" role="status">{loading && offset === 0 ? '正在加载…' : error ? '加载失败' : query ? `搜索「${query}」 · ${total} 项（按名称排序）` : `当前目录 · ${total} 项`}</div>
          {error && <div className="files-error" role="alert">{error}<button type="button" data-agent-id="files.library.retry" onClick={refresh}>重试</button><Link to="/files" data-agent-id="files.library.goRoot">回到根目录</Link></div>}
          {!error && items.length > 0 && <><div className={`files-items ${view === 'grid' ? 'files-items--grid' : 'files-items--list'}`}>{items.map((node) => <article key={node.id} className={`files-card ${dragOver === node.id ? 'files-card--drag' : ''}`} draggable onDragStart={(event) => { event.dataTransfer.setData('application/x-movehome-node', node.id); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDragOver(null)} {...(node.type === 'folder' ? dropProps(node.id) : {})} data-agent-region={`files.row.${node.id}`}>
            <button type="button" className="files-card-main" data-agent-id={`files.row.${node.id}.open`} onClick={() => node.type === 'folder' ? navigate(`/files/${node.id}`) : openPreview(node)}>{node.type === 'file' && node.status === 'ready' && CARD_IMAGE_MIMES.has(node.mime?.toLowerCase() ?? '') && node.size > 0 && node.size <= CARD_IMAGE_THUMBNAIL_MAX_BYTES ? <FileThumbnail node={node} /> : <span className={`files-thumb files-thumb--${kind(node)}`}><span aria-hidden="true">{node.type === 'folder' ? '▤' : kind(node) === '视频' ? '▶' : kind(node) === '音频' ? '♫' : '▧'}</span><small>{kind(node)}</small></span>}<span className="files-card-copy"><b title={node.name}>{node.name}</b><small>{node.type === 'folder' ? '文件夹 · 点击打开' : `${formatSize(node.size)} · ${new Date(node.uploadedAt || node.updatedAt).toLocaleDateString('zh-CN')}`}</small></span>{view === 'list' && <span className="files-list-size">{node.type === 'folder' ? '—' : formatSize(node.size)}</span>}</button>
            <Dropdown trigger="click" position="br" popupVisible={menuId === node.id} onVisibleChange={(visible) => setMenuId(visible ? node.id : null)} getPopupContainer={getFilesPopupContainer} droplist={
              <Menu className="files-action-menu" data-agent-region={`files.row.${node.id}.menu`} onClickMenuItem={(key) => {
                if (key === 'rename' || key === 'move' || key === 'delete') openAction({ kind: key, node });
              }}>
                <Menu.Item key="rename" wrapper="button" data-agent-id={`files.row.${node.id}.rename`}>重命名</Menu.Item>
                <Menu.Item key="move" wrapper="button" data-agent-id={`files.row.${node.id}.move`}>移动到…</Menu.Item>
                <Menu.Item key="delete" wrapper="button" className="files-action-menu-danger" data-agent-id={`files.row.${node.id}.delete`} data-agent-danger="true">移入回收站</Menu.Item>
              </Menu>
            }><button type="button" className="files-more" aria-label={`${node.name}的更多操作`} data-agent-label={`${node.name}的更多操作`} aria-expanded={menuId === node.id} aria-haspopup="menu" data-agent-id={`files.row.${node.id}.more`}>•••</button></Dropdown>
          </article>)}</div>{items.length < total && <button type="button" className="files-more-pages" data-agent-id="files.library.loadMore" disabled={loading} onClick={() => setOffset(items.length)}>加载更多（{items.length}/{total}）</button>}</>}
          {!error && !loading && total === 0 && <div className="files-empty"><span className="files-folder-symbol">▤</span><h3>{query ? '没有找到匹配的文件' : currentFolder ? '这个文件夹还是空的' : '这里还没有文件'}</h3><p>{query ? '换个文件名试试，目前仅支持按名称搜索。' : '创建文件夹，或者上传第一份旅途素材。'}</p>{!query && <div><button type="button" data-agent-id="files.empty.createFolder" onClick={() => openAction({ kind: 'create' })}>新建文件夹</button><Link to={`/upload${currentFolder ? `?parentId=${currentFolder}` : ''}`} data-agent-id="files.empty.upload">上传素材 →</Link></div>}</div>}
          <footer className="files-library-footer">文件仅你本人可见 · 排序与搜索由服务器处理</footer>
        </section><p className="files-footnote">素材保存在私有空间，预览链接按需签发并短期有效。</p>
      </div>
      <nav className="files-mobile-nav" aria-label="移动端导航" data-agent-region="files.mobileNav"><Link to="/" data-agent-id="nav.mobile.home">⌂<small>首页</small></Link><Link to="/files" aria-current="page" data-agent-id="nav.mobile.files">▤<small>文件</small></Link><Link to="/upload" data-agent-id="nav.mobile.upload">↑<small>上传</small></Link><Link to="/settings/account" data-agent-id="nav.mobile.account">○<small>我的</small></Link></nav>
    </main>
    {action && <Modal
      visible
      className="files-arco-modal"
      getPopupContainer={getFilesPopupContainer}
      data-agent-region="files.dialog"
      title={<div className="files-dialog-heading"><span>文件整理</span><h2>{action.kind === 'create' ? '新建文件夹' : action.kind === 'rename' ? '重命名' : action.kind === 'move' ? '移动到…' : '移入回收站'}</h2></div>}
      closable={false}
      footer={null}
      maskClosable={false}
      escToExit={!busy}
      onCancel={() => { if (!busy) setAction(null); }}
    >
      <button type="button" className="files-dialog-close" aria-label="关闭对话框" data-agent-id="files.dialog.close" data-agent-label="关闭对话框" disabled={busy} onClick={() => setAction(null)}>×</button>
      <form onSubmit={(event) => void submit(event)}>
        <div className="files-modal-content">
          {(action.kind === 'create' || action.kind === 'rename') && <label>名称<input autoFocus value={name} maxLength={255} onChange={(event) => setName(event.target.value)} data-agent-id="files.dialog.name" /></label>}
          {action.kind === 'delete' && <p>将「{action.node?.name}」移入回收站？{action.node?.type === 'folder' ? '其内部所有文件也会一起移入。' : ''}</p>}
          {action.kind === 'move' && <><p>将「{action.node?.name}」移动到：</p><div className="files-target-path">{targetPath.map((entry, index) => <button type="button" key={entry.id ?? 'root'} data-agent-id={`files.dialog.path.${entry.id ?? 'root'}`} onClick={() => { setTargetPath(targetPath.slice(0, index + 1)); setFolders([]); setTargetOffset(0); }}>{entry.name}</button>)}</div><div className="files-target-list">{targetLoading && <p>加载中…</p>}{folders.filter((folder) => folder.id !== action.node?.id).map((folder) => <button type="button" key={folder.id} data-agent-id={`files.dialog.folder.${folder.id}`} onClick={() => { setTargetPath([...targetPath, { id: folder.id, name: folder.name }]); setFolders([]); setTargetOffset(0); }}>▤ {folder.name} →</button>)}{!targetLoading && targetOffset + 100 < targetTotal && <button type="button" data-agent-id="files.dialog.loadMore" onClick={() => setTargetOffset((value) => value + 100)}>加载更多</button>}</div></>}
          {actionError && <p className="files-action-error" role="alert">{actionError}</p>}
        </div>
        <div className="files-dialog-footer"><button type="button" data-agent-id="files.dialog.cancel" disabled={busy} onClick={() => setAction(null)}>取消</button><button type="submit" disabled={busy} className={action.kind === 'delete' ? 'danger' : 'primary'} data-agent-id="files.dialog.submit" data-agent-danger={action.kind === 'delete' ? 'true' : undefined}>{busy ? '处理中…' : action.kind === 'delete' ? '确认移入回收站' : action.kind === 'create' ? '创建' : action.kind === 'rename' ? '保存' : '确认移动'}</button></div>
      </form>
    </Modal>}
    {preview && <Modal
      visible
      className="files-arco-modal files-arco-modal--preview"
      getPopupContainer={getFilesPopupContainer}
      data-agent-region="files.preview"
      title={<div className="files-dialog-heading"><span>私有素材 · 短时链接</span><h2>{preview.name}</h2></div>}
      closable={false}
      footer={null}
      maskClosable={false}
      onCancel={() => { setPreview(null); setAccess(null); }}
    >
      <button type="button" className="files-dialog-close" aria-label="关闭预览" data-agent-id="files.preview.close" data-agent-label="关闭预览" onClick={() => { setPreview(null); setAccess(null); }}>×</button>
      <div className="files-preview-body" data-agent-ignore="true">{previewLoading && <p>正在获取私有访问链接…</p>}{previewError && <p role="alert">{previewError}</p>}{access && (access.previewable ? access.mime.startsWith('image/') ? <img src={access.url} alt={preview.name} referrerPolicy="no-referrer" onError={() => setPreviewError('图片无法加载，请尝试下载原文件')} /> : access.mime.startsWith('video/') ? <video src={access.url} controls controlsList="nodownload" onError={() => setPreviewError('该视频暂无法在线播放，请下载原片')} /> : access.mime.startsWith('audio/') ? <audio src={access.url} controls controlsList="nodownload" onError={() => setPreviewError('音频无法播放，请下载原文件')} /> : null : <p>当前格式不支持在线预览，可以下载原文件。</p>)}</div>
      <div className="files-dialog-footer files-dialog-footer--preview"><span>{formatSize(preview.size)} · {kind(preview)}</span><button type="button" data-agent-id="files.preview.download" onClick={download}>下载原文件</button></div>
    </Modal>}
    {notice && <p className="files-toast" role="status">{notice}</p>}
  </div>;
}
