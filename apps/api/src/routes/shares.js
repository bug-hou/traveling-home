import { randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { fail, parseBody } from '../lib/http.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { downloadResponse } from '../services/cos.js';

const id = z.string().regex(/^[a-f\d]{24}$/i);
const handle = z.string().regex(/^[a-z][a-z0-9-]{2,29}$/);
const slug = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/, '路径需为 1–48 位小写字母、数字或连字符');
const settings = z.object({
  slug: slug.optional(),
  title: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(1000).optional(),
  mode: z.enum(['standard', 'activity']).optional(),
  coverNodeId: id.nullable().optional(),
  password: z.string().min(4).max(128).nullable().optional(),
  requireLogin: z.boolean().optional(),
  expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
  allowPreview: z.boolean().optional(),
  allowDownload: z.boolean().optional(),
  maxDownloads: z.number().int().min(1).max(1_000_000).nullable().optional(),
  maxViews: z.number().int().min(1).max(1_000_000).nullable().optional(),
}).strict();
const createBody = settings.extend({ targetId: id.optional(), noteId: id.optional() })
  .refine((body) => Boolean(body.targetId) !== Boolean(body.noteId), '请选择一个分享目标');
const noteBody = z.object({ title: z.string().trim().min(1).max(80), content: z.string().min(1).max(10_000) }).strict();
const noteChanges = noteBody.partial().refine((body) => Object.keys(body).length > 0, '请提供要修改的内容');
const noteId = z.object({ id });
const noteList = z.object({ offset: z.coerce.number().int().min(0).max(100_000).default(0) }).strict();
const publicNoteBody = z.object({ password: z.string().max(128).optional() }).strict();
const browseBody = z.object({ password: z.string().max(128).optional(), parentId: id.optional(), offset: z.number().int().min(0).max(100_000).default(0) }).strict();
const accessBody = z.object({ password: z.string().max(128).optional(), purpose: z.enum(['preview', 'download']) }).strict();
const INLINE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav']);
const COVER_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function publicNode(node) {
  return { id: String(node._id), parentId: node.parentId ? String(node.parentId) : null, type: node.type, name: node.name, size: node.size ?? 0, mime: node.mime ?? null };
}

function privateNote(note, includeContent = true) {
  return { id: String(note._id), title: note.title, ...(includeContent ? { content: note.content } : {}), createdAt: note.createdAt, updatedAt: note.updatedAt };
}

function ownerShare(share) {
  return {
    id: String(share._id), targetId: String(share.targetId), targetType: share.targetType,
    slug: share.slug, title: share.title, description: share.description, mode: share.mode,
    coverNodeId: share.coverNodeId ? String(share.coverNodeId) : null,
    hasPassword: Boolean(share.passwordHash), requireLogin: share.requireLogin,
    expiresAt: share.expiresAt, allowPreview: share.allowPreview, allowDownload: share.allowDownload,
    maxDownloads: share.maxDownloads, downloadCount: share.downloadCount, viewCount: share.viewCount,
    maxViews: share.maxViews ?? null, revokedAt: share.revokedAt, createdAt: share.createdAt,
  };
}

async function activeNode(nodes, userId, nodeId) {
  return nodes.findOne({ _id: nodeId, userId, deletedAt: null });
}

// Traverse current parents, not a cached path: moving a file outside a shared folder revokes its access.
async function insideShare(nodes, share, nodeId) {
  const seen = new Set();
  let current = nodeId;
  for (let depth = 0; current && depth < 100; depth++) {
    const key = String(current);
    if (seen.has(key)) return null;
    seen.add(key);
    const node = await activeNode(nodes, share.userId, current);
    if (!node) return null;
    if (key === String(share.targetId)) return node;
    current = node.parentId;
  }
  return null;
}

