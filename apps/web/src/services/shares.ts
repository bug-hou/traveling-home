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
  targetType: 'file' | 'folder' | 'note';
  hasPassword: boolean;
  downloadCount: number;
  viewCount: number;
  maxViews: number | null;
  revokedAt: string | null;
  createdAt: string;
}

export type ShareInput = ShareSettings & { password?: string | null; maxViews?: number | null };
export interface PublicNode {
  id: string;
  parentId: string | null;
  type: 'file' | 'folder';
  name: string;
  mime: string | null;
  size: number;
}
export interface PublicBrowse {
  share: Omit<ShareSettings, 'slug'> & { targetType: 'file' | 'folder' | 'note'; hasPassword: boolean; downloadCount: number; ownerName: string; handle: string };
  root: PublicNode | null;
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
  create: (targetId: string, input: ShareInput, targetType?: 'note') => apiRequest<{ share: Share; handle: string }>('/api/v1/shares', { method: 'POST', body: JSON.stringify(targetType === 'note' ? { noteId: targetId, slug: input.slug, title: input.title, description: input.description, expiresAt: input.expiresAt, maxViews: input.maxViews ?? null, ...(input.password ? { password: input.password } : {}) } : { targetId, ...input }) }),
  update: (id: string, input: Partial<ShareInput>, targetType?: 'note') => apiRequest<{ share: Share; handle: string }>(`/api/v1/shares/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(targetType === 'note' ? { slug: input.slug, title: input.title, description: input.description, expiresAt: input.expiresAt, ...(Object.hasOwn(input, 'maxViews') ? { maxViews: input.maxViews } : {}), ...(Object.hasOwn(input, 'password') ? { password: input.password } : {}) } : input) }),
  revoke: (id: string) => apiRequest<void>(`/api/v1/shares/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  browse: (handle: string, slug: string, password?: string, parentId?: string, offset = 0) => apiRequest<PublicBrowse>(`/api/v1/public/shares/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}/browse`, { method: 'POST', body: JSON.stringify({ ...(password ? { password } : {}), ...(parentId ? { parentId } : {}), offset }) }),
  access: (handle: string, slug: string, nodeId: string, purpose: 'preview' | 'download', password?: string) => apiRequest<NodeAccess>(`/api/v1/public/shares/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}/files/${encodeURIComponent(nodeId)}/access`, { method: 'POST', body: JSON.stringify({ purpose, ...(password ? { password } : {}) }) }),
  readNote: (handle: string, slug: string, password?: string) => apiRequest<{ share: ShareSettings & { ownerName: string; hasPassword: boolean }; note: { title: string; content: string } }>(`/api/v1/public/shares/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}/note`, { method: 'POST', body: JSON.stringify({ ...(password ? { password } : {}) }) }),
};

