const truthy = new Set(['1', 'true', 'yes', 'on']);

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return truthy.has(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function loadCosConfig(env) {
  const names = ['COS_SECRET_ID', 'COS_SECRET_KEY', 'COS_BUCKET'];
  const values = Object.fromEntries(names.map((name) => [name, String(env[name] ?? '').trim()]));
  const configured = names.filter((name) => values[name]);
  if (configured.length === 0) return null;
  if (configured.length !== names.length) {
    const missing = names.filter((name) => !values[name]);
    throw new Error(`COS 配置不完整，缺少：${missing.join(', ')}`);
  }

  const region = String(env.COS_REGION ?? 'ap-chengdu').trim();
  if (!/^[a-z0-9-]+$/.test(region)) throw new Error('COS_REGION 格式不正确');
  const bucketAppId = values.COS_BUCKET.match(/-(\d+)$/)?.[1];
  const appId = String(env.COS_APP_ID ?? bucketAppId ?? '').trim();
  if (!appId || !/^\d+$/.test(appId)) throw new Error('COS_APP_ID 未配置且无法从 COS_BUCKET 推导');
  if (bucketAppId && appId !== bucketAppId) throw new Error('COS_APP_ID 与 COS_BUCKET 不匹配');

  const prefix = String(env.COS_PREFIX ?? 'movehome')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  if (!prefix || prefix.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('COS_PREFIX 格式不正确');
  }

  const readDomain = String(env.COS_READ_DOMAIN ?? '').trim().toLowerCase();
  if (readDomain && (
    readDomain.length > 253 ||
    !readDomain.includes('.') ||
    readDomain.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )) {
    throw new Error('COS_READ_DOMAIN 必须是域名，不含协议、端口或路径');
  }

  return Object.freeze({
    secretId: values.COS_SECRET_ID,
    secretKey: values.COS_SECRET_KEY,
    bucket: values.COS_BUCKET,
    region,
    appId,
    prefix,
    readDomain: readDomain || null,
  });
}

export function loadConfig(env = process.env) {
  const jwtSecret = env.JWT_SECRET ?? '';
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET 未配置或长度不足 32 个字符');
  }
  if (!env.MONGO_URI) throw new Error('MONGO_URI 未配置');

  const corsOrigins = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (corsOrigins.length === 0) throw new Error('CORS_ORIGINS 未配置');

  return Object.freeze({
    isProd: env.NODE_ENV === 'production',
    host: env.HOST ?? '127.0.0.1',
    port: int(env.PORT, 3001),
    corsOrigins,
    mongoUri: env.MONGO_URI,
    mongoDb: env.MONGO_DB || 'movehome',
    jwtSecret,
    allowRegistration: bool(env.ALLOW_REGISTRATION, false),
    accessTtlSeconds: int(env.ACCESS_TOKEN_TTL_SECONDS, 900),
    refreshTtlDays: int(env.REFRESH_TOKEN_TTL_DAYS, 30),
    cos: loadCosConfig(env),
    imageProcessingEnabled: bool(env.COS_IMAGE_PROCESSING_ENABLED, false),
    phoneUploadsEnabled: bool(env.PHONE_UPLOADS_ENABLED, false),
    mapServerKey: String(env.TENCENT_MAP_SERVER_KEY ?? '').trim(),
  });
}
