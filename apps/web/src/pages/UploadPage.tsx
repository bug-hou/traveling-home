import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { Link, useBlocker, useBeforeUnload, useSearchParams } from 'react-router-dom';
import { Modal, Progress } from '@arco-design/web-react';
import { ApiError } from '@/services/api';
import { nodesApi } from '@/services/nodes';
import type { NodeSummary } from '@/services/nodes';
import { useAuth } from '@/features/auth/AuthProvider';
import { retryUploadRegistration, UploadCancelledError, UploadRegistrationError, uploadSelectedFile } from '@/services/uploads';
import type { UploadCredentials, UploadTaskController } from '@/services/uploads';
import '@/styles/upload.css';

type UploadStatus = 'queued' | 'uploading' | 'paused' | 'registering' | 'completed' | 'failed' | 'registration_failed';

interface UploadItem {
  id: string;
  file: File;
  previewUrl: string | null;
  status: UploadStatus;
  progress: number;
  loaded: number;
  speed: number;
  credentials: UploadCredentials | null;
  error: string;
}

interface DirectoryEntry {
  id: string | null;
  name: string;
}

const ACCEPTED_TYPES = 'image/*,video/*,audio/*,.dng,.raw,.srt,.lrf';

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`;
}

function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '计算中';
  const total = Math.ceil(seconds);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return minutes > 0 ? `约 ${minutes} 分 ${remainder} 秒` : `约 ${remainder} 秒`;
}

function itemError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'UPLOADS_NOT_CONFIGURED') return '上传服务尚未配置，请稍后再试。';
    if (error.code === 'PARENT_NOT_FOUND' || error.code === 'PARENT_NOT_AVAILABLE') return '目标文件夹已不可用，请重新选择目录。';
    if (error.code === 'UPLOAD_SESSION_EXPIRED') return '上传授权已过期，请重新开始该任务。';
    if (error.code === 'UPLOAD_SIZE_MISMATCH') return '云端文件大小校验失败，请重新上传。';
    return error.message;
  }
  if (error instanceof Error && error.message === 'UPLOAD_CANCELLED') return '已取消上传。';
  if (error instanceof Error && /network|fetch|timeout|网络/i.test(error.message)) return '网络连接中断，请检查网络后重试。';
  return '上传失败，请检查网络或稍后重试。';
}

function fileKind(file: File) {
  if (file.type.startsWith('video/')) return 'VIDEO';
  if (file.type.startsWith('audio/')) return 'AUDIO';
  if (file.type.startsWith('image/')) return 'PHOTO';
  return (file.name.split('.').pop() || 'FILE').slice(0, 6).toUpperCase();
}

function filePreviewClass(file: File) {
  if (file.type.startsWith('video/')) return 'upload-file-thumb upload-file-thumb--video';
  if (file.type.startsWith('audio/')) return 'upload-file-thumb upload-file-thumb--audio';
  if (file.type.startsWith('image/')) return 'upload-file-thumb upload-file-thumb--image';
  return 'upload-file-thumb upload-file-thumb--other';
}

function createQueueItem(file: File): UploadItem {
  return {
    id: crypto.randomUUID(),
    file,
    previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    status: 'queued',
    progress: 0,
    loaded: 0,
    speed: 0,
    credentials: null,
    error: '',
  };
}

export default function UploadPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const initialParentId = searchParams.get('parentId');
  const [items, setItems] = useState<UploadItem[]>([]);
  const itemsRef = useRef(items);
  const [destination, setDestination] = useState<DirectoryEntry>({ id: null, name: '全部文件' });
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [directoryStack, setDirectoryStack] = useState<DirectoryEntry[]>([{ id: null, name: '全部文件' }]);
  const [folders, setFolders] = useState<NodeSummary[]>([]);
  const [folderOffset, setFolderOffset] = useState(0);
  const [folderHasMore, setFolderHasMore] = useState(false);
  const [folderLoading, setFolderLoading] = useState(false);
  const [folderError, setFolderError] = useState('');
  const [folderReload, setFolderReload] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [queueRunning, setQueueRunning] = useState(false);
  const [pauseAll, setPauseAll] = useState(false);
  const [notice, setNotice] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const directoryToggleRef = useRef<HTMLButtonElement>(null);
  const directoryWasOpenRef = useRef(false);
  const runningRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);
  const controllersRef = useRef(new Map<string, UploadTaskController>());
  const pauseRequestedRef = useRef(new Set<string>());
  const cancelledItemsRef = useRef(new Set<string>());
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    currentLocation.pathname !== nextLocation.pathname &&
    itemsRef.current.some((item) => ['uploading', 'paused', 'registering'].includes(item.status)),
  );

  useBeforeUnload((event) => {
    if (!itemsRef.current.some((item) => ['uploading', 'paused', 'registering'].includes(item.status))) return;
    event.preventDefault();
    event.returnValue = '';
  });

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const shouldLeave = window.confirm('上传任务仍在进行。离开页面会停止当前任务，未完成的 COS 分片可能需要后续清理。确定离开吗？');
    if (shouldLeave) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  const currentDirectory = directoryStack[directoryStack.length - 1] ?? { id: null, name: '全部文件' };
  const activeCount = items.filter((item) => ['uploading', 'paused', 'registering'].includes(item.status)).length;
  const failedCount = items.filter((item) => ['failed', 'registration_failed'].includes(item.status)).length;
  const totalBytes = items.reduce((sum, item) => sum + item.file.size, 0);
  const transferredBytes = items.reduce((sum, item) => sum + (item.status === 'completed' ? item.file.size : item.loaded), 0);
  const overallProgress = totalBytes > 0 ? Math.min(100, (transferredBytes / totalBytes) * 100) : 0;
  const currentSpeed = items.reduce((sum, item) => sum + (item.status === 'uploading' ? item.speed : 0), 0);

  function updateItems(updater: (current: UploadItem[]) => UploadItem[]) {
    const next = updater(itemsRef.current);
    itemsRef.current = next;
    setItems(next);
  }

  function updateItem(id: string, patch: Partial<UploadItem>) {
    updateItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function notify(message: string) {
    setNotice(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setNotice(''), 3000);
  }

  useEffect(() => {
    if (!initialParentId || !/^[a-f\d]{24}$/i.test(initialParentId)) return;
    let active = true;
    nodesApi.detail(initialParentId).then(({ node }) => {
      if (active && node.type === 'folder') setDestination({ id: node.id, name: node.name });
    }).catch(() => { if (active) notify('目标文件夹不可用，请重新选择目录'); });
    return () => { active = false; };
  }, [initialParentId]);

  useEffect(() => {
    if (!directoryOpen && directoryWasOpenRef.current) directoryToggleRef.current?.focus();
    directoryWasOpenRef.current = directoryOpen;
  }, [directoryOpen]);

  useEffect(() => {
    if (!directoryOpen) return undefined;
    let active = true;
    setFolderLoading(true);
    setFolderError('');
    nodesApi
      .list(currentDirectory.id, folderOffset)
      .then((response) => {
        if (!active) return;
        const nextFolders = response.items.filter((node) => node.type === 'folder');
        setFolders((current) => (folderOffset === 0 ? nextFolders : [...current, ...nextFolders]));
        setFolderHasMore(response.offset + response.items.length < response.total);
      })
      .catch((error: unknown) => {
        if (active) setFolderError(error instanceof Error ? error.message : '无法读取文件夹列表');
      })
      .finally(() => {
        if (active) setFolderLoading(false);
      });
    return () => {
      active = false;
    };
  }, [directoryOpen, currentDirectory.id, folderOffset, folderReload]);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    for (const item of itemsRef.current) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
    for (const controller of controllersRef.current.values()) controller.cancel();
  }, []);

  function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    const nextItems = files.map(createQueueItem);
    updateItems((current) => [...current, ...nextItems]);
    notify(`${files.length} 个文件已加入上传队列`);
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    if (event.currentTarget.files) addFiles(event.currentTarget.files);
    event.currentTarget.value = '';
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  async function processQueue() {
    if (runningRef.current) return;
    runningRef.current = true;
    setQueueRunning(true);
    try {
      while (true) {
        const item = itemsRef.current.find((entry) => entry.status === 'queued');
        if (!item) break;
        if (item.file.size > 5_000_000_000_000) {
          updateItem(item.id, { status: 'failed', error: '单个文件超过当前上传接口的 5 TB 限制。' });
          continue;
        }

        updateItem(item.id, { status: 'uploading', error: '', progress: 0, loaded: 0, speed: 0 });
        try {
          await uploadSelectedFile(item.file, destination.id, {
            onCredentials(credentials) {
              updateItem(item.id, { credentials });
            },
            onTaskReady(controller) {
              controllersRef.current.set(item.id, controller);
              if (cancelledItemsRef.current.has(item.id)) controller.cancel();
              else if (pauseRequestedRef.current.has(item.id)) controller.pause();
            },
            onProgress(progress) {
              updateItem(item.id, {
                loaded: progress.loaded,
                progress: progress.percent * 100,
                speed: progress.speed,
              });
            },
            onRegistering() {
              updateItem(item.id, { status: 'registering', progress: 100, loaded: item.file.size, speed: 0 });
            },
            isCancelled() {
              return cancelledItemsRef.current.has(item.id);
            },
          });
          controllersRef.current.delete(item.id);
          pauseRequestedRef.current.delete(item.id);
          cancelledItemsRef.current.delete(item.id);
          updateItem(item.id, { status: 'completed', progress: 100, loaded: item.file.size, speed: 0, error: '' });
          notify(`${item.file.name} 已安全保存到云空间`);
        } catch (error) {
          controllersRef.current.delete(item.id);
          pauseRequestedRef.current.delete(item.id);
          cancelledItemsRef.current.delete(item.id);
          if (!itemsRef.current.some((entry) => entry.id === item.id)) continue;
          if (error instanceof UploadCancelledError) continue;
          if (error instanceof UploadRegistrationError) {
            updateItem(item.id, {
              status: 'registration_failed',
              credentials: error.credentials,
              error: itemError(error.originalError),
              progress: 100,
              loaded: item.file.size,
              speed: 0,
            });
          } else {
            updateItem(item.id, { status: 'failed', error: itemError(error), speed: 0 });
          }
        }
      }
    } finally {
      runningRef.current = false;
      setQueueRunning(false);
      setPauseAll(itemsRef.current.some((item) => item.status === 'paused'));
    }
  }

  function startQueue() {
    void processQueue();
  }

  function togglePauseAll() {
    const uploading = itemsRef.current.filter((item) => item.status === 'uploading');
    const paused = itemsRef.current.filter((item) => item.status === 'paused');
    if (uploading.length > 0) {
      for (const item of uploading) {
        const controller = controllersRef.current.get(item.id);
        if (controller) controller.pause();
        else pauseRequestedRef.current.add(item.id);
        updateItem(item.id, { status: 'paused', speed: 0 });
      }
      setPauseAll(true);
    } else if (paused.length > 0) {
      for (const item of paused) {
        controllersRef.current.get(item.id)?.resume();
        pauseRequestedRef.current.delete(item.id);
        updateItem(item.id, { status: 'uploading' });
      }
      setPauseAll(false);
    }
  }

  function toggleItemPause(item: UploadItem) {
    if (item.status === 'uploading') {
      const controller = controllersRef.current.get(item.id);
      if (controller) controller.pause();
      else pauseRequestedRef.current.add(item.id);
      updateItem(item.id, { status: 'paused', speed: 0 });
    } else if (item.status === 'paused') {
      controllersRef.current.get(item.id)?.resume();
      pauseRequestedRef.current.delete(item.id);
      updateItem(item.id, { status: 'uploading' });
    }
  }

  function removeItem(item: UploadItem) {
    const wasTransferring = item.status === 'uploading' || item.status === 'paused';
    if (wasTransferring) cancelledItemsRef.current.add(item.id);
    controllersRef.current.get(item.id)?.cancel();
    controllersRef.current.delete(item.id);
    pauseRequestedRef.current.delete(item.id);
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    updateItems((current) => current.filter((entry) => entry.id !== item.id));
    notify(wasTransferring ? '已停止并从队列移除；COS 可能仍保留未完成分片' : '已从上传队列移除');
  }

  function retryItem(item: UploadItem) {
    if (item.status === 'registration_failed' && item.credentials) {
      updateItem(item.id, { status: 'registering', error: '' });
      void retryUploadRegistration(item.credentials)
        .then(() => {
          updateItem(item.id, { status: 'completed', error: '' });
          notify(`${item.file.name} 已登记到云空间`);
        })
        .catch((error: unknown) => {
          updateItem(item.id, { status: 'registration_failed', error: itemError(error) });
        });
      return;
    }
    updateItem(item.id, { status: 'queued', progress: 0, loaded: 0, speed: 0, credentials: null, error: '' });
    window.setTimeout(startQueue, 0);
  }

  function clearCompleted() {
    const completed = itemsRef.current.filter((item) => item.status === 'completed');
    for (const item of completed) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
    updateItems((current) => current.filter((item) => item.status !== 'completed'));
    notify(completed.length ? `已清除 ${completed.length} 个已完成队列项；云端文件保留` : '当前没有已完成项目');
  }

  function openDirectoryPicker() {
    setDirectoryStack([{ id: null, name: '全部文件' }]);
    setFolderOffset(0);
    setFolders([]);
    setDirectoryOpen(true);
  }

  function openFolder(folder: NodeSummary) {
    setDirectoryStack((current) => [...current, { id: folder.id, name: folder.name }]);
    setFolderOffset(0);
    setFolders([]);
  }

  function chooseDirectory(entry: DirectoryEntry) {
    setDestination(entry);
    setDirectoryOpen(false);
    notify(`上传目标已设为“${entry.name}”`);
  }

  function overallStatus() {
    if (items.length === 0) return '选择文件后开始上传';
    const completed = items.filter((item) => item.status === 'completed').length;
    const parts = [`${items.length} 个任务`];
    if (activeCount) parts.push(`${activeCount} 个进行中`);
    if (failedCount) parts.push(`${failedCount} 个需要处理`);
    if (completed) parts.push(`${completed} 个已完成`);
    return parts.join(' · ');
  }

  function renderItemAction(item: UploadItem) {
    if (item.status === 'uploading' || item.status === 'paused') {
      const paused = item.status === 'paused';
      return (
        <div className="upload-row-controls">
          <button
            className="upload-row-action"
            type="button"
            aria-label={paused ? `继续 ${item.file.name}` : `暂停 ${item.file.name}`}
            aria-pressed={paused}
            data-agent-id={`upload.queue.row.${item.id}.${paused ? 'resume' : 'pause'}`}
            onClick={() => toggleItemPause(item)}
          >
            {paused ? <span aria-hidden="true">▶</span> : <span aria-hidden="true">Ⅱ</span>}
          </button>
          <button
            className="upload-row-action upload-row-action--cancel"
            type="button"
            aria-label={`取消上传 ${item.file.name}`}
            data-agent-id={`upload.queue.row.${item.id}.cancel`}
            data-agent-danger="true"
            onClick={() => removeItem(item)}
          >×</button>
        </div>
      );
    }
    if (item.status === 'completed') {
      return <span className="upload-row-action upload-row-action--done" aria-label={`${item.file.name} 上传完成`}>✓</span>;
    }
    if (item.status === 'registering') return <span className="upload-row-action upload-row-action--busy" aria-label="正在登记">…</span>;
    return (
      <button
        className="upload-row-action"
        type="button"
        aria-label={`从队列移除 ${item.file.name}`}
        data-agent-id={`upload.queue.row.${item.id}.remove`}
        onClick={() => removeItem(item)}
      >
        ×
      </button>
    );
  }

  function statusLabel(item: UploadItem) {
    if (item.status === 'queued') return '等待中';
    if (item.status === 'uploading') return '上传中';
    if (item.status === 'paused') return '已暂停';
    if (item.status === 'registering') return '校验入库';
    if (item.status === 'completed') return '已完成';
    if (item.status === 'registration_failed') return '等待登记';
    return '上传失败';
  }

  return (
    <div className="upload-app">
      <aside className="upload-sidebar" aria-label="主导航" data-agent-region="upload.nav">
        <Link className="upload-brand" to="/upload" aria-label="迹光上传" data-agent-id="upload.nav.brand">
          <img src={`${import.meta.env.BASE_URL}brand-mark.svg`} alt="" /><span>迹光</span>
        </Link>
        <p className="upload-side-caption">工作空间</p>
        <nav className="upload-side-nav" aria-label="工作空间">
          <Link to="/" className="upload-nav-item" data-agent-id="nav.home"><span aria-hidden="true">⌂</span>首页</Link>
          <Link to="/files" className="upload-nav-item" data-agent-id="nav.files"><span aria-hidden="true">▤</span>全部文件</Link>
          <button type="button" className="upload-nav-item" disabled aria-disabled="true" data-agent-id="nav.map"><span aria-hidden="true">⌖</span>足迹地图</button>
          <button type="button" className="upload-nav-item" disabled aria-disabled="true" data-agent-id="nav.trips"><span aria-hidden="true">▦</span>旅行</button>
          <button type="button" className="upload-nav-item" disabled aria-disabled="true" data-agent-id="nav.shares"><span aria-hidden="true">↗</span>我的分享</button>
          <button type="button" className="upload-nav-item" disabled aria-disabled="true" data-agent-id="nav.trash"><span aria-hidden="true">⌫</span>回收站</button>
          <Link to="/upload" className="upload-nav-item is-active" aria-current="page" data-agent-id="nav.upload"><span aria-hidden="true">↑</span>上传素材</Link>
        </nav>
        <div className="upload-sidebar-bottom">
          <div className="upload-privacy-card"><span aria-hidden="true">◆</span><div><b>私密空间</b><small>仅你本人可访问</small></div></div>
          <Link className="upload-profile-link" to="/settings/account" data-agent-id="upload.nav.account">
            <span className="upload-avatar">{(user?.nickname || user?.email || '旅').slice(0, 1)}</span>
            <span className="upload-profile-copy"><b>{user?.nickname || '旅行者'}</b><small>账号设置</small></span><span aria-hidden="true">›</span>
          </Link>
        </div>
      </aside>

      <main className="upload-main">
        <header className="upload-topbar" data-agent-region="upload.header">
          <div className="upload-breadcrumb"><Link to="/files" data-agent-id="upload.header.workspace">全部文件</Link><span>/</span><strong>上传素材</strong></div>
          <div className="upload-top-actions"><span className="upload-secure-label"><span aria-hidden="true">◆</span>私密传输</span><Link className="upload-top-avatar" to="/settings/account" aria-label="账号设置" data-agent-id="upload.header.account">{(user?.nickname || user?.email || '旅').slice(0, 1)}</Link></div>
        </header>

        <section className="upload-content">
          <div className="upload-heading" data-agent-region="upload.intro">
            <div><span className="upload-eyebrow"><i /> YOUR TRAVEL LIBRARY</span><h1>上传素材</h1><p>把相机、无人机和旅途中的文件，安心收进迹光。</p></div>
            <Link className="upload-back-link" to={destination.id ? `/files/${destination.id}` : '/files'} aria-label="返回文件" data-agent-id="upload.header.back" data-agent-label="返回文件">← <span>返回文件</span></Link>
          </div>

          <section className="upload-destination" data-agent-region="upload.destination">
            <div className="upload-destination-copy"><span className="upload-destination-icon" aria-hidden="true">▤</span><span><small>上传到</small><b>{destination.name}</b></span></div>
            <button ref={directoryToggleRef} className="upload-destination-button" type="button" aria-expanded={directoryOpen} disabled={queueRunning} aria-disabled={queueRunning} data-agent-id="upload.destination.open" onClick={openDirectoryPicker}>
              更改目录 <span aria-hidden="true">⌄</span>
            </button>
          </section>

          <section
            className={`upload-dropzone${dragging ? ' is-dragging' : ''}`}
            aria-label="文件选择与拖放区域"
            data-agent-id="upload.dropzone.dropFiles"
            data-agent-region="upload.dropzone"
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
            onDrop={handleDrop}
          >
            <span className="upload-drop-icon" aria-hidden="true">↑</span>
            <span className="upload-drop-kicker">从旅途，到你的私人素材库</span>
            <h2>{dragging ? '松开即可加入队列' : '把文件拖到这里'}</h2>
            <p>照片、视频、音频与无人机素材，都可以一起整理</p>
            <button className="upload-choose-button" type="button" data-agent-id="upload.dropzone.chooseFiles" onClick={() => inputRef.current?.click()}>
              <span aria-hidden="true">↑</span>选择本地文件
            </button>
            <small className="upload-drop-footnote">支持批量选择 · 大文件分片传输</small>
            <input
              ref={inputRef}
              className="upload-file-input"
              type="file"
              multiple
              accept={ACCEPTED_TYPES}
              aria-label="选择要上传的本地文件"
              aria-hidden="true"
              data-agent-ignore="true"
              tabIndex={-1}
              onChange={handleFileInput}
            />
            <div className="upload-private-note"><span aria-hidden="true">◆</span><span><b>你的素材保持私密</b><small>文件直接传输到私有云空间</small></span></div>
          </section>

          <div className="upload-lower-grid">
            <section className="upload-queue-card" data-agent-region="upload.queue">
              <div className="upload-queue-heading">
                <div className="upload-queue-title"><span className="upload-queue-icon" aria-hidden="true">☷</span><span><b>上传队列</b><small>{overallStatus()}</small></span></div>
                <div className="upload-queue-actions">
                  <button className="upload-start-button" type="button" data-agent-id="upload.queue.start" disabled={queueRunning || !items.some((item) => item.status === 'queued')} aria-disabled={queueRunning || !items.some((item) => item.status === 'queued')} onClick={startQueue}>
                    {queueRunning ? '上传中…' : '开始上传'}
                  </button>
                  <button className="upload-pause-button" type="button" data-agent-id="upload.queue.pauseAll" aria-pressed={pauseAll} disabled={!items.some((item) => item.status === 'uploading' || item.status === 'paused')} aria-disabled={!items.some((item) => item.status === 'uploading' || item.status === 'paused')} onClick={togglePauseAll}>
                    {pauseAll ? '全部继续' : '全部暂停'}
                  </button>
                </div>
              </div>
              <div className="upload-overall-progress" role="group" aria-label="本批上传总进度"><Progress percent={overallProgress} showText={false} strokeWidth={6} color="#25a98d" /></div>
              <div className="upload-queue-list">
                {items.map((item) => {
                  const remaining = item.speed > 0 ? (item.file.size - item.loaded) / item.speed : Number.NaN;
                  return (
                    <article className={`upload-queue-row upload-queue-row--${item.status}`} key={item.id} data-agent-region={`upload.queue.row.${item.id}`}>
                      <div className={filePreviewClass(item.file)}>
                        {item.previewUrl ? <img src={item.previewUrl} alt="" /> : <span className="upload-file-thumb-glyph" aria-hidden="true">{item.file.type.startsWith('audio/') ? '♫' : item.file.type.startsWith('video/') ? '▶' : '▧'}</span>}
                        <span className="upload-file-kind">{fileKind(item.file)}</span>
                      </div>
                      <div className="upload-file-main">
                        <div className="upload-file-title"><b title={item.file.name}>{item.file.name}</b><span className={`upload-status upload-status--${item.status}`}><i />{statusLabel(item)}</span></div>
                        <p className="upload-file-meta">{formatBytes(item.file.size)}{item.file.type ? ` · ${item.file.type}` : ' · 素材文件'}</p>
                        <div className="upload-file-progress" role="group" aria-label={`${item.file.name} 上传进度`}><Progress percent={item.progress} showText={false} strokeWidth={6} color={item.status === 'failed' || item.status === 'registration_failed' ? '#d88473' : '#25a98d'} /></div>
                        <div className="upload-file-progress-meta">
                          <span>{item.error || (item.status === 'completed' ? '已保存到云空间' : item.status === 'registering' ? '正在校验云端文件并登记…' : item.status === 'paused' ? `${formatBytes(item.loaded)} / ${formatBytes(item.file.size)} · 已暂停` : item.status === 'uploading' ? `${formatBytes(item.loaded)} / ${formatBytes(item.file.size)}` : item.status === 'registration_failed' ? '文件已上传；仅需重试登记' : '等待开始')}</span>
                          <span>{item.status === 'uploading' && item.speed > 0 ? `${formatBytes(item.speed)}/s · ${formatClock(remaining)}` : ''}</span>
                        </div>
                        {(item.status === 'failed' || item.status === 'registration_failed') && <button className="upload-retry-button" type="button" data-agent-id={`upload.queue.row.${item.id}.retryAction`} onClick={() => retryItem(item)}>{item.status === 'registration_failed' ? '重试登记' : '重新上传'} ↻</button>}
                      </div>
                      {renderItemAction(item)}
                    </article>
                  );
                })}
              </div>
              {items.length === 0 && <div className="upload-queue-empty"><span aria-hidden="true">＋</span><b>队列还空着</b><small>选择几份旅途素材，让它们开始云端归档。</small></div>}
              <footer className="upload-queue-footer"><span><i />传输加密，素材仅自己可见</span><span>{formatBytes(transferredBytes)} / {formatBytes(totalBytes)}{currentSpeed > 0 ? ` · ${formatBytes(currentSpeed)}/s` : ''}</span><button type="button" data-agent-id="upload.queue.clearCompleted" disabled={!items.some((item) => item.status === 'completed')} aria-disabled={!items.some((item) => item.status === 'completed')} onClick={clearCompleted}>清除已完成</button></footer>
            </section>

            <aside className="upload-tips-card" data-agent-region="upload.tips">
              <div className="upload-tips-heading"><span aria-hidden="true">✦</span><div><small>A LITTLE TIP</small><b>让整理，从上传开始</b></div></div>
              <div className="upload-tip"><i>01</i><span><b>原片安心保存</b><small>浏览器直传私有 COS，应用服务器不接触文件内容。</small></span></div>
              <div className="upload-tip"><i>02</i><span><b>大文件分片传输</b><small>当前页面可暂停、继续与重试；刷新页面后队列不会自动恢复。</small></span></div>
              <div className="upload-tip"><i>03</i><span><b>地点识别准备中</b><small>GPS / DJI SRT 解析与地图足迹还未接入。</small></span></div>
              <p className="upload-tips-foot">只会上传你亲自选择或拖入的文件。</p>
            </aside>
          </div>
          <p className="upload-page-note">上传会话临时凭证约 30 分钟有效；单次浏览器会话内可暂停/继续，不保留刷新前的本地文件授权。</p>
        </section>

        <nav className="upload-mobile-nav" aria-label="移动端导航" data-agent-region="upload.mobileNav">
          <Link to="/" data-agent-id="nav.mobile.home"><span aria-hidden="true">⌂</span>首页</Link>
          <Link to="/settings/account" data-agent-id="nav.mobile.account"><span aria-hidden="true">⌂</span>我的</Link>
          <span className="is-active" aria-current="page"><span aria-hidden="true">↑</span>上传</span>
          <Link to="/files" data-agent-id="nav.mobile.files"><span aria-hidden="true">▤</span>文件</Link>
          <button type="button" disabled aria-disabled="true" data-agent-id="nav.mobile.map"><span aria-hidden="true">⌖</span>足迹</button>
        </nav>
      </main>

      {directoryOpen && (
        <Modal visible className="upload-directory-modal" title={<div className="upload-directory-title"><small>上传目标</small><h2>选择文件夹</h2></div>} footer={null} closable={false} maskClosable={false} onCancel={() => setDirectoryOpen(false)} getPopupContainer={() => document.querySelector('.upload-app') ?? document.body} data-agent-region="upload.destination.dialog">
          <button className="upload-directory-close" type="button" aria-label="关闭目录选择器" data-agent-id="upload.destination.close" data-agent-label="关闭目录选择器" onClick={() => setDirectoryOpen(false)}>×</button>
          <div className="upload-directory-dialog">
            <div className="upload-directory-breadcrumbs">
              {directoryStack.map((entry, index) => <button type="button" key={entry.id ?? 'root'} aria-current={index === directoryStack.length - 1 ? 'location' : undefined} data-agent-id={`upload.destination.breadcrumb.${entry.id ?? 'root'}`} onClick={() => { setDirectoryStack((current) => current.slice(0, index + 1)); setFolderOffset(0); setFolders([]); }}>{entry.name}</button>)}
            </div>
            <button className="upload-directory-select-current" type="button" data-agent-id="upload.destination.selectCurrent" onClick={() => chooseDirectory(currentDirectory)}>将文件上传到“{currentDirectory.name}”</button>
            <div className="upload-directory-list" aria-live="polite">
              {folderLoading && <p className="upload-directory-message">正在读取文件夹…</p>}
              {folderError && <div className="upload-directory-error" role="alert"><span>{folderError}</span><button type="button" data-agent-id="upload.destination.retryList" onClick={() => setFolderReload((value) => value + 1)}>重试</button></div>}
              {!folderLoading && !folderError && folders.length === 0 && <p className="upload-directory-message">此处没有子文件夹。</p>}
              {folders.map((folder) => <button className="upload-directory-entry" key={folder.id} type="button" data-agent-id={`upload.destination.openFolder.${folder.id}`} onClick={() => openFolder(folder)}><span aria-hidden="true">▤</span><b>{folder.name}</b><span aria-hidden="true">›</span></button>)}
              {!folderLoading && folderHasMore && <button className="upload-directory-more" type="button" data-agent-id="upload.destination.loadMore" onClick={() => setFolderOffset((value) => value + 100)}>加载更多文件夹</button>}
            </div>
            <footer><button className="upload-directory-cancel" type="button" data-agent-id="upload.destination.cancel" onClick={() => setDirectoryOpen(false)}>取消</button><button className="upload-directory-confirm" type="button" data-agent-id="upload.destination.confirm" onClick={() => chooseDirectory(currentDirectory)}>选择此目录</button></footer>
          </div>
        </Modal>
      )}
      {notice && <div className="upload-toast" role="status" aria-live="polite">{notice}</div>}
    </div>
  );
}
