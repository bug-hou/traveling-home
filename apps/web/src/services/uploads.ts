import COS from 'cos-js-sdk-v5';
import { apiRequest } from './api';

export interface UploadCredentialInput {
  name: string;
  size: number;
  mime?: string;
  parentId: string | null;
}

export interface UploadCredentials {
  uploadId: string;
  fileId: string;
  bucket: string;
  region: string;
  key: string;
  credentials: {
    tmpSecretId: string;
    tmpSecretKey: string;
    sessionToken: string;
  };
  expiresAt: string;
}

export interface UploadedNode {
  id: string;
  parentId: string | null;
  type: 'file';
  name: string;
  size: number;
  mime: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  uploadedAt: string;
  deletedAt: string | null;
}

export interface UploadCompleteResponse {
  node: UploadedNode;
  idempotent: boolean;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  speed: number;
  percent: number;
}

export interface UploadTaskController {
  pause(): void;
  resume(): void;
  cancel(): void;
}

export const uploadsApi = {
  requestCredentials(input: UploadCredentialInput) {
    return apiRequest<UploadCredentials>('/api/v1/uploads/credentials', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  complete(uploadId: string) {
    return apiRequest<UploadCompleteResponse>('/api/v1/uploads/complete', {
      method: 'POST',
      body: JSON.stringify({ uploadId }),
    });
  },
};

export class UploadCancelledError extends Error {
  constructor() {
    super('UPLOAD_CANCELLED');
    this.name = 'UploadCancelledError';
  }
}

export class UploadRegistrationError extends Error {
  readonly credentials: UploadCredentials;
  readonly originalError: unknown;

  constructor(credentials: UploadCredentials, originalError: unknown) {
    super(originalError instanceof Error ? originalError.message : '文件已上传，但登记失败');
    this.name = 'UploadRegistrationError';
    this.credentials = credentials;
    this.originalError = originalError;
  }
}

export async function uploadSelectedFile(
  file: File,
  parentId: string | null,
  handlers: {
    onCredentials(credentials: UploadCredentials): void;
    onProgress(progress: UploadProgress): void;
    onTaskReady(controller: UploadTaskController): void;
    onRegistering(): void;
    isCancelled(): boolean;
  },
) {
  const credentials = await uploadsApi.requestCredentials({
    name: file.name,
    size: file.size,
    ...(file.type ? { mime: file.type.split(';')[0] } : {}),
    parentId,
  });
  handlers.onCredentials(credentials);
  if (handlers.isCancelled()) throw new UploadCancelledError();

  await uploadDirectToCos(file, credentials, {
    onProgress: handlers.onProgress,
    onTaskReady: handlers.onTaskReady,
  });

  handlers.onRegistering();
  try {
    return await uploadsApi.complete(credentials.uploadId);
  } catch (error) {
    throw new UploadRegistrationError(credentials, error);
  }
}

export function retryUploadRegistration(credentials: UploadCredentials) {
  return uploadsApi.complete(credentials.uploadId);
}

export function uploadDirectToCos(
  file: File,
  credentials: UploadCredentials,
  handlers: {
    onProgress(progress: UploadProgress): void;
    onTaskReady(controller: UploadTaskController): void;
  },
): Promise<void> {
  const cos = new COS({
    getAuthorization(_options, callback) {
      callback({
        TmpSecretId: credentials.credentials.tmpSecretId,
        TmpSecretKey: credentials.credentials.tmpSecretKey,
        SecurityToken: credentials.credentials.sessionToken,
        StartTime: Math.floor(Date.now() / 1000) - 60,
        ExpiredTime: Math.floor(new Date(credentials.expiresAt).getTime() / 1000),
      });
    },
  });

  return new Promise((resolve, reject) => {
    let taskId: string | null = null;
    let pausedBeforeReady = false;
    let cancelled = false;

    const controller: UploadTaskController = {
      pause() {
        if (taskId) cos.pauseTask(taskId);
        else pausedBeforeReady = true;
      },
      resume() {
        if (taskId) cos.restartTask(taskId);
        pausedBeforeReady = false;
      },
      cancel() {
        cancelled = true;
        if (taskId) cos.cancelTask(taskId);
      },
    };

    cos
      .uploadFile({
        Bucket: credentials.bucket,
        Region: credentials.region,
        Key: credentials.key,
        Body: file,
        ContentType: file.type || 'application/octet-stream',
        SliceSize: 5 * 1024 * 1024,
        ChunkSize: 8 * 1024 * 1024,
        onTaskReady(nextTaskId) {
          taskId = nextTaskId;
          handlers.onTaskReady(controller);
          if (pausedBeforeReady) cos.pauseTask(nextTaskId);
          if (cancelled) cos.cancelTask(nextTaskId);
        },
        onProgress(progress) {
          handlers.onProgress(progress);
        },
      })
      .then(() => {
        if (cancelled) reject(new Error('UPLOAD_CANCELLED'));
        else resolve();
      })
      .catch((error: unknown) => {
        reject(cancelled ? new Error('UPLOAD_CANCELLED') : error);
      });
  });
}
