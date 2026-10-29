import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { ObjectId } from 'mongodb';
import mapRoutes from './map.js';

function matchesLocation(node) {
  const latitude = node.mediaLocation?.latitude;
  const longitude = node.mediaLocation?.longitude;
  return typeof latitude === 'number' && latitude >= -90 && latitude <= 90 &&
    typeof longitude === 'number' && longitude >= -180 && longitude <= 180;
}

function setup(records = [], { mapServerKey, translate } = {}) {
  const app = Fastify({ logger: false });
  const captures = [];
  const selected = (filter) => records.filter((node) => {
    const allowedMime = new RegExp(filter.$or[0].mime.$regex, filter.$or[0].mime.$options);
    const allowedExtension = new RegExp(filter.$or[1].name.$regex, filter.$or[1].name.$options);
    const media = allowedMime.test(node.mime ?? '') ||
      (node.mime === filter.$or[1].mime && allowedExtension.test(node.name));
    return String(node.userId) === String(filter.userId) && node.type === filter.type &&
      node.status === filter.status && node.deletedAt == null && media &&
      matchesLocation(node) !== Boolean(filter.$nor);
  });
  const nodes = {
    async countDocuments(filter) {
      captures.push({ kind: 'count', filter });
      return selected(filter).length;
    },
    find(filter, options) {
      captures.push({ kind: 'find', filter, options });
      assert.deepEqual(options.projection, {
        parentId: 1, name: 1, mime: 1, size: 1, uploadedAt: 1, createdAt: 1, mediaLocation: 1,
      });
      const rows = selected(filter);
      let offset = 0;
      let limit = Infinity;
      return {
        sort(spec) {
          assert.deepEqual(spec, { uploadedAt: -1, _id: -1 });
          rows.sort((a, b) => +new Date(b.uploadedAt ?? 0) - +new Date(a.uploadedAt ?? 0) ||
            String(b._id).localeCompare(String(a._id)));
          return this;
        },
        skip(value) { offset = value; return this; },
        limit(value) { limit = value; return this; },
        async toArray() { return rows.slice(offset, offset + limit); },
      };
    },
  };
  const requireAuth = (req, reply, done) => {
    const userId = req.headers['x-test-user'];
    if (!userId) return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
    req.user = { _id: new ObjectId(userId) };
    done();
  };
  return {
    app,
    captures,
    ready: () => app.register(mapRoutes, { prefix: '/api/v1', db: { collection: () => nodes }, requireAuth, cfg: { mapServerKey }, translate }),
  };
}

function file(userId, fields = {}) {
  return {
    _id: new ObjectId(), userId, parentId: new ObjectId(), type: 'file', status: 'ready', deletedAt: null,
    name: '旅行照片.jpg', size: 120, mime: 'image/jpeg',
    uploadedAt: new Date('2026-10-27T12:00:00Z'),
    ...fields,
  };
}

function request(ctx, user, path) {
  return ctx.app.inject({ url: `/api/v1/map/${path}`, headers: { 'x-test-user': String(user) } });
}

test('map lists require login and reject invalid pagination without querying the database', async (t) => {
  const ctx = setup();
  await ctx.ready();
  t.after(() => ctx.app.close());
  for (const path of ['points', 'unlocated']) {
    assert.equal((await ctx.app.inject(`/api/v1/map/${path}`)).statusCode, 401);
    const user = new ObjectId();
    for (const query of ['offset=-1', 'offset=100001', 'offset=1.5', 'offset=abc', 'limit=0', 'limit=101', 'limit=abc', 'other=1']) {
      const response = await request(ctx, user, `${path}?${query}`);
      assert.equal(response.statusCode, 400, `${path}?${query}`);
      assert.equal(response.json().error.code, 'INVALID_INPUT');
      assert.equal(response.headers['cache-control'], 'private, no-store');
    }
  }
  assert.equal(ctx.captures.length, 0);
});

test('points show only current user ready active image/video with valid WGS-84 coordinates', async (t) => {
  const owner = new ObjectId();
  const other = new ObjectId();
  const zero = file(owner, { name: '<山谷>.jpg', mediaLocation: { latitude: 0, longitude: 0, source: 'exif', placeName: '赤道' }, cosKey: 'private/key', secret: 'hidden' });
  const edge = file(owner, { name: '边界.MP4', mime: 'video/mp4', mediaLocation: { latitude: -90, longitude: 180, source: 'srt' }, uploadedAt: new Date('2026-10-29T10:00:00Z') });
  const manual = file(owner, { name: '手动位置.jpg', mediaLocation: { latitude: 22, longitude: 114, source: 'manual', placeName: null }, uploadedAt: new Date('2026-10-28T10:00:00Z') });
  const ctx = setup([
    zero, edge, manual, file(other, { mediaLocation: { latitude: 12, longitude: 100, source: 'exif' } }),
    file(owner, { type: 'folder', mediaLocation: { latitude: 1, longitude: 2 } }),
    file(owner, { status: 'pending', mediaLocation: { latitude: 1, longitude: 2 } }),
    file(owner, { deletedAt: new Date(), mediaLocation: { latitude: 1, longitude: 2 } }),
    file(owner, { mime: 'audio/mpeg', mediaLocation: { latitude: 1, longitude: 2 } }),
    file(owner, { mediaLocation: { latitude: 91, longitude: 1 } }),
    file(owner, { mediaLocation: { latitude: 1, longitude: Number.NaN } }),
    file(owner, { mediaLocation: { latitude: '1', longitude: 2 } }),
  ]);
  await ctx.ready();
  t.after(() => ctx.app.close());
  const response = await request(ctx, owner, 'points?offset=1&limit=1');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.deepEqual(response.json(), {
    total: 3, offset: 1, limit: 1, mapStatus: 'not_configured',
    items: [{ id: String(manual._id), parentId: String(manual.parentId), name: manual.name,
      mime: manual.mime, size: manual.size, uploadedAt: manual.uploadedAt.toISOString(),
      location: { latitude: 22, longitude: 114, placeName: null, source: 'manual' } }],
  });
  const all = (await request(ctx, owner, 'points?limit=100')).json();
  assert.deepEqual(all.items.map((item) => item.id), [edge, manual, zero].map((item) => String(item._id)));
  assert.deepEqual(all.items[2].location, { latitude: 0, longitude: 0, placeName: '赤道', source: 'exif' });
  assert.ok(!JSON.stringify(all).includes('private/key'));
  assert.ok(!JSON.stringify(all).includes('hidden'));
  assert.ok(ctx.captures.every(({ filter }) => String(filter.userId) === String(owner)));
});

