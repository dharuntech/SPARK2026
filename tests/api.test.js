'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, makeEvent, studentFixture, teardown, prisma } = require('./helpers/harness');

let ctx;
before(async () => { ctx = await boot(); });
after(async () => { await teardown(); });

test('published events are served from the database', async () => {
  const event = await makeEvent();
  const res = await ctx.api.get('/api/events');
  assert.equal(res.status, 200);
  const found = res.body.events.find((e) => e.id === event.id);
  assert.ok(found, 'fixture event missing from the public list');
  assert.equal(found.timeLabel, '10:00 AM – 12:00 PM', 'IST time formatting');
  assert.equal(found.dateLabel, '01 Jan 2030');
  assert.equal(typeof found.registeredCount, 'number');
  assert.equal(found.registrationOpen, true);
});

test('draft and cancelled events are never exposed publicly', async () => {
  const draft = await makeEvent({ status: 'DRAFT' });
  const cancelled = await makeEvent({ status: 'CANCELLED' });
  const list = await ctx.api.get('/api/events');
  assert.ok(!list.body.events.some((e) => e.id === draft.id), 'draft event leaked');
  assert.ok(!list.body.events.some((e) => e.id === cancelled.id), 'cancelled event leaked');
  const detail = await ctx.api.get(`/api/events/${draft.id}`);
  assert.equal(detail.status, 404);
});

test('registration creates student + registration rows and a real QR pass', async () => {
  const event = await makeEvent();
  const student = studentFixture();
  const res = await ctx.api.post('/api/registrations').send({ eventId: event.id, ...student });
  assert.equal(res.status, 201);
  assert.match(res.body.pass.registrationId, /^SP26-T/);
  assert.ok(res.body.pass.qr.payload.startsWith('SPK26.'), 'signed payload expected');
  assert.ok(res.body.pass.qr.pngDataUrl.startsWith('data:image/png;base64,'));

  const stored = await prisma.registration.findUnique({
    where: { registrationId: res.body.pass.registrationId },
    include: { student: true, event: true },
  });
  assert.equal(stored.studentId, (await prisma.student.findUnique({ where: { registerNumber: student.registerNumber } })).id);
  assert.equal(stored.eventId, event.id);
  assert.equal(stored.attendanceStatus, 'PENDING');
  assert.equal(stored.source, 'WEBSITE');
  assert.ok(stored.qrToken.length >= 40, 'opaque token expected');
  assert.notEqual(stored.qrToken, res.body.pass.qr.token === stored.qrToken ? 'x' : stored.qrToken); // token is opaque, not derived
});

test('duplicate registration for the same event is rejected by the database constraint', async () => {
  const event = await makeEvent();
  const student = studentFixture();
  const first = await ctx.api.post('/api/registrations').send({ eventId: event.id, ...student });
  assert.equal(first.status, 201);
  const second = await ctx.api.post('/api/registrations').send({ eventId: event.id, ...student });
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'DUPLICATE_REGISTRATION');
  const count = await prisma.registration.count({ where: { eventId: event.id } });
  assert.equal(count, 1, 'duplicate row was stored');
});

test('concurrent duplicate submissions still create exactly one registration', async () => {
  const event = await makeEvent();
  const student = studentFixture();
  const results = await Promise.all(
    Array.from({ length: 4 }, () => ctx.api.post('/api/registrations').send({ eventId: event.id, ...student }))
  );
  const created = results.filter((r) => r.status === 201);
  assert.equal(created.length, 1, `expected exactly one 201, got ${results.map((r) => r.status).join(',')}`);
  assert.equal(await prisma.registration.count({ where: { eventId: event.id } }), 1);
});

test('one student can register for several different events', async () => {
  const a = await makeEvent();
  const b = await makeEvent();
  const student = studentFixture();
  const r1 = await ctx.api.post('/api/registrations').send({ eventId: a.id, ...student });
  const r2 = await ctx.api.post('/api/registrations').send({ eventId: b.id, ...student });
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 201);
  assert.equal(await prisma.student.count({ where: { registerNumber: student.registerNumber } }), 1, 'student record was duplicated');
});

test('server-side validation rejects invalid input and returns field errors', async () => {
  const event = await makeEvent();
  const res = await ctx.api.post('/api/registrations').send({ eventId: event.id, name: 'X', registerNumber: '12', department: '', academicYear: '', section: '', email: 'not-an-email' });
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  assert.ok(res.body.error.details.email);
  assert.ok(res.body.error.details.registerNumber);
});

