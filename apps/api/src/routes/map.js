import { z } from 'zod';
import { fail } from '../lib/http.js';
import { translateWgs84 } from '../services/map-coordinates.js';

const querySchema = z.object({
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

const projection = {
  parentId: 1,
  name: 1,
  mime: 1,
  size: 1,
  uploadedAt: 1,
  createdAt: 1,
  mediaLocation: 1,
};

const validLocation = {
  $expr: { $and: [
    { $isNumber: '$mediaLocation.latitude' },
    { $isNumber: '$mediaLocation.longitude' },
    { $gte: ['$mediaLocation.latitude', -90] },
    { $lte: ['$mediaLocation.latitude', 90] },
    { $gte: ['$mediaLocation.longitude', -180] },
    { $lte: ['$mediaLocation.longitude', 180] },
  ] },
};
const mediaFilter = { $or: [
  { mime: { $regex: '^(image|video)/', $options: 'i' } },
  { mime: 'application/octet-stream', name: { $regex: '\\.(jpe?g|mp4|mov)$', $options: 'i' } },
] };

function serializeFile(node, includeLocation) {
  return {
    id: String(node._id),
    parentId: node.parentId ? String(node.parentId) : null,
    name: node.name,
    mime: node.mime ?? null,
    size: node.size ?? 0,
    uploadedAt: node.uploadedAt ?? node.createdAt ?? null,
    ...(includeLocation ? {
      location: {
        latitude: node.mediaLocation.latitude,
        longitude: node.mediaLocation.longitude,
        placeName: node.mediaLocation.placeName ?? null,
        source: node.mediaLocation.source ?? null,
      },
    } : {}),
  };
}

export default async function mapRoutes(app, { db, requireAuth, cfg = {}, translate = translateWgs84 }) {
  const nodes = db.collection('nodes');

  async function list(req, reply, located) {
    reply.header('Cache-Control', 'private, no-store');
    const parsed = querySchema.safeParse(req.query ?? {});
    if (!parsed.success) return fail(reply, 400, 'INVALID_INPUT', '请求参数不正确');

    const { offset, limit } = parsed.data;
    const filter = {
      userId: req.user._id,
      type: 'file',
      status: 'ready',
      deletedAt: null,
      ...mediaFilter,
      ...(located ? validLocation : { $nor: [validLocation] }),
    };
    const [total, items] = await Promise.all([
      nodes.countDocuments(filter),
      nodes.find(filter, { projection })
        .sort({ uploadedAt: -1, _id: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
    ]);
    const result = items.map((node) => serializeFile(node, located));
    if (!located) return { items: result, total, offset, limit };
    let mapStatus = cfg.mapServerKey ? 'ready' : 'not_configured';
    if (cfg.mapServerKey && result.length) {
      try {
        const coordinates = await translate(result.map((item) => item.location), cfg.mapServerKey);
        if (coordinates.length !== result.length) throw new Error('地图坐标数量不一致');
        result.forEach((item, index) => { item.mapLocation = coordinates[index]; });
      } catch {
        mapStatus = 'unavailable';
        req.log.warn('map coordinate conversion unavailable');
      }
    }
    return { items: result, total, offset, limit, mapStatus };
  }

  app.get('/map/points', { preHandler: requireAuth }, (req, reply) => list(req, reply, true));
  app.get('/map/unlocated', { preHandler: requireAuth }, (req, reply) => list(req, reply, false));
}
