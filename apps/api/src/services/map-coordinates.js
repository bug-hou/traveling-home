const ENDPOINT = 'https://apis.map.qq.com/ws/coord/v1/translate';
const MAX_LOCATIONS_LENGTH = 2048;

export async function translateWgs84(points, key, fetchImpl = fetch) {
  if (!key || points.length === 0) return [];
  const batches = [];
  let batch = [];
  let length = 0;
  for (const point of points) {
    const pair = `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`;
    if (batch.length && length + pair.length + 1 > MAX_LOCATIONS_LENGTH) {
      batches.push(batch);
      batch = [];
      length = 0;
    }
    batch.push(pair);
    length += pair.length + (length ? 1 : 0);
  }
  if (batch.length) batches.push(batch);

  const translated = [];
  for (const pairs of batches) {
    const params = new URLSearchParams({ key, type: '1', locations: pairs.join(';') });
    const response = await fetchImpl(`${ENDPOINT}?${params}`, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('腾讯地图坐标服务暂不可用');
    const result = await response.json();
    if (result?.status !== 0 || !Array.isArray(result.locations) || result.locations.length !== pairs.length ||
      result.locations.some((item) => !Number.isFinite(item?.lat) || !Number.isFinite(item?.lng) ||
        item.lat < -90 || item.lat > 90 || item.lng < -180 || item.lng > 180)) {
      throw new Error('腾讯地图坐标转换结果无效');
    }
    translated.push(...result.locations.map((item) => ({ latitude: item.lat, longitude: item.lng })));
  }
  return translated;
}
