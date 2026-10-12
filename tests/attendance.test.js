'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jsQR = require('jsqr');
const { PNG } = require('pngjs');
const { boot, makeEvent, studentFixture, teardown, prisma } = require('./helpers/harness');

let ctx;
before(async () => { ctx = await boot(); });
after(async () => { await teardown(); });

function decodePass(pngDataUrl) {
  const png = PNG.sync.read(Buffer.from(pngDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
  const res = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return res ? res.data : null;
}

async function register(event, student = studentFixture()) {
  const res = await ctx.api.post('/api/registrations').send({ eventId: event.id, ...student });
  assert.equal(res.status, 201);
  return res.body.pass;
}

const verify = (body) => ctx.agent.post('/api/admin/attendance/verify').set('x-csrf-token', ctx.csrf).send(body);

test('a genuine QR image decodes with an independent QR reader and matches the stored token', async () => {
  const event = await makeEvent();
  const pass = await register(event);
  const decoded = decodePass(pass.qr.pngDataUrl);
  assert.equal(decoded, pass.qr.payload, 'independent QR reader could not read the pass');
  const stored = await prisma.registration.findUnique({ where: { registrationId: pass.registrationId } });
  const inner = JSON.parse(Buffer.from(decoded.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(inner.t, stored.qrToken, 'decoded payload does not carry the stored opaque token');
  assert.equal(inner.r, pass.registrationId);
  assert.ok(!decoded.includes(stored.qrToken), 'the raw token must be inside the packed payload, not adjacent to it');
});

test('scanning a valid pass for the selected event marks the student present exactly once', async () => {
  const event = await makeEvent();
  const student = studentFixture();
  const pass = await register(event, student);

  const res = await verify({ eventId: event.id, code: pass.qr.payload });
  assert.equal(res.status, 200);
  assert.equal(res.body.result, 'CHECKED_IN');
  assert.equal(res.body.registration.name, student.name);

  const stored = await prisma.registration.findUnique({ where: { registrationId: pass.registrationId } });
  assert.equal(stored.attendanceStatus, 'PRESENT');
  assert.ok(stored.checkedInAt instanceof Date, 'check-in timestamp not stored');
  assert.equal(stored.checkedInByAdminId, ctx.admin.id, 'check-in not attributed to the admin');
});

test('scanning the same pass again does not create a second check-in', async () => {
  const event = await makeEvent();
  const pass = await register(event);
  const first = await verify({ eventId: event.id, code: pass.qr.payload });
  assert.equal(first.body.result, 'CHECKED_IN');
  const firstAt = (await prisma.registration.findUnique({ where: { registrationId: pass.registrationId } })).checkedInAt;

  const second = await verify({ eventId: event.id, code: pass.qr.payload });
  assert.equal(second.body.result, 'ALREADY_CHECKED_IN');
  const after = await prisma.registration.findUnique({ where: { registrationId: pass.registrationId } });
  assert.equal(after.checkedInAt.getTime(), firstAt.getTime(), 'timestamp was overwritten by a repeat scan');
  assert.equal(await prisma.registration.count({ where: { eventId: event.id, attendanceStatus: 'PRESENT' } }), 1);
});

test('concurrent scans of one pass record attendance only once (idempotent)', async () => {
  const event = await makeEvent();
  const pass = await register(event);
  const results = await Promise.all([
    verify({ eventId: event.id, code: pass.qr.payload }),
    verify({ eventId: event.id, code: pass.qr.payload }),
    verify({ eventId: event.id, code: pass.qr.payload }),
  ]);
  const kinds = results.map((r) => r.body.result);
  assert.equal(kinds.filter((k) => k === 'CHECKED_IN').length, 1, `expected exactly one CHECKED_IN, got ${kinds.join(',')}`);
  assert.equal(kinds.filter((k) => k === 'ALREADY_CHECKED_IN').length, 2);
  assert.equal(await prisma.registration.count({ where: { eventId: event.id, attendanceStatus: 'PRESENT' } }), 1);
});

test('a pass for a different event can never be checked in', async () => {
  const eventA = await makeEvent();
  const eventB = await makeEvent();
  const passA = await register(eventA);
  const res = await verify({ eventId: eventB.id, code: passA.qr.payload });
  assert.equal(res.status, 200);
  assert.equal(res.body.result, 'WRONG_EVENT');
  assert.equal(res.body.recorded, false);
  const stored = await prisma.registration.findUnique({ where: { registrationId: passA.registrationId } });
  assert.equal(stored.attendanceStatus, 'PENDING', 'wrong-event scan changed attendance');
});

test('tampered, unknown and non-QR codes are rejected', async () => {
  const event = await makeEvent();
  const pass = await register(event);
  const tampered = pass.qr.payload.slice(0, -4) + 'AAAA';
  const cases = [
    { code: tampered, expect: 'INVALID_CODE' },
    { code: 'SPK26.eyJ0Ijoibm90LXJlYWwifQ.abcdefghijklmnopqrstu', expect: 'INVALID_CODE' },
    { code: 'https://example.com/not-a-pass', expect: 'INVALID_CODE' },
    { code: 'SPK26.' + Buffer.from(JSON.stringify({ r: 'SP26-X-000000', t: 'x'.repeat(43), e: 'E01' })).toString('base64url') + '.deadbeefdeadbeefdeadbe', expect: 'INVALID_CODE' },
  ];
  for (const { code, expect } of cases) {
    const res = await verify({ eventId: event.id, code });
    assert.equal(res.body.result, expect, `code "${code.slice(0, 24)}…" produced ${res.body.result}`);
    assert.equal(res.body.recorded, false);
  }
  const unknown = await verify({ eventId: event.id, registrationId: 'SP26-XXX-ZZZZZZ' });
  assert.equal(unknown.body.result, 'UNKNOWN_REGISTRATION');
  assert.equal(await prisma.registration.count({ where: { eventId: event.id, attendanceStatus: 'PRESENT' } }), 0);
});

test('the manual fallback verifies by registration ID and is audited', async () => {
  const event = await makeEvent();
  const pass = await register(event);
  const res = await verify({ eventId: event.id, registrationId: pass.registrationId });
  assert.equal(res.body.result, 'CHECKED_IN');
  const log = await prisma.auditLog.findFirst({ where: { action: 'attendance.verified', entityId: pass.registrationId } });
  assert.ok(log, 'check-in was not audited');
  assert.equal(log.adminId, ctx.admin.id);
  assert.ok(!JSON.stringify(log.metadata).includes(pass.qr.token), 'audit log must not contain QR secrets');
});

test('draft or cancelled events cannot be checked in', async () => {
  const draft = await makeEvent({ status: 'DRAFT' });
  const res = await verify({ eventId: draft.id, registrationId: 'SP26-ANY-AAAAAA' });
  assert.equal(res.body.result, 'EVENT_NOT_SCANNABLE');
});

test('authorised admins can correct attendance manually, and it is audited', async () => {
  const event = await makeEvent();
  const pass = await register(event);
  const stored = await prisma.registration.findUnique({ where: { registrationId: pass.registrationId } });

  const setPresent = await ctx.agent.patch(`/api/admin/registrations/${stored.id}/attendance`)
    .set('x-csrf-token', ctx.csrf).send({ attendanceStatus: 'PRESENT' });
  assert.equal(setPresent.status, 200);
  assert.equal(setPresent.body.registration.attendanceStatus, 'PRESENT');

  const reset = await ctx.agent.patch(`/api/admin/registrations/${stored.id}/attendance`)
    .set('x-csrf-token', ctx.csrf).send({ attendanceStatus: 'PENDING' });
  assert.equal(reset.body.registration.attendanceStatus, 'PENDING');
  const cleared = await prisma.registration.findUnique({ where: { id: stored.id } });
  assert.equal(cleared.checkedInAt, null);

  const logs = await prisma.auditLog.findMany({ where: { action: 'attendance.manual_update', entityId: pass.registrationId } });
  assert.equal(logs.length, 2);
});

test('attendance totals reflect the database per event', async () => {
  const event = await makeEvent();
  const passA = await register(event);
  await register(event);
  await verify({ eventId: event.id, code: passA.qr.payload });
  const summary = await ctx.agent.get(`/api/admin/attendance/summary?eventId=${event.id}`);
  assert.deepEqual(
    { total: summary.body.summary.total, present: summary.body.summary.present, pending: summary.body.summary.pending },
    { total: 2, present: 1, pending: 1 }
  );
});
