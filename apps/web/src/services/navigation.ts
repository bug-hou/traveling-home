export type WorkspaceSection = 'home' | 'files' | 'map' | 'upload' | 'shares' | 'account';

export const workspaceSections: ReadonlyArray<{ id: WorkspaceSection; to: string; label: string; icon: string }> = [
  { id: 'home', to: '/', label: '首页', icon: '⌂' },
  { id: 'files', to: '/files', label: '全部文件', icon: '▤' },
  { id: 'map', to: '/map', label: '足迹地图', icon: '⌖' },
  { id: 'upload', to: '/upload', label: '上传素材', icon: '↑' },
  { id: 'shares', to: '/shares', label: '我的分享', icon: '◇' },
  { id: 'account', to: '/settings/account', label: '我的', icon: '○' },
];

export const upcomingSections = [
  { id: 'trips', label: '旅行', icon: '▦' },
  { id: 'trash', label: '回收站', icon: '⌫' },
] as const;

// 只接受站内已知页面；不能把 URL、签名地址或任意外站地址用作返回目标。
const INTERNAL_PATH = /^\/(?:files(?:\/[a-f\d]{24})?|preview\/[a-f\d]{24}|map|upload|shares(?:\/(?:new|[a-f\d]{24}\/edit))?|settings\/account)?$/i;

export function currentPagePath(pathname: string, search = '') {
  return `${pathname}${search}`;
}

export function navigationSource(pathname: string, search: string, state: unknown) {
  const from = currentPagePath(pathname, search);
  const previousFrom = returnTarget((state as { from?: unknown } | null)?.from, '');
  return previousFrom && previousFrom !== from ? { from, previousFrom } : { from };
}

export function returnTarget(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.length > 1024 || /[\\#\x00-\x1f\x7f]/.test(value)) return fallback;
  const question = value.indexOf('?');
  const pathname = question < 0 ? value : value.slice(0, question);
  return INTERNAL_PATH.test(pathname) ? value : fallback;
}

export function returnLabel(path: string) {
  if (path === '/') return '首页';
  if (path.startsWith('/map')) return '足迹地图';
  if (path.startsWith('/upload')) return '上传素材';
  if (path.startsWith('/shares')) return '我的分享';
  if (path.startsWith('/preview')) return '素材预览';
  if (path.startsWith('/settings/account')) return '账号设置';
  if (path.startsWith('/files') && new URLSearchParams(path.split('?')[1] ?? '').has('q')) return '文件搜索结果';
  return '文件空间';
}
