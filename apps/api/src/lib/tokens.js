import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

const ISSUER = 'movehome-api';
const AUDIENCE = 'movehome-web';

export function createAccessTokens(cfg) {
  const key = new TextEncoder().encode(cfg.jwtSecret);

  return {
    signAccess(user) {
      return new SignJWT({ role: user.role })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(String(user._id))
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${cfg.accessTtlSeconds}s`)
        .sign(key);
    },

    async verifyAccess(token) {
      const { payload } = await jwtVerify(token, key, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      return payload;
    },
  };
}

// 刷新令牌是不透明随机串，库里只存 SHA-256 摘要
export function newRefreshToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
