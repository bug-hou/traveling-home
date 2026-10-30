import { MongoClient } from 'mongodb';

export async function connectDb(cfg) {
  const client = new MongoClient(cfg.mongoUri, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10,
  });
  await client.connect();
  const db = client.db(cfg.mongoDb);
  await ensureIndexes(db, cfg);
  return { client, db };
}

async function ensureIndexes(db, cfg) {
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  await db.collection('users').createIndex({ publicHandle: 1 }, { unique: true, partialFilterExpression: { publicHandle: { $type: 'string' } } });
  await db.collection('handles').createIndex({ userId: 1 });
  await db.collection('shares').createIndex({ userId: 1, slug: 1 }, { unique: true });
  await db.collection('shares').createIndex({ userId: 1, createdAt: -1 });
  await db.collection('notes').createIndex({ userId: 1, deletedAt: 1, updatedAt: -1, _id: -1 });
  await db.collection('nodes').createIndex({ userId: 1, parentId: 1, deletedAt: 1 });
  await db.collection('nodes').createIndex({ userId: 1, type: 1, status: 1, deletedAt: 1, uploadedAt: -1, _id: -1 });

  const uploadSessions = db.collection('upload_sessions');
  await uploadSessions.createIndex({ userId: 1, status: 1, expiresAt: 1 });
  await uploadSessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  if (cfg.phoneUploadsEnabled === true) {
    const phonePairs = db.collection('phone_upload_pairs');
    await phonePairs.createIndex({ userId: 1, createdAt: -1 });
    await phonePairs.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  }

  const notePairs = db.collection('note_read_pairs');
  await notePairs.createIndex({ userId: 1, noteId: 1, createdAt: -1 });
  await notePairs.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  const sessions = db.collection('sessions');
  await sessions.createIndex({ tokenHash: 1 }, { unique: true });
  await sessions.createIndex({ familyId: 1 });
  await sessions.createIndex({ userId: 1 });
  // 到期后由 MongoDB 自动清理
  await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
