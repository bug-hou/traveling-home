import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { ObjectId } from 'mongodb';
import nodeRoutes from './nodes.js';
import { createCosService } from '../services/cos.js';

function equal(left, right) {
  if (left instanceof ObjectId || right instanceof ObjectId) {
    return String(left) === String(right);
  }
  if (left instanceof Date || right instanceof Date) {
    return new Date(left).getTime() === new Date(right).getTime();
  }
  return left === right;
}

function matchesValue(actual, expected, exists) {
  if (expected instanceof RegExp) return typeof actual === 'string' && expected.test(actual);
  if (expected && typeof expected === 'object' && !(expected instanceof ObjectId) && !(expected instanceof Date)) {
    return Object.entries(expected).every(([operator, value]) => {
      if (operator === '$exists') return exists === value;
      if (operator === '$in') return value.some((candidate) => equal(actual, candidate));
      if (operator === '$ne') return exists && !equal(actual, value);
      if (operator === '$regex') {
        const options = expected.$options ?? '';
        return typeof actual === 'string' && new RegExp(value, options).test(actual);
      }
      if (operator === '$options') return true;
      return false;
    });
  }
  if (expected === null) return actual === null || actual === undefined;
  return equal(actual, expected);
}

function matches(document, filter) {
  return Object.entries(filter).every(([field, expected]) => {
    const exists = Object.hasOwn(document, field);
    return matchesValue(document[field], expected, exists);
  });
}

function compareValues(left, right) {
  const a = left instanceof ObjectId ? String(left) : left instanceof Date ? left.getTime() : left;
  const b = right instanceof ObjectId ? String(right) : right instanceof Date ? right.getTime() : right;
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  return a < b ? -1 : 1;
}

function applyUpdate(document, update) {
  for (const [field, value] of Object.entries(update.$set ?? {})) document[field] = value;
  for (const field of Object.keys(update.$unset ?? {})) delete document[field];
}

function createDb() {
  const documents = [];
  const nodes = {
    async findOne(filter) {
      return documents.find((document) => matches(document, filter)) ?? null;
    },
    find(filter) {
      let result = documents.filter((document) => matches(document, filter));
      let skipCount = 0;
      let limitCount = Infinity;
      return {
        sort(specification) {
          result = [...result].sort((left, right) => {
            for (const [field, direction] of Object.entries(specification)) {
              const order = compareValues(left[field], right[field]);
              if (order !== 0) return order * direction;
            }
            return 0;
          });
          return this;
        },
        skip(value) {
          skipCount = value;
          return this;
        },
        limit(value) {
          limitCount = value;
          return this;
        },
        async toArray() {
          return result.slice(skipCount, skipCount + limitCount);
        },
      };
    },
    async countDocuments(filter) {
      return documents.filter((document) => matches(document, filter)).length;
    },
    async insertOne(document) {
      document._id ??= new ObjectId();
      documents.push(document);
      return { insertedId: document._id };
    },
    async updateOne(filter, update) {
      const document = documents.find((item) => matches(item, filter));
      if (!document) return { matchedCount: 0, modifiedCount: 0 };
      applyUpdate(document, update);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async updateMany(filter, update) {
      const matched = documents.filter((item) => matches(item, filter));
      for (const document of matched) applyUpdate(document, update);
      return { matchedCount: matched.length, modifiedCount: matched.length };
    },
  };
  return { collection: (name) => (name === 'nodes' ? nodes : null) };
}

async function createApp({ cfg, cos } = {}) {
  const db = createDb();
  const app = Fastify();
  const requireAuth = async (req, reply) => {
    const userId = req.headers['x-test-user'];
    if (!userId) return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
    req.user = { _id: new ObjectId(String(userId)) };
  };
  await app.register(nodeRoutes, { prefix: '/api/v1', cfg, cos, db, requireAuth });
  return { app, db };
}

async function createFolder(app, userId, name, parentId) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/nodes/folder',
    headers: { 'x-test-user': String(userId) },
    payload: { name, ...(parentId ? { parentId } : {}) },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().node;
}

test('node routes require authentication', async (t) => {
  const { app } = await createApp();
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/api/v1/nodes' });
  assert.equal(response.statusCode, 401);
});

