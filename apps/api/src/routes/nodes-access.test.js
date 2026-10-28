import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { ObjectId } from 'mongodb';
import nodeRoutes from './nodes.js';

function createApp({ imageProcessingEnabled = false } = {}) {
  const docs = [];
  const calls = [];
  const userId = new ObjectId();
  const cfg = { cos: { prefix: 'movehome' }, imageProcessingEnabled };
  const db = {
    collection() {
      return {
        findOne(query) {
          return Promise.resolve(docs.find((item) =>
            Object.entries(query).every(([key, value]) =>
              value instanceof ObjectId ? String(item[key]) === String(value) :
                value === null ? item[key] == null : item[key] === value,
            ),
          ) ?? null);
        },
      };
    },
  };
  const cos = {
    async signReadUrl(key, options) {
      calls.push({ key, options });
      return 'https://private-cos.example.invalid/signed?test=1';
    },
  };
  const app = Fastify();
  const requireAuth = (req, reply, done) => {
    if (!req.headers['x-test-user']) return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
    req.user = { _id: new ObjectId(req.headers['x-test-user']) };
    done();
  };
  return {
    app,
    docs,
    calls,
    userId,
    async ready() {
      await app.register(nodeRoutes, { prefix: '/api/v1', cfg, db, cos, requireAuth });
      await app.ready();
    },
  };
}

function file(owner, patch = {}) {
  const id = new ObjectId();
  return {
    _id: id,
    userId: owner,
    parentId: null,
    type: 'file',
    name: 'photo.jpg',
    mime: 'image/jpeg',
    size: 128,
    status: 'ready',
    cosKey: `movehome/users/${owner}/originals/2026/10/${id}.jpg`,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...patch,
  };
}

