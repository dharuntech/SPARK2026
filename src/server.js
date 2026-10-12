'use strict';
const env = require('./config/env');
const { createApp } = require('./app');
const { ensureUploadDirs } = require('./middleware/upload');
const prisma = require('./lib/prisma');

async function main() {
  ensureUploadDirs();
  const app = createApp();

  const server = app.listen(env.port, '0.0.0.0', () => {
    console.log(`\n  Spark’26 server running → http://localhost:${env.port}`);
    console.log(`  Environment: ${env.nodeEnv} · timezone ${env.timezone}`);
    console.log(`  Uploads: ${env.uploadDir}\n`);
  });

  const shutdown = async (signal) => {
    console.log(`\n${signal} received — shutting down.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
    await prisma.$disconnect().catch(() => {});
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Failed to start Spark’26 server:', err);
    process.exit(1);
  });
}

module.exports = require('./app');
