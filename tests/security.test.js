'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { boot, makeEvent, studentFixture, teardown, prisma } = require('./helpers/harness');
const { build } = require('../src/middleware/rateLimit');

let ctx;
before(async () => { ctx = await boot(); });
after(async () => { await teardown(); });

test('passwords are stored only as bcrypt hashes', async () => {
  const admin = await prisma.adminUser.findUnique({ where: { email: ctx.admin.email } });
  assert.match(admin.passwordHash, /^\$2[aby]\$/);
  assert.ok(!admin.passwordHash.includes('TestPassw0rd'));
  const ok = await bcrypt.compare('TestPassw0rd!26', admin.passwordHash);
  assert.equal(ok, true);
});

test('login failures do not reveal whether an account exists', async () => {
  const unknown = await request(ctx.app).post('/api/admin/auth/login').send({ email: 'nobody@spark26.test', password: 'whatever123' });
  const wrong = await request(ctx.app).post('/api/admin/auth/login').send({ email: ctx.admin.email, password: 'wrong-password' });
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(unknown.body.error.message, wrong.body.error.message);
});

test('no public admin-registration endpoint exists', async () => {
  for (const url of ['/api/admin/register', '/api/admin/signup', '/api/admin/users']) {
    const res = await request(ctx.app).post(url).send({ email: 'evil@spark26.test', password: 'x'.repeat(12) });
    assert.ok([401, 404].includes(res.status), `${url} should not be reachable (got ${res.status})`);
  }
});

test('disabled admins lose their session immediately', async () => {
  const email = `disabled-${Math.random().toString(36).slice(2, 7)}@spark26.test`;
  const password = 'Disabled123!';
  const admin = await prisma.adminUser.create({
    data: { name: 'Disabled Admin', email, passwordHash: await bcrypt.hash(password, 4), role: 'ADMIN', status: 'ACTIVE' },
  });
  const agent = request.agent(ctx.app);
  const login = await agent.post('/api/admin/auth/login').send({ email, password });
  assert.equal(login.status, 200);
  assert.equal((await agent.get('/api/admin/auth/session')).status, 200);

  await prisma.adminUser.update({ where: { id: admin.id }, data: { status: 'DISABLED' } });
  const after = await agent.get('/api/admin/auth/session');
  assert.equal(after.status, 401, 'disabled admin kept access');
});

test('the session cookie is HTTP-only and SameSite protected', async () => {
  const agent = request.agent(ctx.app);
  const res = await agent.post('/api/admin/auth/login').send({ email: ctx.admin.email, password: 'TestPassw0rd!26' });
  const cookie = res.headers['set-cookie'].find((c) => c.startsWith('spark26.sid='));
  assert.ok(cookie, 'session cookie missing');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
});

test('a SCANNER-role admin cannot create events but can verify passes', async () => {
  const email = `scanner-${Math.random().toString(36).slice(2, 7)}@spark26.test`;
  const password = 'Scanner123!';
  await prisma.adminUser.create({ data: { name: 'Scanner', email, passwordHash: await bcrypt.hash(password, 4), role: 'SCANNER' } });
  const agent = request.agent(ctx.app);
  const login = await agent.post('/api/admin/auth/login').send({ email, password });
  const csrf = login.body.csrfToken;

  const createEvent = await agent.post('/api/admin/events').set('x-csrf-token', csrf)
    .field('name', 'Scanner Attempt').field('category', 'TECHNICAL').field('venue', 'Hall')
    .field('eventDate', '2030-01-01').field('startTime', '10:00').field('endTime', '11:00').field('description', 'should be forbidden');
  assert.equal(createEvent.status, 403, 'SCANNER role should not publish events');

  const event = await makeEvent();
  const pass = (await ctx.api.post('/api/registrations').send({ eventId: event.id, ...studentFixture() })).body.pass;
  const verify = await agent.post('/api/admin/attendance/verify').set('x-csrf-token', csrf).send({ eventId: event.id, code: pass.qr.payload });
  assert.equal(verify.status, 200);
  assert.equal(verify.body.result, 'CHECKED_IN');
});

test('students cannot read other students’ registrations through the API', async () => {
  const event = await makeEvent();
  const a = studentFixture();
  const b = studentFixture();
  await ctx.api.post('/api/registrations').send({ eventId: event.id, ...a });
  await ctx.api.post('/api/registrations').send({ eventId: event.id, ...b });

  const withWrongEmail = await ctx.api.post('/api/passes/lookup').send({ registerNumber: a.registerNumber, email: b.email });
  assert.equal(withWrongEmail.status, 404);

  const registrationList = await request(ctx.app).get('/api/registrations');
  assert.ok([401, 404].includes(registrationList.status), 'registration list must not be public');
});