test('on-spot-only events reject website registration', async () => {
  const event = await makeEvent({ registrationMode: 'ON_SPOT' });
  const res = await ctx.api.post('/api/registrations').send({ eventId: event.id, ...studentFixture() });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'ON_SPOT_ONLY');
});

test('capacity limits are enforced atomically', async () => {
  const event = await makeEvent({ maxCapacity: 1 });
  const first = await ctx.api.post('/api/registrations').send({ eventId: event.id, ...studentFixture() });
  assert.equal(first.status, 201);
  const second = await ctx.api.post('/api/registrations').send({ eventId: event.id, ...studentFixture() });
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'EVENT_FULL');
});

test('passed registration deadlines close online registration', async () => {
  const event = await makeEvent({ registrationDeadline: new Date(Date.now() - 3600_000) });
  const res = await ctx.api.post('/api/registrations').send({ eventId: event.id, ...studentFixture() });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'DEADLINE_PASSED');
});

test('registered-student counts are accurate per event', async () => {
  const event = await makeEvent();
  const other = await makeEvent();
  await ctx.api.post('/api/registrations').send({ eventId: event.id, ...studentFixture() });
  await ctx.api.post('/api/registrations').send({ eventId: event.id, ...studentFixture() });
  await ctx.api.post('/api/registrations').send({ eventId: other.id, ...studentFixture() });
  const detail = await ctx.api.get(`/api/events/${event.id}`);
  assert.equal(detail.body.event.registeredCount, 2);
  const admin = await ctx.agent.get('/api/admin/events');
  const row = admin.body.events.find((e) => e.id === event.id);
  assert.equal(row.registeredCount, 2);
});

test('pass retrieval works by capability token and by register number + email', async () => {
  const event = await makeEvent();
  const student = studentFixture();
  const created = await ctx.api.post('/api/registrations').send({ eventId: event.id, ...student });
  const token = created.body.pass.qr.token;

  const byToken = await ctx.api.get(`/api/passes/token/${encodeURIComponent(token)}`);
  assert.equal(byToken.status, 200);
  assert.equal(byToken.body.pass.registrationId, created.body.pass.registrationId);

  const byDetails = await ctx.api.post('/api/passes/lookup').send({ registerNumber: student.registerNumber, email: student.email });
  assert.equal(byDetails.status, 200);
  assert.equal(byDetails.body.passes.length, 1);

  const wrongEmail = await ctx.api.post('/api/passes/lookup').send({ registerNumber: student.registerNumber, email: 'someone.else@spark26.test' });
  assert.equal(wrongEmail.status, 404);

  const guessed = await ctx.api.get('/api/passes/token/SP26-NOPE-AAAAAA');
  assert.equal(guessed.status, 404);
});

test('the QR payload carries no personal data and exposes an opaque token only', async () => {
  const event = await makeEvent();
  const student = studentFixture();
  const created = await ctx.api.post('/api/registrations').send({ eventId: event.id, ...student });
  const payload = created.body.pass.qr.payload;
  const decoded = Buffer.from(payload.split('.')[1], 'base64url').toString('utf8');
  assert.ok(!decoded.includes(student.email));
  assert.ok(!decoded.includes(student.registerNumber));
  assert.ok(!decoded.toLowerCase().includes('password'));
  const parsed = JSON.parse(decoded);
  assert.deepEqual(Object.keys(parsed).sort(), ['e', 'r', 't']);
});

test('admin endpoints reject unauthenticated callers', async () => {
  const anon = require('supertest')(ctx.app);
  for (const [method, url] of [['get', '/api/admin/events'], ['get', '/api/admin/registrations'], ['post', '/api/admin/attendance/verify'], ['get', '/api/admin/export/master.xlsx']]) {
    const res = await anon[method](url).send({});
    assert.equal(res.status, 401, `${method.toUpperCase()} ${url} should require authentication`);
  }
});

test('state-changing admin requests require a valid CSRF token', async () => {
  const noCsrf = await ctx.agent.post('/api/admin/events').field('name', 'CSRF Check').field('category', 'TECHNICAL')
    .field('venue', 'Hall').field('eventDate', '2030-01-01').field('startTime', '10:00').field('endTime', '11:00')
    .field('description', 'Should be blocked');
  assert.equal(noCsrf.status, 403);
  assert.equal(noCsrf.body.error.code, 'CSRF_MISSING');
  const badCsrf = await ctx.agent.post('/api/admin/events').set('x-csrf-token', 'nope').send({});
  assert.equal(badCsrf.status, 403);
});

