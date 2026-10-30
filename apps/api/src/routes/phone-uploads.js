import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
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
const notePairBody = z.object({ noteId: z.string().regex(ID) }).strict();
const NOTE_READ_TTL_MS = 10 * 60 * 1000;
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

export default async function phoneUploadRoutes(app, { cfg, db, requireAuth, cos }) {
  const pairs = db.collection('phone_upload_pairs');
  const nodes = db.collection('nodes');
  const noStore = (reply) => reply.header('Cache-Control', 'no-store');

  if (cfg.phoneUploadsEnabled === true) {
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
      issuedCount: 0, completedCount: 0, activePromotions: 0, recentFiles: [],
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
    const deadline = Date.now() + 25_000;
    while (true) {
      const current = await pairs.findOne({ _id: id, userId: req.user._id });
      if (!current) return fail(reply, 503, 'REVOCATION_PENDING', '撤销处理中，请稍后重试');
      if (!current.activePromotions) return { status: 'revoked' };
      if (Date.now() >= deadline) return fail(reply, 503, 'REVOCATION_PENDING', '撤销处理中，请稍后重试');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
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

  const notePairs = db.collection('note_read_pairs');
  const notes = db.collection('notes');
  const pairFilter = (pairId, userId) => ({ _id: pairId, userId });
  const noteAvailable = (pair) => notes.findOne({ _id: pair.noteId, userId: pair.userId, deletedAt: null });
  const notePairStatus = (pair) => {
    const now = new Date();
    if (pair.status === 'approved' && pair.approvedUntil <= now || ['pending', 'awaiting'].includes(pair.status) && pair.joinUntil <= now) return 'expired';
    return pair.status;
  };
  const devicePair = async (req, reply) => {
    const _id = pairingId(req, reply);
    if (!_id) return null;
    const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
    const pair = await notePairs.findOne({ _id });
    if (!pair || !secretMatches(bearer, pair.deviceHash)) {
      fail(reply, 403, 'PAIRING_FORBIDDEN', '此设备无权访问笔记配对');
      return null;
    }
    return pair;
  };

  app.post('/note-pairs', { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    noStore(reply);
    const body = parseBody(notePairBody, req.body, reply);
    if (!body) return;
    const noteId = new ObjectId(body.noteId);
    if (!await notes.findOne({ _id: noteId, userId: req.user._id, deletedAt: null })) {
      return fail(reply, 404, 'NOTE_NOT_FOUND', '笔记不存在');
    }
    const now = new Date();
    const secret = token();
    const pair = { _id: new ObjectId(), userId: req.user._id, noteId, status: 'pending',
      qrHash: hash(secret), deviceHash: null, code: null, createdAt: now,
      joinUntil: new Date(now.getTime() + JOIN_TTL_MS), expiresAt: new Date(now.getTime() + RECORD_TTL_MS) };
    await notePairs.insertOne(pair);
    return reply.code(201).send({ id: String(pair._id), secret, joinUntil: pair.joinUntil });
  });

  app.get('/note-pairs/active', { preHandler: requireAuth }, async (req, reply) => {
    noStore(reply);
    const query = notePairBody.safeParse(req.query);
    if (!query.success) return fail(reply, 400, 'INVALID_INPUT', '笔记 ID 格式不正确');
    const noteId = new ObjectId(query.data.noteId);
    if (!await notes.findOne({ _id: noteId, userId: req.user._id, deletedAt: null })) {
      return fail(reply, 404, 'NOTE_NOT_FOUND', '笔记不存在');
    }
    const now = new Date();
    const [joining, approved] = await Promise.all([
      notePairs.findOne({ userId: req.user._id, noteId, status: { $in: ['pending', 'awaiting'] }, joinUntil: { $gt: now } }, { sort: { createdAt: -1 } }),
      notePairs.findOne({ userId: req.user._id, noteId, status: 'approved', approvedUntil: { $gt: now } }, { sort: { createdAt: -1 } }),
    ]);
    const pair = [joining, approved].filter(Boolean).sort((a, b) => b.createdAt - a.createdAt)[0];
    return { id: pair ? String(pair._id) : null };
  });

  app.get('/note-pairs/:id', { preHandler: requireAuth }, async (req, reply) => {
    noStore(reply);
    const _id = pairingId(req, reply);
    if (!_id) return;
    const pair = await notePairs.findOne(pairFilter(_id, req.user._id));
    if (!pair) return fail(reply, 404, 'PAIRING_NOT_FOUND', '扫码会话不存在');
    const status = notePairStatus(pair);
    return { status, code: status === 'awaiting' ? pair.code : null,
      approvedUntil: status === 'approved' ? pair.approvedUntil : null };
  });

  app.post('/note-pairs/:id/approve', { preHandler: requireAuth }, async (req, reply) => {
    noStore(reply);
    const _id = pairingId(req, reply);
    if (!_id) return;
    const pair = await notePairs.findOne(pairFilter(_id, req.user._id));
    const note = pair && await noteAvailable(pair);
    if (!note) return fail(reply, 404, 'PAIRING_NOT_FOUND', '扫码会话或笔记不存在');
    const now = new Date();
    const approvedUntil = new Date(now.getTime() + NOTE_READ_TTL_MS);
    const result = await notePairs.updateOne(
      { ...pairFilter(_id, req.user._id), status: 'awaiting', joinUntil: { $gt: now }, expiresAt: { $gt: now } },
      { $set: { status: 'approved', code: null, qrHash: null, approvedUntil, expiresAt: approvedUntil,
        noteSnapshot: { title: note.title, content: note.content, createdAt: note.createdAt, updatedAt: note.updatedAt } } },
    );
    if (!result.matchedCount) return fail(reply, 409, 'PAIRING_NOT_PENDING', '扫码请求已失效，请重新配对');
    return { status: 'approved', approvedUntil };
  });

  app.post('/note-pairs/:id/revoke', { preHandler: requireAuth }, async (req, reply) => {
    noStore(reply);
    const _id = pairingId(req, reply);
    if (!_id) return;
    const result = await notePairs.updateOne(pairFilter(_id, req.user._id),
      { $set: { status: 'revoked', code: null, qrHash: null, deviceHash: null }, $unset: { noteSnapshot: '' } });
    if (!result.matchedCount) return fail(reply, 404, 'PAIRING_NOT_FOUND', '扫码会话不存在');
    return { status: 'revoked' };
  });

  app.post('/note-pairs/:id/join', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    noStore(reply);
    const _id = pairingId(req, reply);
    if (!_id) return;
    const body = parseBody(joinBody, req.body, reply);
    if (!body) return;
    const now = new Date();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const result = await notePairs.findOneAndUpdate(
      { _id, status: 'pending', qrHash: hash(body.secret), joinUntil: { $gt: now }, expiresAt: { $gt: now } },
      { $set: { status: 'awaiting', deviceHash: hash(body.deviceToken), code } }, { returnDocument: 'after' },
    );
    if (result) return { deviceToken: body.deviceToken, code, status: 'awaiting' };
    const existing = await notePairs.findOne({ _id, status: 'awaiting', qrHash: hash(body.secret),
      deviceHash: hash(body.deviceToken), joinUntil: { $gt: now }, expiresAt: { $gt: now } });
    if (!existing) return fail(reply, 410, 'PAIRING_UNAVAILABLE', '二维码无效、已使用或已过期');
    return { deviceToken: body.deviceToken, code: existing.code, status: 'awaiting' };
  });

  app.get('/note-pairs/:id/status', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    noStore(reply);
    const pair = await devicePair(req, reply);
    if (!pair) return;
    const status = notePairStatus(pair);
    return { status, approvedUntil: status === 'approved' ? pair.approvedUntil : null };
  });

  app.get('/note-pairs/:id/note', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    noStore(reply);
    const pair = await devicePair(req, reply);
    if (!pair) return;
    if (notePairStatus(pair) !== 'approved') return fail(reply, 410, 'PAIRING_INACTIVE', '笔记读取授权尚未生效或已结束');
    const note = await noteAvailable(pair);
    if (!note) return fail(reply, 404, 'NOTE_NOT_FOUND', '笔记已删除');
    const active = await notePairs.findOne({ _id: pair._id, status: 'approved', deviceHash: pair.deviceHash,
      approvedUntil: { $gt: new Date() }, expiresAt: { $gt: new Date() } });
    if (!active) return fail(reply, 410, 'PAIRING_INACTIVE', '笔记读取授权已结束');
    return { note: { id: String(note._id), ...active.noteSnapshot } };
  });
}
