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
const { OFFICIAL_EVENTS, OFFICIAL_EVENT_CODES } = require('../src/config/officialEvents');

const prisma = new PrismaClient();

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
  let updated = 0;
  for (const e of OFFICIAL_EVENTS) {
    const existing = await prisma.event.findFirst({
      where: { OR: [{ code: e.code }, { id: e.id }] },
    });
    const data = {
      code: e.code,
      slug: e.slug,
      name: e.name,
      category: e.category,
      venue: e.venue,
      startsAt: new Date(e.startsAt),
      endsAt: new Date(e.endsAt),
      description: e.description,
      registrationMode: e.registrationMode,
      registrationDeadline: e.registrationDeadline ? new Date(e.registrationDeadline) : null,
      imageUrl: e.imageUrl || null,
      brochureUrl: e.brochureUrl || null,
      brochureName: e.brochureName || null,
      status: 'PUBLISHED',
    };
    if (existing) {
      await prisma.event.update({
        where: { id: existing.id },
        data,
      });
      updated += 1;
    } else {
      await prisma.event.create({
        data: {
          id: e.id,
          ...data,
        },
      });
      created += 1;
    }
  }

  // Ensure any non-official events are set to DRAFT so only the 6 official events are published
  await prisma.event.updateMany({
    where: {
      code: { notIn: OFFICIAL_EVENT_CODES },
      status: 'PUBLISHED',
    },
    data: { status: 'DRAFT' },
  });

  console.log(`✔ Events: ${created} created, ${updated} updated (guaranteed 6 permanent official events)`);
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