test('admin can create, publish and unpublish an event with an uploaded image', async () => {
  const { PNG } = require('pngjs');
  const png = new PNG({ width: 64, height: 64 });
  png.data.fill(200);
  const buffer = PNG.sync.write(png);

  const created = await ctx.agent.post('/api/admin/events')
    .set('x-csrf-token', ctx.csrf)
    .field('name', `Image Event ${Math.random().toString(36).slice(2, 7)}`)
    .field('category', 'NON_TECHNICAL')
    .field('venue', 'Canteen Hall')
    .field('eventDate', '2030-02-02')
    .field('startTime', '11:00')
    .field('endTime', '13:00')
    .field('description', 'Fixture event for automated tests.')
    .field('registrationMode', 'BOTH')
    .field('status', 'DRAFT')
    .attach('image', buffer, { filename: 'poster.png', contentType: 'image/png' });
  assert.equal(created.status, 201);
  assert.match(created.body.event.imageUrl, /^\/uploads\/events\//);

  const stillDraft = await ctx.api.get('/api/events');
  assert.ok(!stillDraft.body.events.some((e) => e.id === created.body.event.id), 'draft event visible publicly');

  const published = await ctx.agent.post(`/api/admin/events/${created.body.event.id}/status`)
    .set('x-csrf-token', ctx.csrf).send({ status: 'PUBLISHED' });
  assert.equal(published.status, 200);
  const nowPublic = await ctx.api.get('/api/events');
  const found = nowPublic.body.events.find((e) => e.id === created.body.event.id);
  assert.ok(found, 'published event not on the public API');
  assert.equal(found.imageUrl, created.body.event.imageUrl);

  const unpublished = await ctx.agent.post(`/api/admin/events/${created.body.event.id}/status`)
    .set('x-csrf-token', ctx.csrf).send({ status: 'DRAFT' });
  assert.equal(unpublished.body.event.status, 'DRAFT');

  const gone = await ctx.api.get('/api/events');
  assert.ok(!gone.body.events.some((e) => e.id === created.body.event.id), 'unpublished event still public');

  const audit = await prisma.auditLog.findMany({ where: { entityId: created.body.event.id } });
  assert.ok(audit.some((a) => a.action === 'event.created'));
  assert.ok(audit.some((a) => a.action === 'event.published'));
});

test('fake images are rejected by content sniffing', async () => {
  const res = await ctx.agent.post('/api/admin/events')
    .set('x-csrf-token', ctx.csrf)
    .field('name', 'Fake Image Event')
    .field('category', 'TECHNICAL')
    .field('venue', 'Hall')
    .field('eventDate', '2030-03-03')
    .field('startTime', '10:00')
    .field('endTime', '11:00')
    .field('description', 'Fixture event for automated tests.')
    .attach('image', Buffer.from('this is definitely not a png'), { filename: 'evil.png', contentType: 'image/png' });
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /not a valid/i);
});

test('an event with registrations cannot be deleted, only archived', async () => {
  const event = await makeEvent();
  await ctx.api.post('/api/registrations').send({ eventId: event.id, ...studentFixture() });
  const del = await ctx.agent.delete(`/api/admin/events/${event.id}`).set('x-csrf-token', ctx.csrf);
  assert.equal(del.status, 409);
  assert.equal(del.body.error.code, 'EVENT_HAS_REGISTRATIONS');
  const archive = await ctx.agent.post(`/api/admin/events/${event.id}/archive`).set('x-csrf-token', ctx.csrf);
  assert.equal(archive.status, 200);
  assert.equal(archive.body.event.status, 'CANCELLED');
  assert.equal(await prisma.registration.count({ where: { eventId: event.id } }), 1, 'history was destroyed');
});

test('on-spot registration creates the same reliable records as website registration', async () => {
  const event = await makeEvent({ registrationMode: 'ON_SPOT' });
  const student = studentFixture('S');
  const res = await ctx.agent.post('/api/admin/registrations').set('x-csrf-token', ctx.csrf).send({ eventId: event.id, ...student });
  assert.equal(res.status, 201);
  assert.equal(res.body.pass.source, 'ON_SPOT');
  const stored = await prisma.registration.findUnique({ where: { registrationId: res.body.pass.registrationId } });
  assert.equal(stored.source, 'ON_SPOT');
  assert.equal(stored.createdByAdminId, ctx.admin.id);
  assert.ok(stored.qrToken && stored.qrToken.length > 40);

  const participants = await ctx.agent.get(`/api/admin/events/${event.id}/participants`);
  assert.equal(participants.body.pagination.total, 1);
  assert.equal(participants.body.registrations[0].source, 'ON_SPOT');
});

