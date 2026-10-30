import COS from 'cos-nodejs-sdk-v5';
import STS from 'qcloud-cos-sts';

const UPLOAD_ACTIONS = [
  'name/cos:PutObject',
  'name/cos:InitiateMultipartUpload',
  'name/cos:UploadPart',
  'name/cos:CompleteMultipartUpload',
  'name/cos:AbortMultipartUpload',
  'name/cos:ListParts',
];
const COPY_PART_SIZE = 1024 ** 3;
const SIMPLE_COPY_LIMIT = 4 * COPY_PART_SIZE;

const DOWNLOAD_EXTENSIONS = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'video/mp4': ['mp4', 'm4v'],
  'video/webm': ['webm'],
  'audio/mpeg': ['mp3'],
  'audio/mp4': ['m4a', 'mp4'],
  'audio/ogg': ['ogg', 'oga'],
  'audio/wav': ['wav'],
};

export function downloadResponse(name, mime) {
  const normalizedMime = typeof mime === 'string' ? mime.toLowerCase() : '';
  const extensions = Object.hasOwn(DOWNLOAD_EXTENSIONS, normalizedMime) ? DOWNLOAD_EXTENSIONS[normalizedMime] : null;
  const base = (typeof name === 'string' ? name : '').replace(/[\\/\x00-\x1f\x7f]/g, '_').trim() || 'download';
  const filename = extensions && !extensions.some((extension) => base.toLowerCase().endsWith(`.${extension}`))
    ? `${base}.${extensions[0]}` : base;
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\%]/g, '_');
  const fallback = /[a-z\d]/i.test(ascii.split('.').slice(0, -1).join('.') || ascii)
    ? ascii : `download${extensions ? `.${extensions[0]}` : ''}`;
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return {
    mime: extensions ? normalizedMime : 'application/octet-stream',
    disposition: `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
  };
}

function getCredential(options) {
  return new Promise((resolve, reject) => {
    STS.getCredential(options, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}

function cosCall(cos, method, params) {
  return new Promise((resolve, reject) => {
    cos[method](params, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}

export async function copyVerifiedObject(client, { bucket, region, sourceKey, key, size, etag, mime }) {
  if (sourceKey === key || !Number.isSafeInteger(size) || size < 0 || !(/^[a-f\d]{32}(?:-\d+)?$/i.test(etag) || /^"[a-f\d]{32}(?:-\d+)?"$/i.test(etag))) {
    throw new Error('invalid COS copy source');
  }
  const CopySource = `${bucket}.cos.${region}.myqcloud.com/${sourceKey.split('/').map(encodeURIComponent).join('/')}`;
  const destination = { Bucket: bucket, Region: region, Key: key };
  if (size <= SIMPLE_COPY_LIMIT) {
    return cosCall(client, 'putObjectCopy', { ...destination, CopySource, CopySourceIfMatch: etag });
  }

  const { UploadId } = await cosCall(client, 'multipartInit', { ...destination, ContentType: mime });
  if (!UploadId) throw new Error('COS multipart init returned no upload ID');
  try {
    const Parts = [];
    for (let offset = 0; offset < size; offset += COPY_PART_SIZE) {
      const part = await cosCall(client, 'uploadPartCopy', {
        ...destination, CopySource, CopySourceIfMatch: etag, UploadId,
        PartNumber: Parts.length + 1,
        CopySourceRange: `bytes=${offset}-${Math.min(size - 1, offset + COPY_PART_SIZE - 1)}`,
      });
      if (!part.ETag) throw new Error('COS multipart copy returned no ETag');
      Parts.push({ PartNumber: Parts.length + 1, ETag: part.ETag });
    }
    return await cosCall(client, 'multipartComplete', { ...destination, UploadId, Parts });
  } catch (error) {
    try { await cosCall(client, 'multipartAbort', { ...destination, UploadId }); } catch {}
    throw error;
  }
}

export function createCosService(cfg) {
  if (!cfg.cos) return null;

  const { secretId, secretKey, bucket, region, appId, readDomain } = cfg.cos;
  const client = new COS({ SecretId: secretId, SecretKey: secretKey });

  return {
    async issueUploadCredentials({ key }) {
      const resource = `qcs::cos:${region}:uid/${appId}:${bucket}/${key}`;
      const data = await getCredential({
        secretId,
        secretKey,
        durationSeconds: 1800,
        policy: {
          version: '2.0',
          statement: [
            {
              action: UPLOAD_ACTIONS,
              effect: 'allow',
              principal: { qcs: ['*'] },
              resource: [resource],
            },
          ],
        },
      });

      return {
        credentials: {
          tmpSecretId: data.credentials.tmpSecretId,
          tmpSecretKey: data.credentials.tmpSecretKey,
          sessionToken: data.credentials.sessionToken,
        },
        expiresAt: new Date(data.expiredTime * 1000),
      };
    },

    async headObject(key) {
      return cosCall(client, 'headObject', { Bucket: bucket, Region: region, Key: key });
    },

    async promoteObject({ sourceKey, key, size, etag, mime }) {
      return copyVerifiedObject(client, { bucket, region, sourceKey, key, size, etag, mime });
    },

    async deleteObject(key) {
      return cosCall(client, 'deleteObject', { Bucket: bucket, Region: region, Key: key });
    },

    async signReadUrl(key, { disposition, mime, thumbnail = false, expires = 600 }) {
      const data = await cosCall(client, 'getObjectUrl', {
        Bucket: bucket,
        Region: region,
        Key: key,
        Protocol: 'https:',
        ...(readDomain ? { Domain: readDomain } : {}),
        Method: 'GET',
        Sign: true,
        Expires: expires,
        Query: {
          'response-content-disposition': disposition,
          'response-content-type': mime,
          ...(thumbnail ? { 'imageMogr2/thumbnail/320x320>/format/jpg/quality/80': '' } : {}),
        },
      });
      return data.Url;
    },
  };
}

