#!/usr/bin/env node
'use strict';
/**
 * Clears application data (students, registrations, E2E events, audit logs) and
 * re-seeds the canonical Spark'26 event list.
 *   node scripts/reset-dev-data.js            # wipe registrations + non-seed events
 *   node scripts/reset-dev-data.js --all      # also remove the seed events
 * Administrators are never deleted.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const { execFileSync } = require('child_process');

const prisma = new PrismaClient();
const SEED_CODES = ['E01','E02','E03','E04','E05','E06','E07','E08'];

(async () => {
  const wipeEvents = process.argv.includes('--all');
  const regs = await prisma.registration.deleteMany({});
  const students = await prisma.student.deleteMany({});
  await prisma.auditLog.deleteMany({});
  const events = await prisma.event.deleteMany({ where: wipeEvents ? {} : { code: { notIn: SEED_CODES } } });
  await prisma.siteSetting.updateMany({ where: { key: 'homeHeroImageUrl' }, data: { value: '' } });
  console.log(`Removed ${regs.count} registrations, ${students.count} students, ${events.count} events.`);
  await prisma.$disconnect();
  execFileSync('node', [path.join(__dirname, '..', 'prisma', 'seed.js')], { stdio: 'inherit', env: process.env });
})().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
