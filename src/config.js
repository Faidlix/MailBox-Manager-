import path from 'node:path';

export const config = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 4141),
  dataDir: path.resolve('data'),
  dbPath: process.env.MAILBOX_DB_PATH || path.resolve('data', 'mailbox.db'),
  syncLimit: Math.min(Math.max(Number(process.env.SYNC_LIMIT || 1000), 1), 1000),
};

export const googleRedirectUri = `http://${config.host}:${config.port}/api/oauth/google/callback`;
