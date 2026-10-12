'use strict';
const { PrismaClient } = require('@prisma/client');

const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.__spark26Prisma ||
  new PrismaClient({
    log: process.env.PRISMA_LOG === '1' ? ['warn', 'error'] : ['error'],
  });

globalForPrisma.__spark26Prisma = prisma;

module.exports = prisma;
