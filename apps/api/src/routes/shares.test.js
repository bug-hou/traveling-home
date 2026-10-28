import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { ObjectId } from 'mongodb';
import shareRoutes from './shares.js';
import { downloadResponse } from '../services/cos.js';

function same(a, b) { return a instanceof ObjectId || b instanceof ObjectId ? String(a) === String(b) : a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b; }
function matches(doc, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some((item) => matches(doc, item));
    if (value && typeof value === 'object' && !(value instanceof ObjectId) && !(value instanceof Date)) {
      return Object.entries(value).every(([op, number]) => op === '$gt' ? doc[key] > number : op === '$lt' ? doc[key] < number : op === '$lte' ? doc[key] <= number : false);
    }
    return same(doc[key] ?? null, value);
  });
}
function fixture() {
  const userId = new ObjectId();
  const otherId = new ObjectId();
  const rootId = new ObjectId();
  const imageId = new ObjectId();
  const foreignId = new ObjectId();
  const now = new Date();
  const docs = {
    users: [{ _id: userId, publicHandle: 'traveler', nickname: '旅人', status: 'active' }, { _id: otherId, publicHandle: 'other', nickname: '访客', status: 'active' }],
    handles: [{ _id: 'traveler', userId }],
    shares: [],
    nodes: [
      { _id: rootId, userId, type: 'folder', name: '相册', parentId: null, deletedAt: null },
      { _id: imageId, userId, type: 'file', name: 'photo.jpg', mime: 'image/jpeg', size: 100, status: 'ready', cosKey: `movehome/users/${userId}/originals/p.jpg`, parentId: rootId, deletedAt: null },
      { _id: foreignId, userId: otherId, type: 'file', name: 'foreign.jpg', mime: 'image/jpeg', size: 100, status: 'ready', cosKey: `movehome/users/${otherId}/originals/f.jpg`, parentId: null, deletedAt: null },
    ],
  };
  const collection = (name) => ({
    findOne: async (query) => docs[name].find((doc) => matches(doc, query)) ?? null,
    insertOne: async (doc) => { if (docs[name].some((item) => item.userId && same(item.userId, doc.userId) && item.slug === doc.slug)) { const err = new Error('duplicate'); err.code = 11000; throw err; } doc._id ??= new ObjectId(); docs[name].push(doc); return { insertedId: doc._id }; },
    updateOne: async (query, update) => { const item = docs[name].find((doc) => matches(doc, query)); if (!item) return { matchedCount: 0 }; Object.assign(item, update.$set); for (const [key, value] of Object.entries(update.$inc ?? {})) item[key] += value; return { matchedCount: 1 }; },
    findOneAndUpdate: async (query, update) => { const item = docs[name].find((doc) => matches(doc, query)); if (item) Object.assign(item, update.$set); return item ?? null; },
    countDocuments: async (query) => docs[name].filter((doc) => matches(doc, query)).length,
    find: (query) => ({ sort: () => ({ limit: (limit) => ({ toArray: async () => docs[name].filter((doc) => matches(doc, query)).slice(0, limit) }), skip: (skip) => ({ limit: (limit) => ({ toArray: async () => docs[name].filter((doc) => matches(doc, query)).slice(skip, skip + limit) }) }) }) }),
  });
  const calls = [];
  const app = Fastify();
  const requireAuth = async (req, reply) => {
    if (!req.headers['x-test-user']) return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
    req.user = docs.users.find((item) => String(item._id) === req.headers['x-test-user']);
    if (!req.user) return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
  };
  const cos = { signReadUrl: async (key, options) => { calls.push({ key, options }); return 'https://assets.example.invalid/signed'; } };
  return {
    app, docs, calls, userId, otherId, rootId, imageId, foreignId,
    async ready() { await app.register(shareRoutes, { db: { collection }, cfg: { cos: { prefix: 'movehome' } }, cos, requireAuth }); await app.ready(); },
    create(body = {}) { return app.inject({ method: 'POST', url: '/shares', headers: { 'x-test-user': String(userId) }, payload: { targetId: String(rootId), slug: 'west-trip', ...body } }); },
    browse(payload = {}, suffix = 'traveler/west-trip') { return app.inject({ method: 'POST', url: `/public/shares/${suffix}/browse`, payload }); },
    access(nodeId = imageId, purpose = 'download', payload = {}, headers = {}) { return app.inject({ method: 'POST', url: `/public/shares/traveler/west-trip/files/${nodeId}/access`, payload: { purpose, ...payload }, headers }); },
  };
}

test('folder share is owner-only and public browsing is scoped to its current subtree', async (t) => {
  const ctx = fixture(); await ctx.ready(); t.after(() => ctx.app.close());
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/shares', payload: { targetId: String(ctx.rootId) } })).statusCode, 401);
  assert.equal((await ctx.create({ targetId: String(ctx.foreignId) })).statusCode, 404);
  assert.equal((await ctx.create()).statusCode, 201);
  const browse = await ctx.browse();
  assert.equal(browse.statusCode, 200, browse.body);
  assert.equal(browse.json().items[0].id, String(ctx.imageId));
  assert.ok(!browse.body.includes('cosKey'));
  assert.equal((await ctx.access(ctx.foreignId)).statusCode, 404);
  assert.equal((await ctx.access(ctx.imageId, 'preview')).statusCode, 200);
  assert.equal(ctx.calls[0].options.expires, 60);
  ctx.docs.nodes.find((item) => same(item._id, ctx.imageId)).parentId = null;
  assert.equal((await ctx.access(ctx.imageId)).statusCode, 404);
  ctx.docs.nodes.find((item) => same(item._id, ctx.rootId)).deletedAt = new Date();
  assert.equal((await ctx.browse()).statusCode, 404);
});

