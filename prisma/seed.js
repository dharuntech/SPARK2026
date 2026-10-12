'use strict';
/**
 * Seeds the Spark'26 database:
 *   1. The first administrator, read from environment variables (ADMIN_EMAIL/ADMIN_PASSWORD).
 *   2. The eight symposium events that shipped with the original frontend (as PUBLISHED).
 *
 * Safe to re-run: existing events are left untouched, and the admin password is
 * only (re)written when ADMIN_FORCE_RESET=1 is set.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const IST_OFFSET_MINUTES = 330;
const SYMPOSIUM_DATE = process.env.SEED_EVENT_DATE || '2026-10-18';

function ist(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - IST_OFFSET_MINUTES * 60 * 1000);
}

const DEFAULT_EVENTS = [
  { code: 'E01', name: 'Code Sprint', category: 'TECHNICAL', venue: 'CSE Lab 1', start: '10:00', end: '12:00', mode: 'WEBSITE', desc: 'Fast-paced coding round covering logic, debugging and problem solving.' },
  { code: 'E02', name: 'Treasure Hunt', category: 'NON_TECHNICAL', venue: 'Main Block Courtyard', start: '11:30', end: '13:00', mode: 'BOTH', desc: 'Clues, campus checkpoints and team challenges with a CS twist.' },
  { code: 'E03', name: 'UI / UX Forge', category: 'TECHNICAL', venue: 'Innovation Studio', start: '13:30', end: '15:00', mode: 'WEBSITE', desc: 'Design a high-impact interface from a surprise problem statement.' },
  { code: 'E04', name: 'Debug the Bug', category: 'TECHNICAL', venue: 'Seminar Hall B', start: '14:00', end: '15:00', mode: 'WEBSITE', desc: 'Find, reason about and fix intentionally broken programs.' },
  { code: 'E05', name: 'Tech Quiz', category: 'TECHNICAL', venue: 'AV Room', start: '15:30', end: '16:30', mode: 'BOTH', desc: 'Computer science, programming and emerging-tech quiz for teams.' },
  { code: 'E06', name: 'IPL Auction Arena', category: 'NON_TECHNICAL', venue: 'Open Auditorium', start: '16:00', end: '17:30', mode: 'ON_SPOT', desc: 'Strategy, bidding and team-building in a live auction format.' },
  { code: 'E07', name: 'Paper Presentation', category: 'TECHNICAL', venue: 'Seminar Hall A', start: '09:30', end: '12:30', mode: 'WEBSITE', desc: 'Present research, systems, AI ideas or impactful technical builds.' },
  { code: 'E08', name: 'Meme Matrix', category: 'NON_TECHNICAL', venue: 'Student Activity Zone', start: '13:00', end: '14:00', mode: 'ON_SPOT', desc: 'Create the smartest CS-themed meme with the biggest crowd reaction.' },
];

const slugify = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function seedAdmin() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  const name = process.env.ADMIN_NAME || 'Spark26 Coordinator';
  const role = (process.env.ADMIN_ROLE || 'SUPERADMIN').toUpperCase();
  const forceReset = process.env.ADMIN_FORCE_RESET === '1';

  if (!email || !password) {
    console.warn('⚠  ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin seed (no public admin signup exists).');
    return null;
  }
  if (password.length < 10) {
    throw new Error('ADMIN_PASSWORD must be at least 10 characters long.');
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing && !forceReset) {
    console.log(`✔ Admin already present: ${email} (set ADMIN_FORCE_RESET=1 to rotate the password)`);
    return existing;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const admin = existing
    ? await prisma.adminUser.update({ where: { email }, data: { name, passwordHash, role, status: 'ACTIVE' } })
    : await prisma.adminUser.create({ data: { name, email, passwordHash, role, status: 'ACTIVE' } });
  console.log(`✔ Admin ${existing ? 'updated' : 'created'}: ${admin.email} (${admin.role})`);
  return admin;
}

async function seedEvents() {
  let created = 0;
  for (const e of DEFAULT_EVENTS) {
    const existing = await prisma.event.findUnique({ where: { code: e.code } });
    if (existing) continue;
    await prisma.event.create({
      data: {
        code: e.code,
        slug: slugify(e.name),
        name: e.name,
        category: e.category,
        venue: e.venue,
        startsAt: ist(SYMPOSIUM_DATE, e.start),
        endsAt: ist(SYMPOSIUM_DATE, e.end),
        description: e.desc,
        registrationMode: e.mode,
        registrationDeadline: ist(SYMPOSIUM_DATE, '09:00'),
        status: 'PUBLISHED',
      },
    });
    created += 1;
  }
  console.log(`✔ Events: ${created} created, ${DEFAULT_EVENTS.length - created} already existed (symposium date ${SYMPOSIUM_DATE} IST)`);
}

async function main() {
  console.log('\n── Spark’26 seed ──────────────────────────────');
  await seedAdmin();
  await seedEvents();
  await prisma.siteSetting.upsert({
    where: { key: 'homeHeroImageUrl' },
    update: {},
    create: { key: 'homeHeroImageUrl', value: '' },
  });
  console.log('── Seed complete ──────────────────────────────\n');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
