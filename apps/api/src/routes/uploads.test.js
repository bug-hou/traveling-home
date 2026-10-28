import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { ObjectId } from 'mongodb';
import uploadRoutes from './uploads.js';
import nodeRoutes from './nodes.js';

function same(left, right) {
  if (left instanceof ObjectId || right instanceof ObjectId) return String(left) === String(right);
  return left === right;
}

function matches(document, filter) {
  return Object.entries(filter).every(([field, value]) => same(document[field], value));
}

function createDb() {
  const collections = new Map();
  for (const name of ['nodes', 'upload_sessions']) {
    const documents = [];
    collections.set(name, {
      documents,
      async findOne(filter) {
        return documents.find((document) => matches(document, filter)) ?? null;
      },
      async insertOne(document) {
        if (documents.some((item) => same(item._id, document._id))) {
          const error = new Error('duplicate key');
          error.code = 11000;
          throw error;
        }
        documents.push(document);
        return { insertedId: document._id };
      },
      async updateOne(filter, update) {
        const document = documents.find((item) => matches(item, filter));
        if (!document) return { matchedCount: 0, modifiedCount: 0 };
        Object.assign(document, update.$set ?? {});
        return { matchedCount: 1, modifiedCount: 1 };
      },
    });
  }
  return {
    collection(name) {
      return collections.get(name);
    },
  };
}

async function createApp({ cos = null, configured = true } = {}) {
  const db = createDb();
  const app = Fastify();
  const requireAuth = async (req, reply) => {
    const userId = req.headers['x-test-user'];
    if (!userId) return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
    req.user = { _id: new ObjectId(String(userId)) };
  };
  const cfg = {
    cos: configured
      ? {
          bucket: 'test-1234567890',
          region: 'ap-chengdu',
          prefix: 'movehome',
        }
      : null,
  };
  await app.register(uploadRoutes, { prefix: '/api/v1', cfg, db, requireAuth, cos });
  await app.register(nodeRoutes, { prefix: '/api/v1', cfg, db, requireAuth, cos });
  return { app, db };
}

async function requestCredentials(app, userId, payload = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/uploads/credentials',
    headers: { 'x-test-user': String(userId) },
    payload: { name: 'drone clip.MP4', size: 2048, mime: 'video/mp4', ...payload },
  });
}

function fakeCos({ head = { headers: { 'content-length': '2048' } }, onHead = () => {} } = {}) {
  const calls = { issue: [], head: [] };
  return {
    calls,
    async issueUploadCredentials(input) {
      calls.issue.push(input);
      return {
        credentials: { tmpSecretId: 'temporary-id', tmpSecretKey: 'temporary-key', sessionToken: 'temporary-token' },
        expiresAt: new Date('2026-10-28T12:30:00.000Z'),
      };
    },
    async headObject(key) {
      calls.head.push(key);
      onHead(key);
      if (head instanceof Error) throw head;
      return head;
    },
  };
}

test('upload routes require authentication and report missing COS configuration', async (t) => {
  const unavailable = await createApp({ configured: false });
  t.after(() => unavailable.app.close());

  const unauthenticated = await unavailable.app.inject({
    method: 'POST',
    url: '/api/v1/uploads/credentials',
    payload: { name: 'photo.jpg', size: 2 },
  });
  assert.equal(unauthenticated.statusCode, 401);

  const userId = new ObjectId();
  const response = await requestCredentials(unavailable.app, userId);
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error.code, 'UPLOADS_NOT_CONFIGURED');
});

test('credential request rejects client-selected keys and foreign or missing folders', async (t) => {
  const cos = fakeCos();
  const { app, db } = await createApp({ cos });
  t.after(() => app.close());
  const userId = new ObjectId();
  const foreignParent = new ObjectId();
  db.collection('nodes').documents.push({
    _id: foreignParent,
    userId: new ObjectId(),
    type: 'folder',
    deletedAt: null,
  });

  const untrustedKey = await app.inject({
    method: 'POST',
    url: '/api/v1/uploads/credentials',
    headers: { 'x-test-user': String(userId) },
    payload: { name: 'photo.jpg', size: 10, key: 'another-users/private.jpg' },
  });
  assert.equal(untrustedKey.statusCode, 400);

  const foreignFolder = await requestCredentials(app, userId, { parentId: String(foreignParent) });
  assert.equal(foreignFolder.statusCode, 404);
  assert.equal(foreignFolder.json().error.code, 'PARENT_NOT_FOUND');
  assert.equal(cos.calls.issue.length, 0);
  assert.equal(db.collection('upload_sessions').documents.length, 0);
});

