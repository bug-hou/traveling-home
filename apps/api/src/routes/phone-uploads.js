import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { fail, parseBody } from '../lib/http.js';

const ID = /^[a-f\d]{24}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const JOIN_TTL_MS = 5 * 60 * 1000;
const UPLOAD_TTL_MS = 60 * 60 * 1000;
const RECORD_TTL_MS = 24 * 60 * 60 * 1000;
const createBody = z.object({ parentId: z.string().regex(ID).nullable() }).strict();
const joinBody = z.object({ secret: z.string().regex(TOKEN), deviceToken: z.string().regex(TOKEN) }).strict();
const hash = (value) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');

function secretMatches(value, expectedHash) {
  if (!TOKEN.test(value ?? '') || !/^[a-f\d]{64}$/.test(expectedHash ?? '')) return false;
  return timingSafeEqual(Buffer.from(hash(value), 'hex'), Buffer.from(expectedHash, 'hex'));
}

function pairingId(req, reply) {
  if (!ID.test(req.params.id)) {
    fail(reply, 404, 'PAIRING_NOT_FOUND', '扫码会话不存在');
    return null;
  }
  return new ObjectId(req.params.id);
}

export async function getPhonePairing(req, reply, db, { forCredentials = false } = {}) {
  const id = pairingId(req, reply);
  if (!id) return null;
  const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
  const pair = await db.collection('phone_upload_pairs').findOne({ _id: id });
  if (!pair || !secretMatches(bearer, pair.deviceHash)) {
    fail(reply, 403, 'PAIRING_FORBIDDEN', '此设备无权访问扫码会话');
    return null;
  }
  if (pair.status !== 'approved' || (forCredentials && pair.approvedUntil <= new Date()) || pair.expiresAt <= new Date()) {
    fail(reply, 410, 'PAIRING_INACTIVE', '扫码上传尚未授权、已结束或已过期');
    return null;
  }
  return pair;
}