test('folder operations are isolated by owner and prevent moving into descendants', async (t) => {
  const { app } = await createApp();
  t.after(() => app.close());
  const owner = new ObjectId();
  const other = new ObjectId();
  const parent = await createFolder(app, owner, 'parent');
  const child = await createFolder(app, owner, 'child', parent.id);

  const cycle = await app.inject({
    method: 'PATCH',
    url: `/api/v1/nodes/${parent.id}`,
    headers: { 'x-test-user': String(owner) },
    payload: { parentId: child.id },
  });
  assert.equal(cycle.statusCode, 409);
  assert.equal(cycle.json().error.code, 'MOVE_CYCLE');

  const foreign = await app.inject({
    method: 'DELETE',
    url: `/api/v1/nodes/${parent.id}`,
    headers: { 'x-test-user': String(other) },
  });
  assert.equal(foreign.statusCode, 404);

  const list = await app.inject({
    method: 'GET',
    url: '/api/v1/nodes',
    headers: { 'x-test-user': String(other) },
  });
  assert.equal(list.json().total, 0);
});

test('nodes can be renamed and moved only to folders owned by the current user', async (t) => {
  const { app } = await createApp();
  t.after(() => app.close());
  const owner = new ObjectId();
  const other = new ObjectId();
  const source = await createFolder(app, owner, 'source');
  const destination = await createFolder(app, owner, 'destination');
  const foreignFolder = await createFolder(app, other, 'foreign');
  const child = await createFolder(app, owner, 'before', source.id);

  const moved = await app.inject({
    method: 'PATCH',
    url: `/api/v1/nodes/${child.id}`,
    headers: { 'x-test-user': String(owner) },
    payload: { name: 'after', parentId: destination.id },
  });
  assert.equal(moved.statusCode, 200);
  assert.equal(moved.json().node.name, 'after');
  assert.equal(moved.json().node.parentId, destination.id);

  const foreignMove = await app.inject({
    method: 'PATCH',
    url: `/api/v1/nodes/${child.id}`,
    headers: { 'x-test-user': String(owner) },
    payload: { parentId: foreignFolder.id },
  });
  assert.equal(foreignMove.statusCode, 404);

  const nestedList = await app.inject({
    method: 'GET',
    url: `/api/v1/nodes?parentId=${destination.id}`,
    headers: { 'x-test-user': String(owner) },
  });
  assert.equal(nestedList.json().total, 1);
  assert.equal(nestedList.json().items[0].name, 'after');

  const toRoot = await app.inject({
    method: 'PATCH',
    url: `/api/v1/nodes/${child.id}`,
    headers: { 'x-test-user': String(owner) },
    payload: { parentId: null },
  });
  assert.equal(toRoot.statusCode, 200);
  assert.equal(toRoot.json().node.parentId, null);
});

test('deleting and restoring a folder moves its complete subtree to and from trash', async (t) => {
  const { app } = await createApp();
  t.after(() => app.close());
  const owner = new ObjectId();
  const root = await createFolder(app, owner, 'root');
  const child = await createFolder(app, owner, 'child', root.id);
  await createFolder(app, owner, 'grandchild', child.id);

  const deleted = await app.inject({
    method: 'DELETE',
    url: `/api/v1/nodes/${root.id}`,
    headers: { 'x-test-user': String(owner) },
  });
  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.json().deletedCount, 3);

  const trash = await app.inject({
    method: 'GET',
    url: '/api/v1/nodes?view=trash',
    headers: { 'x-test-user': String(owner) },
  });
  assert.equal(trash.json().total, 1);
  assert.equal(trash.json().items[0].id, root.id);

  const childRestore = await app.inject({
    method: 'POST',
    url: `/api/v1/nodes/${child.id}/restore`,
    headers: { 'x-test-user': String(owner) },
  });
  assert.equal(childRestore.statusCode, 409);
  assert.equal(childRestore.json().error.code, 'PARENT_IN_TRASH');

  const restored = await app.inject({
    method: 'POST',
    url: `/api/v1/nodes/${root.id}/restore`,
    headers: { 'x-test-user': String(owner) },
  });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.json().restoredCount, 3);

  const rootList = await app.inject({
    method: 'GET',
    url: '/api/v1/nodes',
    headers: { 'x-test-user': String(owner) },
  });
  assert.equal(rootList.json().total, 1);
  assert.equal(rootList.json().items[0].id, root.id);
});