test('signed URL is scoped to authenticated owner and an active ready file', async (t) => {
  const ctx = createApp();
  await ctx.ready();
  t.after(() => ctx.app.close());
  const node = file(ctx.userId);
  ctx.docs.push(node);
  const url = `/api/v1/nodes/${node._id}/url`;
  const anonymous = await ctx.app.inject({ url });
  assert.equal(anonymous.statusCode, 401);
  const other = await ctx.app.inject({ url, headers: { 'x-test-user': String(new ObjectId()) } });
  assert.equal(other.statusCode, 404);
  const response = await ctx.app.inject({ url, headers: { 'x-test-user': String(ctx.userId) } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().previewable, true);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.deepEqual(ctx.calls[0], { key: node.cosKey, options: { mime: 'image/jpeg', disposition: 'inline' } });
  assert.ok(!response.body.includes('cosKey'));

  node.deletedAt = new Date();
  assert.equal((await ctx.app.inject({ url, headers: { 'x-test-user': String(ctx.userId) } })).statusCode, 404);
});

test('unsafe MIME downloads as octet-stream; never inline HTML or user supplied keys', async (t) => {
  const ctx = createApp();
  await ctx.ready();
  t.after(() => ctx.app.close());
  const node = file(ctx.userId, { name: 'index.html', mime: 'text/html' });
  ctx.docs.push(node);
  const base = `/api/v1/nodes/${node._id}/url`;
  const reply = await ctx.app.inject({ url: `${base}?purpose=preview`, headers: { 'x-test-user': String(ctx.userId) } });
  assert.equal(reply.statusCode, 200);
  assert.equal(reply.json().previewable, false);
  assert.equal(ctx.calls[0].options.mime, 'application/octet-stream');
  assert.match(ctx.calls[0].options.disposition, /^attachment;/);
  const invalid = await ctx.app.inject({ url: `${base}?purpose=preview&key=other`, headers: { 'x-test-user': String(ctx.userId) } });
  assert.equal(invalid.statusCode, 400);
  node.cosKey = `movehome/users/${new ObjectId()}/originals/foreign`;
  const foreignKey = await ctx.app.inject({ url: base, headers: { 'x-test-user': String(ctx.userId) } });
  assert.equal(foreignKey.statusCode, 409);
});

test('owner download appends the image extension without changing the stored display name', async (t) => {
  const ctx = createApp(); await ctx.ready(); t.after(() => ctx.app.close());
  const node = file(ctx.userId, { name: '头像', mime: 'image/jpeg' });
  ctx.docs.push(node);
  const url = `/api/v1/nodes/${node._id}/url?purpose=download`;
  const download = await ctx.app.inject({ url, headers: { 'x-test-user': String(ctx.userId) } });
  assert.equal(download.statusCode, 200, download.body);
  assert.equal(download.json().name, '头像');
  assert.equal(download.json().mime, 'image/jpeg');
  assert.equal(ctx.calls.at(-1).options.mime, 'image/jpeg');
  assert.equal(ctx.calls.at(-1).options.disposition, 'attachment; filename="download.jpg"; filename*=UTF-8\'\'%E5%A4%B4%E5%83%8F.jpg');
});

test('thumbnail URL requires explicit opt-in and a small allowed image with owner permissions', async (t) => {
  const disabled = createApp();
  await disabled.ready();
  t.after(() => disabled.app.close());
  const original = file(disabled.userId, { size: 8 * 1024 * 1024 });
  disabled.docs.push(original);
  const path = `/api/v1/nodes/${original._id}/url?purpose=thumbnail`;
  assert.equal((await disabled.app.inject({ url: path, headers: { 'x-test-user': String(disabled.userId) } })).statusCode, 503);
  assert.equal(disabled.calls.length, 0);

  const enabled = createApp({ imageProcessingEnabled: true });
  await enabled.ready();
  t.after(() => enabled.app.close());
  const image = file(enabled.userId, { size: 8 * 1024 * 1024 });
  enabled.docs.push(image);
  const endpoint = `/api/v1/nodes/${image._id}/url?purpose=thumbnail`;
  assert.equal((await enabled.app.inject({ url: endpoint })).statusCode, 401);
  assert.equal((await enabled.app.inject({ url: endpoint, headers: { 'x-test-user': String(new ObjectId()) } })).statusCode, 404);
  const result = await enabled.app.inject({ url: endpoint, headers: { 'x-test-user': String(enabled.userId) } });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().mime, 'image/jpeg');
  assert.equal(result.headers['cache-control'], 'private, no-store');
  assert.equal(enabled.calls[0].options.thumbnail, true);
  image.mime = 'image/svg+xml';
  assert.equal((await enabled.app.inject({ url: endpoint, headers: { 'x-test-user': String(enabled.userId) } })).statusCode, 422);
  image.mime = 'image/jpeg';
  image.size = 31 * 1024 * 1024;
  assert.equal((await enabled.app.inject({ url: endpoint, headers: { 'x-test-user': String(enabled.userId) } })).statusCode, 422);
});

test('folder detail returns validated ancestor chain for direct navigation', async (t) => {
  const ctx = createApp();
  await ctx.ready();
  t.after(() => ctx.app.close());
  const grandparent = file(ctx.userId, { type: 'folder', name: '旅行', cosKey: undefined });
  const parent = file(ctx.userId, { type: 'folder', name: '川西', parentId: grandparent._id, cosKey: undefined });
  const child = file(ctx.userId, { type: 'folder', name: '照片', parentId: parent._id, cosKey: undefined });
  ctx.docs.push(grandparent, parent, child);
  const response = await ctx.app.inject({ url: `/api/v1/nodes/${child._id}`, headers: { 'x-test-user': String(ctx.userId) } });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().ancestors.map((entry) => entry.name), ['旅行', '川西']);
  const foreign = await ctx.app.inject({ url: `/api/v1/nodes/${child._id}`, headers: { 'x-test-user': String(new ObjectId()) } });
  assert.equal(foreign.statusCode, 404);
});
