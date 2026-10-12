'use strict';
/**
 * Shared test harness: boots the Express app against the isolated test database,
 * creates an admin + fixture events, and exposes small request helpers.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

const bcrypt = require('bcryptjs');
const request = require('supertest');
const { createApp } = require('../../src/app');
const prisma = require('../../src/lib/prisma');
const { ensureUploadDirs } = require('../../src/middleware/upload');

const RND = () => Math.random().toString(36).slice(2, 8);
const IST_OFFSET = 330;

function ist(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - IST_OFFSET * 60 * 1000);
}

const ADMIN = { email: `test-admin-${RND()}@spark26.test`, password: 'TestPassw0rd!26', name: 'Test Coordinator' };

async function boot() {
  ensureUploadDirs();
  const app = createApp();
  const agent = request.agent(app);
  const admin = await prisma.adminUser.create({
    data: {
      name: ADMIN.name,
      email: ADMIN.email,
      passwordHash: await bcrypt.hash(ADMIN.password, 4),
      role: 'SUPERADMIN',
      status: 'ACTIVE',
    },
  });
  const login = await agent.post('/api/admin/auth/login').send({ email: ADMIN.email, password: ADMIN.password });
  if (login.status !== 200) throw new Error('test admin login failed: ' + JSON.stringify(login.body));
  const csrf = login.body.csrfToken;
  return { app, agent, admin, csrf, api: request(app) };
}

async function makeEvent(overrides = {}) {
  const tag = RND().toUpperCase();
  const base = {
    code: `T${tag.slice(0, 4)}`,
    slug: `test-event-${tag.toLowerCase()}`,
    name: `Test Event ${tag}`,
    category: 'TECHNICAL',
    venue: 'Test Hall',
    startsAt: ist('2030-01-01', '10:00'),
    endsAt: ist('2030-01-01', '12:00'),
    description: 'Fixture event for automated tests.',
    registrationMode: 'BOTH',
    status: 'PUBLISHED',
  };
  return prisma.event.create({ data: { ...base, ...overrides } });
}

function studentFixture(tag) {
  const key = RND();
  return {
    name: `Student ${key.toUpperCase()}`,
    registerNumber: `T${tag || 'S'}${key.toUpperCase()}`.slice(0, 16),
    department: 'Computer Science and Engineering',
    academicYear: 'III',
    section: 'A',
    email: `student.${key}@spark26.test`,
  };
}

/** Deletes everything this test run created (students/events keep a marker). */
async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { admin: { email: { contains: '@spark26.test' } } } });
  await prisma.registration.deleteMany({
    where: { OR: [{ student: { email: { contains: '@spark26.test' } } }, { event: { description: 'Fixture event for automated tests.' } }] },
  });
  await prisma.student.deleteMany({ where: { email: { contains: '@spark26.test' } } });
  await prisma.event.deleteMany({ where: { description: 'Fixture event for automated tests.' } });
  await prisma.adminUser.deleteMany({ where: { email: { contains: '@spark26.test' } } });
}

async function teardown() {
  await cleanup();
  await prisma.$disconnect();
}

module.exports = { boot, makeEvent, studentFixture, cleanup, teardown, prisma, ist, ADMIN, RND };
