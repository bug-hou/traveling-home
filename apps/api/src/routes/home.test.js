import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { ObjectId } from 'mongodb';
import homeRoutes from './home.js';

function setup({ records = [], failStorage = false, failFiles = false } = {}) {
  const app = Fastify({ logger: false });
  const captures = [];
  const activeFor = (filter) => records.filter((record) =>
    String(record.userId) === String(filter.userId) &&
    record.type === filter.type && record.status === filter.status && record.deletedAt == null,
  );
  const db = { collection: () => ({
    aggregate(stages) {
      captures.push(stages);
      if (failStorage) throw new Error('storage unavailable');
      const files = activeFor(stages[0].$match);
      const bytes = (predicate) => files.filter(predicate).reduce((sum, file) => sum + (file.size ?? 0), 0);
      return { toArray: async () => files.length ? [{
        count: files.length,
        usedBytes: bytes(() => true),
        videoBytes: bytes((file) => file.mime?.startsWith('video/')),
        imageBytes: bytes((file) => file.mime?.startsWith('image/')),
        audioBytes: bytes((file) => file.mime?.startsWith('audio/')),
      }] : [] };
    },
    async countDocuments(filter) {
      if (failFiles) throw new Error('files unavailable');
      return activeFor(filter).length;
    },
    find(filter, options) {
      assert.deepEqual(options.projection, { name: 1, mime: 1, size: 1, uploadedAt: 1, createdAt: 1 });
      const files = activeFor(filter);
      return {
        sort(spec) {
          assert.deepEqual(spec, { uploadedAt: -1, _id: -1 });
          files.sort((left, right) => (+new Date(right.uploadedAt ?? 0) - +new Date(left.uploadedAt ?? 0)) ||
            String(right._id).localeCompare(String(left._id)));
          return this;
        },
        limit(value) {
          this.count = value;
          return this;
        },
        async toArray() {
          if (failFiles) throw new Error('files unavailable');
          return files.slice(0, this.count);
        },
      };
    },
  }) };
  const requireAuth = (req, reply, done) => {
    const id = req.headers['x-test-user'];
    if (!id) return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
    req.user = { _id: new ObjectId(id) };
    done();
  };
  return { app, captures, ready: () => app.register(homeRoutes, { prefix: '/api/v1', db, requireAuth }) };
}

function record(userId, patch = {}) {
  return {
    _id: new ObjectId(), userId, parentId: new ObjectId(), type: 'file', status: 'ready', deletedAt: null,
    name: 'picture.jpg', mime: 'image/jpeg', size: 150, uploadedAt: new Date('2026-10-27T12:00:00Z'),
    ...patch,
  };
}

test('summary requires authentication and validates recentLimit', async (t) => {
  const ctx = setup();
  await ctx.ready();
  t.after(() => ctx.app.close());
  assert.equal((await ctx.app.inject('/api/v1/home/summary')).statusCode, 401);
  const user = new ObjectId();
  for (const query of ['recentLimit=0', 'recentLimit=9', 'recentLimit=abc', 'other=1']) {
    const result = await ctx.app.inject({ url: `/api/v1/home/summary?${query}`, headers: { 'x-test-user': String(user) } });
    assert.equal(result.statusCode, 400);
  }
  assert.equal(ctx.captures.length, 0);
});

test('summary isolates users, excludes folders and trash, sorts recent files and returns honest statuses', async (t) => {
  const owner = new ObjectId();
  const other = new ObjectId();
  const old = record(owner, { mime: 'video/mp4', size: 800, uploadedAt: new Date('2026-10-27T09:00:00Z') });
  const newest = record(owner, { name: 'latest.jpg', uploadedAt: new Date('2026-10-28T09:00:00Z'), cosKey: 'secret' });
  const ctx = setup({ records: [old, newest, record(owner, { type: 'folder', size: 0 }), record(other, { size: 9000 }), record(owner, { deletedAt: new Date() }), record(owner, { status: 'pending' })] });
  await ctx.ready();
  t.after(() => ctx.app.close());
  const response = await ctx.app.inject({ url: '/api/v1/home/summary?recentLimit=1', headers: { 'x-test-user': String(owner) } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  const body = response.json();
  assert.equal(body.storage.usedBytes, 950);
  assert.deepEqual(body.storage.breakdown, { videoBytes: 800, imageBytes: 150, audioBytes: 0, otherBytes: 0 });
  assert.equal(body.storage.quotaBytes, null);
  assert.equal(body.files.totalFiles, 2);
  assert.equal(body.files.recent.length, 1);
  assert.equal(body.files.recent[0].id, String(newest._id));
  assert.equal(body.files.recent[0].thumbnailUrl, null);
  assert.equal(body.footprint.status, 'not_ready');
  assert.equal(body.footprint.countyCount, null);
  assert.equal(body.trips.status, 'not_ready');
  assert.equal(body.trips.count, null);
  assert.ok(!response.body.includes('secret'));
  assert.equal(String(ctx.captures[0][0].$match.userId), String(owner));
});

test('summary distinguishes empty collections from independently unavailable modules', async (t) => {
  const owner = new ObjectId();
  const empty = setup();
  await empty.ready();
  t.after(() => empty.app.close());
  const response = await empty.app.inject({ url: '/api/v1/home/summary', headers: { 'x-test-user': String(owner) } });
  assert.equal(response.json().storage.status, 'empty');
  assert.equal(response.json().storage.usedBytes, 0);
  assert.equal(response.json().files.status, 'empty');
  assert.equal(response.json().files.totalFiles, 0);

  const partial = setup({ records: [record(owner)], failStorage: true });
  await partial.ready();
  t.after(() => partial.app.close());
  const result = await partial.app.inject({ url: '/api/v1/home/summary', headers: { 'x-test-user': String(owner) } });
  assert.equal(result.json().storage.status, 'unavailable');
  assert.equal(result.json().storage.usedBytes, null);
  assert.equal(result.json().files.status, 'ready');
  assert.equal(result.json().files.totalFiles, 1);
});
