import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { createAccessTokens } from './lib/tokens.js';
import { createAuthGuard } from './plugins/auth.js';
import authRoutes from './routes/auth.js';
import nodeRoutes from './routes/nodes.js';
import shareRoutes from './routes/shares.js';
import homeRoutes from './routes/home.js';
import mapRoutes from './routes/map.js';
import uploadRoutes from './routes/uploads.js';
import phoneUploadRoutes from './routes/phone-uploads.js';
import { createCosService } from './services/cos.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function buildApp({ cfg, db }) {
  const app = Fastify({
    logger: { level: cfg.isProd ? 'info' : 'debug' },
    // 仅信任本机 nginx，取到真实客户端 IP，防止伪造 X-Forwarded-For
    trustProxy: '127.0.0.1',
    bodyLimit: 64 * 1024,
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: cfg.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 120, timeWindow: '1 minute' });

  // CSRF 防护：带 Cookie 的写请求必须来自允许的前端来源
  const allowedOrigins = new Set(cfg.corsOrigins);
  app.addHook('onRequest', async (req, reply) => {
    if (SAFE_METHODS.has(req.method)) return;
    const origin = req.headers.origin;
    if (!origin || !allowedOrigins.has(origin)) {
      return reply
        .code(403)
        .send({ error: { code: 'BAD_ORIGIN', message: '请求来源不被允许' } });
    }
  });

  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在' } }),
  );

  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode && err.statusCode < 500) {
      return reply
        .code(err.statusCode)
        .send({ error: { code: err.code ?? 'BAD_REQUEST', message: '请求不正确' } });
    }
    req.log.error(err);
    return reply
      .code(500)
      .send({ error: { code: 'INTERNAL_ERROR', message: '服务器开小差了，请稍后再试' } });
  });

  app.get('/health', async () => {
    await db.command({ ping: 1 });
    return { ok: true };
  });

  const tokens = createAccessTokens(cfg);
  const requireAuth = createAuthGuard({ db, tokens });
  const cos = createCosService(cfg);
  await app.register(authRoutes, {
    prefix: '/api/v1/auth',
    cfg,
    db,
    tokens,
    requireAuth,
  });
  await app.register(nodeRoutes, {
    prefix: '/api/v1',
    cfg,
    db,
    requireAuth,
    cos,
  });
  await app.register(uploadRoutes, {
    prefix: '/api/v1',
    cfg,
    db,
    requireAuth,
    cos,
  });
  await app.register(phoneUploadRoutes, {
    prefix: '/api/v1',
    db,
    requireAuth,
    cos,
  });
  await app.register(homeRoutes, {
    prefix: '/api/v1',
    db,
    requireAuth,
  });
  await app.register(mapRoutes, {
    prefix: '/api/v1',
    db,
    cfg,
    requireAuth,
  });
  await app.register(shareRoutes, {
    prefix: '/api/v1',
    db,
    cfg,
    cos,
    requireAuth,
  });

  return app;
}
