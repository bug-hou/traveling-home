import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { ObjectId } from 'mongodb';
import phoneUploadRoutes from './phone-uploads.js';
import uploadRoutes from './uploads.js';

const same = (a, b) => a instanceof ObjectId || b instanceof ObjectId ? String(a) === String(b) : a === b;
function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object' && !(value instanceof ObjectId) && !(value instanceof Date)) {
      if ('$gt' in value) return doc[key] > value.$gt;
      if ('$lt' in value) return doc[key] < value.$lt;
      if ('$in' in value) return value.$in.includes(doc[key]);
    }
    return same(doc[key], value);
  });
}
function fakeDb() {
  const collections = Object.fromEntries(['nodes', 'upload_sessions', 'phone_upload_pairs'].map((name) => {
    const documents = [];
    return [name, {
      documents,
      async findOne(filter) { return documents.find((doc) => matches(doc, filter)) ?? null; },
      async insertOne(doc) {
        if (documents.some((item) => same(item._id, doc._id))) throw Object.assign(new Error('duplicate'), { code: 11000 });
        documents.push(doc);
      },
      async updateOne(filter, update) {
        const doc = documents.find((item) => matches(item, filter));
        if (!doc) return { matchedCount: 0 };
        Object.assign(doc, update.$set ?? {});
        for (const [key, value] of Object.entries(update.$inc ?? {})) doc[key] += value;
        for (const [key, value] of Object.entries(update.$push ?? {})) doc[key] = [...(doc[key] ?? []), ...value.$each].slice(value.$slice);
        return { matchedCount: 1 };
      },
      async findOneAndUpdate(filter, update) {
        const doc = documents.find((item) => matches(item, filter));
        if (!doc) return null;
        Object.assign(doc, update.$set ?? {});
        return doc;
      },
    }];
  }));
  return { collection: (name) => collections[name] };
}
async function setup(t) {
  const app = Fastify();
  const db = fakeDb();
  const cos = {
    async issueUploadCredentials() { return { credentials: { tmpSecretId: 'id', tmpSecretKey: 'key', sessionToken: 'token' }, expiresAt: new Date(Date.now() + 1800000) }; },
    async headObject() { return { headers: { 'content-length': '12' } }; },
  };
  const cfg = { cos: { bucket: 'bucket-123', region: 'ap-chengdu', prefix: 'movehome' } };
  const requireAuth = async (req, reply) => {
    if (!req.headers['x-test-user']) return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
    req.user = { _id: new ObjectId(req.headers['x-test-user']) };
  };
  await app.register(phoneUploadRoutes, { prefix: '/api/v1', db, requireAuth, cos });
  await app.register(uploadRoutes, { prefix: '/api/v1', db, requireAuth, cos, cfg });
  t.after(() => app.close());
  const owner = new ObjectId();
  const other = new ObjectId();
  const parent = new ObjectId();
  db.collection('nodes').documents.push({ _id: parent, userId: owner, type: 'folder', name: '我的旅行', deletedAt: null });
  const send = (method, path, payload, headers = {}) => app.inject({ method, url: `/api/v1/phone-uploads${path}`, payload, headers });
  const create = async () => send('POST', '', { parentId: String(parent) }, { 'x-test-user': String(owner) });
  return { db, cos, owner, other, parent, send, create };
}

