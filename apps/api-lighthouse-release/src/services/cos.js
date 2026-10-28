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

    async signReadUrl(key, { disposition, mime }) {
      const data = await cosCall(client, 'getObjectUrl', {
        Bucket: bucket,
        Region: region,
        Key: key,
        Protocol: 'https:',
        ...(readDomain ? { Domain: readDomain } : {}),
        Method: 'GET',
        Sign: true,
        Expires: 600,
        Query: {
          'response-content-disposition': disposition,
          'response-content-type': mime,
        },
      });
      return data.Url;
    },
  };
}

