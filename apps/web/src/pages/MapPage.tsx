import { Button } from '@arco-design/web-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { WorkspaceMobileNavigation, WorkspaceNavigation } from '@/components/WorkspaceNavigation';
import { currentPagePath } from '@/services/navigation';
import { mapApi, pointLabel } from '@/services/map';
import type { MapFile, MapPage, MapPoint, PointPage } from '@/services/map';
import { createMap, focusMapPoint, loadTencentMap } from '@/services/map-view';
import { nodesApi } from '@/services/nodes';
import '@/styles/map.css';

const SMALL_IMAGE = 2 * 1024 * 1024;
const MAX_THUMBNAIL_SOURCE = 30 * 1024 * 1024;
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const sourceNames = { exif: 'EXIF 自动定位', srt: 'DJI SRT 自动定位', manual: '手动标记' } as const;

function fileKind(file: MapFile) {
  return file.mime?.startsWith('video/') || /\.(mp4|mov)$/i.test(file.name) ? '视频' : '照片';
}

function SelectedThumbnail({ point }: { point: MapPoint }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setUrl('');
    setFailed(false);
    if (!IMAGE_MIMES.has(point.mime?.toLowerCase() ?? '') || point.size <= 0 || point.size > MAX_THUMBNAIL_SOURCE) return;
    const controller = new AbortController();
    let timer: number | undefined;
    nodesApi.access(point.id, point.size <= SMALL_IMAGE ? 'preview' : 'thumbnail', controller.signal)
      .then((result) => {
        if (!result.previewable || !result.mime.startsWith('image/')) return;
        const lifetime = new Date(result.expiresAt).getTime() - Date.now() - 30000;
        if (lifetime <= 0) return;
        setUrl(result.url);
        timer = window.setTimeout(() => setUrl(''), lifetime);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [point.id, point.mime, point.size]);
  return <div className="footprint-selected-art" data-agent-ignore="true">{url && !failed ? <img src={url} alt="" referrerPolicy="no-referrer" onError={() => { setUrl(''); setFailed(true); }} /> : <span aria-hidden="true">{fileKind(point) === '视频' ? '▶' : '▧'}</span>}<small>{fileKind(point)}</small></div>;
}

function LiveMap({ points, status, selected, onSelect }: { points: MapPoint[]; status: PointPage['mapStatus']; selected: MapPoint | null; onSelect: (id: string) => void }) {
  const elementRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef(onSelect);
  const instanceRef = useRef<ReturnType<typeof createMap> | null>(null);
  const sdkRef = useRef<Awaited<ReturnType<typeof loadTencentMap>> | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => { selectRef.current = onSelect; }, [onSelect]);
  useEffect(() => {
    if (!points.length || status !== 'ready') return;
    let active = true;
    setError('');
    loadTencentMap().then((sdk) => {
      if (!active || !elementRef.current) return;
      sdkRef.current = sdk;
      instanceRef.current = createMap(elementRef.current, sdk, points, (id) => selectRef.current(id));
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : '底图加载失败'); });
    return () => { active = false; instanceRef.current?.destroy(); instanceRef.current = null; sdkRef.current = null; };
  }, [points, status, revision]);
  useEffect(() => {
    if (selected && instanceRef.current && sdkRef.current) focusMapPoint(instanceRef.current.map, sdkRef.current, selected);
  }, [selected]);
  const unavailable = points.length === 0 ? '还没有已定位素材。上传带 GPS 的照片或视频，或在预览中补充拍摄位置。'
    : status === 'not_configured' ? '坐标转换尚未配置，不能将 GPS 原始位置直接放上腾讯底图。素材列表仍可浏览。'
      : status === 'unavailable' ? '地图坐标转换暂不可用。已定位素材仍可从右侧列表打开。' : error;
  return <div className="footprint-map-wrap" data-agent-region="map.canvas"><div className="footprint-map" ref={elementRef} role="img" aria-label="本人已定位素材的腾讯地图点位；也可使用旁边列表选择点位" />{unavailable && <div className="footprint-map-overlay" role={error ? 'alert' : 'status'}><span aria-hidden="true">⌖</span><strong>{points.length ? '底图暂不可用' : '等第一枚坐标'}</strong><p>{unavailable}</p>{error && <Button data-agent-id="map.canvas.retry" onClick={() => setRevision((value) => value + 1)}>重试加载底图</Button>}{!points.length && <Link to="/upload" data-agent-id="map.canvas.upload">上传素材 →</Link>}</div>}<div className="footprint-map-legend">⌖ 已定位素材 · 仅你本人可见</div></div>;
}

