import { apiRequest } from './api';

export interface NodeSummary {
  id: string;
  parentId: string | null;
  type: 'file' | 'folder';
  name: string;
  size: number;
  mime: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  uploadedAt?: string | null;
  deletedAt: string | null;
}

export interface NodeListResponse {
  items: NodeSummary[];
  total: number;
  offset: number;
  limit: number;
}

export type NodeSort = 'name' | 'updated' | 'size' | 'created';

export interface NodeAccess {
  url: string;
  expiresAt: string;
  name: string;
  mime: string;
  previewable: boolean;
}

export interface NodeLocation {
  latitude: number;
  longitude: number;
  placeName: string | null;
  source: 'manual';
}

const sortOptions: Record<NodeSort, { sortBy: string; sortOrder: string }> = {
  name: { sortBy: 'name', sortOrder: 'asc' },
  updated: { sortBy: 'updatedAt', sortOrder: 'desc' },
  size: { sortBy: 'size', sortOrder: 'desc' },
  created: { sortBy: 'createdAt', sortOrder: 'asc' },
};

export const nodesApi = {
  list(parentId: string | null, offset = 0, sort: NodeSort = 'name') {
    const params = new URLSearchParams({ limit: '100', offset: String(offset), ...sortOptions[sort] });
    if (parentId) params.set('parentId', parentId);
    return apiRequest<NodeListResponse>(`/api/v1/nodes?${params.toString()}`);
  },
  search(query: string, offset = 0) {
    return apiRequest<NodeListResponse>(`/api/v1/nodes/search?${new URLSearchParams({ q: query, offset: String(offset), limit: '100' })}`);
  },
  detail(id: string, signal?: AbortSignal) {
    return apiRequest<{ node: NodeSummary; ancestors: NodeSummary[] }>(`/api/v1/nodes/${encodeURIComponent(id)}`, { signal });
  },
  location(id: string, signal?: AbortSignal) {
    return apiRequest<{ location: NodeLocation | null }>(`/api/v1/nodes/${encodeURIComponent(id)}/location`, { signal });
  },
  saveLocation(id: string, data: { latitude: number; longitude: number; placeName: string | null }) {
    return apiRequest<{ location: NodeLocation }>(`/api/v1/nodes/${encodeURIComponent(id)}/location`, {
      method: 'PATCH', body: JSON.stringify(data),
    });
  },
  createFolder(name: string, parentId: string | null) {
    return apiRequest<{ node: NodeSummary }>('/api/v1/nodes/folder', {
      method: 'POST', body: JSON.stringify({ name, parentId }),
    });
  },
  rename(id: string, name: string) {
    return apiRequest<{ node: NodeSummary }>(`/api/v1/nodes/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ name }),
    });
  },
  move(id: string, parentId: string | null) {
    return apiRequest<{ node: NodeSummary }>(`/api/v1/nodes/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ parentId }),
    });
  },
  remove(id: string) {
    return apiRequest<{ deletedCount: number }>(`/api/v1/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  access(id: string, purpose: 'preview' | 'download' | 'thumbnail', signal?: AbortSignal) {
    return apiRequest<NodeAccess>(`/api/v1/nodes/${encodeURIComponent(id)}/url?purpose=${purpose}`, { signal });
  },
};