test('login rate limiting engages when enabled', async () => {
  const limiter = build({ windowMs: 60_000, max: 3, message: 'too many', alwaysOn: true, prefix: `rl:testlogin:${Date.now()}:` });
  const app = require('express')();
  app.set('trust proxy', 1);
  app.post('/login', limiter, (_req, res) => res.json({ ok: true }));
  const agent = request(app);
  const statuses = [];
  for (let i = 0; i < 5; i += 1) statuses.push((await agent.post('/login').send({})).status);
  assert.deepEqual(statuses.slice(0, 3), [200, 200, 200]);
  assert.equal(statuses[3], 429, 'rate limiter did not engage');
});

test('errors never leak internals, stack traces or secrets', async () => {
  const bad = await ctx.api.post('/api/registrations').send({ eventId: 'does-not-exist', ...studentFixture() });
  assert.equal(bad.status, 404);
  const text = JSON.stringify(bad.body);
  assert.ok(!/prisma|stack|at Object|\/home\//i.test(text), 'error response leaked internals: ' + text);
  assert.ok(!text.includes('password'));
});

test('audit log never stores QR tokens, passwords or full student rows', async () => {
  const event = await makeEvent();
  const student = studentFixture();
  const pass = (await ctx.api.post('/api/registrations').send({ eventId: event.id, ...student })).body.pass;
  await ctx.agent.post('/api/admin/attendance/verify').set('x-csrf-token', ctx.csrf).send({ eventId: event.id, code: pass.qr.payload });
  const logs = await prisma.auditLog.findMany({ where: { entityId: pass.registrationId } });
  const serialized = JSON.stringify(logs);
  assert.ok(!serialized.includes(pass.qr.token), 'audit metadata contains the QR token');
  assert.ok(!serialized.includes(student.email), 'audit metadata contains student PII');
});

test('uploaded files are served from the upload directory and reject traversal', async () => {
  const res = await ctx.api.get('/uploads/../../etc/passwd');
  assert.ok(res.status >= 400 || res.type === 'text/html', 'static server exposed a traversal path');
  const traversal = await ctx.api.get('/uploads/..%2f..%2fetc%2fpasswd');
  assert.ok(traversal.status >= 400 || !String(traversal.text || '').includes('root:'), 'path traversal succeeded');
});

test('health endpoint responds without authentication and reveals nothing sensitive', async () => {
  const res = await request(ctx.app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(Object.keys(res.body).sort(), ['ok', 'service', 'time', 'timezone']);
});

test('postgres distributed rate limiter persists atomic counters and sets Retry-After on 429', async () => {
  const { PostgresStore, build } = require('../src/middleware/rateLimit');
  const store = new PostgresStore({ prefix: 'rl:test:' });
  const key = `ip-test-${Date.now()}`;
  const hit1 = await store.increment(key);
  assert.equal(hit1.totalHits, 1);
  const hit2 = await store.increment(key);
  assert.equal(hit2.totalHits, 2);
  await store.resetKey(key);

  const limiter = build({ windowMs: 30_000, max: 2, message: 'Too many requests.', alwaysOn: true, prefix: `rl:testsuite:${Date.now()}:` });
  const app = require('express')();
  app.set('trust proxy', 1);
  app.get('/test-rl', limiter, (_req, res) => res.json({ ok: true }));
  const agent = request(app);

  const r1 = await agent.get('/test-rl');
  const r2 = await agent.get('/test-rl');
  const r3 = await agent.get('/test-rl');
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(r3.status, 429);
  assert.equal(r3.body.ok, false);
  assert.equal(r3.body.error.code, 'RATE_LIMITED');
  assert.ok(r3.headers['retry-after'], 'expected Retry-After header on 429');
});

test('high-concurrency registration transactions strictly enforce event capacity without overbooking', async () => {
  // Create an event with maximum capacity = 3
  const event = await makeEvent({ maxCapacity: 3 });
  const students = Array.from({ length: 8 }, () => studentFixture());

  // Fire 8 concurrent registration requests simultaneously
  const results = await Promise.all(
    students.map((student) =>
      ctx.api.post('/api/registrations').send({ eventId: event.id, ...student })
    )
  );

  const successes = results.filter((r) => r.status === 201);
  const fullRejections = results.filter((r) => r.status === 409 && r.body.error?.code === 'EVENT_FULL');

  assert.equal(successes.length, 3, `Expected exactly 3 registrations to succeed, got ${successes.length}`);
  assert.equal(fullRejections.length, 5, `Expected 5 requests to be rejected with EVENT_FULL, got ${fullRejections.length}`);

  // Confirm database row count matches capacity
  const confirmedCount = await prisma.registration.count({ where: { eventId: event.id, status: 'CONFIRMED' } });
  assert.equal(confirmedCount, 3, 'Database count exceeded event capacity');
});

