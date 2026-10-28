import { z } from 'zod';
import { fail } from '../lib/http.js';

const querySchema = z.object({
  recentLimit: z.coerce.number().int().min(1).max(8).default(4),
}).strict();

const NOT_READY_FOOTPRINT = Object.freeze({
  status: 'not_ready',
  countyCount: null,
  cityCount: null,
  provinceCount: null,
  latestCounty: null,
});
const NOT_READY_TRIPS = Object.freeze({ status: 'not_ready', count: null, recent: [] });

function categorySum(regex) {
  return {
    $sum: {
      $cond: [
        { $regexMatch: { input: { $ifNull: ['$mime', ''] }, regex } },
        { $ifNull: ['$size', 0] },
        0,
      ],
    },
  };
}

async function storageSummary(nodes, filter) {
  const [stats] = await nodes.aggregate([
    { $match: filter },
    { $group: {
      _id: null,
      count: { $sum: 1 },
      usedBytes: { $sum: { $ifNull: ['$size', 0] } },
      videoBytes: categorySum('^video/'),
      imageBytes: categorySum('^image/'),
      audioBytes: categorySum('^audio/'),
    } },
  ]).toArray();
  const usedBytes = stats?.usedBytes ?? 0;
  const videoBytes = stats?.videoBytes ?? 0;
  const imageBytes = stats?.imageBytes ?? 0;
  const audioBytes = stats?.audioBytes ?? 0;
  return {
    status: stats?.count ? 'ready' : 'empty',
    usedBytes,
    quotaBytes: null,
    usagePercent: null,
    breakdown: {
      videoBytes,
      imageBytes,
      audioBytes,
      otherBytes: usedBytes - videoBytes - imageBytes - audioBytes,
    },
  };
}

async function filesSummary(nodes, filter, limit) {
  const [totalFiles, recent] = await Promise.all([
    nodes.countDocuments(filter),
    nodes.find(filter, { projection: { name: 1, mime: 1, size: 1, uploadedAt: 1, createdAt: 1 } })
      .sort({ uploadedAt: -1, _id: -1 })
      .limit(limit)
      .toArray(),
  ]);
  return {
    status: totalFiles ? 'ready' : 'empty',
    totalFiles,
    recent: recent.map((node) => ({
      id: String(node._id),
      name: node.name,
      type: 'file',
      mime: node.mime ?? null,
      size: node.size ?? 0,
      uploadedAt: node.uploadedAt ?? node.createdAt ?? null,
      thumbnailUrl: null,
      processingStatus: null,
      locationStatus: null,
    })),
  };
}

export default async function homeRoutes(app, { db, requireAuth }) {
  const nodes = db.collection('nodes');

  app.get('/home/summary', { preHandler: requireAuth }, async (req, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const query = querySchema.safeParse(req.query ?? {});
    if (!query.success) return fail(reply, 400, 'INVALID_INPUT', '请求参数不正确');

    const filter = { userId: req.user._id, type: 'file', status: 'ready', deletedAt: null };
    const [storage, files] = await Promise.allSettled([
      storageSummary(nodes, filter),
      filesSummary(nodes, filter, query.data.recentLimit),
    ]);
    if (storage.status === 'rejected') req.log.error({ err: storage.reason }, 'home storage summary unavailable');
    if (files.status === 'rejected') req.log.error({ err: files.reason }, 'home files summary unavailable');
    return {
      generatedAt: new Date(),
      storage: storage.status === 'fulfilled' ? storage.value : {
        status: 'unavailable', usedBytes: null, quotaBytes: null, usagePercent: null, breakdown: null,
      },
      files: files.status === 'fulfilled' ? files.value : { status: 'unavailable', totalFiles: null, recent: [] },
      footprint: NOT_READY_FOOTPRINT,
      trips: NOT_READY_TRIPS,
    };
  });
}
