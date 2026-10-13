'use strict';
/**
 * Seeds the Spark'26 database:
 *   1. The first administrator, read from environment variables (ADMIN_EMAIL/ADMIN_PASSWORD).
 *   2. The eight events that shipped with the original frontend (as PUBLISHED).
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
const EVENT_DATE = process.env.SEED_EVENT_DATE || '2026-10-18';

function ist(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - IST_OFFSET_MINUTES * 60 * 1000);
}

const DEFAULT_EVENTS = [
  { code: 'E04', name: 'IPL AUCTION', category: 'NON_TECHNICAL', venue: '322', start: '10:00', end: '13:00', mode: 'BOTH', desc: '🏏 IPL AUCTION – SPARK 2026\n\nBuild your dream IPL team! 🔥 Bid for your favourite players, manage your budget, and compete with other teams to create the ultimate cricket squad. Let the bidding battle begin! 💰🏆' },
  { code: 'E03', name: 'Capture The Flag', category: 'TECHNICAL', venue: 'SHIVA AYUADURAI LAB', start: '10:00', end: '12:00', mode: 'WEBSITE', desc: 'Capture The Flag (CTF) is a technical challenge where participants must use their problem-solving and cybersecurity skills to find a hidden flag placed in a folder somewhere on a computer. The participant who discovers the flag first and submits it correctly wins the challenge.' },
  { code: 'E05', name: 'Creovate', category: 'TECHNICAL', venue: 'DENNIS RICHIE LAB(Right)', start: '10:00', end: '12:00', mode: 'WEBSITE', desc: 'Creovate: Technical innovation, design thinking, and rapid prototyping competition.' },
  { code: 'E06', name: 'AuRagen', category: 'TECHNICAL', venue: 'DENNIS RICHIE LAB(Left)', start: '10:00', end: '12:00', mode: 'WEBSITE', desc: 'AuRagen: Advanced generative AI, machine learning and intelligent system building.' },
  { code: 'E07', name: 'Project expo', category: 'TECHNICAL', venue: 'IOT LAB', start: '10:00', end: '13:00', mode: 'WEBSITE', desc: 'Project Expo: Showcase your groundbreaking hardware, IoT, and software projects to expert panels.' },
  { code: 'E02', name: 'NeuraForge', category: 'TECHNICAL', venue: 'IBM LAB', start: '11:30', end: '13:00', mode: 'WEBSITE', desc: 'NeuraForge: Neural network architectures, deep learning engineering, and algorithmic mastery.' },
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
        startsAt: ist(EVENT_DATE, e.start),
        endsAt: ist(EVENT_DATE, e.end),
        description: e.desc,
        registrationMode: e.mode,
        registrationDeadline: ist(EVENT_DATE, '09:00'),
        status: 'PUBLISHED',
      },
    });
    created += 1;
  }
  console.log(`✔ Events: ${created} created, ${DEFAULT_EVENTS.length - created} already existed (event date ${EVENT_DATE} IST)`);
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