test('password, login, expiry, preview permission and atomic download issuance limit', async (t) => {
  const ctx = fixture(); await ctx.ready(); t.after(() => ctx.app.close());
  const created = await ctx.create({ password: 'passcode-123', requireLogin: true, allowPreview: false, maxDownloads: 1 });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal((await ctx.browse()).statusCode, 401);
  const headers = { 'x-test-user': String(ctx.otherId) };
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/public/shares/traveler/west-trip/browse', headers })).statusCode, 403);
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/public/shares/traveler/west-trip/browse', headers: { 'x-test-user': String(ctx.userId) } })).statusCode, 403);
  assert.equal((await ctx.access(ctx.imageId, 'preview', { password: 'passcode-123' }, { 'x-test-user': String(ctx.userId) })).statusCode, 403);
  const payload = { password: 'passcode-123' };
  const owner = { 'x-test-user': String(ctx.userId) };
  const responses = await Promise.all([ctx.access(ctx.imageId, 'download', payload, owner), ctx.access(ctx.imageId, 'download', payload, owner)]);
  assert.deepEqual(responses.map((item) => item.statusCode).sort(), [200, 429]);
  assert.equal(ctx.docs.shares[0].downloadCount, 1);
  assert.equal(ctx.docs.shares[0].passwordHash.startsWith('$argon2id$'), true);
  assert.equal((await ctx.app.inject({ method: 'DELETE', url: `/shares/${ctx.docs.shares[0]._id}`, headers: owner })).statusCode, 204);
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/public/shares/traveler/west-trip/browse', payload, headers: owner })).statusCode, 404);
});

test('public media downloads retain their real type and a usable file extension', async (t) => {
  const ctx = fixture(); await ctx.ready(); t.after(() => ctx.app.close());
  assert.equal((await ctx.create()).statusCode, 201);
  const image = ctx.docs.nodes.find((item) => same(item._id, ctx.imageId));
  image.name = '国徽';
  const download = await ctx.access();
  assert.equal(download.statusCode, 200, download.body);
  assert.equal(download.json().mime, 'image/jpeg');
  assert.equal(download.json().name, '国徽');
  assert.equal(ctx.calls.at(-1).options.mime, 'image/jpeg');
  assert.equal(ctx.calls.at(-1).options.disposition, 'attachment; filename="download.jpg"; filename*=UTF-8\'\'%E5%9B%BD%E5%BE%BD.jpg');

  image.name = 'photo.JPEG';
  await ctx.access();
  assert.match(ctx.calls.at(-1).options.disposition, /filename\*=UTF-8''photo.JPEG$/);
  image.name = 'photo.txt';
  await ctx.access();
  assert.match(ctx.calls.at(-1).options.disposition, /filename\*=UTF-8''photo.txt.jpg$/);

  const preview = await ctx.access(ctx.imageId, 'preview');
  assert.equal(preview.statusCode, 200);
  assert.equal(ctx.calls.at(-1).options.disposition, 'inline');
  assert.equal(ctx.calls.at(-1).options.mime, 'image/jpeg');

  image.name = 'index.html'; image.mime = 'text/html';
  const unsafe = await ctx.access();
  assert.equal(unsafe.statusCode, 200);
  assert.equal(unsafe.json().mime, 'application/octet-stream');
  assert.equal(ctx.calls.at(-1).options.mime, 'application/octet-stream');
  assert.match(ctx.calls.at(-1).options.disposition, /filename\*=UTF-8''index.html$/);
});

test('download filename handles encoded punctuation, MIME suffixes and unsafe types', () => {
  const png = downloadResponse('旅途.PNG', 'image/png');
  assert.match(png.disposition, /filename\*=UTF-8''%E6%97%85%E9%80%94.PNG$/);
  assert.equal(png.mime, 'image/png');
  const quoted = downloadResponse('2026\r\n旅途\'照"片', 'image/webp');
  assert.ok(!/[\r\n]/.test(quoted.disposition));
  assert.match(quoted.disposition, /filename\*=UTF-8''2026__%E6%97%85%E9%80%94%27%E7%85%A7%22%E7%89%87.webp$/);
  const unsafe = downloadResponse('index.html', 'text/html');
  assert.equal(unsafe.mime, 'application/octet-stream');
  assert.match(unsafe.disposition, /filename\*=UTF-8''index.html$/);
});

test('unshareable unsafe preview, time limit and ownership on edits', async (t) => {
  const ctx = fixture(); await ctx.ready(); t.after(() => ctx.app.close());
  assert.equal((await ctx.create({ expiresAt: new Date(Date.now() - 1000).toISOString() })).statusCode, 400);
  assert.equal((await ctx.create({ allowPreview: false, allowDownload: false })).statusCode, 400);
  assert.equal((await ctx.create()).statusCode, 201);
  const shareId = String(ctx.docs.shares[0]._id);
  const foreignEdit = await ctx.app.inject({ method: 'PATCH', url: `/shares/${shareId}`, payload: { title: 'fake' }, headers: { 'x-test-user': String(ctx.otherId) } });
  assert.equal(foreignEdit.statusCode, 404);
  ctx.docs.nodes.find((item) => same(item._id, ctx.imageId)).mime = 'text/html';
  assert.equal((await ctx.access(ctx.imageId, 'preview')).statusCode, 422);
  ctx.docs.shares[0].expiresAt = new Date(Date.now() - 1000);
  assert.equal((await ctx.browse()).statusCode, 404);
});