test('扫码请求需电脑确认，不能跨目录、跨设备或越权完成其他上传', async (t) => {
  const { db, owner, other, parent, send, create } = await setup(t);
  const created = await create();
  assert.equal(created.statusCode, 201, created.body);
  const { id, secret } = created.json();
  assert.equal((await send('GET', `/active?parentId=${parent}`, undefined, { 'x-test-user': String(owner) })).json().id, id);
  assert.ok(!JSON.stringify(db.collection('phone_upload_pairs').documents).includes(secret));
  const deviceToken = 'x'.repeat(43);
  const join = await send('POST', `/${id}/join`, { secret, deviceToken });
  assert.equal(join.statusCode, 200, join.body);
  const { code } = join.json();
  const auth = { authorization: `Bearer ${deviceToken}` };
  assert.equal((await send('POST', `/${id}/join`, { secret, deviceToken })).json().code, code);
  assert.equal((await send('POST', `/${id}/join`, { secret, deviceToken: 'y'.repeat(43) })).statusCode, 410);
  assert.equal((await send('POST', `/${id}/credentials`, { name: 'a.jpg', size: 12 }, auth)).statusCode, 410);
  assert.equal((await send('POST', `/${id}/approve`, {}, { 'x-test-user': String(other) })).statusCode, 409);
  const waiting = await send('GET', `/${id}`, undefined, { 'x-test-user': String(owner) });
  assert.equal(waiting.json().code, code);
  assert.equal((await send('POST', `/${id}/approve`, {}, { 'x-test-user': String(owner) })).statusCode, 200);
  const active = await send('GET', `/${id}/status`, undefined, auth);
  assert.equal(active.json().folderName, '我的旅行');
  assert.equal((await send('POST', `/${id}/credentials`, { name: 'a.jpg', size: 12 }, {})).statusCode, 403);
  assert.equal((await send('POST', `/${id}/credentials`, { name: 'a.jpg', size: 12, parentId: null }, auth)).statusCode, 400);
  const credentials = await send('POST', `/${id}/credentials`, { name: 'a.jpg', size: 12, mime: 'image/jpeg' }, auth);
  assert.equal(credentials.statusCode, 201, credentials.body);
  const upload = credentials.json();
  assert.equal(String(db.collection('upload_sessions').documents[0].parentId), String(parent));
  const foreign = await send('POST', `/${id}/complete`, { uploadId: String(new ObjectId()) }, auth);
  assert.equal(foreign.statusCode, 404);
  const complete = () => send('POST', `/${id}/complete`, { uploadId: upload.uploadId }, auth);
  assert.equal((await complete()).statusCode, 200);
  assert.equal((await complete()).json().idempotent, true);
  const desktopResult = (await send('GET', `/${id}`, undefined, { 'x-test-user': String(owner) })).json();
  assert.equal(desktopResult.completedCount, 1);
  assert.deepEqual(desktopResult.recentFiles, [{ id: upload.fileId, name: 'a.jpg' }]);
  assert.equal(db.collection('nodes').documents[1].name, 'a.jpg');
  assert.equal((await send('POST', `/${id}/revoke`, {}, { 'x-test-user': String(owner) })).statusCode, 200);
  assert.equal((await complete()).statusCode, 403);
  assert.equal((await send('POST', `/${id}/credentials`, { name: 'b.jpg', size: 12 }, auth)).statusCode, 403);
});

test('无效目录、二维码过期、授权到期和次数上限不签发 COS 凭证', async (t) => {
  const { db, owner, other, send, create } = await setup(t);
  assert.equal((await send('POST', '', { parentId: String(new ObjectId()) }, { 'x-test-user': String(owner) })).statusCode, 404);
  assert.equal((await send('POST', '', { parentId: null }, { 'x-test-user': String(other) })).statusCode, 201);
  const { id, secret } = (await create()).json();
  const pair = db.collection('phone_upload_pairs').documents.find((item) => String(item._id) === id);
  pair.joinUntil = new Date(Date.now() - 1000);
  assert.equal((await send('GET', `/${id}`, undefined, { 'x-test-user': String(owner) })).json().status, 'expired');
  const deviceToken = 'z'.repeat(43);
  assert.equal((await send('POST', `/${id}/join`, { secret, deviceToken })).statusCode, 410);
  pair.joinUntil = new Date(Date.now() + 60000);
  assert.equal((await send('POST', `/${id}/join`, { secret, deviceToken })).statusCode, 200);
  const ownerHeader = { 'x-test-user': String(owner) };
  assert.equal((await send('POST', `/${id}/approve`, {}, ownerHeader)).statusCode, 200);
  const auth = { authorization: `Bearer ${deviceToken}` };
  assert.equal((await send('POST', `/${id}/credentials`, { name: 'huge.jpg', size: 6 * 1024 ** 3 }, auth)).statusCode, 400);
  pair.issuedCount = 100;
  assert.equal((await send('POST', `/${id}/credentials`, { name: 'a.jpg', size: 12 }, auth)).statusCode, 410);
  pair.issuedCount = 0;
  pair.approvedUntil = new Date(Date.now() - 1000);
  assert.equal((await send('POST', `/${id}/credentials`, { name: 'a.jpg', size: 12 }, auth)).statusCode, 410);
});

test('扫码加入后逾期两端一致，COS 凭证失败不耗尽上传额度', async (t) => {
  const { db, cos, owner, send, create } = await setup(t);
  const { id, secret } = (await create()).json();
  const deviceToken = 'w'.repeat(43);
  assert.equal((await send('POST', `/${id}/join`, { secret, deviceToken })).statusCode, 200);
  const pair = db.collection('phone_upload_pairs').documents.find((item) => String(item._id) === id);
  const headers = { 'x-test-user': String(owner) };
  pair.joinUntil = new Date(Date.now() - 1);
  assert.equal((await send('GET', `/${id}`, undefined, headers)).json().status, 'expired');
  assert.equal((await send('GET', `/${id}/status`, undefined, { authorization: `Bearer ${deviceToken}` })).json().status, 'expired');
  pair.joinUntil = new Date(Date.now() + 60000);
  assert.equal((await send('POST', `/${id}/approve`, {}, headers)).statusCode, 200);
  cos.issueUploadCredentials = async () => { throw new Error('COS unavailable'); };
  const result = await send('POST', `/${id}/credentials`, { name: 'a.jpg', size: 12 }, { authorization: `Bearer ${deviceToken}` });
  assert.equal(result.statusCode, 503);
  assert.equal(pair.issuedCount, 0);
});