test('credential request creates a server-generated user-scoped object key and session', async (t) => {
  const cos = fakeCos();
  const { app, db } = await createApp({ cos });
  t.after(() => app.close());
  const userId = new ObjectId();

  const response = await requestCredentials(app, userId);
  assert.equal(response.statusCode, 201, response.body);
  const body = response.json();
  assert.match(body.key, new RegExp(`^movehome/users/${userId}/originals/\\d{4}/\\d{2}/[a-f\\d]{24}\\.mp4$`));
  assert.equal(body.fileId.length, 24);
  assert.equal(body.credentials.tmpSecretId, 'temporary-id');
  assert.equal(body.credentials.sessionToken, 'temporary-token');
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.deepEqual(cos.calls.issue[0], { key: body.key });

  const sessions = db.collection('upload_sessions').documents;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].expectedSize, 2048);
  assert.equal(sessions[0].cosKey, body.key);
  assert.equal(sessions[0].status, 'pending');
});

test('complete validates the COS object, creates a file node, and is idempotent', async (t) => {
  const cos = fakeCos();
  const { app, db } = await createApp({ cos });
  t.after(() => app.close());
  const userId = new ObjectId();
  const created = await requestCredentials(app, userId);
  const { uploadId, fileId } = created.json();
  const complete = () =>
    app.inject({
      method: 'POST',
      url: '/api/v1/uploads/complete',
      headers: { 'x-test-user': String(userId) },
      payload: { uploadId },
    });

  const first = await complete();
  assert.equal(first.statusCode, 200, first.body);
  const node = first.json().node;
  assert.equal(node.id, fileId);
  assert.equal(node.type, 'file');
  assert.equal(node.size, 2048);
  assert.equal(node.mime, 'video/mp4');
  assert.equal(node.name, 'drone clip.MP4');
  assert.equal(first.json().idempotent, false);
  assert.equal(db.collection('nodes').documents.length, 1);
  assert.equal(db.collection('nodes').documents[0].cosKey, created.json().key);

  const second = await complete();
  assert.equal(second.statusCode, 200, second.body);
  assert.equal(second.json().idempotent, true);
  assert.equal(second.json().node.id, fileId);
  assert.equal(db.collection('nodes').documents.length, 1);
  assert.equal(cos.calls.head.length, 1);
});

test('completion rejects missing or size-mismatched COS objects without creating a node', async (t) => {
  const missingCos = fakeCos({ head: Object.assign(new Error('not found'), { statusCode: 404, code: 'NoSuchKey' }) });
  const missing = await createApp({ cos: missingCos });
  t.after(() => missing.app.close());
  const userId = new ObjectId();
  const created = await requestCredentials(missing.app, userId);
  const missingResponse = await missing.app.inject({
    method: 'POST',
    url: '/api/v1/uploads/complete',
    headers: { 'x-test-user': String(userId) },
    payload: { uploadId: created.json().uploadId },
  });
  assert.equal(missingResponse.statusCode, 409);
  assert.equal(missingResponse.json().error.code, 'UPLOAD_OBJECT_NOT_FOUND');
  assert.equal(missing.db.collection('nodes').documents.length, 0);

  const mismatchCos = fakeCos({ head: { headers: { 'content-length': '1024' } } });
  const mismatch = await createApp({ cos: mismatchCos });
  t.after(() => mismatch.app.close());
  const mismatchUpload = await requestCredentials(mismatch.app, userId);
  const mismatchResponse = await mismatch.app.inject({
    method: 'POST',
    url: '/api/v1/uploads/complete',
    headers: { 'x-test-user': String(userId) },
    payload: { uploadId: mismatchUpload.json().uploadId },
  });
  assert.equal(mismatchResponse.statusCode, 409);
  assert.equal(mismatchResponse.json().error.code, 'UPLOAD_SIZE_MISMATCH');
  assert.equal(mismatch.db.collection('nodes').documents.length, 0);
});

test('completion rechecks that the selected parent remains active after COS validation', async (t) => {
  const userId = new ObjectId();
  const parentId = new ObjectId();
  let parent;
  const cos = fakeCos({
    onHead: () => {
      parent.deletedAt = new Date();
    },
  });
  const { app, db } = await createApp({ cos });
  t.after(() => app.close());
  parent = { _id: parentId, userId, type: 'folder', deletedAt: null };
  db.collection('nodes').documents.push(parent);
  const created = await requestCredentials(app, userId, { parentId: String(parentId) });
  assert.equal(created.statusCode, 201);

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/uploads/complete',
    headers: { 'x-test-user': String(userId) },
    payload: { uploadId: created.json().uploadId },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, 'PARENT_NOT_AVAILABLE');
  assert.ok(parent.deletedAt instanceof Date);
  assert.equal(db.collection('nodes').documents.filter((node) => node.type === 'file').length, 0);
});

test('upload sessions cannot be completed by another user', async (t) => {
  const cos = fakeCos();
  const { app, db } = await createApp({ cos });
  t.after(() => app.close());
  const owner = new ObjectId();
  const otherUser = new ObjectId();
  const created = await requestCredentials(app, owner);

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/uploads/complete',
    headers: { 'x-test-user': String(otherUser) },
    payload: { uploadId: created.json().uploadId },
  });
  assert.equal(response.statusCode, 404);
  assert.equal(db.collection('nodes').documents.length, 0);
  assert.equal(cos.calls.head.length, 0);
});

