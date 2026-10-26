'use strict';
const config = require('./config');
const { migrate, pool } = require('./db');
const { createApp } = require('./app');

async function main() {
  await migrate();
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`Bookscover API listening on port ${config.port} (${config.env})`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
