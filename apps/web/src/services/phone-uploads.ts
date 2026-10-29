import { env } from '@/config/env';
import { ApiError, apiRequest } from './api';
import type { AutomaticLocation } from './media-location';
import { uploadDirectToCos, UploadCancelledError, UploadRegistrationError } from './uploads';
import type { UploadCompleteResponse, UploadCredentials, UploadProgress, UploadTaskController } from './uploads';

export interface PhonePair {
  id: string;
  secret: string;
  joinUntil: string;
}
export interface PairStatus {
  status: 'pending' | 'awaiting' | 'approved' | 'revoked' | 'expired';
  code: string | null;
  approvedUntil: string | null;
  completedCount: number;
  recentFiles: { id: string; name: string }[];
}
export interface PhoneStatus {
  status: PairStatus['status'];
  code: string | null;
  folderName: string | null;
  approvedUntil: string | null;
}
export interface PhoneJoin {
  deviceToken: string;
  code: string;
  status: 'awaiting';
}

async function deviceRequest<T>(path: string, deviceToken: string | null, method = 'GET', body?: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${env.apiBaseUrl.replace(/\/$/, '')}/api/v1/phone-uploads${path}`, {
      method,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(deviceToken ? { Authorization: `Bearer ${deviceToken}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, { error: { code: 'NETWORK_ERROR', message: '网络连接失败，请检查网络后重试' } });
  }
  if (!response.ok) {
    let payload;
    try { payload = await response.json(); } catch { payload = undefined; }
    throw new ApiError(response.status, payload);
  }
  return response.json() as Promise<T>;
}

const joinsInFlight = new Map<string, Promise<PhoneJoin>>();

export function joinPhoneOnce(id: string, secret: string, deviceToken: string) {
  const key = `${id}:${secret}`;
  let pending = joinsInFlight.get(key);
  if (!pending) {
    pending = deviceRequest<PhoneJoin>(`/${id}/join`, null, 'POST', { secret, deviceToken });
    joinsInFlight.set(key, pending);
    void pending.finally(() => { joinsInFlight.delete(key); }).catch(() => {});
  }
  return pending;
}

export const phoneUploadsApi = {
  create(parentId: string | null) {
    return apiRequest<PhonePair>('/api/v1/phone-uploads', { method: 'POST', body: JSON.stringify({ parentId }) });
  },
  active(parentId: string | null) { return apiRequest<{ id: string | null }>(`/api/v1/phone-uploads/active${parentId ? `?parentId=${parentId}` : ''}`); },
  read(id: string) { return apiRequest<PairStatus>(`/api/v1/phone-uploads/${id}`); },
  approve(id: string) { return apiRequest<{ status: 'approved'; approvedUntil: string }>(`/api/v1/phone-uploads/${id}/approve`, { method: 'POST' }); },
  revoke(id: string) { return apiRequest<{ status: 'revoked' }>(`/api/v1/phone-uploads/${id}/revoke`, { method: 'POST' }); },
  join(id: string, secret: string) { return deviceRequest<PhoneJoin>(`/${id}/join`, null, 'POST', { secret }); },
  status(id: string, deviceToken: string) { return deviceRequest<PhoneStatus>(`/${id}/status`, deviceToken); },
  credentials(id: string, deviceToken: string, file: File) {
    return deviceRequest<UploadCredentials>(`/${id}/credentials`, deviceToken, 'POST', {
      name: file.name, size: file.size, ...(file.type ? { mime: file.type.split(';')[0] } : {}),
    });
  },
  complete(id: string, deviceToken: string, uploadId: string, location: AutomaticLocation | null) {
    return deviceRequest<UploadCompleteResponse>(`/${id}/complete`, deviceToken, 'POST', {
      uploadId, ...(location ? { location } : {}),
    });
  },
};

export async function uploadFromPhone(file: File, id: string, deviceToken: string, handlers: {
  onCredentials(credentials: UploadCredentials): void;
  onProgress(progress: UploadProgress): void;
  onTaskReady(controller: UploadTaskController): void;
  onRegistering(): void;
  isCancelled(): boolean;
}, location: AutomaticLocation | null) {
  const credentials = await phoneUploadsApi.credentials(id, deviceToken, file);
  handlers.onCredentials(credentials);
  if (handlers.isCancelled()) throw new UploadCancelledError();
  await uploadDirectToCos(file, credentials, { onProgress: handlers.onProgress, onTaskReady: handlers.onTaskReady });
  handlers.onRegistering();
  try {
    return await phoneUploadsApi.complete(id, deviceToken, credentials.uploadId, location);
  } catch (cause) {
    throw new UploadRegistrationError(credentials, cause);
  }
}
