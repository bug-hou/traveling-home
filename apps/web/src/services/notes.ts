import { env } from '@/config/env';
import { ApiError, apiRequest } from './api';

export interface PrivateNote {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}
export type NoteSummary = Omit<PrivateNote, 'content'>;

export const notesApi = {
  list: (offset = 0) => apiRequest<{ items: NoteSummary[]; total: number; offset: number }>(`/api/v1/notes?offset=${offset}`),
  detail: (id: string) => apiRequest<{ note: PrivateNote }>(`/api/v1/notes/${encodeURIComponent(id)}`),
  create: (title: string, content: string) => apiRequest<{ note: PrivateNote }>('/api/v1/notes', { method: 'POST', body: JSON.stringify({ title, content }) }),
  update: (id: string, title: string, content: string) => apiRequest<{ note: PrivateNote }>(`/api/v1/notes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ title, content }) }),
  remove: (id: string) => apiRequest<void>(`/api/v1/notes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export interface NotePair {
  id: string;
  secret: string;
  joinUntil: string;
}
export interface NotePairStatus {
  status: 'pending' | 'awaiting' | 'approved' | 'revoked' | 'expired';
  code: string | null;
  approvedUntil: string | null;
}
export type PhoneNoteStatus = Pick<NotePairStatus, 'status' | 'approvedUntil'>;

async function deviceRequest<T>(id: string, endpoint: string, token: string | null, method = 'GET', body?: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${env.apiBaseUrl.replace(/\/$/, '')}/api/v1/note-pairs/${encodeURIComponent(id)}${endpoint}`, {
      method, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch { throw new ApiError(0, { error: { code: 'NETWORK_ERROR', message: '网络连接失败，请检查网络后重试' } }); }
  if (!response.ok) {
    let payload;
    try { payload = await response.json(); } catch { payload = undefined; }
    throw new ApiError(response.status, payload);
  }
  return response.json() as Promise<T>;
}

const joinsInFlight = new Map<string, Promise<{ deviceToken: string; code: string; status: 'awaiting' }>>();

export const notePairsApi = {
  create: (noteId: string) => apiRequest<NotePair>('/api/v1/note-pairs', { method: 'POST', body: JSON.stringify({ noteId }) }),
  active: (noteId: string) => apiRequest<{ id: string | null }>(`/api/v1/note-pairs/active?noteId=${encodeURIComponent(noteId)}`),
  read: (id: string) => apiRequest<NotePairStatus>(`/api/v1/note-pairs/${encodeURIComponent(id)}`),
  approve: (id: string) => apiRequest<{ status: 'approved'; approvedUntil: string }>(`/api/v1/note-pairs/${encodeURIComponent(id)}/approve`, { method: 'POST' }),
  revoke: (id: string) => apiRequest<{ status: 'revoked' }>(`/api/v1/note-pairs/${encodeURIComponent(id)}/revoke`, { method: 'POST' }),
  join(id: string, secret: string, deviceToken: string) {
    const key = `${id}:${deviceToken}`;
    let pending = joinsInFlight.get(key);
    if (!pending) {
      pending = deviceRequest<{ deviceToken: string; code: string; status: 'awaiting' }>(id, '/join', null, 'POST', { secret, deviceToken });
      joinsInFlight.set(key, pending);
      void pending.finally(() => { joinsInFlight.delete(key); }).catch(() => {});
    }
    return pending;
  },
  status: (id: string, deviceToken: string) => deviceRequest<PhoneNoteStatus>(id, '/status', deviceToken),
  content: (id: string, deviceToken: string) => deviceRequest<{ note: PrivateNote }>(id, '/note', deviceToken),
};
