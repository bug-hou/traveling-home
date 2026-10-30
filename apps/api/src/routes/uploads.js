import { randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { fail, parseBody } from '../lib/http.js';
import { getPhonePairing } from './phone-uploads.js';

const MAX_OBJECT_SIZE = 5_000_000_000_000;
const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const fileNameSchema = z
  .string()
  .trim()
  .min(1, '文件名不能为空')
  .max(255, '文件名不能超过 255 个字符')
  .refine((value) => !/[\\/\0]/.test(value) && value !== '.' && value !== '..', {
    message: '文件名不能包含路径分隔符',
  });
const parentIdSchema = z.string().regex(/^[a-f\d]{24}$/i, '文件夹 ID 格式不正确');
const credentialsBody = z
  .object({
    name: fileNameSchema,
    size: z.number().int().min(0).max(MAX_OBJECT_SIZE),
    mime: z
      .string()
      .trim()
      .max(255)
      .regex(/^[a-z\d!#$&^_.+-]+\/[a-z\d!#$&^_.+-]+$/i, 'MIME 类型格式不正确')
      .optional(),
    parentId: parentIdSchema.nullable().optional(),
  })
  .strict();
const phoneCredentialsBody = credentialsBody.omit({ parentId: true });
const PHONE_MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024;
const PHONE_MAX_FILES = 100;
const automaticLocationSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  source: z.enum(['exif', 'srt']),
}).strict();
const completeBody = z
  .object({
    uploadId: z.string().regex(/^[a-f\d]{24}$/i, '上传 ID 格式不正确'),
    location: automaticLocationSchema.optional(),
  })
  .strict();

function extensionFor(name) {
  const match = name.match(/\.([a-z\d]{1,16})$/i);
  return match ? `.${match[1].toLowerCase()}` : '';
}

function getContentLength(head) {
  const value =
    head?.headers?.['content-length'] ??
    head?.headers?.['Content-Length'] ??
    head?.ContentLength ??
    head?.contentLength;
  const size = Number(value);
  return Number.isSafeInteger(size) && size >= 0 ? size : null;
}

function getEtag(head) {
  const etag = head?.headers?.etag ?? head?.headers?.ETag ?? head?.ETag;
  return typeof etag === 'string' && (/^[a-f\d]{32}(?:-\d+)?$/i.test(etag) || /^"[a-f\d]{32}(?:-\d+)?"$/i.test(etag)) ? etag : null;
}

function isObjectNotFound(error) {
  return (
    Number(error?.statusCode) === 404 ||
    error?.code === 'NoSuchKey' ||
    error?.code === 'NotFound' ||
    error?.Code === 'NoSuchKey' ||
    error?.Code === 'NotFound'
  );
}

function serializeFile(node) {
  return {
    id: String(node._id),
    parentId: node.parentId ? String(node.parentId) : null,
    type: 'file',
    name: node.name,
    size: node.size,
    mime: node.mime,
    status: node.status,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    uploadedAt: node.uploadedAt,
    deletedAt: node.deletedAt,
  };
}

async function findActiveParent(nodes, userId, parentId) {
  if (!parentId) return true;
  const parent = await nodes.findOne({
    _id: parentId,
    userId,
    type: 'folder',
    deletedAt: null,
  });
  return Boolean(parent);
}

export default async function uploadRoutes(app, { cfg, db, requireAuth, cos }) {
  const nodes = db.collection('nodes');
  const sessions = db.collection('upload_sessions');

  const pairs = db.collection('phone_upload_pairs');

  async function createCredentials(req, reply, pair = null) {
    if (!cfg.cos || !cos) {
      return fail(reply, 503, 'UPLOADS_NOT_CONFIGURED', '上传服务暂不可用');
    }

    const body = parseBody(pair ? phoneCredentialsBody : credentialsBody, req.body, reply);
    if (!body) return;
    if (pair && body.size > PHONE_MAX_FILE_SIZE) {
      return fail(reply, 400, 'PHONE_FILE_TOO_LARGE', '扫码上传单个文件不能超过 5 GB');
    }

    const userId = pair ? pair.userId : req.user._id;
    const parentId = pair ? pair.parentId : body.parentId ? new ObjectId(body.parentId) : null;
    if (!(await findActiveParent(nodes, userId, parentId))) {
      return fail(reply, 404, 'PARENT_NOT_FOUND', '目标文件夹不存在');
    }

    const now = new Date();
    const uploadId = new ObjectId();
    const nodeId = new ObjectId();
    const datePath = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const key = `${cfg.cos.prefix}/users/${userId}/originals/${datePath}/${nodeId}${extensionFor(body.name)}`;
    const stagingKey = pair ? `${cfg.cos.prefix}/users/${userId}/incoming/${pair._id}/${uploadId}${extensionFor(body.name)}` : null;
    const expiresAt = new Date(now.getTime() + UPLOAD_SESSION_TTL_MS);
    const credentialExpiresAt = new Date(now.getTime() + 30 * 60 * 1000);
    const session = {
      _id: uploadId,
      userId,
      nodeId,
      parentId,
      name: body.name,
      expectedSize: body.size,
      mime: body.mime?.toLowerCase() ?? 'application/octet-stream',
      cosKey: key,
      status: 'pending',
      createdAt: now,
      expiresAt,
      credentialExpiresAt,
      ...(pair ? { phonePairId: pair._id, stagingKey } : {}),
    };

    if (pair) {
      const reserved = await pairs.updateOne(
        { _id: pair._id, status: 'approved', approvedUntil: { $gt: now }, issuedCount: { $lt: PHONE_MAX_FILES } },
        { $inc: { issuedCount: 1 } },
      );
      if (!reserved.matchedCount) return fail(reply, 410, 'PAIRING_LIMIT', '本次扫码上传已结束或达到 100 个文件的上限');
    }

    let authorization;
    try {
      authorization = await cos.issueUploadCredentials({ key: stagingKey ?? key });
    } catch {
      if (pair) await pairs.updateOne({ _id: pair._id }, { $inc: { issuedCount: -1 } });
      return fail(reply, 503, 'UPLOAD_AUTH_UNAVAILABLE', '暂时无法创建上传授权，请稍后重试');
    }

    try {
      if (pair && !(await pairs.findOne({ _id: pair._id, status: 'approved', approvedUntil: { $gt: new Date() } }))) {
        await pairs.updateOne({ _id: pair._id }, { $inc: { issuedCount: -1 } });
        return fail(reply, 410, 'PAIRING_INACTIVE', '电脑已结束本次扫码上传');
      }
      session.credentialExpiresAt = authorization.expiresAt;
      await sessions.insertOne(session);
    } catch {
      if (pair) await pairs.updateOne({ _id: pair._id }, { $inc: { issuedCount: -1 } });
      return fail(reply, 503, 'UPLOAD_SESSION_UNAVAILABLE', '暂时无法创建上传任务，请稍后重试');
    }

    reply.header('Cache-Control', 'private, no-store');
    return reply.code(201).send({
      uploadId: String(uploadId),
      fileId: String(nodeId),
      bucket: cfg.cos.bucket,
      region: cfg.cos.region,
      key: stagingKey ?? key,
      credentials: authorization.credentials,
      expiresAt: authorization.expiresAt,
    });
  }

  app.post('/uploads/credentials', { preHandler: requireAuth }, (req, reply) => createCredentials(req, reply));
  if (cfg.phoneUploadsEnabled === true) {
    app.post('/phone-uploads/:id/credentials', async (req, reply) => {
      const pair = await getPhonePairing(req, reply, db, { forCredentials: true });
      if (!pair) return;
      return createCredentials(req, reply, pair);
    });
  }

  async function completeUpload(req, reply, pair = null) {
    const body = parseBody(completeBody, req.body, reply);
    if (!body) return;

    const userId = pair ? pair.userId : req.user._id;
    const uploadId = new ObjectId(body.uploadId);
    const session = await sessions.findOne({ _id: uploadId, userId, ...(pair ? { phonePairId: pair._id } : {}) });
    if (!session || !pair && session.phonePairId) return fail(reply, 404, 'UPLOAD_SESSION_NOT_FOUND', '上传任务不存在或已过期');
    if (body.location) {
      const { name, mime } = session;
      const matchesFile = body.location.source === 'exif'
        ? /\.jpe?g$/i.test(name) && (mime === 'image/jpeg' || mime === 'application/octet-stream')
        : /\.(mp4|mov)$/i.test(name) && (mime.startsWith('video/') || mime === 'application/octet-stream');
      if (!matchesFile) return fail(reply, 400, 'INVALID_INPUT', '位置来源与上传文件格式不匹配');
    }

    reply.header('Cache-Control', 'private, no-store');
    if (session.status === 'completed') {
      const existingNode = await nodes.findOne({
        _id: session.nodeId,
        userId,
        uploadSessionId: session._id,
      });
      if (!existingNode) return fail(reply, 500, 'UPLOAD_RECORD_INCONSISTENT', '上传记录暂时无法读取');
      return { node: serializeFile(existingNode), idempotent: true };
    }

    if (pair && session.status === 'promoting' && session.promotionUntil > new Date()) {
      return fail(reply, 409, 'UPLOAD_IN_PROGRESS', '文件正在登记，请稍后重试');
    }
    if (!['pending', ...(pair ? ['promoting'] : [])].includes(session.status) || session.expiresAt <= new Date()) {
      return fail(reply, 410, 'UPLOAD_SESSION_EXPIRED', '上传任务已过期，请重新上传');
    }
    if (pair && (!session.stagingKey || !session.stagingKey.startsWith(`${cfg.cos.prefix}/users/${userId}/incoming/${pair._id}/`))) {
      return fail(reply, 409, 'UPLOAD_SESSION_UNSAFE', '旧版扫码上传任务不可登记，请重新上传');
    }

    if (!(await findActiveParent(nodes, userId, session.parentId))) {
      return fail(reply, 409, 'PARENT_NOT_AVAILABLE', '目标文件夹已不可用，请重新选择位置');
    }

    let head;
    try {
      head = await cos.headObject(pair ? session.stagingKey : session.cosKey);
    } catch (error) {
      if (isObjectNotFound(error)) {
        return fail(reply, 409, 'UPLOAD_OBJECT_NOT_FOUND', '未找到已上传的文件对象');
      }
      return fail(reply, 503, 'STORAGE_UNAVAILABLE', '暂时无法校验上传文件，请稍后重试');
    }

    const actualSize = getContentLength(head);
    if (actualSize === null) return fail(reply, 502, 'STORAGE_RESPONSE_INVALID', '存储服务返回了无效的文件信息');
    if (actualSize !== session.expectedSize) {
      return fail(reply, 409, 'UPLOAD_SIZE_MISMATCH', '上传文件大小与申请上传时不一致');
    }
    if (!(await findActiveParent(nodes, userId, session.parentId))) {
      return fail(reply, 409, 'PARENT_NOT_AVAILABLE', '目标文件夹已不可用，请重新选择位置');
    }
    let promotion = null;
    let pairLease = false;
    try {
    if (pair) {
      if (!(await pairs.findOne({ _id: pair._id, status: 'approved', deviceHash: pair.deviceHash, approvedUntil: { $gt: new Date() } }))) {
        return fail(reply, 410, 'PAIRING_INACTIVE', '电脑已结束本次扫码上传');
      }
      const etag = getEtag(head);
      if (!etag) return fail(reply, 502, 'STORAGE_RESPONSE_INVALID', '存储服务未返回有效的对象标识');
      const id = randomBytes(16).toString('hex');
      const extension = extensionFor(session.name);
      const stem = extension ? session.cosKey.slice(0, -extension.length) : session.cosKey;
      const key = `${stem}-${id}${extension}`;
      const now = new Date();
      const lease = await pairs.updateOne(
        { _id: pair._id, status: 'approved', deviceHash: pair.deviceHash, approvedUntil: { $gt: now } },
        { $inc: { activePromotions: 1 } },
      );
      if (!lease.matchedCount) return fail(reply, 410, 'PAIRING_INACTIVE', '电脑已结束本次扫码上传');
      pairLease = true;
      const claim = await sessions.updateOne(
        { _id: session._id, userId, phonePairId: pair._id,
          ...(session.status === 'pending' ? { status: 'pending' } : { status: 'promoting', promotionUntil: { $lte: now } }) },
        { $set: { status: 'promoting', promotionId: id, promotionUntil: new Date(now.getTime() + 10 * 60_000) } },
      );
      if (!claim.matchedCount) return fail(reply, 409, 'UPLOAD_IN_PROGRESS', '文件正在登记，请稍后重试');
      promotion = { id, key };
      try {
        await cos.promoteObject({ sourceKey: session.stagingKey, key, size: actualSize, etag, mime: session.mime });
        const copied = await cos.headObject(key);
        if (getContentLength(copied) !== actualSize) throw new Error('COS promoted object size mismatch');
        const sourceAfterCopy = await cos.headObject(session.stagingKey);
        if (getEtag(sourceAfterCopy) !== etag || getContentLength(sourceAfterCopy) !== actualSize) {
          throw new Error('COS copy source changed during promotion');
        }
      } catch (error) {
        try { await cos.deleteObject(key); } catch {}
        await sessions.updateOne({ _id: session._id, userId, status: 'promoting', promotionId: id },
          { $set: { status: 'pending' } });
        return fail(reply, 503, 'STORAGE_UNAVAILABLE', '文件转存失败，请稍后重试登记');
      }
      if (!(await pairs.findOne({ _id: pair._id, status: 'approved', deviceHash: pair.deviceHash, approvedUntil: { $gt: new Date() } }))
        || !(await sessions.findOne({ _id: session._id, userId, status: 'promoting', promotionId: id }))
        || !(await findActiveParent(nodes, userId, session.parentId))) {
        try { await cos.deleteObject(key); } catch {}
        await sessions.updateOne({ _id: session._id, userId, status: 'promoting', promotionId: id },
          { $set: { status: 'pending' } });
        return fail(reply, 410, 'PAIRING_INACTIVE', '授权已结束或上传目标已不可用');
      }
    }

    const now = new Date();
    const node = {
      _id: session.nodeId,
      userId,
      parentId: session.parentId,
      type: 'file',
      name: session.name,
      size: actualSize,
      mime: session.mime,
      hash: null,
      cosKey: promotion?.key ?? session.cosKey,
      status: 'ready',
      uploadSessionId: session._id,
      ...(body.location ? { mediaLocation: { ...body.location, placeName: null } } : {}),
      createdAt: now,
      updatedAt: now,
      uploadedAt: now,
      deletedAt: null,
    };

    let inserted = true;
    try {
      await nodes.insertOne(node);
    } catch (error) {
      if (error?.code !== 11000) {
        if (promotion) await sessions.updateOne({ _id: session._id, userId, status: 'promoting', promotionId: promotion.id },
          { $set: { status: 'pending' } });
        throw error;
      }
      inserted = false;
      const existingNode = await nodes.findOne({
        _id: session.nodeId,
        userId,
        uploadSessionId: session._id,
      });
      if (!existingNode) throw error;
      Object.assign(node, existingNode);
    }

    await sessions.updateOne(
      { _id: session._id, userId, ...(promotion ? { status: 'promoting', promotionId: promotion.id } : { status: 'pending' }) },
      { $set: { status: 'completed', completedAt: now, updatedAt: now } },
    );
    if (pair && inserted) await pairs.updateOne({ _id: pair._id }, {
      $inc: { completedCount: 1 },
      $push: { recentFiles: { $each: [{ id: String(node._id), name: node.name }], $slice: -10 } },
    });

    return { node: serializeFile(node), idempotent: !inserted };
    } finally {
      if (pairLease) await pairs.updateOne({ _id: pair._id }, { $inc: { activePromotions: -1 } });
    }
  }

  app.post('/uploads/complete', { preHandler: requireAuth }, (req, reply) => completeUpload(req, reply));
  if (cfg.phoneUploadsEnabled === true) {
    app.post('/phone-uploads/:id/complete', async (req, reply) => {
      const pair = await getPhonePairing(req, reply, db);
      if (!pair) return;
      return completeUpload(req, reply, pair);
    });
  }
}
