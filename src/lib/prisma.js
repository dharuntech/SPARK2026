'use strict';
const { PrismaClient } = require('@prisma/client');

const globalForPrisma = globalThis;

function getPrismaClient() {
  if (globalForPrisma.__spark26Prisma) {
    return globalForPrisma.__spark26Prisma;
  }

  const client = new PrismaClient({
    log: process.env.PRISMA_LOG === '1' ? ['warn', 'error'] : ['error'],
  });

  globalForPrisma.__spark26Prisma = client;
  return client;
}

const prisma = getPrismaClient();

module.exports = prisma;