test('search treats user input as a literal case-insensitive substring', async (t) => {
  const { app } = await createApp();
  t.after(() => app.close());
  const owner = new ObjectId();
  const literal = await createFolder(app, owner, 'A.* folder');
  await createFolder(app, owner, 'Another folder');

  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/nodes/search?q=a.*',
    headers: { 'x-test-user': String(owner) },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().total, 1);
  assert.equal(response.json().items[0].id, literal.id);
});

test('file access signs the custom domain for the owner only', async (t) => {
  const cfg = { imageProcessingEnabled: true, cos: {
    secretId: 'test-id', secretKey: 'test-key', bucket: 'test-cos-1312827847',
    region: 'ap-chengdu', prefix: 'movehome', readDomain: 'assets.convenience.top',
  } };
  const { app, db } = await createApp({ cfg, cos: createCosService(cfg) });
  t.after(() => app.close());
  const owner = new ObjectId();
  const other = new ObjectId();
  const fileId = new ObjectId();
  const path = `movehome/users/${owner}/originals/2026/10/${fileId}.jpg`;
  await db.collection('nodes').insertOne({
    _id: fileId, userId: owner, parentId: null, type: 'file', status: 'ready',
    deletedAt: null, name: '旅行照片.jpg', mime: 'image/jpeg', size: 8 * 1024 * 1024, cosKey: path,
  });
  const endpoint = `/api/v1/nodes/${fileId}/url`;
  const unauthenticated = await app.inject({ method: 'GET', url: endpoint });
  assert.equal(unauthenticated.statusCode, 401);
  const foreign = await app.inject({ method: 'GET', url: endpoint, headers: { 'x-test-user': String(other) } });
  assert.equal(foreign.statusCode, 404);

  const preview = await app.inject({ method: 'GET', url: endpoint, headers: { 'x-test-user': String(owner) } });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.headers['cache-control'], 'private, no-store');
  assert.equal(preview.json().previewable, true);
  const signed = new URL(preview.json().url);
  assert.equal(signed.origin, 'https://assets.convenience.top');
  assert.equal(signed.pathname, `/${path}`);
  assert.match(signed.searchParams.get('q-header-list'), /host/);
  assert.ok(signed.searchParams.get('q-signature'));
  assert.equal(signed.searchParams.get('response-content-disposition'), 'inline');

  const thumbnail = await app.inject({ method: 'GET', url: `${endpoint}?purpose=thumbnail`, headers: { 'x-test-user': String(owner) } });
  assert.equal(thumbnail.statusCode, 200, thumbnail.body);
  const signedThumbnail = new URL(thumbnail.json().url);
  assert.equal(signedThumbnail.origin, 'https://assets.convenience.top');
  assert.equal(signedThumbnail.searchParams.get('imageMogr2/thumbnail/320x320>/format/jpg/quality/80'), '');
  assert.match(signedThumbnail.searchParams.get('q-url-param-list'), /imagemogr2%2fthumbnail/);
  assert.equal(thumbnail.json().mime, 'image/jpeg');

  const download = await app.inject({ method: 'GET', url: `${endpoint}?purpose=download`, headers: { 'x-test-user': String(owner) } });
  assert.equal(download.statusCode, 200, download.body);
  assert.equal(download.json().previewable, false);
  assert.match(new URL(download.json().url).searchParams.get('response-content-disposition'), /^attachment;/);

  const invalid = await app.inject({ method: 'GET', url: `${endpoint}?purpose=unknown`, headers: { 'x-test-user': String(owner) } });
  assert.equal(invalid.statusCode, 400);
  const folder = await createFolder(app, owner, 'private');
  const folderUrl = await app.inject({ method: 'GET', url: `/api/v1/nodes/${folder.id}/url`, headers: { 'x-test-user': String(owner) } });
  assert.equal(folderUrl.statusCode, 404);
  await db.collection('nodes').updateOne({ _id: fileId }, { $set: { deletedAt: new Date() } });
  const deleted = await app.inject({ method: 'GET', url: endpoint, headers: { 'x-test-user': String(owner) } });
  assert.equal(deleted.statusCode, 404);
});

