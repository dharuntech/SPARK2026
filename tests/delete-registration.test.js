'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { boot, makeEvent, studentFixture, teardown, prisma } = require('./helpers/harness');

let ctx;
before(async () => { ctx = await boot(); });
after(async () => { await teardown(); });

test('DELETE /api/admin/registrations/:id requires authentication and CSRF', async () => {
  const event = await makeEvent();
  const student = studentFixture();
  const regRes = await ctx.api.post('/api/registrations').send({ eventId: event.id, ...student });
  assert.equal(regRes.status, 201);
  const regId = regRes.body.pass.registrationId;

  // Unauthenticated request
  const unauth = await ctx.api.delete(`/api/admin/registrations/${regId}`);
  assert.equal(unauth.status, 401);

  // Authenticated without CSRF token
  const noCsrf = await ctx.agent.delete(`/api/admin/registrations/${regId}`);
  assert.equal(noCsrf.status, 403);
});

test('Scanner role cannot delete registrations', async () => {
  const event = await makeEvent();
  const student = studentFixture();
  const regRes = await ctx.api.post('/api/registrations').send({ eventId: event.id, ...student });
  assert.equal(regRes.status, 201);
  const regId = regRes.body.pass.registrationId;

  const scannerEmail = `scanner-${Math.random().toString(36).slice(2, 7)}@spark26.test`;
  const scannerPassword = 'ScannerPassword123!';
  await prisma.adminUser.create({
    data: {
      name: 'Scanner User',
      email: scannerEmail,
      passwordHash: await bcrypt.hash(scannerPassword, 4),
      role: 'SCANNER',
      status: 'ACTIVE',
    },
  });

  const scannerAgent = request.agent(ctx.app);
  const loginRes = await scannerAgent.post('/api/admin/auth/login').send({
    email: scannerEmail,
    password: scannerPassword,
  });
  assert.equal(loginRes.status, 200);
  const scannerCsrf = loginRes.body.csrfToken;

  const res = await scannerAgent
    .delete(`/api/admin/registrations/${regId}`)
    .set('X-CSRF-Token', scannerCsrf);

  assert.equal(res.status, 403);
});

test('Returns 404 for non-existent registration ID', async () => {
  const res = await ctx.agent
    .delete('/api/admin/registrations/SP26-NONEXISTENT')
    .set('X-CSRF-Token', ctx.csrf);

  assert.equal(res.status, 404);
});

test('Authorized admin can safely delete an individual registration without affecting other registrations or student profile', async () => {
  const eventA = await makeEvent({ name: 'Alpha Hack' });
  const eventB = await makeEvent({ name: 'Beta Code' });
  const student = studentFixture();

  // Register same student for Event A with team
  const regARes = await ctx.api.post('/api/registrations').send({
    eventId: eventA.id,
    ...student,
    teamMembers: [{ name: 'Partner One', registerNumber: 'PARTNER001' }],
  });
  assert.equal(regARes.status, 201);
  const passA = regARes.body.pass;

  // Register same student for Event B
  const regBRes = await ctx.api.post('/api/registrations').send({
    eventId: eventB.id,
    ...student,
  });
  assert.equal(regBRes.status, 201);
  const passB = regBRes.body.pass;

  // Verify team setting exists for registration A
  const teamSettingBefore = await prisma.siteSetting.findUnique({
    where: { key: 'team_' + passA.registrationId },
  });
  assert.ok(teamSettingBefore, 'Team setting should exist before deletion');

  // Check counts before deletion
  const preSummary = await ctx.agent.get('/api/admin/events-summary');
  const countABefore = preSummary.body.events.find(e => e.id === eventA.id).registeredCount;

  // Delete registration A
  const deleteRes = await ctx.agent
    .delete(`/api/admin/registrations/${passA.registrationId}`)
    .set('X-CSRF-Token', ctx.csrf);

  assert.equal(deleteRes.status, 200);
  assert.equal(deleteRes.body.ok, true);
  assert.equal(deleteRes.body.deleted.registrationId, passA.registrationId);

  // 1. Verify Registration A is deleted from DB
  const storedA = await prisma.registration.findUnique({
    where: { registrationId: passA.registrationId },
  });
  assert.equal(storedA, null, 'Registration A must be deleted');

  // 2. Verify team setting for Registration A is cleaned up
  const teamSettingAfter = await prisma.siteSetting.findUnique({
    where: { key: 'team_' + passA.registrationId },
  });
  assert.equal(teamSettingAfter, null, 'Team setting for Registration A must be deleted');

  // 3. Verify Registration B is STILL intact
  const storedB = await prisma.registration.findUnique({
    where: { registrationId: passB.registrationId },
  });
  assert.ok(storedB, 'Registration B must still exist in the database');
  assert.equal(storedB.status, 'CONFIRMED');

  // 4. Verify Student profile is STILL intact
  const storedStudent = await prisma.student.findUnique({
    where: { registerNumber: student.registerNumber.toUpperCase() },
  });
  assert.ok(storedStudent, 'Student profile must still exist in the database');
  assert.equal(storedStudent.email, student.email.toLowerCase());

  // 5. Verify Event A registration count decreased by 1
  const postSummary = await ctx.agent.get('/api/admin/events-summary');
  const countAAfter = postSummary.body.events.find(e => e.id === eventA.id).registeredCount;
  assert.equal(countAAfter, countABefore - 1, 'Event A registered count must decrease by 1');

  // 6. Verify QR scan rejection for deleted registration A
  const verifyRes = await ctx.agent
    .post('/api/admin/attendance/verify')
    .set('X-CSRF-Token', ctx.csrf)
    .send({ eventId: eventA.id, registrationId: passA.registrationId });

  assert.equal(verifyRes.status, 200);
  assert.equal(verifyRes.body.ok, false);
  assert.equal(verifyRes.body.result, 'UNKNOWN_REGISTRATION');

  // 7. Verify Registration B can still be verified
  const verifyBRes = await ctx.agent
    .post('/api/admin/attendance/verify')
    .set('X-CSRF-Token', ctx.csrf)
    .send({ eventId: eventB.id, registrationId: passB.registrationId });

  assert.equal(verifyBRes.status, 200);
  assert.equal(verifyBRes.body.ok, true);
  assert.equal(verifyBRes.body.result, 'CHECKED_IN');

  // 8. Verify audit log entry
  const auditLog = await prisma.auditLog.findFirst({
    where: { action: 'registration.deleted', entityId: passA.registrationId },
  });
  assert.ok(auditLog, 'Audit log entry must be created for registration.deleted');
  assert.equal(auditLog.adminId, ctx.admin.id);
});
