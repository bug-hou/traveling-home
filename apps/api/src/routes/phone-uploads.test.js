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
      if ('$lte' in value) return doc[key] <= value.$lte;
      if ('$in' in value) return value.$in.includes(doc[key]);
    }
    return same(doc[key], value);
  });
}
function fakeDb() {
  const collections = Object.fromEntries(['nodes', 'upload_sessions', 'phone_upload_pairs', 'notes', 'note_read_pairs'].map((name) => {
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
        for (const key of Object.keys(update.$unset ?? {})) delete doc[key];
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
async function setup(t, phoneUploadsEnabled = true) {
  const app = Fastify();
  const db = fakeDb();
  const objects = new Map();
  const cos = {
    objects,
    issuedKeys: [],
    async issueUploadCredentials({ key }) {
      this.issuedKeys.push(key);
      return { credentials: { tmpSecretId: 'id', tmpSecretKey: 'key', sessionToken: 'token' }, expiresAt: new Date(Date.now() + 1800000) };
    },
    async headObject(key) {
      const content = objects.get(key) ?? 'original';
      return { headers: { 'content-length': '12', etag: content === 'original'
        ? '"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"' : '"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"' }, content };
    },
    async promoteObject({ sourceKey, key }) { objects.set(key, objects.get(sourceKey) ?? 'original'); },
    async deleteObject(key) { objects.delete(key); },
  };
  const cfg = { cos: { bucket: 'bucket-123', region: 'ap-chengdu', prefix: 'movehome' }, phoneUploadsEnabled };
  const requireAuth = async (req, reply) => {
    if (!req.headers['x-test-user']) return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
    req.user = { _id: new ObjectId(req.headers['x-test-user']) };
  };
  await app.register(phoneUploadRoutes, { prefix: '/api/v1', cfg, db, requireAuth, cos });
  await app.register(uploadRoutes, { prefix: '/api/v1', db, requireAuth, cos, cfg });
  t.after(() => app.close());
  const owner = new ObjectId();
  const other = new ObjectId();
  const parent = new ObjectId();
  db.collection('nodes').documents.push({ _id: parent, userId: owner, type: 'folder', name: '我的旅行', deletedAt: null });
  const send = (method, path, payload, headers = {}) => app.inject({ method, url: `/api/v1/phone-uploads${path}`, payload, headers });
  const create = async () => send('POST', '', { parentId: String(parent) }, { 'x-test-user': String(owner) });
  return { app, db, cos, owner, other, parent, send, create };
}

async function startPairedUpload(context) {
  const { owner, send, create } = context;
  const { id, secret } = (await create()).json();
  const deviceToken = 'z'.repeat(43);
  assert.equal((await send('POST', `/${id}/join`, { secret, deviceToken })).statusCode, 200);
  assert.equal((await send('POST', `/${id}/approve`, {}, { 'x-test-user': String(owner) })).statusCode, 200);
  const auth = { authorization: `Bearer ${deviceToken}` };
  const response = await send('POST', `/${id}/credentials`, { name: 'a.jpg', size: 12 }, auth);
  assert.equal(response.statusCode, 201, response.body);
  return { id, auth, upload: response.json(), complete: () => send('POST', `/${id}/complete`, { uploadId: response.json().uploadId }, auth) };
}

test('禁用手机上传时不暴露任一手机接口，笔记配对及普通上传仍可用', async (t) => {
  const { app, owner, send } = await setup(t, false);
  const headers = { 'x-test-user': String(owner) };
  const id = String(new ObjectId());
  for (const [method, path] of [
    ['POST', ''], ['GET', '/active'], ['GET', `/${id}`],
    ['POST', `/${id}/approve`], ['POST', `/${id}/revoke`], ['POST', `/${id}/join`],
    ['GET', `/${id}/status`], ['POST', `/${id}/credentials`], ['POST', `/${id}/complete`],
  ]) {
    assert.equal((await send(method, path, {}, headers)).statusCode, 404, `${method} ${path}`);
  }
  const notePair = await app.inject({ method: 'POST', url: '/api/v1/note-pairs', payload: { noteId: id }, headers });
  assert.equal(notePair.json().error?.code, 'NOTE_NOT_FOUND');
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/uploads/credentials', payload: { name: 'a.jpg', size: 1 }, headers })).statusCode, 201);
});

test('扫码请求需电脑确认，不能跨目录、跨设备或越权完成其他上传', async (t) => {
  const { app, db, cos, owner, other, parent, send, create } = await setup(t);
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
  assert.match(upload.key, new RegExp(`^movehome/users/${owner}/incoming/${id}/${upload.uploadId}\\.jpg$`));
  assert.deepEqual(cos.issuedKeys, [upload.key]);
  cos.objects.set(upload.key, 'original');
  const bypass = await app.inject({ method: 'POST', url: '/api/v1/uploads/complete',
    payload: { uploadId: upload.uploadId }, headers: { 'x-test-user': String(owner) } });
  assert.equal(bypass.statusCode, 404);
  const foreign = await send('POST', `/${id}/complete`, { uploadId: String(new ObjectId()) }, auth);
  assert.equal(foreign.statusCode, 404);
  const complete = () => send('POST', `/${id}/complete`, { uploadId: upload.uploadId }, auth);
  assert.equal((await complete()).statusCode, 200);
  assert.equal((await complete()).json().idempotent, true);
  const desktopResult = (await send('GET', `/${id}`, undefined, { 'x-test-user': String(owner) })).json();
  assert.equal(desktopResult.completedCount, 1);
  assert.deepEqual(desktopResult.recentFiles, [{ id: upload.fileId, name: 'a.jpg' }]);
  assert.equal(db.collection('nodes').documents[1].name, 'a.jpg');
  const finalKey = db.collection('nodes').documents[1].cosKey;
  assert.notEqual(finalKey, upload.key);
  assert.match(finalKey, new RegExp(`^movehome/users/${owner}/originals/`));
  assert.equal(cos.objects.get(finalKey), 'original');
  assert.equal((await send('POST', `/${id}/revoke`, {}, { 'x-test-user': String(owner) })).statusCode, 200);
  cos.objects.set(upload.key, 'overwritten');
  assert.equal(cos.objects.get(finalKey), 'original');
  assert.equal((await complete()).statusCode, 403);
  assert.equal((await send('POST', `/${id}/credentials`, { name: 'b.jpg', size: 12 }, auth)).statusCode, 403);
});

test('旧版直写会话与复制源变化不能登记，重试使用不同目标 Key', async (t) => {
  const context = await setup(t);
  const { db, cos } = context;
  const { upload, complete } = await startPairedUpload(context);
  const session = db.collection('upload_sessions').documents[0];
  const stagingKey = session.stagingKey;
  session.stagingKey = undefined;
  assert.equal((await complete()).json().error.code, 'UPLOAD_SESSION_UNSAFE');
  session.stagingKey = stagingKey;
  cos.objects.set(stagingKey, 'original');
  const keys = [];
  cos.promoteObject = async ({ sourceKey, key }) => {
    keys.push(key);
    cos.objects.set(key, cos.objects.get(sourceKey));
    if (keys.length === 1) cos.objects.set(sourceKey, 'overwritten');
  };
  const failed = await complete();
  assert.equal(failed.statusCode, 503);
  assert.equal(cos.objects.has(keys[0]), false);
  assert.equal(db.collection('nodes').documents.length, 1);
  assert.equal(session.status, 'pending');
  const retry = await complete();
  assert.equal(retry.statusCode, 200, retry.body);
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
  assert.equal(db.collection('nodes').documents[1].cosKey, keys[1]);
  assert.notEqual(db.collection('nodes').documents[1].cosKey, upload.key);
});

test('复制故障可重试，过期的晋升租约不会覆盖随后发布的对象', async (t) => {
  const context = await setup(t);
  const { db, cos } = context;
  const { complete } = await startPairedUpload(context);
  const session = db.collection('upload_sessions').documents[0];
  const original = cos.promoteObject;
  cos.promoteObject = async () => { throw new Error('COS unavailable'); };
  assert.equal((await complete()).statusCode, 503);
  assert.equal(session.status, 'pending');
  session.status = 'promoting';
  session.promotionId = 'stale';
  session.promotionUntil = new Date(Date.now() - 1);
  cos.promoteObject = original;
  assert.equal((await complete()).statusCode, 200);
  assert.equal(session.status, 'completed');
  const published = db.collection('nodes').documents[1].cosKey;
  assert.notEqual(published, session.stagingKey);
  assert.equal((await complete()).json().idempotent, true);
  assert.equal(db.collection('nodes').documents[1].cosKey, published);
});

test('撤销发生在复制中时不登记新文件，并发登记只允许一次复制', async (t) => {
  const context = await setup(t);
  const { db, cos, owner, send } = context;
  const { id, complete } = await startPairedUpload(context);
  let started;
  const copying = new Promise((resolve) => { started = resolve; });
  let unblock;
  const blocked = new Promise((resolve) => { unblock = resolve; });
  cos.promoteObject = async () => { started(); await blocked; };
  const first = complete();
  await copying;
  assert.equal((await complete()).json().error.code, 'UPLOAD_IN_PROGRESS');
  const revocation = send('POST', `/${id}/revoke`, {}, { 'x-test-user': String(owner) });
  while (db.collection('phone_upload_pairs').documents[0].status !== 'revoked') {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(db.collection('phone_upload_pairs').documents[0].activePromotions, 1);
  unblock();
  assert.equal((await first).statusCode, 410);
  assert.equal((await revocation).statusCode, 200);
  assert.equal(db.collection('phone_upload_pairs').documents[0].activePromotions, 0);
  assert.equal(db.collection('nodes').documents.length, 1);
});

test('撤销必须等待最终节点登记完毕才能确认成功', async (t) => {
  const context = await setup(t);
  const { db, owner, send } = context;
  const { id, complete } = await startPairedUpload(context);
  const nodes = db.collection('nodes');
  const originalInsert = nodes.insertOne;
  let pauseInsert;
  const inserting = new Promise((resolve) => { pauseInsert = resolve; });
  let resumeInsert;
  const blocked = new Promise((resolve) => { resumeInsert = resolve; });
  nodes.insertOne = async (document) => { pauseInsert(); await blocked; return originalInsert(document); };
  const registration = complete();
  await inserting;
  let revokeFinished = false;
  const revocation = send('POST', `/${id}/revoke`, {}, { 'x-test-user': String(owner) })
    .then((response) => { revokeFinished = true; return response; });
  while (db.collection('phone_upload_pairs').documents[0].status !== 'revoked') {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(revokeFinished, false);
  resumeInsert();
  assert.equal((await registration).statusCode, 200);
  assert.equal((await revocation).statusCode, 200);
  assert.equal(nodes.documents.length, 2);
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

test('笔记扫码须持有二维码、设备令牌并由所属用户批准才可读取指定正文', async (t) => {
  const { app, db, owner, other, send } = await setup(t);
  const first = { _id: new ObjectId(), userId: owner, deletedAt: null, title: '第一条', content: '私密正文' };
  const second = { _id: new ObjectId(), userId: owner, deletedAt: null, title: '第二条', content: '其他正文' };
  db.collection('notes').documents.push(first, second);
  const request = (method, path, payload, headers = {}) => app.inject({ method, url: `/api/v1/note-pairs${path}`, payload, headers });
  const ownerHeader = { 'x-test-user': String(owner) };
  const otherHeader = { 'x-test-user': String(other) };
  assert.equal((await request('POST', '', { noteId: String(first._id) })).statusCode, 401);
  assert.equal((await request('POST', '', { noteId: String(first._id) }, otherHeader)).statusCode, 404);
  const created = await request('POST', '', { noteId: String(first._id) }, ownerHeader);
  assert.equal(created.statusCode, 201, created.body);
  const { id, secret } = created.json();
  const pair = db.collection('note_read_pairs').documents[0];
  assert.ok(!JSON.stringify(pair).includes(secret));
  assert.equal((await request('GET', `/active?noteId=${first._id}`, undefined, ownerHeader)).json().id, id);
  assert.equal((await request('GET', `/active?noteId=${first._id}`, undefined, otherHeader)).statusCode, 404);
  assert.equal((await request('GET', `/active?noteId=${second._id}`, undefined, ownerHeader)).json().id, null);
  const deviceToken = 'a'.repeat(43);
  const bearer = { authorization: `Bearer ${deviceToken}` };
  assert.equal((await request('POST', `/${id}/join`, { secret: 'b'.repeat(43), deviceToken })).statusCode, 410);
  const joined = await request('POST', `/${id}/join`, { secret, deviceToken });
  assert.equal(joined.statusCode, 200, joined.body);
  assert.match(joined.json().code, /^\d{6}$/);
  assert.equal((await request('POST', `/${id}/join`, { secret, deviceToken })).json().code, joined.json().code);
  assert.equal((await request('POST', `/${id}/join`, { secret, deviceToken: 'c'.repeat(43) })).statusCode, 410);
  assert.equal((await request('GET', `/${id}/note`, undefined, bearer)).statusCode, 410);
  assert.equal((await request('GET', `/${id}`, undefined, otherHeader)).statusCode, 404);
  assert.equal((await request('POST', `/${id}/approve`, {}, otherHeader)).statusCode, 404);
  assert.equal((await request('GET', `/${id}`, undefined, ownerHeader)).json().code, joined.json().code);
  assert.equal((await request('POST', `/${id}/approve`, {}, ownerHeader)).statusCode, 200);
  assert.equal(pair.noteSnapshot.content, '私密正文');
  assert.equal(pair.expiresAt.getTime(), pair.approvedUntil.getTime());
  assert.equal((await request('POST', `/${id}/approve`, {}, ownerHeader)).statusCode, 409);
  assert.equal((await request('GET', `/active?noteId=${first._id}`, undefined, ownerHeader)).json().id, id);
  assert.equal((await request('GET', `/${id}/status`, undefined, bearer)).json().status, 'approved');
  first.title = '批准后的新标题'; first.content = '批准后新增的敏感段落';
  const read = await request('GET', `/${id}/note`, undefined, bearer);
  assert.equal(read.statusCode, 200, read.body);
  assert.match(read.headers['cache-control'], /no-store/);
  assert.equal(read.json().note.content, '私密正文');
  assert.equal(read.json().note.title, '第一条');
  assert.ok(!read.body.includes('批准后新增的敏感段落'));
  assert.ok(!read.body.includes('其他正文'));
  assert.equal((await request('GET', `/${id}/note`, undefined, { authorization: `Bearer ${'d'.repeat(43)}` })).statusCode, 403);
  assert.equal((await send('POST', `/${id}/credentials`, { name: 'a.jpg', size: 12 }, bearer)).statusCode, 403);
  assert.equal((await request('POST', `/${id}/revoke`, {}, ownerHeader)).statusCode, 200);
  assert.equal(pair.noteSnapshot, undefined);
  assert.equal((await request('GET', `/active?noteId=${first._id}`, undefined, ownerHeader)).json().id, null);
  assert.equal((await request('GET', `/${id}/note`, undefined, bearer)).statusCode, 403);
});

test('笔记配对的二维码过期、授权过期和笔记删除均禁止移动设备读取', async (t) => {
  const { app, db, owner } = await setup(t);
  const note = { _id: new ObjectId(), userId: owner, deletedAt: null, title: '记录', content: '仅用于当前设备' };
  db.collection('notes').documents.push(note);
  const request = (method, path, payload, headers = {}) => app.inject({ method, url: `/api/v1/note-pairs${path}`, payload, headers });
  const ownerHeader = { 'x-test-user': String(owner) };
  const created = (await request('POST', '', { noteId: String(note._id) }, ownerHeader)).json();
  const pair = db.collection('note_read_pairs').documents[0];
  const deviceToken = 'e'.repeat(43);
  const bearer = { authorization: `Bearer ${deviceToken}` };
  pair.joinUntil = new Date(Date.now() - 1);
  assert.equal((await request('POST', `/${created.id}/join`, { secret: created.secret, deviceToken })).statusCode, 410);
  pair.joinUntil = new Date(Date.now() + 60_000);
  assert.equal((await request('POST', `/${created.id}/join`, { secret: created.secret, deviceToken })).statusCode, 200);
  pair.joinUntil = new Date(Date.now() - 1);
  assert.equal((await request('POST', `/${created.id}/approve`, {}, ownerHeader)).statusCode, 409);
  pair.joinUntil = new Date(Date.now() + 60_000);
  assert.equal((await request('POST', `/${created.id}/approve`, {}, ownerHeader)).statusCode, 200);
  pair.approvedUntil = new Date(Date.now() - 1);
  assert.equal((await request('GET', `/${created.id}/status`, undefined, bearer)).json().status, 'expired');
  assert.equal((await request('GET', `/${created.id}/note`, undefined, bearer)).statusCode, 410);
  pair.approvedUntil = new Date(Date.now() + 60_000);
  note.deletedAt = new Date();
  assert.equal((await request('GET', `/${created.id}/note`, undefined, bearer)).statusCode, 404);
});