test('file locations are owner-only, validated, replaceable and never exposed in node summaries', async (t) => {
  const { app, db } = await createApp();
  t.after(() => app.close());
  const owner = new ObjectId();
  const other = new ObjectId();
  const id = new ObjectId();
  const pendingId = new ObjectId();
  const folder = await createFolder(app, owner, 'trip');
  const nodes = db.collection('nodes');
  await nodes.insertOne({ _id: id, userId: owner, parentId: null, type: 'file', status: 'ready', deletedAt: null, name: 'photo.jpg' });
  await nodes.insertOne({ _id: pendingId, userId: owner, type: 'file', status: 'pending', deletedAt: null, name: 'pending.jpg' });
  const url = `/api/v1/nodes/${id}/location`;
  const headers = { 'x-test-user': String(owner) };
  const read = (endpoint = url, user = owner) => app.inject({ method: 'GET', url: endpoint, headers: { 'x-test-user': String(user) } });
  const write = (payload, endpoint = url, user = owner) => app.inject({ method: 'PATCH', url: endpoint, headers: { 'x-test-user': String(user) }, payload });

  assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401);
  assert.equal((await app.inject({ method: 'PATCH', url, payload: { latitude: 0, longitude: 0 } })).statusCode, 401);
  assert.equal((await read(url, other)).statusCode, 404);
  assert.equal((await write({ latitude: 0, longitude: 0 }, url, other)).statusCode, 404);
  assert.equal((await read(`/api/v1/nodes/${folder.id}/location`)).statusCode, 404);
  assert.equal((await read(`/api/v1/nodes/${pendingId}/location`)).statusCode, 404);
  assert.equal((await write({ latitude: 0, longitude: 0 }, `/api/v1/nodes/${pendingId}/location`)).statusCode, 404);
  assert.equal((await read('/api/v1/nodes/not-an-id/location')).statusCode, 400);

  const empty = await read();
  assert.equal(empty.statusCode, 200);
  assert.equal(empty.headers['cache-control'], 'private, no-store');
  assert.deepEqual(empty.json(), { location: null });
  const written = await write({ latitude: 0, longitude: -180, placeName: '  旅途  ' });
  assert.equal(written.statusCode, 200, written.body);
  assert.equal(written.headers['cache-control'], 'private, no-store');
  assert.deepEqual(written.json().location, { latitude: 0, longitude: -180, placeName: '旅途', source: 'manual' });
  assert.deepEqual((await read()).json().location, written.json().location);
  assert.equal((await write({ latitude: 90, longitude: 180 })).json().location.placeName, null);
  const detail = await app.inject({ method: 'GET', url: `/api/v1/nodes/${id}`, headers });
  assert.equal(JSON.stringify(detail.json()).includes('mediaLocation'), false);
  const list = await app.inject({ method: 'GET', url: '/api/v1/nodes', headers });
  assert.equal(JSON.stringify(list.json()).includes('mediaLocation'), false);

  for (const payload of [
    { latitude: '1', longitude: 1 }, { latitude: 91, longitude: 1 }, { latitude: 1, longitude: 181 },
    { latitude: 1 }, { longitude: 1 }, { latitude: 1, longitude: 1, userId: String(owner) },
    { latitude: 1, longitude: 1, placeName: '  ' }, { latitude: 1, longitude: 1, placeName: 'a\n' },
  ]) {
    const invalid = await write(payload);
    assert.equal(invalid.statusCode, 400, JSON.stringify(payload));
    assert.equal(invalid.json().error.code, 'INVALID_INPUT');
  }
  await nodes.updateOne({ _id: id }, { $set: { deletedAt: new Date() } });
  assert.equal((await read()).statusCode, 404);
  assert.equal((await write({ latitude: 1, longitude: 1 })).statusCode, 404);
});
