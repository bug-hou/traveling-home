import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { fail, parseBody } from '../lib/http.js';

const nodeIdSchema = z.string().regex(/^[a-f\d]{24}$/i, '节点 ID 格式不正确');
const nodeNameSchema = z
  .string()
  .trim()
  .min(1, '名称不能为空')
  .max(255, '名称不能超过 255 个字符')
  .refine((value) => !/[\\/\0]/.test(value) && value !== '.' && value !== '..', {
    message: '名称不能包含路径分隔符',
  });

const createFolderBody = z
  .object({
    name: nodeNameSchema,
    parentId: nodeIdSchema.nullable().optional(),
  })
  .strict();

const updateNodeBody = z
  .object({
    name: nodeNameSchema.optional(),
    parentId: nodeIdSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.parentId !== undefined, {
    message: '至少提供一个要修改的字段',
  });

const listQuerySchema = z
  .object({
    parentId: nodeIdSchema.optional(),
    view: z.enum(['active', 'trash']).default('active'),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    sortBy: z.enum(['name', 'createdAt', 'updatedAt', 'size']).default('name'),
    sortOrder: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

const readUrlQuerySchema = z.object({ purpose: z.enum(['preview', 'download']).default('preview') }).strict();
const INLINE_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav']);

const searchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(100),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

const NAME_REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

function escapeRegex(value) {
  return value.replace(NAME_REGEX_SPECIAL, '\\$&');
}

function serializeNode(node) {
  return {
    id: String(node._id),
    parentId: node.parentId ? String(node.parentId) : null,
    type: node.type,
    name: node.name,
    size: node.size ?? 0,
    mime: node.mime ?? null,
    status: node.status ?? 'ready',
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    uploadedAt: node.uploadedAt ?? null,
    deletedAt: node.deletedAt ?? null,
  };
}

function pageQuery(query) {
  return {
    sort: { [query.sortBy]: query.sortOrder === 'asc' ? 1 : -1, _id: 1 },
    skip: query.offset,
    limit: query.limit,
  };
}

function chunks(values, size = 500) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function collectDescendantIds(nodes, userId, rootId) {
  const visited = new Set([String(rootId)]);
  const descendants = [];
  let parents = [rootId];

  while (parents.length > 0) {
    const nextParents = [];
    for (const parentBatch of chunks(parents)) {
      const children = await nodes
        .find({ userId, parentId: { $in: parentBatch } }, { projection: { _id: 1 } })
        .toArray();
      for (const child of children) {
        const id = String(child._id);
        if (visited.has(id)) continue;
        visited.add(id);
        descendants.push(child._id);
        nextParents.push(child._id);
      }
    }
    parents = nextParents;
  }

  return descendants;
}

async function requireActiveFolder(nodes, userId, parentId, reply) {
  if (parentId === null || parentId === undefined) return null;
  const folder = await nodes.findOne({
    _id: parentId,
    userId,
    type: 'folder',
    deletedAt: null,
  });
  if (!folder) fail(reply, 404, 'PARENT_NOT_FOUND', '目标文件夹不存在');
  return folder;
}

async function ensureNoMoveCycle(nodes, userId, node, parentId, reply) {
  if (parentId === null || parentId === undefined || node.type !== 'folder') return true;

  const movingId = String(node._id);
  const visited = new Set();
  let cursor = parentId;
  while (cursor) {
    const cursorId = String(cursor);
    if (cursorId === movingId) {
      fail(reply, 409, 'MOVE_CYCLE', '不能将文件夹移动到自身或其子文件夹中');
      return false;
    }
    if (visited.has(cursorId)) {
      fail(reply, 409, 'INVALID_FOLDER_TREE', '目标文件夹层级存在循环');
      return false;
    }
    visited.add(cursorId);

    const ancestor = await nodes.findOne(
      { _id: cursor, userId, type: 'folder', deletedAt: null },
      { projection: { parentId: 1 } },
    );
    if (!ancestor) break;
    cursor = ancestor.parentId;
  }
  return true;
}

function parseNodeId(value, reply) {
  const result = nodeIdSchema.safeParse(value);
  if (result.success) return new ObjectId(result.data);
  fail(reply, 400, 'INVALID_INPUT', '节点 ID 格式不正确');
  return null;
}

export default async function nodeRoutes(app, { cfg, db, requireAuth, cos }) {
  const nodes = db.collection('nodes');

  app.get('/nodes', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      return fail(reply, 400, 'INVALID_INPUT', '请求参数不正确', details);
    }

    const query = parsed.data;
    const userId = req.user._id;
    const filter = { userId };
    if (query.view === 'trash') {
      filter.deletedAt = { $ne: null };
      if (query.parentId) {
        const parentId = new ObjectId(query.parentId);
        const parent = await nodes.findOne({ _id: parentId, userId, type: 'folder' });
        if (!parent) return fail(reply, 404, 'PARENT_NOT_FOUND', '目标文件夹不存在');
        filter.parentId = parentId;
      } else {
        filter.deletedRootId = { $exists: false };
      }
    } else {
      filter.deletedAt = null;
      const parentId = query.parentId ? new ObjectId(query.parentId) : null;
      if (parentId) {
        const parent = await requireActiveFolder(nodes, userId, parentId, reply);
        if (!parent) return reply;
      }
      filter.parentId = parentId;
    }

    const total = await nodes.countDocuments(filter);
    const items = await nodes
      .find(filter)
      .sort(pageQuery(query).sort)
      .skip(query.offset)
      .limit(query.limit)
      .toArray();

    return {
      items: items.map(serializeNode),
      total,
      offset: query.offset,
      limit: query.limit,
    };
  });

  app.get('/nodes/:id', { preHandler: requireAuth }, async (req, reply) => {
    const id = parseNodeId(req.params.id, reply);
    if (!id) return;
    const userId = req.user._id;
    const node = await nodes.findOne({ _id: id, userId, deletedAt: null });
    if (!node) return fail(reply, 404, 'NODE_NOT_FOUND', '节点不存在');

    const ancestors = [];
    const visited = new Set([String(id)]);
    let parentId = node.parentId;
    while (parentId) {
      if (visited.has(String(parentId))) return fail(reply, 409, 'INVALID_FOLDER_TREE', '目录层级存在循环');
      visited.add(String(parentId));
      const parent = await nodes.findOne({ _id: parentId, userId, type: 'folder', deletedAt: null });
      if (!parent) return fail(reply, 404, 'NODE_NOT_FOUND', '节点所在目录不可用');
      ancestors.unshift(serializeNode(parent));
      parentId = parent.parentId;
    }
    reply.header('Cache-Control', 'private, no-store');
    return { node: serializeNode(node), ancestors };
  });

  app.get('/nodes/:id/url', { preHandler: requireAuth }, async (req, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const id = parseNodeId(req.params.id, reply);
    if (!id) return;
    const query = readUrlQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return fail(reply, 400, 'INVALID_INPUT', '请求参数不正确');
    const userId = req.user._id;
    const node = await nodes.findOne({ _id: id, userId, type: 'file', status: 'ready', deletedAt: null });
    if (!node) return fail(reply, 404, 'NODE_NOT_FOUND', '文件不存在');
    if (!cos || !cfg?.cos) return fail(reply, 503, 'STORAGE_UNAVAILABLE', '文件访问暂不可用');
    if (typeof node.cosKey !== 'string' || !node.cosKey.startsWith(`${cfg.cos.prefix}/users/${userId}/originals/`)) {
      return fail(reply, 409, 'FILE_NOT_AVAILABLE', '文件存储信息不可用');
    }

    const mime = INLINE_MIME.has(node.mime?.toLowerCase()) ? node.mime.toLowerCase() : 'application/octet-stream';
    const inline = query.data.purpose === 'preview' && mime !== 'application/octet-stream';
    const disposition = inline ? 'inline' : `attachment; filename*=UTF-8''${encodeURIComponent(node.name ?? 'download')}`;
    try {
      const url = await cos.signReadUrl(node.cosKey, { disposition, mime });
      return { url, expiresAt: new Date(Date.now() + 600_000), name: node.name, mime, previewable: inline };
    } catch (error) {
      req.log.error({ err: error, nodeId: String(id) }, 'unable to sign file URL');
      return fail(reply, 503, 'STORAGE_UNAVAILABLE', '文件访问暂不可用');
    }
  });

  app.post('/nodes/folder', { preHandler: requireAuth }, async (req, reply) => {
    const body = parseBody(createFolderBody, req.body, reply);
    if (!body) return;

    const parentId = body.parentId ? new ObjectId(body.parentId) : null;
    if (parentId) {
      const parent = await requireActiveFolder(nodes, req.user._id, parentId, reply);
      if (!parent) return;
    }

    const now = new Date();
    const folder = {
      userId: req.user._id,
      parentId,
      type: 'folder',
      name: body.name,
      size: 0,
      mime: null,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const result = await nodes.insertOne(folder);
    folder._id = result.insertedId;
    return reply.code(201).send({ node: serializeNode(folder) });
  });

  app.patch('/nodes/:id', { preHandler: requireAuth }, async (req, reply) => {
    const id = parseNodeId(req.params.id, reply);
    if (!id) return;

    const body = parseBody(updateNodeBody, req.body, reply);
    if (!body) return;

    const current = await nodes.findOne({ _id: id, userId: req.user._id, deletedAt: null });
    if (!current) return fail(reply, 404, 'NODE_NOT_FOUND', '节点不存在');

    const update = { updatedAt: new Date() };
    if (body.name !== undefined) update.name = body.name;
    if (body.parentId !== undefined) {
      const parentId = body.parentId ? new ObjectId(body.parentId) : null;
      if (parentId) {
        const parent = await requireActiveFolder(nodes, req.user._id, parentId, reply);
        if (!parent) return;
      }
      if (!(await ensureNoMoveCycle(nodes, req.user._id, current, parentId, reply))) return;
      update.parentId = parentId;
    }

    const result = await nodes.updateOne(
      { _id: id, userId: req.user._id, deletedAt: null },
      { $set: update },
    );
    if (result.matchedCount !== 1) return fail(reply, 404, 'NODE_NOT_FOUND', '节点不存在');

    const updated = await nodes.findOne({ _id: id, userId: req.user._id });
    return { node: serializeNode(updated) };
  });

  app.delete('/nodes/:id', { preHandler: requireAuth }, async (req, reply) => {
    const id = parseNodeId(req.params.id, reply);
    if (!id) return;

    const current = await nodes.findOne({ _id: id, userId: req.user._id, deletedAt: null });
    if (!current) return fail(reply, 404, 'NODE_NOT_FOUND', '节点不存在');

    const descendantIds =
      current.type === 'folder' ? await collectDescendantIds(nodes, req.user._id, id) : [];
    const now = new Date();
    const rootResult = await nodes.updateOne(
      { _id: id, userId: req.user._id, deletedAt: null },
      { $set: { deletedAt: now, updatedAt: now }, $unset: { deletedRootId: '' } },
    );
    if (rootResult.matchedCount !== 1) return fail(reply, 404, 'NODE_NOT_FOUND', '节点不存在');

    for (const batch of chunks(descendantIds)) {
      await nodes.updateMany(
        { _id: { $in: batch }, userId: req.user._id },
        { $set: { deletedAt: now, deletedRootId: id, updatedAt: now } },
      );
    }

    return { deletedCount: descendantIds.length + 1 };
  });

  app.post('/nodes/:id/restore', { preHandler: requireAuth }, async (req, reply) => {
    const id = parseNodeId(req.params.id, reply);
    if (!id) return;

    const current = await nodes.findOne({
      _id: id,
      userId: req.user._id,
      deletedAt: { $ne: null },
    });
    if (!current) return fail(reply, 404, 'NODE_NOT_FOUND', '回收站中的节点不存在');
    if (current.deletedRootId) {
      return fail(reply, 409, 'PARENT_IN_TRASH', '请先恢复包含此节点的文件夹');
    }

    if (current.parentId) {
      const parent = await nodes.findOne({ _id: current.parentId, userId: req.user._id });
      if (parent?.deletedAt) {
        return fail(reply, 409, 'PARENT_IN_TRASH', '请先恢复包含此节点的文件夹');
      }
    }

    const now = new Date();
    const rootResult = await nodes.updateOne(
      { _id: id, userId: req.user._id, deletedAt: { $ne: null } },
      { $unset: { deletedAt: '', deletedRootId: '' }, $set: { updatedAt: now } },
    );
    if (rootResult.matchedCount !== 1) return fail(reply, 404, 'NODE_NOT_FOUND', '回收站中的节点不存在');

    let restoredCount = 1;
    if (current.type === 'folder') {
      const result = await nodes.updateMany(
        { userId: req.user._id, deletedRootId: id },
        { $unset: { deletedAt: '', deletedRootId: '' }, $set: { updatedAt: now } },
      );
      restoredCount += result.modifiedCount;
    }

    const restored = await nodes.findOne({ _id: id, userId: req.user._id });
    return { node: serializeNode(restored), restoredCount };
  });

  app.get('/nodes/search', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = searchQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      return fail(reply, 400, 'INVALID_INPUT', '请求参数不正确', details);
    }

    const query = parsed.data;
    const filter = {
      userId: req.user._id,
      deletedAt: null,
      name: { $regex: escapeRegex(query.q), $options: 'i' },
    };
    const total = await nodes.countDocuments(filter);
    const items = await nodes
      .find(filter)
      .sort({ name: 1, _id: 1 })
      .skip(query.offset)
      .limit(query.limit)
      .toArray();

    return {
      items: items.map(serializeNode),
      total,
      offset: query.offset,
      limit: query.limit,
    };
  });
}
