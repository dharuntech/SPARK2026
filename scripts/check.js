#!/usr/bin/env node
'use strict';
/** Quick environment + database sanity check: `npm run check`. */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const rows = [];

async function main() {
  const env = require('../src/config/env');
  rows.push(['NODE_ENV', env.nodeEnv]);
  rows.push(['PORT', env.port]);
  rows.push(['Timezone', env.timezone]);
  rows.push(['Upload dir', env.uploadDir]);

  const [{ version }] = await prisma.$queryRaw`SELECT version()`;
  rows.push(['PostgreSQL', String(version).split(' ').slice(0, 2).join(' ')]);

  const [events, published, registrations, students, admins] = await Promise.all([
    prisma.event.count(),
    prisma.event.count({ where: { status: 'PUBLISHED' } }),
    prisma.registration.count(),
    prisma.student.count(),
    prisma.adminUser.count(),
  ]);
  rows.push(['Events (total / published)', `${events} / ${published}`]);
  rows.push(['Registrations', registrations]);
  rows.push(['Students', students]);
  rows.push(['Admin accounts', admins]);

  const width = Math.max(...rows.map((r) => r[0].length));
  console.log('\nSpark’26 environment check');
  console.log('─'.repeat(width + 28));
  for (const [k, v] of rows) console.log(`${k.padEnd(width)}  ${v}`);
  console.log('─'.repeat(width + 28));
  if (!admins) console.log('⚠  No admin accounts yet — run `npm run db:seed` or `npm run admin:create`.');
  console.log('');
}

main()
  .catch((err) => {
    console.error('Check failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
