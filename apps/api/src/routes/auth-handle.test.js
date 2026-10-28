import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { ObjectId } from 'mongodb';
import authRoutes from './auth.js';

function createApp() {
  const app = Fastify();
  const user = { _id: new ObjectId(), email: 'user@example.invalid', nickname: '旅人', role: 'user', status: 'active', createdAt: new Date() };
  const other = { _id: new ObjectId() };
  const handles = new Map([['taken', other._id]]);
  const db = { collection(name) {
    if (name === 'users') return { updateOne: async (filter, change) => {
      if (String(filter._id) !== String(user._id) || (user.publicHandle ?? null) !== filter.publicHandle) return { matchedCount: 0 };
      Object.assign(user, change.$set); return { matchedCount: 1 };
    } };
    if (name === 'handles') return {
      insertOne: async (doc) => { if (handles.has(doc._id)) { const error = new Error('duplicate'); error.code = 11000; throw error; } handles.set(doc._id, doc.userId); },
      findOne: async ({ _id }) => handles.has(_id) ? { _id, userId: handles.get(_id) } : null,
    };
    return {};
  } };
  return { app, user, handles, async ready() {
    await app.register(authRoutes, { cfg: { isProd: false }, db, tokens: {}, requireAuth: async (req, reply) => {
      if (!req.headers['x-test-user']) return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
      req.user = user;
    } });
    await app.ready();
  }, update(handle) { return app.inject({ method: 'PATCH', url: '/handle', headers: { 'x-test-user': '1' }, payload: { handle } }); } };
}

test('public handle is unique, immutable internally, and old aliases stay reserved', async (t) => {
  const ctx = createApp(); await ctx.ready(); t.after(() => ctx.app.close());
  assert.equal((await ctx.app.inject({ method: 'PATCH', url: '/handle', payload: { handle: 'travel' } })).statusCode, 401);
  assert.equal((await ctx.update('admin')).statusCode, 400);
  assert.equal((await ctx.update('taken')).statusCode, 409);
  assert.equal((await ctx.update('Travel')).statusCode, 400);
  const first = await ctx.update('traveler');
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().user.id, String(ctx.user._id));
  const second = await ctx.update('traveler-next');
  assert.equal(second.statusCode, 200, second.body);
  assert.equal(ctx.handles.has('traveler'), true);
  assert.equal(ctx.handles.get('traveler-next').toString(), String(ctx.user._id));
  assert.equal((await ctx.update('traveler')).statusCode, 200);
});
