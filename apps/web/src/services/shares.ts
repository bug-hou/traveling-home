import { apiRequest } from './api';
import type { NodeAccess } from './nodes';

export interface ShareSettings {
  slug: string;
  title: string;
  description: string;
  mode: 'standard' | 'activity';
  coverNodeId: string | null;
  requireLogin: boolean;
  expiresAt: string | null;
  allowPreview: boolean;
  allowDownload: boolean;
  maxDownloads: number | null;
}

export interface Share extends ShareSettings {
  id: string;
  targetId: string;
  targetType: 'file' | 'folder';
  hasPassword: boolean;
  downloadCount: number;
  viewCount: number;
  revokedAt: string | null;
  createdAt: string;
}

export type ShareInput = ShareSettings & { password?: string | null };
export interface PublicNode {
  id: string;
  parentId: string | null;
  type: 'file' | 'folder';
  name: string;
  mime: string | null;
  size: number;
}
export interface PublicBrowse {
  share: Omit<ShareSettings, 'slug'> & { hasPassword: boolean; downloadCount: number; ownerName: string; handle: string };
  root: PublicNode;
  breadcrumbs: PublicNode[];
  items: PublicNode[];
  total: number;
  offset: number;
}

export type ShareFilter = 'all' | 'active' | 'expired' | 'revoked';

export function shareStatus(share: Share, now = Date.now()): Exclude<ShareFilter, 'all'> {
  if (share.revokedAt) return 'revoked';
  return share.expiresAt && Date.parse(share.expiresAt) <= now ? 'expired' : 'active';
}

export function filterShares(items: Share[], filter: ShareFilter, query: string, now = Date.now()) {
  const keyword = query.trim().toLocaleLowerCase();
  return items.filter((share) => (filter === 'all' || shareStatus(share, now) === filter)
    && (!keyword || `${share.title} ${share.slug}`.toLocaleLowerCase().includes(keyword)));
}

export function shareLink(handle: string, slug: string) {
  const path = `${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`;
  return import.meta.env.DEV ? `${window.location.origin}/s/${path}` : `https://share.convenience.top/${path}`;
}

export const sharesApi = {
  list: () => apiRequest<{ items: Share[]; handle: string | null }>('/api/v1/shares'),
  create: (targetId: string, input: ShareInput) => apiRequest<{ share: Share; handle: string }>('/api/v1/shares', { method: 'POST', body: JSON.stringify({ targetId, ...input }) }),
  update: (id: string, input: Partial<ShareInput>) => apiRequest<{ share: Share; handle: string }>(`/api/v1/shares/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  revoke: (id: string) => apiRequest<void>(`/api/v1/shares/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  browse: (handle: string, slug: string, password?: string, parentId?: string, offset = 0) => apiRequest<PublicBrowse>(`/api/v1/public/shares/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}/browse`, { method: 'POST', body: JSON.stringify({ ...(password ? { password } : {}), ...(parentId ? { parentId } : {}), offset }) }),
  access: (handle: string, slug: string, nodeId: string, purpose: 'preview' | 'download', password?: string) => apiRequest<NodeAccess>(`/api/v1/public/shares/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}/files/${encodeURIComponent(nodeId)}/access`, { method: 'POST', body: JSON.stringify({ purpose, ...(password ? { password } : {}) }) }),
};
