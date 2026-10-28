import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from './config.js';

function baseEnv(extra = {}) {
  return {
    JWT_SECRET: 'a'.repeat(64),
    MONGO_URI: 'mongodb://localhost:27017/movehome',
    CORS_ORIGINS: 'https://convenience.top',
    ...extra,
  };
}

test('COS is optional until credentials and bucket are configured', () => {
  const config = loadConfig(baseEnv({ COS_REGION: 'ap-chengdu' }));
  assert.equal(config.cos, null);
});

test('image processing is disabled by default and only enabled explicitly', () => {
  assert.equal(loadConfig(baseEnv()).imageProcessingEnabled, false);
  assert.equal(loadConfig(baseEnv({ COS_IMAGE_PROCESSING_ENABLED: 'true' })).imageProcessingEnabled, true);
  assert.equal(loadConfig(baseEnv({ COS_IMAGE_PROCESSING_ENABLED: 'false' })).imageProcessingEnabled, false);
});

test('COS config derives the account ID from the bucket and normalizes prefix slashes', () => {
  const config = loadConfig(
    baseEnv({
      COS_SECRET_ID: 'id',
      COS_SECRET_KEY: 'key',
      COS_BUCKET: 'test-cos-1312827847',
      COS_REGION: 'ap-chengdu',
      COS_PREFIX: '/movehome/',
      COS_READ_DOMAIN: 'Assets.Convenience.Top',
    }),
  );

  assert.deepEqual(config.cos, {
    secretId: 'id',
    secretKey: 'key',
    bucket: 'test-cos-1312827847',
    region: 'ap-chengdu',
    appId: '1312827847',
    prefix: 'movehome',
    readDomain: 'assets.convenience.top',
  });
});

test('partial credentials and unsafe prefixes are rejected', () => {
  assert.throws(
    () => loadConfig(baseEnv({ COS_SECRET_ID: 'id', COS_REGION: 'ap-chengdu' })),
    /COS 配置不完整/,
  );

  assert.throws(
    () =>
      loadConfig(
        baseEnv({
          COS_SECRET_ID: 'id',
          COS_SECRET_KEY: 'key',
          COS_BUCKET: 'test-cos-1312827847',
          COS_PREFIX: '../outside',
        }),
      ),
    /COS_PREFIX 格式不正确/,
  );

  assert.throws(
    () =>
      loadConfig(
        baseEnv({
          COS_SECRET_ID: 'id',
          COS_SECRET_KEY: 'key',
          COS_BUCKET: 'test-cos-1312827847',
          COS_APP_ID: '1111111111',
        }),
      ),
    /COS_APP_ID 与 COS_BUCKET 不匹配/,
  );
  for (const domain of ['https://assets.convenience.top', 'assets.convenience.top:443', 'localhost', 'assets.convenience.top/path']) {
    assert.throws(
      () => loadConfig(baseEnv({
        COS_SECRET_ID: 'id', COS_SECRET_KEY: 'key', COS_BUCKET: 'test-cos-1312827847', COS_READ_DOMAIN: domain,
      })),
      /COS_READ_DOMAIN/,
    );
  }
});

test('COS read domain defaults to the bucket domain when not configured', () => {
  const config = loadConfig(baseEnv({
    COS_SECRET_ID: 'id', COS_SECRET_KEY: 'key', COS_BUCKET: 'test-cos-1312827847',
  }));
  assert.equal(config.cos.readDomain, null);
});
