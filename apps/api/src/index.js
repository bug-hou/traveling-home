import { loadConfig } from './config.js';
import { connectDb } from './db.js';
import { buildApp } from './server.js';

const cfg = loadConfig();
const { client, db } = await connectDb(cfg);
const app = await buildApp({ cfg, db });

async function shutdown(signal) {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    await client.close();
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

await app.listen({ host: cfg.host, port: cfg.port });