export default async function phoneUploadRoutes(app, { db, requireAuth, cos }) {
  const pairs = db.collection('phone_upload_pairs');
  const nodes = db.collection('nodes');
  const noStore = (reply) => reply.header('Cache-Control', 'no-store');

  app.post('/phone-uploads', { preHandler: requireAuth }, async (req, reply) => {
    if (!cos) return fail(reply, 503, 'UPLOADS_NOT_CONFIGURED', '上传服务暂不可用');
    const body = parseBody(createBody, req.body, reply);
    if (!body) return;
    const parentId = body.parentId ? new ObjectId(body.parentId) : null;
    if (parentId && !(await nodes.findOne({ _id: parentId, userId: req.user._id, type: 'folder', deletedAt: null }))) {
      return fail(reply, 404, 'PARENT_NOT_FOUND', '目标文件夹不存在');
    }
    const now = new Date();
    const existing = await pairs.findOne(
      { userId: req.user._id, parentId, status: { $in: ['pending', 'awaiting', 'approved'] } },
      { sort: { createdAt: -1 } },
    );
    if (existing && (existing.status === 'approved' ? existing.approvedUntil > now : existing.joinUntil > now)) {
      return fail(reply, 409, 'PAIRING_ACTIVE', '此文件夹仍有扫码上传会话，请先结束现有授权');
    }
    const qrSecret = token();
    const pair = {
      _id: new ObjectId(), userId: req.user._id, parentId, status: 'pending',
      qrHash: hash(qrSecret), deviceHash: null, code: null,
      issuedCount: 0, completedCount: 0, recentFiles: [],
      createdAt: now, joinUntil: new Date(now.getTime() + JOIN_TTL_MS),
      expiresAt: new Date(now.getTime() + RECORD_TTL_MS),
    };
    await pairs.insertOne(pair);
    noStore(reply);
    return reply.code(201).send({ id: String(pair._id), secret: qrSecret, joinUntil: pair.joinUntil });
  });

  app.get('/phone-uploads/active', { preHandler: requireAuth }, async (req, reply) => {
    const parent = req.query?.parentId;
    if (parent !== undefined && parent !== '' && !ID.test(parent)) return fail(reply, 400, 'INVALID_INPUT', '文件夹 ID 格式不正确');
    const pair = await pairs.findOne(
      { userId: req.user._id, parentId: parent ? new ObjectId(parent) : null, status: { $in: ['pending', 'awaiting', 'approved'] } },
      { sort: { createdAt: -1 } },
    );
    noStore(reply);
    if (!pair) return { id: null };
    const now = new Date();
    if (pair.status === 'approved' ? pair.approvedUntil <= now : pair.joinUntil <= now) return { id: null };
    return { id: String(pair._id) };
  });

  app.get('/phone-uploads/:id', { preHandler: requireAuth }, async (req, reply) => {
    const id = pairingId(req, reply);
    if (!id) return;
    const pair = await pairs.findOne({ _id: id, userId: req.user._id });
    if (!pair) return fail(reply, 404, 'PAIRING_NOT_FOUND', '扫码会话不存在');
    noStore(reply);
    const status = ['pending', 'awaiting'].includes(pair.status) && pair.joinUntil <= new Date() ? 'expired'
      : pair.status === 'approved' && pair.approvedUntil <= new Date() ? 'expired'
        : pair.status;
    return { status, code: status === 'awaiting' ? pair.code : null, approvedUntil: pair.approvedUntil ?? null, completedCount: pair.completedCount, recentFiles: pair.recentFiles ?? [] };
  });

  app.post('/phone-uploads/:id/approve', { preHandler: requireAuth }, async (req, reply) => {
    const id = pairingId(req, reply);
    if (!id) return;
    const now = new Date();
    const approvedUntil = new Date(now.getTime() + UPLOAD_TTL_MS);
    const result = await pairs.updateOne(
      { _id: id, userId: req.user._id, status: 'awaiting', joinUntil: { $gt: now } },
      { $set: { status: 'approved', approvedUntil, code: null, qrHash: null } },
    );
    if (!result.matchedCount) return fail(reply, 409, 'PAIRING_NOT_PENDING', '扫码请求已失效，请生成新二维码');
    noStore(reply);
    return { status: 'approved', approvedUntil };
  });

  app.post('/phone-uploads/:id/revoke', { preHandler: requireAuth }, async (req, reply) => {
    const id = pairingId(req, reply);
    if (!id) return;
    const result = await pairs.updateOne(
      { _id: id, userId: req.user._id },
      { $set: { status: 'revoked', code: null, qrHash: null, deviceHash: null } },
    );
    if (!result.matchedCount) return fail(reply, 404, 'PAIRING_NOT_FOUND', '扫码会话不存在');
    noStore(reply);
    return { status: 'revoked' };
  });

  app.post('/phone-uploads/:id/join', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const id = pairingId(req, reply);
    if (!id) return;
    const body = parseBody(joinBody, req.body, reply);
    if (!body) return;
    const now = new Date();
    const { deviceToken } = body;
    const code = String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, '0');
    const result = await pairs.findOneAndUpdate(
      { _id: id, status: 'pending', qrHash: hash(body.secret), joinUntil: { $gt: now } },
      { $set: { status: 'awaiting', deviceHash: hash(deviceToken), code } },
      { returnDocument: 'after' },
    );
    if (!result) {
      const existing = await pairs.findOne({ _id: id, qrHash: hash(body.secret), deviceHash: hash(deviceToken), status: 'awaiting', joinUntil: { $gt: now } });
      if (!existing) return fail(reply, 410, 'PAIRING_UNAVAILABLE', '二维码无效、已使用或已过期，请在电脑上重新生成');
      noStore(reply);
      return { deviceToken, code: existing.code, status: 'awaiting' };
    }
    noStore(reply);
    return { deviceToken, code, status: 'awaiting' };
  });

  app.get('/phone-uploads/:id/status', async (req, reply) => {
    const id = pairingId(req, reply);
    if (!id) return;
    const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
    const pair = await pairs.findOne({ _id: id });
    if (!pair || !secretMatches(bearer, pair.deviceHash)) {
      return fail(reply, 403, 'PAIRING_FORBIDDEN', '此设备无权访问扫码会话');
    }
    noStore(reply);
    const status = pair.status === 'awaiting' && pair.joinUntil <= new Date() ? 'expired'
      : pair.status === 'approved' && pair.approvedUntil <= new Date() ? 'expired'
        : pair.status;
    const folder = status === 'approved' && pair.parentId
      ? await nodes.findOne({ _id: pair.parentId, userId: pair.userId, type: 'folder', deletedAt: null }) : null;
    return { status, code: status === 'awaiting' ? pair.code : null, folderName: status === 'approved' ? (pair.parentId ? folder?.name ?? '目标文件夹已不可用' : '全部文件') : null, approvedUntil: pair.approvedUntil ?? null };
  });
}