export default async function shareRoutes(app, { db, cfg, cos, requireAuth }) {
  const shares = db.collection('shares');
  const notes = db.collection('notes');
  const nodes = db.collection('nodes');
  const users = db.collection('users');
  const handles = db.collection('handles');
  const noStore = (_req, reply, done) => { reply.header('Cache-Control', 'private, no-store'); reply.header('Referrer-Policy', 'no-referrer'); done(); };

  async function settingsUpdate(body, current, reply) {
    const changes = {};
    if (body.expiresAt !== undefined) {
      const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
      if (expiresAt && expiresAt.getTime() <= Date.now()) {
        fail(reply, 400, 'INVALID_EXPIRY', '到期时间必须晚于当前时间');
        return null;
      }
      changes.expiresAt = expiresAt;
    }
    if (body.maxDownloads !== undefined && body.maxDownloads !== null && body.maxDownloads < (current?.downloadCount ?? 0)) {
      fail(reply, 409, 'LIMIT_USED', '下载额度不能小于已经签发的次数');
      return null;
    }
    if (body.maxViews !== undefined && body.maxViews !== null && body.maxViews < (current?.viewCount ?? 0)) {
      fail(reply, 409, 'LIMIT_USED', '访问额度不能小于已经阅读的次数');
      return null;
    }
    for (const field of ['slug', 'title', 'description', 'mode', 'requireLogin', 'allowPreview', 'allowDownload', 'maxDownloads', 'maxViews']) {
      if (body[field] !== undefined) changes[field] = body[field];
    }
    if (body.password !== undefined) changes.passwordHash = body.password === null ? null : await hashPassword(body.password);
    if (body.coverNodeId !== undefined) changes.coverNodeId = body.coverNodeId ? new ObjectId(body.coverNodeId) : null;
    if (changes.allowPreview === false && changes.allowDownload === false) {
      fail(reply, 400, 'NO_ACCESS', '预览和下载至少开启一项');
      return null;
    }
    return changes;
  }

  async function validCover(share, coverNodeId) {
    if (!coverNodeId) return true;
    const cover = await activeNode(nodes, share.userId, coverNodeId);
    return Boolean(cover?.type === 'file' && cover.status === 'ready' && cover.size > 0 && cover.size <= 2 * 1024 * 1024 && COVER_MIME.has(cover.mime?.toLowerCase()) && await insideShare(nodes, share, coverNodeId));
  }

  app.post('/notes', { preHandler: [requireAuth, noStore], config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parseBody(noteBody, req.body, reply);
    if (!body) return;
    const now = new Date();
    const note = { userId: req.user._id, ...body, deletedAt: null, createdAt: now, updatedAt: now };
    await notes.insertOne(note);
    return reply.code(201).send({ note: privateNote(note) });
  });

  app.get('/notes', { preHandler: [requireAuth, noStore] }, async (req, reply) => {
    const query = noteList.safeParse(req.query);
    if (!query.success) return fail(reply, 400, 'INVALID_INPUT', '分页参数不正确');
    const filter = { userId: req.user._id, deletedAt: null };
    const [total, items] = await Promise.all([
      notes.countDocuments(filter),
      notes.find(filter, { projection: { content: 0 } }).sort({ updatedAt: -1, _id: -1 }).skip(query.data.offset).limit(50).toArray(),
    ]);
    return { items: items.map((note) => privateNote(note, false)), total, offset: query.data.offset };
  });

  app.get('/notes/:id', { preHandler: [requireAuth, noStore] }, async (req, reply) => {
    if (!noteId.safeParse(req.params).success) return fail(reply, 404, 'NOTE_NOT_FOUND', '笔记不存在');
    const note = await notes.findOne({ _id: new ObjectId(req.params.id), userId: req.user._id, deletedAt: null });
    if (!note) return fail(reply, 404, 'NOTE_NOT_FOUND', '笔记不存在');
    return { note: privateNote(note) };
  });

  app.patch('/notes/:id', { preHandler: [requireAuth, noStore] }, async (req, reply) => {
    if (!noteId.safeParse(req.params).success) return fail(reply, 404, 'NOTE_NOT_FOUND', '笔记不存在');
    const body = parseBody(noteChanges, req.body, reply);
    if (!body) return;
    const updated = await notes.findOneAndUpdate(
      { _id: new ObjectId(req.params.id), userId: req.user._id, deletedAt: null },
      { $set: { ...body, updatedAt: new Date() } }, { returnDocument: 'after' },
    );
    if (!updated) return fail(reply, 404, 'NOTE_NOT_FOUND', '笔记不存在');
    return { note: privateNote(updated) };
  });

  app.delete('/notes/:id', { preHandler: [requireAuth, noStore] }, async (req, reply) => {
    if (!noteId.safeParse(req.params).success) return fail(reply, 404, 'NOTE_NOT_FOUND', '笔记不存在');
    const result = await notes.updateOne(
      { _id: new ObjectId(req.params.id), userId: req.user._id, deletedAt: null },
      { $set: { deletedAt: new Date() } },
    );
    if (!result.matchedCount) return fail(reply, 404, 'NOTE_NOT_FOUND', '笔记不存在');
    return reply.code(204).send();
  });

  app.post('/shares', { preHandler: [requireAuth, noStore] }, async (req, reply) => {
    const body = parseBody(createBody, req.body, reply);
    if (!body) return;
    if (!req.user.publicHandle) return fail(reply, 409, 'HANDLE_REQUIRED', '请先在账号设置中设置公开用户名');
    const isNote = Boolean(body.noteId);
    if (isNote && (body.mode === 'activity' || body.coverNodeId != null || body.allowPreview === false || body.allowDownload === true || body.maxDownloads != null || body.requireLogin === true)
      || !isNote && body.maxViews !== undefined) {
      return fail(reply, 400, 'INVALID_NOTE_SHARE', '访问次数上限仅适用于笔记；笔记分享不支持活动、封面、下载或跨站登录，请使用提取码');
    }
    const targetId = new ObjectId(body.noteId ?? body.targetId);
    const target = isNote
      ? await notes.findOne({ _id: targetId, userId: req.user._id, deletedAt: null })
      : await activeNode(nodes, req.user._id, targetId);
    if (!target || (!isNote && target.type === 'file' && target.status !== 'ready')) {
      return fail(reply, 404, isNote ? 'NOTE_NOT_FOUND' : 'NODE_NOT_FOUND', isNote ? '笔记不存在' : '文件或文件夹不存在');
    }
    const changes = await settingsUpdate(body, null, reply);
    if (!changes) return;
    const now = new Date();
    const share = {
      userId: req.user._id, targetId, targetType: isNote ? 'note' : target.type,
      ...(isNote ? { noteSnapshot: { title: target.title, content: target.content } } : {}),
      slug: changes.slug ?? `journey-${randomBytes(6).toString('hex')}`,
      title: changes.title ?? (isNote ? target.title : target.name), description: changes.description ?? '', mode: changes.mode ?? 'standard',
      coverNodeId: changes.coverNodeId ?? null, passwordHash: changes.passwordHash ?? null,
      requireLogin: changes.requireLogin ?? false, expiresAt: changes.expiresAt ?? null,
      allowPreview: changes.allowPreview ?? true, allowDownload: isNote ? false : changes.allowDownload ?? true,
      maxDownloads: isNote ? null : changes.maxDownloads ?? null, downloadCount: 0, viewCount: 0,
      maxViews: isNote ? changes.maxViews ?? null : null,
      revokedAt: null, createdAt: now, updatedAt: now,
    };
    if (!share.allowPreview && !share.allowDownload) return fail(reply, 400, 'NO_ACCESS', '预览和下载至少开启一项');
    if (!await validCover(share, share.coverNodeId)) return fail(reply, 400, 'INVALID_COVER', '封面须为分享范围内不超过 2 MiB 的图片');
    try { await shares.insertOne(share); } catch (error) {
      if (error?.code === 11000) return fail(reply, 409, 'SLUG_TAKEN', '此自定义路径已被使用');
      throw error;
    }
    return reply.code(201).send({ share: ownerShare(share), handle: req.user.publicHandle });
  });

  app.get('/shares', { preHandler: [requireAuth, noStore] }, async (req) => {
    const items = await shares.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(200).toArray();
    return { items: items.map(ownerShare), handle: req.user.publicHandle ?? null };
  });

  app.patch('/shares/:id', { preHandler: [requireAuth, noStore] }, async (req, reply) => {
    if (!id.safeParse(req.params.id).success) return fail(reply, 400, 'INVALID_INPUT', '分享 ID 格式不正确');
    const body = parseBody(settings, req.body, reply);
    if (!body) return;
    const _id = new ObjectId(req.params.id);
    const current = await shares.findOne({ _id, userId: req.user._id, revokedAt: null });
    if (!current) return fail(reply, 404, 'SHARE_NOT_FOUND', '分享不存在');
    if (current.targetType === 'note' && (body.mode === 'activity' || body.coverNodeId != null || body.allowPreview === false || body.allowDownload === true || body.maxDownloads != null || body.requireLogin === true)
      || current.targetType !== 'note' && body.maxViews !== undefined) {
      return fail(reply, 400, 'INVALID_NOTE_SHARE', '访问次数上限仅适用于笔记；笔记分享不支持活动、封面、下载或跨站登录，请使用提取码');
    }
    const changes = await settingsUpdate(body, current, reply);
    if (!changes) return;
    if (changes.allowPreview === false && !('allowDownload' in changes) && !current.allowDownload || changes.allowDownload === false && !('allowPreview' in changes) && !current.allowPreview) {
      return fail(reply, 400, 'NO_ACCESS', '预览和下载至少开启一项');
    }
    if (!await validCover(current, changes.coverNodeId === undefined ? current.coverNodeId : changes.coverNodeId)) return fail(reply, 400, 'INVALID_COVER', '封面须为分享范围内不超过 2 MiB 的图片');
    try {
      const updated = await shares.findOneAndUpdate(
        { _id, userId: req.user._id, revokedAt: null,
          ...(changes.maxDownloads == null ? {} : { downloadCount: { $lte: changes.maxDownloads } }),
          ...(changes.maxViews == null ? {} : { viewCount: { $lte: changes.maxViews } }) },
        { $set: { ...changes, updatedAt: new Date() } }, { returnDocument: 'after' },
      );
      if (!updated) return fail(reply, 409, 'LIMIT_USED', '访问或下载额度已变化，请重试');
      return { share: ownerShare(updated), handle: req.user.publicHandle };
    } catch (error) {
      if (error?.code === 11000) return fail(reply, 409, 'SLUG_TAKEN', '此自定义路径已被使用');
      throw error;
    }
  });

  app.delete('/shares/:id', { preHandler: [requireAuth, noStore] }, async (req, reply) => {
    if (!id.safeParse(req.params.id).success) return fail(reply, 400, 'INVALID_INPUT', '分享 ID 格式不正确');
    const result = await shares.updateOne({ _id: new ObjectId(req.params.id), userId: req.user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    if (!result.matchedCount) return fail(reply, 404, 'SHARE_NOT_FOUND', '分享不存在');
    return reply.code(204).send();
  });

  async function resolve(req, reply, password) {
    const deny = (status, code, message) => { fail(reply, status, code, message); return null; };
    const path = z.object({ handle, slug }).safeParse(req.params);
    if (!path.success) return deny(404, 'SHARE_NOT_FOUND', '分享不存在');
    const ownerHandle = await handles.findOne({ _id: path.data.handle });
    if (!ownerHandle) return deny(404, 'SHARE_NOT_FOUND', '分享不存在');
    const share = await shares.findOne({ userId: ownerHandle.userId, slug: path.data.slug, revokedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] });
    if (!share || !(share.targetType === 'note'
      ? await notes.findOne({ _id: share.targetId, userId: share.userId, deletedAt: null })
      : await activeNode(nodes, share.userId, share.targetId))) {
      return deny(404, 'SHARE_NOT_FOUND', '分享不存在或已失效');
    }
    const owner = await users.findOne({ _id: share.userId, status: 'active' });
    if (!owner) return deny(404, 'SHARE_NOT_FOUND', '分享不存在或已失效');
    if (share.requireLogin) {
      await requireAuth(req, reply);
      if (reply.sent) return null;
    }
    if (share.passwordHash && (!password || !await verifyPassword(share.passwordHash, password))) {
      return deny(403, 'PASSWORD_REQUIRED', '请输入正确的分享提取码');
    }
    return { share, owner };
  }

  app.post('/public/shares/:handle/:slug/note', { preHandler: noStore, config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parseBody(publicNoteBody, req.body, reply);
    if (!body) return;
    const resolved = await resolve(req, reply, body.password);
    if (!resolved) return;
    const { share, owner } = resolved;
    if (share.targetType !== 'note' || !share.allowPreview) return fail(reply, 404, 'SHARE_NOT_FOUND', '笔记分享不存在');
    const now = new Date();
    const active = await shares.updateOne(
      { _id: share._id, targetType: 'note', allowPreview: true, revokedAt: null, maxViews: share.maxViews ?? null,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
        ...(share.maxViews == null ? {} : { viewCount: { $lt: share.maxViews } }) },
      { $inc: { viewCount: 1 } },
    );
    if (!active.matchedCount) {
      const latest = await shares.findOne({ _id: share._id, targetType: 'note', revokedAt: null,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] });
      if (!latest) return fail(reply, 404, 'SHARE_NOT_FOUND', '笔记分享已失效');
      if (latest.maxViews != null && latest.viewCount >= latest.maxViews) {
        return fail(reply, 429, 'VIEW_LIMIT', '笔记分享阅读次数已用尽');
      }
      return fail(reply, 409, 'SHARE_CHANGED', '分享设置已更新，请重试');
    }
    if (!await notes.findOne({ _id: share.targetId, userId: share.userId, deletedAt: null })) {
      return fail(reply, 404, 'SHARE_NOT_FOUND', '笔记分享已失效');
    }
    return {
      share: { targetType: 'note', title: share.title, description: share.description, expiresAt: share.expiresAt,
        ownerName: owner.nickname, handle: owner.publicHandle, requireLogin: share.requireLogin, hasPassword: Boolean(share.passwordHash) },
      note: share.noteSnapshot,
    };
  });

  app.post('/public/shares/:handle/:slug/browse', { preHandler: noStore, config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parseBody(browseBody, req.body, reply);
    if (!body) return;
    const resolved = await resolve(req, reply, body.password);
    if (!resolved) return;
    const { share, owner } = resolved;
    if (share.targetType === 'note') {
      if (body.parentId) return fail(reply, 404, 'NODE_NOT_FOUND', '笔记分享不包含文件夹');
      return { share: { targetType: 'note', title: share.title, description: share.description, mode: 'standard',
        coverNodeId: null, requireLogin: share.requireLogin, hasPassword: Boolean(share.passwordHash), expiresAt: share.expiresAt,
        allowPreview: true, allowDownload: false, maxDownloads: null, downloadCount: 0,
        ownerName: owner.nickname, handle: owner.publicHandle }, root: null, breadcrumbs: [], items: [], total: 0, offset: body.offset };
    }
    const root = await activeNode(nodes, share.userId, share.targetId);
    const parent = body.parentId ? await activeNode(nodes, share.userId, new ObjectId(body.parentId)) : root;
    if (!root || !parent || !await insideShare(nodes, share, parent._id) || (parent.type !== 'folder' && String(parent._id) !== String(root._id))) {
      return fail(reply, 404, 'NODE_NOT_FOUND', '文件或文件夹不存在');
    }
    const breadcrumbs = [];
    if (parent.type === 'folder') {
      let cursor = parent;
      for (let depth = 0; cursor && depth < 100; depth++) {
        breadcrumbs.unshift(publicNode(cursor));
        if (String(cursor._id) === String(root._id)) break;
        cursor = await activeNode(nodes, share.userId, cursor.parentId);
      }
      if (String(breadcrumbs[0]?.id) !== String(root._id)) return fail(reply, 404, 'NODE_NOT_FOUND', '文件夹已移出分享范围');
    }
    const filter = { userId: share.userId, parentId: parent._id, deletedAt: null };
    const total = parent.type === 'folder' ? await nodes.countDocuments(filter) : 0;
    const items = parent.type === 'folder' ? await nodes.find(filter).sort({ name: 1, _id: 1 }).skip(body.offset).limit(50).toArray() : [];
    if (!body.parentId && body.offset === 0) await shares.updateOne({ _id: share._id }, { $inc: { viewCount: 1 } });
    return {
      share: { targetType: share.targetType, title: share.title, description: share.description, mode: share.mode, coverNodeId: share.coverNodeId ? String(share.coverNodeId) : null,
        requireLogin: share.requireLogin, hasPassword: Boolean(share.passwordHash), expiresAt: share.expiresAt,
        allowPreview: share.allowPreview, allowDownload: share.allowDownload, maxDownloads: share.maxDownloads, downloadCount: share.downloadCount,
        ownerName: owner.nickname, handle: owner.publicHandle },
      root: publicNode(root), breadcrumbs, items: items.map(publicNode), total, offset: body.offset,
    };
  });

  app.post('/public/shares/:handle/:slug/files/:nodeId/access', { preHandler: noStore, config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parseBody(accessBody, req.body, reply);
    if (!body) return;
    if (!id.safeParse(req.params.nodeId).success) return fail(reply, 404, 'NODE_NOT_FOUND', '文件不存在');
    const resolved = await resolve(req, reply, body.password);
    if (!resolved) return;
    const { share } = resolved;
    if (share.targetType === 'note') return fail(reply, 404, 'SHARE_NOT_FOUND', '此分享不包含文件');
    if (body.purpose === 'download' && !share.allowDownload || body.purpose === 'preview' && !share.allowPreview) {
      return fail(reply, 403, 'ACCESS_DISABLED', '分享未开放此操作');
    }
    const nodeId = new ObjectId(req.params.nodeId);
    const node = await activeNode(nodes, share.userId, nodeId);
    if (!node || node.type !== 'file' || node.status !== 'ready' || !await insideShare(nodes, share, nodeId)) {
      return fail(reply, 404, 'NODE_NOT_FOUND', '文件不存在');
    }
    if (!cos || !cfg?.cos) return fail(reply, 503, 'STORAGE_UNAVAILABLE', '文件访问暂不可用');
    if (typeof node.cosKey !== 'string' || !node.cosKey.startsWith(`${cfg.cos.prefix}/users/${share.userId}/originals/`)) {
      return fail(reply, 409, 'FILE_NOT_AVAILABLE', '文件存储信息不可用');
    }
    const mime = INLINE.has(node.mime?.toLowerCase()) ? node.mime.toLowerCase() : 'application/octet-stream';
    if (body.purpose === 'preview' && mime === 'application/octet-stream') return fail(reply, 422, 'PREVIEW_UNSUPPORTED', '此格式不支持在线预览');
    const inline = body.purpose === 'preview';
    const response = inline ? { disposition: 'inline', mime } : downloadResponse(node.name, mime);
    let url;
    try { url = await cos.signReadUrl(node.cosKey, { ...response, expires: 60 }); }
    catch (error) {
      req.log.error({ err: error, nodeId: String(nodeId) }, 'unable to sign shared file URL');
      return fail(reply, 503, 'STORAGE_UNAVAILABLE', '文件访问暂不可用');
    }
    if (!inline) {
      const filter = { _id: share._id, revokedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] };
      if (share.maxDownloads !== null) filter.downloadCount = { $lt: share.maxDownloads };
      const result = await shares.updateOne(filter, { $inc: { downloadCount: 1 } });
      if (!result.matchedCount) return fail(reply, 429, 'DOWNLOAD_LIMIT', '分享下载次数已用尽或分享已失效');
    } else {
      // Close the signing/revocation race before returning a bearer URL.
      const active = await shares.findOne({ _id: share._id, revokedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] });
      if (!active) return fail(reply, 404, 'SHARE_NOT_FOUND', '分享已失效');
    }
    return { url, expiresAt: new Date(Date.now() + 60_000), name: node.name, mime: response.mime, previewable: inline };
  });
}