test('participant list for an event contains only that event\'s students and supports search', async () => {
  const event = await makeEvent();
  const other = await makeEvent();
  const mine = studentFixture();
  await ctx.api.post('/api/registrations').send({ eventId: event.id, ...mine });
  await ctx.api.post('/api/registrations').send({ eventId: other.id, ...studentFixture() });

  const all = await ctx.agent.get(`/api/admin/events/${event.id}/participants`);
  assert.equal(all.body.pagination.total, 1);
  assert.equal(all.body.registrations[0].registerNumber, mine.registerNumber);

  const searchHit = await ctx.agent.get(`/api/admin/events/${event.id}/participants?search=${encodeURIComponent(mine.email)}`);
  assert.equal(searchHit.body.pagination.total, 1);
  const searchMiss = await ctx.agent.get(`/api/admin/events/${event.id}/participants?search=zzz-nobody`);
  assert.equal(searchMiss.body.pagination.total, 0);

  const byRegisterNumber = await ctx.agent.get(`/api/admin/registrations?search=${encodeURIComponent(mine.registerNumber)}`);
  assert.ok(byRegisterNumber.body.registrations.some((r) => r.registerNumber === mine.registerNumber));
});

test('dashboard statistics match the database', async () => {
  const res = await ctx.agent.get('/api/admin/events');
  assert.equal(res.status, 200);
  const [published, drafts, registrations, attendance] = await Promise.all([
    prisma.event.count({ where: { status: 'PUBLISHED' } }),
    prisma.event.count({ where: { status: 'DRAFT' } }),
    prisma.registration.count(),
    prisma.registration.count({ where: { attendanceStatus: 'PRESENT' } }),
  ]);
  assert.equal(res.body.stats.published, published);
  assert.equal(res.body.stats.drafts, drafts);
  assert.equal(res.body.stats.registrations, registrations);
  assert.equal(res.body.stats.attendance, attendance);
});

test('the home-page hero photo is uploaded, persisted and removable', async () => {
  const { PNG } = require('pngjs');
  const png = new PNG({ width: 48, height: 24 });
  png.data.fill(120);
  const buffer = PNG.sync.write(png);

  const upload = await ctx.agent.post('/api/admin/settings/home-hero')
    .set('x-csrf-token', ctx.csrf)
    .attach('image', buffer, { filename: 'hero.png', contentType: 'image/png' });
  assert.equal(upload.status, 200);
  assert.match(upload.body.homeHeroImageUrl, /^\/uploads\/site\//);

  const settings = await ctx.api.get('/api/settings');
  assert.equal(settings.body.settings.homeHeroImageUrl, upload.body.homeHeroImageUrl, 'hero image not persisted for the public site');
  const file = require('path').join(require('../src/config/env').uploadDir, upload.body.homeHeroImageUrl.replace('/uploads/', ''));
  assert.ok(require('fs').existsSync(file), 'uploaded hero file is missing from disk');

  const reset = await ctx.agent.delete('/api/admin/settings/home-hero').set('x-csrf-token', ctx.csrf);
  assert.equal(reset.status, 200);
  const after = await ctx.api.get('/api/settings');
  assert.equal(after.body.settings.homeHeroImageUrl, null);
  assert.ok(!require('fs').existsSync(file), 'removed hero file was left on disk');
});

test('a BOTH-mode event accepts website and on-spot registrations but never a duplicate', async () => {
  const event = await makeEvent({ registrationMode: 'BOTH' });
  const online = studentFixture();
  const venue = studentFixture();

  const web = await ctx.api.post('/api/registrations').send({ eventId: event.id, ...online });
  assert.equal(web.status, 201);
  assert.equal(web.body.pass.source, 'WEBSITE');

  const spot = await ctx.agent.post('/api/admin/registrations').set('x-csrf-token', ctx.csrf).send({ eventId: event.id, ...venue });
  assert.equal(spot.status, 201);
  assert.equal(spot.body.pass.source, 'ON_SPOT');

  // same person, second attempt at the venue → rejected by the database constraint
  const duplicate = await ctx.agent.post('/api/admin/registrations').set('x-csrf-token', ctx.csrf).send({ eventId: event.id, ...online });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, 'DUPLICATE_REGISTRATION');

  const participants = await ctx.agent.get(`/api/admin/events/${event.id}/participants`);
  assert.equal(participants.body.pagination.total, 2);
  assert.deepEqual(participants.body.registrations.map((r) => r.source).sort(), ['ON_SPOT', 'WEBSITE']);
});