export default function MapPage() {
  const pageLocation = useLocation();
  const from = currentPagePath(pageLocation.pathname, pageLocation.search);
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [pointTotal, setPointTotal] = useState<number | null>(null);
  const [mapStatus, setMapStatus] = useState<PointPage['mapStatus']>('not_configured');
  const [truncated, setTruncated] = useState(false);
  const [unlocated, setUnlocated] = useState<MapFile[]>([]);
  const [unlocatedTotal, setUnlocatedTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [unlocatedError, setUnlocatedError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<'located' | 'unlocated'>('located');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = points.find((point) => point.id === selectedId) ?? points[0] ?? null;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    setUnlocatedError('');
    setPoints([]);
    setPointTotal(null);
    setUnlocated([]);
    setUnlocatedTotal(null);
    Promise.allSettled([mapApi.allPoints(controller.signal), mapApi.unlocated(0, controller.signal)])
      .then(([located, missing]) => {
        if (!active) return;
        if (located.status === 'fulfilled') {
          setPoints(located.value.points);
          setPointTotal(located.value.total);
          setMapStatus(located.value.mapStatus);
          setTruncated(located.value.truncated);
        } else setLoadError(located.reason instanceof Error ? located.reason.message : '足迹加载失败');
        if (missing.status === 'fulfilled') {
          setUnlocated(missing.value.items);
          setUnlocatedTotal(missing.value.total);
        } else setUnlocatedError(missing.reason instanceof Error ? missing.reason.message : '未定位素材加载失败');
      }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [revision]);

  async function loadMore() {
    if (loadingMore || unlocatedTotal === null || unlocated.length >= unlocatedTotal) return;
    setLoadingMore(true);
    setUnlocatedError('');
    try {
      const page: MapPage<MapFile> = await mapApi.unlocated(unlocated.length);
      setUnlocated((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setUnlocatedTotal(page.total);
    } catch (cause) { setUnlocatedError(cause instanceof Error ? cause.message : '加载失败，请重试'); }
    finally { setLoadingMore(false); }
  }

  return <div className="footprint-page">
    <aside className="footprint-sidebar" aria-label="主导航" data-agent-region="map.nav"><Link className="footprint-brand" to="/" data-agent-id="nav.home.brand"><img src={`${import.meta.env.BASE_URL}brand-mark.svg`} alt="" />迹光</Link><small>工作空间</small><WorkspaceNavigation /></aside>
    <main className="footprint-main"><header className="footprint-topbar"><span>工作空间 / <b>足迹地图</b></span><span>仅本人可见</span></header>
      <div className="footprint-content">
        <div className="footprint-heading" data-agent-region="map.heading"><div><small>YOUR PLACES / 01</small><h1>走过的地方，都有迹可循。</h1><p>有坐标的照片与视频会出现在地图上，点位可回到你的私有素材预览。</p></div><Link to="/upload" state={{ from }} data-agent-id="map.heading.upload">↑ 上传素材</Link></div>
        <section className="footprint-stats" aria-label="足迹概览" data-agent-region="map.overview"><div><span>⌖</span><small>已定位素材</small><strong>{pointTotal === null ? '—' : pointTotal} <small>份</small></strong></div><div><span>▧</span><small>待标记位置</small><strong>{unlocatedTotal === null ? '—' : unlocatedTotal} <small>份</small></strong></div><div><span>▤</span><small>县级点亮</small><strong className="footprint-next">下一步再见面</strong></div></section>
        <section className="footprint-workspace" data-agent-region="map.workspace"><div className="footprint-workspace-head"><div><small>THE MAP / 你的旅行坐标</small><h2>我的足迹</h2></div><span>真实素材 · 私人空间</span></div>
          {loading ? <div className="footprint-loading" role="status">正在寻找你走过的地方…</div> : <div className="footprint-body"><div className="footprint-map-column">{loadError ? <div className="footprint-error" role="alert"><p>已定位素材暂时无法加载：{loadError}</p><Button data-agent-id="map.load.retry" onClick={() => setRevision((value) => value + 1)}>重新加载</Button></div> : <LiveMap points={points} status={mapStatus} selected={selected} onSelect={(id) => { setSelectedId(id); setTab('located'); }} /> }<p className="footprint-coordinate-note">位置原始数据为 WGS-84；仅转换成功的坐标才显示在腾讯地图上。不提供县界或县区统计。</p></div>
              <aside className="footprint-pane" data-agent-region="map.media"><div className="footprint-tabs" role="group" aria-label="素材位置状态"><button type="button" data-agent-id="map.media.located" className={tab === 'located' ? 'active' : ''} aria-pressed={tab === 'located'} onClick={() => setTab('located')}>已定位 {pointTotal ?? '—'}</button><button type="button" data-agent-id="map.media.unlocated" className={tab === 'unlocated' ? 'active' : ''} aria-pressed={tab === 'unlocated'} onClick={() => setTab('unlocated')}>未定位 {unlocatedTotal ?? '—'}</button></div>
                <div className="footprint-pane-content"><div className="footprint-pane-intro">{tab === 'located' ? '已定位照片与视频' : '没有坐标，不会出现在地图上'}</div>{tab === 'located' ? <>{loadError ? <p role="alert">列表加载失败，请重试。</p> : points.length ? <><div className="footprint-list" aria-label="已定位素材">{points.map((point) => <button key={point.id} type="button" className={point.id === selected?.id ? 'selected' : ''} data-agent-id={`map.point.${point.id}.select`} aria-pressed={point.id === selected?.id} onClick={() => setSelectedId(point.id)}><span className="footprint-file-icon" aria-hidden="true">{fileKind(point) === '视频' ? '▶' : '▧'}</span><span><strong title={point.name}>{point.name}</strong><small>{pointLabel(point)}</small></span><span aria-hidden="true">›</span></button>)}</div>{truncated && <p role="status">素材较多，当前仅显示前 {points.length} 份；请按需分批浏览。</p>}{selected && <div className="footprint-selected" data-agent-region="map.selected"><SelectedThumbnail point={selected} /><div><small>SELECTED MOMENT</small><h3 title={selected.name}>{selected.name}</h3><p>{pointLabel(selected)}</p><small>{selected.location.source ? sourceNames[selected.location.source] : '已定位'}</small></div><Link to={`/preview/${selected.id}`} state={{ from }} data-agent-id={`map.point.${selected.id}.preview`}>点回素材预览 →</Link></div>}</> : <div className="footprint-empty"><strong>还没有已定位素材</strong><p>从上传带 GPS 的照片或视频开始，或给已有素材手动补充位置。</p><Link to="/upload" state={{ from }} data-agent-id="map.media.upload">上传素材 →</Link></div>}</> : <>{unlocatedError && <div role="alert" className="footprint-error"><p>{unlocatedError}</p><Button data-agent-id="map.media.retry" onClick={() => setRevision((value) => value + 1)}>重新加载</Button></div>}{unlocated.length ? <div className="footprint-list" aria-label="未定位素材">{unlocated.map((file) => <Link key={file.id} to={`/preview/${file.id}`} state={{ from }} data-agent-id={`map.unlocated.${file.id}.preview`}><span className="footprint-file-icon" aria-hidden="true">{fileKind(file) === '视频' ? '▶' : '▧'}</span><span><strong title={file.name}>{file.name}</strong><small>未定位 · 预览页可手动补充</small></span><span aria-hidden="true">›</span></Link>)}</div> : !unlocatedError && <div className="footprint-empty"><strong>没有待标记素材</strong><p>新上传的照片和视频会自动检查是否有可用位置。</p></div>}{unlocatedTotal !== null && unlocated.length < unlocatedTotal && <Button loading={loadingMore} disabled={unlocated.length > 100000} data-agent-id="map.media.loadMore" onClick={() => void loadMore()}>加载更多未定位素材</Button>}</>}</div>
              </aside></div>}
        </section>
        <div className="footprint-after"><div><strong>有些回忆，还没有坐标。</strong><p>未定位素材不会落点，也不会根据文件名猜测地点；可以在素材预览里手动标记。</p><button type="button" data-agent-id="map.after.unlocated" onClick={() => { setTab('unlocated'); document.querySelector('.footprint-workspace')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); }}>查看未定位素材 →</button></div><div><strong>县级点亮 · 下一步</strong><p>县界数据、许可及坐标转换核实后再统计省市县；本版只展示本人素材点位。</p></div></div>
      </div>
    </main><WorkspaceMobileNavigation className="footprint-mobile-nav" region="map.mobileNav" />
  </div>;
}
