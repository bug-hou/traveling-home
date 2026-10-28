import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { fail, parseBody } from '../lib/http.js';
import { dummyVerify, hashPassword, verifyPassword } from '../lib/password.js';
import { hashToken, newRefreshToken } from '../lib/tokens.js';
import { ACCESS_COOKIE } from '../plugins/auth.js';

const REFRESH_COOKIE = 'mh_rt';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
// 并发刷新（如多个标签页同时刷新）时，旧令牌在此窗口内被重复使用不视为被盗
const REUSE_GRACE_MS = 10_000;

const email = z.string().trim().toLowerCase().email().max(254);
const newPassword = z.string().min(8, '密码至少 8 位').max(128, '密码最长 128 位');

const registerBody = z
  .object({
    email,
    password: newPassword,
    nickname: z.string().trim().min(1).max(30).optional(),
  })
  .refine((v) => v.password.toLowerCase() !== v.email, {
    message: '密码不能与邮箱相同',
    path: ['password'],
  });

const loginBody = z.object({
  email,
  password: z.string().min(1).max(128),
});

const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword,
});

function publicUser(user) {
  return {
    id: String(user._id),
    email: user.email,
    nickname: user.nickname,
    role: user.role,
    createdAt: user.createdAt,
  };
}

export default async function authRoutes(app, { cfg, db, tokens, requireAuth }) {
  const users = db.collection('users');
  const sessions = db.collection('sessions');

  const cookieBase = { httpOnly: true, secure: cfg.isProd, sameSite: 'lax' };

  function setAuthCookies(reply, accessToken, refreshToken) {
    reply.setCookie(ACCESS_COOKIE, accessToken, {
      ...cookieBase,
      path: '/',
      maxAge: cfg.accessTtlSeconds,
    });
    reply.setCookie(REFRESH_COOKIE, refreshToken, {
      ...cookieBase,
      path: REFRESH_COOKIE_PATH,
      maxAge: cfg.refreshTtlDays * 86400,
    });
  }

  function clearAuthCookies(reply) {
    reply.clearCookie(ACCESS_COOKIE, { ...cookieBase, path: '/' });
    reply.clearCookie(REFRESH_COOKIE, { ...cookieBase, path: REFRESH_COOKIE_PATH });
  }

  // 创建一条新会话（刷新令牌），同一登录链路共用 familyId，便于整链吊销
  async function issueSession(req, reply, user, familyId = new ObjectId()) {
    const refreshToken = newRefreshToken();
    const now = new Date();
    await sessions.insertOne({
      userId: user._id,
      familyId,
      tokenHash: hashToken(refreshToken),
      createdAt: now,
      expiresAt: new Date(now.getTime() + cfg.refreshTtlDays * 86400_000),
      revokedAt: null,
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200),
      ip: req.ip,
    });
    const accessToken = await tokens.signAccess(user);
    setAuthCookies(reply, accessToken, refreshToken);
  }

  const revokeFamily = (familyId) =>
    sessions.updateMany({ familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });

  // 注册
  app.post(
    '/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const body = parseBody(registerBody, req.body, reply);
      if (!body) return;

      const existingCount = await users.estimatedDocumentCount();
      if (existingCount > 0 && !cfg.allowRegistration) {
        return fail(reply, 403, 'REGISTRATION_CLOSED', '暂未开放注册');
      }

      const now = new Date();
      const user = {
        email: body.email,
        passwordHash: await hashPassword(body.password),
        nickname: body.nickname ?? body.email.split('@')[0],
        // 首位注册用户为管理员
        role: existingCount === 0 ? 'admin' : 'user',
        status: 'active',
        // 预留：空间配额（null 表示不限制）
        quotaBytes: null,
        usedBytes: 0,
        failedLogins: 0,
        lockedUntil: null,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      };

      try {
        const { insertedId } = await users.insertOne(user);
        user._id = insertedId;
      } catch (err) {
        if (err?.code === 11000) return fail(reply, 409, 'EMAIL_TAKEN', '该邮箱已注册');
        throw err;
      }

      await issueSession(req, reply, user);
      return reply.code(201).send({ user: publicUser(user) });
    },
  );

  // 登录
  app.post(
    '/login',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const body = parseBody(loginBody, req.body, reply);
      if (!body) return;

      const invalid = () => fail(reply, 401, 'INVALID_CREDENTIALS', '邮箱或密码不正确');
      const user = await users.findOne({ email: body.email });

      if (!user) {
        await dummyVerify(body.password);
        return invalid();
      }

      if (user.lockedUntil && user.lockedUntil > new Date()) {
        return fail(reply, 429, 'TOO_MANY_ATTEMPTS', '尝试次数过多，请稍后再试');
      }

      const ok = await verifyPassword(user.passwordHash, body.password);
      if (!ok) {
        const after = await users.findOneAndUpdate(
          { _id: user._id },
          { $inc: { failedLogins: 1 } },
          { returnDocument: 'after' },
        );
        if (after && after.failedLogins >= MAX_FAILED_LOGINS) {
          await users.updateOne(
            { _id: user._id },
            {
              $set: {
                failedLogins: 0,
                lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000),
              },
            },
          );
        }
        return invalid();
      }

      if (user.status !== 'active') {
        return fail(reply, 403, 'ACCOUNT_DISABLED', '账号已被停用');
      }

      const now = new Date();
      await users.updateOne(
        { _id: user._id },
        { $set: { failedLogins: 0, lockedUntil: null, lastLoginAt: now, updatedAt: now } },
      );

      await issueSession(req, reply, user);
      return { user: publicUser(user) };
    },
  );

  // 刷新：旋转刷新令牌，并检测旧令牌被重复使用
  app.post(
    '/refresh',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const token = req.cookies[REFRESH_COOKIE];
      if (!token) return fail(reply, 401, 'UNAUTHORIZED', '请先登录');

      const tokenHash = hashToken(token);
      const now = new Date();

      const current = await sessions.findOneAndUpdate(
        { tokenHash, revokedAt: null, expiresAt: { $gt: now } },
        { $set: { revokedAt: now, rotatedAt: now } },
        { returnDocument: 'before' },
      );

      if (!current) {
        const stale = await sessions.findOne({ tokenHash });
        if (stale?.revokedAt) {
          // 刚被旋转掉的旧令牌：大概率是并发刷新，让前端稍后重试，不动 Cookie
          if (stale.rotatedAt && now - stale.rotatedAt <= REUSE_GRACE_MS) {
            return fail(reply, 409, 'REFRESH_IN_PROGRESS', '会话刷新中，请重试');
          }
          // 已失效的旧令牌被再次使用：视为泄露，吊销整条链路
          await revokeFamily(stale.familyId);
        }
        clearAuthCookies(reply);
        return fail(reply, 401, 'UNAUTHORIZED', '登录已失效，请重新登录');
      }

      const user = await users.findOne({ _id: current.userId });
      if (!user || user.status !== 'active') {
        await revokeFamily(current.familyId);
        clearAuthCookies(reply);
        return fail(reply, 401, 'UNAUTHORIZED', '登录已失效，请重新登录');
      }

      await issueSession(req, reply, user, current.familyId);
      return { user: publicUser(user) };
    },
  );

  // 退出：吊销当前登录链路
  app.post('/logout', async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (token) {
      const session = await sessions.findOne({ tokenHash: hashToken(token) });
      if (session) await revokeFamily(session.familyId);
    }
    clearAuthCookies(reply);
    return reply.code(204).send();
  });

  // 修改密码：成功后吊销所有设备的会话，并为当前设备签发新会话
  app.post(
    '/change-password',
    { preHandler: requireAuth, config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const body = parseBody(changePasswordBody, req.body, reply);
      if (!body) return;

      const user = req.user;
      const ok = await verifyPassword(user.passwordHash, body.currentPassword);
      if (!ok) return fail(reply, 400, 'WRONG_PASSWORD', '当前密码不正确');
      if (body.newPassword === body.currentPassword) {
        return fail(reply, 400, 'SAME_PASSWORD', '新密码不能与当前密码相同');
      }

      await users.updateOne(
        { _id: user._id },
        { $set: { passwordHash: await hashPassword(body.newPassword), updatedAt: new Date() } },
      );
      await sessions.updateMany(
        { userId: user._id, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );

      await issueSession(req, reply, user);
      return { ok: true };
    },
  );

  // 当前用户
  app.get('/me', { preHandler: requireAuth }, async (req) => ({ user: publicUser(req.user) }));
}
