import { ObjectId } from 'mongodb';
import { fail } from '../lib/http.js';

export const ACCESS_COOKIE = 'mh_at';

// 返回一个 preHandler：校验访问令牌，并确认账号仍然有效
export function createAuthGuard({ db, tokens }) {
  const users = db.collection('users');

  return async function requireAuth(req, reply) {
    const token = req.cookies[ACCESS_COOKIE];
    if (!token) return fail(reply, 401, 'UNAUTHORIZED', '请先登录');

    let user;
    try {
      const payload = await tokens.verifyAccess(token);
      user = await users.findOne({ _id: new ObjectId(payload.sub) });
    } catch {
      return fail(reply, 401, 'UNAUTHORIZED', '登录已失效，请重新登录');
    }

    if (!user || user.status !== 'active') {
      return fail(reply, 401, 'UNAUTHORIZED', '登录已失效，请重新登录');
    }
    req.user = user;
  };
}
