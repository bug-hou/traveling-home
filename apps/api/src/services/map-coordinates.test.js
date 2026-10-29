import assert from 'node:assert/strict';
import test from 'node:test';
import { translateWgs84 } from './map-coordinates.js';

test('GPS conversion uses fixed Tencent HTTPS endpoint and validates output order', async () => {
  const calls = [];
  const points = [{ latitude: 0, longitude: 0 }, { latitude: 28.48, longitude: 100.3 }];
  const output = await translateWgs84(points, 'server-key', async (url, options) => {
    calls.push(new URL(url));
    assert.equal(options.headers.Accept, 'application/json');
    return { ok: true, json: async () => ({ status: 0, locations: [{ lat: 0, lng: 0 }, { lat: 28.482, lng: 100.306 }] }) };
  });
  assert.equal(calls[0].origin, 'https://apis.map.qq.com');
  assert.equal(calls[0].pathname, '/ws/coord/v1/translate');
  assert.equal(calls[0].searchParams.get('type'), '1');
  assert.equal(calls[0].searchParams.get('locations'), '0.000000,0.000000;28.480000,100.300000');
  assert.deepEqual(output, [{ latitude: 0, longitude: 0 }, { latitude: 28.482, longitude: 100.306 }]);
});

test('GPS conversion rejects malformed results and batches long inputs within API limit', async () => {
  const points = Array.from({ length: 100 }, (_, index) => ({ latitude: 20 + index / 100, longitude: 100 }));
  let calls = 0;
  const result = await translateWgs84(points, 'server-key', async (url) => {
    calls++;
    const list = new URL(url).searchParams.get('locations').split(';');
    assert.ok(list.join(';').length <= 2048);
    return { ok: true, json: async () => ({ status: 0, locations: list.map((pair) => {
      const [lat, lng] = pair.split(',').map(Number);
      return { lat, lng };
    }) }) };
  });
  assert.equal(result.length, 100);
  assert.ok(calls > 1);
  await assert.rejects(() => translateWgs84(points.slice(0, 1), 'server-key', async () => ({ ok: true, json: async () => ({ status: 0, locations: [{ lat: 'bad', lng: 100 }] }) })));
});