test('completion saves automatic GPS once and never replaces a later manual location', async (t) => {
  const { app, db } = await createApp({ cos: fakeCos() });
  t.after(() => app.close());
  const userId = new ObjectId();
  const { uploadId, fileId } = (await requestCredentials(app, userId, { name: 'frame.JPG', mime: 'image/jpeg' })).json();
  const complete = (location) => app.inject({
    method: 'POST', url: '/api/v1/uploads/complete', headers: { 'x-test-user': String(userId) },
    payload: { uploadId, location },
  });
  const first = await complete({ latitude: 0, longitude: -73.5, source: 'exif' });
  assert.equal(first.statusCode, 200, first.body);
  const node = db.collection('nodes').documents[0];
  assert.equal(String(node._id), fileId);
  assert.deepEqual(node.mediaLocation, { latitude: 0, longitude: -73.5, placeName: null, source: 'exif' });
  const locationUrl = `/api/v1/nodes/${fileId}/location`;
  const read = () => app.inject({ method: 'GET', url: locationUrl, headers: { 'x-test-user': String(userId) } });
  assert.deepEqual((await read()).json().location, node.mediaLocation);
  const manual = await app.inject({
    method: 'PATCH', url: locationUrl, headers: { 'x-test-user': String(userId) },
    payload: { latitude: 30, longitude: 120, placeName: '手动标记' },
  });
  assert.equal(manual.statusCode, 200);
  assert.equal(manual.json().location.source, 'manual');
  const repeated = await complete({ latitude: 50, longitude: 50, source: 'exif' });
  assert.equal(repeated.statusCode, 200);
  assert.equal(repeated.json().idempotent, true);
  assert.deepEqual((await read()).json().location, { latitude: 30, longitude: 120, placeName: '手动标记', source: 'manual' });
  db.collection('upload_sessions').documents[0].status = 'pending';
  const duplicateInsert = await complete({ latitude: 50, longitude: 50, source: 'exif' });
  assert.equal(duplicateInsert.statusCode, 200);
  assert.equal(duplicateInsert.json().idempotent, true);
  assert.deepEqual((await read()).json().location, { latitude: 30, longitude: 120, placeName: '手动标记', source: 'manual' });
});

test('completion validates automatic GPS and binds SRT positions only to the matching owner session', async (t) => {
  const { app, db } = await createApp({ cos: fakeCos() });
  t.after(() => app.close());
  const owner = new ObjectId();
  const { uploadId } = (await requestCredentials(app, owner)).json();
  const complete = (userId, location) => app.inject({
    method: 'POST', url: '/api/v1/uploads/complete', headers: { 'x-test-user': String(userId) },
    payload: { uploadId, location },
  });
  for (const location of [
    { latitude: 91, longitude: 10, source: 'srt' },
    { latitude: 20, longitude: -181, source: 'srt' },
    { latitude: '20', longitude: 100, source: 'srt' },
    { latitude: 20, longitude: 100, source: 'manual' },
    { latitude: 20, longitude: 100, source: 'srt', placeName: 'injected' },
  ]) {
    assert.equal((await complete(owner, location)).statusCode, 400);
  }
  assert.equal(db.collection('nodes').documents.length, 0);
  assert.equal((await complete(new ObjectId(), { latitude: 20, longitude: 100, source: 'srt' })).statusCode, 404);
  const success = await complete(owner, { latitude: -3.5, longitude: 0, source: 'srt' });
  assert.equal(success.statusCode, 200, success.body);
  assert.deepEqual(db.collection('nodes').documents[0].mediaLocation, { latitude: -3.5, longitude: 0, placeName: null, source: 'srt' });
});

test('completion without GPS succeeds, and location sources cannot be attached to incompatible files', async (t) => {
  const { app, db } = await createApp({ cos: fakeCos() });
  t.after(() => app.close());
  const owner = new ObjectId();
  const srt = (await requestCredentials(app, owner, { name: 'clip.SRT', mime: 'application/octet-stream' })).json();
  const photo = (await requestCredentials(app, owner, { name: 'photo.jpeg', mime: 'image/jpeg' })).json();
  const complete = (uploadId, location) => app.inject({
    method: 'POST', url: '/api/v1/uploads/complete', headers: { 'x-test-user': String(owner) },
    payload: location ? { uploadId, location } : { uploadId },
  });
  assert.equal((await complete(srt.uploadId, { latitude: 10, longitude: 20, source: 'srt' })).statusCode, 400);
  assert.equal((await complete(photo.uploadId, { latitude: 10, longitude: 20, source: 'srt' })).statusCode, 400);
  assert.equal((await complete(srt.uploadId)).statusCode, 200);
  assert.equal((await complete(photo.uploadId)).statusCode, 200);
  assert.ok(db.collection('nodes').documents.every((node) => !Object.hasOwn(node, 'mediaLocation')));
});