test('unlocated includes missing, null and incomplete locations, but excludes other media and deleted files', async (t) => {
  const owner = new ObjectId();
  const missing = file(owner, { name: '无 GPS.jpg', mediaLocation: null });
  const incomplete = file(owner, { name: '部分位置.MP4', mime: 'video/mp4', mediaLocation: { latitude: 20 } });
  const invalid = file(owner, { name: '无效位置.jpg', mediaLocation: { latitude: Infinity, longitude: 1 } });
  const absent = file(owner, { name: '旧素材.jpg' });
  const ctx = setup([
    missing, incomplete, invalid, absent,
    file(owner, { mediaLocation: { latitude: 10, longitude: 20, source: 'exif' } }),
    file(owner, { mime: 'audio/wav' }), file(owner, { type: 'folder' }),
    file(owner, { deletedAt: new Date() }), file(new ObjectId()),
  ]);
  await ctx.ready();
  t.after(() => ctx.app.close());
  const response = await request(ctx, owner, 'unlocated?limit=2');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.equal(response.json().total, 4);
  assert.equal(response.json().items.length, 2);
  const secondPage = (await request(ctx, owner, 'unlocated?offset=2&limit=2')).json();
  assert.equal(secondPage.total, 4);
  assert.deepEqual(new Set([...response.json().items, ...secondPage.items].map((item) => item.id)),
    new Set([missing, incomplete, invalid, absent].map((item) => String(item._id))));
  assert.ok([...response.json().items, ...secondPage.items].every((item) => !Object.hasOwn(item, 'location')));
});

test('empty account returns zero totals and default pagination for both lists', async (t) => {
  const ctx = setup();
  await ctx.ready();
  t.after(() => ctx.app.close());
  for (const path of ['points', 'unlocated']) {
    assert.deepEqual((await request(ctx, new ObjectId(), path)).json(),
      { items: [], total: 0, offset: 0, limit: 50, ...(path === 'points' ? { mapStatus: 'not_configured' } : {}) });
  }
});

test('octet-stream JPEG/MP4 with clear extensions participate and array coordinates never become points', async (t) => {
  const owner = new ObjectId();
  const gps = file(owner, { name: 'DJI_1.MP4', mime: 'application/octet-stream', mediaLocation: { latitude: 28, longitude: 100, source: 'srt' } });
  const array = file(owner, { mediaLocation: { latitude: [28], longitude: [100] } });
  const missing = file(owner, { name: '无位置.JPG', mime: 'application/octet-stream' });
  const ctx = setup([gps, array, missing, file(owner, { name: 'other.txt', mime: 'application/octet-stream' })]);
  await ctx.ready();
  t.after(() => ctx.app.close());
  assert.deepEqual((await request(ctx, owner, 'points')).json().items.map((item) => item.id), [String(gps._id)]);
  assert.deepEqual(new Set((await request(ctx, owner, 'unlocated')).json().items.map((item) => item.id)),
    new Set([String(array._id), String(missing._id)]));
  assert.ok(ctx.captures.some(({ filter }) => filter.$expr?.$and?.some((part) => part.$isNumber === '$mediaLocation.latitude')));
});

test('points carry converted map coordinates only on successful server-side translation', async (t) => {
  const owner = new ObjectId();
  const gps = file(owner, { mediaLocation: { latitude: 28.48, longitude: 100.3, source: 'exif' } });
  const ctx = setup([gps], { mapServerKey: 'server-only', translate: async (points, key) => {
    assert.equal(key, 'server-only');
    assert.deepEqual(points, [{ latitude: 28.48, longitude: 100.3, placeName: null, source: 'exif' }]);
    return [{ latitude: 28.482, longitude: 100.306 }];
  } });
  await ctx.ready();
  t.after(() => ctx.app.close());
  const response = await request(ctx, owner, 'points');
  assert.equal(response.json().mapStatus, 'ready');
  assert.deepEqual(response.json().items[0].mapLocation, { latitude: 28.482, longitude: 100.306 });
  assert.ok(!response.body.includes('server-only'));
});

test('failed coordinate translation never marks raw GPS points as GCJ-02', async (t) => {
  const owner = new ObjectId();
  const ctx = setup([file(owner, { mediaLocation: { latitude: 28, longitude: 100 } })], {
    mapServerKey: 'server-only', translate: async () => { throw new Error('remote unavailable'); },
  });
  await ctx.ready();
  t.after(() => ctx.app.close());
  const response = (await request(ctx, owner, 'points')).json();
  assert.equal(response.mapStatus, 'unavailable');
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0].mapLocation, undefined);
});
