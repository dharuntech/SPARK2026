'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { boot, makeEvent, studentFixture, teardown, prisma } = require('./helpers/harness');

let ctx;
before(async () => { ctx = await boot(); });
after(async () => { await teardown(); });

/** superagent has no built-in parser for xlsx — collect the raw bytes ourselves. */
function binaryParser(res, cb) {
  res.setEncoding('binary');
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => cb(null, Buffer.from(data, 'binary')));
}
const fetchXlsx = (agent, url) => agent.get(url).buffer(true).parse(binaryParser);

async function register(event, student = studentFixture()) {
  const res = await ctx.api.post('/api/registrations').send({ eventId: event.id, ...student });
  assert.equal(res.status, 201);
  return res.body.pass;
}

async function loadWorkbook(res) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body);
  return wb;
}

function parseSheetKeyValues(sheet) {
  const rows = [];
  sheet.eachRow((r, n) => {
    rows.push({
      line: n,
      field: r.getCell(1).value != null ? String(r.getCell(1).value).trim() : '',
      details: r.getCell(2).value != null ? String(r.getCell(2).value).trim() : '',
    });
  });
  return rows;
}

test('event workbook is a genuine .xlsx with exactly one worksheet and vertical team layout', async () => {
  const eventA = await makeEvent({ name: 'Workbook Alpha', category: 'TECHNICAL' });
  const eventB = await makeEvent({ name: 'Workbook Beta', category: 'NON_TECHNICAL' });
  const alice = studentFixture();
  const bob = studentFixture();
  await register(eventA, alice);
  await register(eventA, bob);
  await register(eventB, studentFixture());

  const res = await fetchXlsx(ctx.agent, `/api/admin/events/${eventA.id}/registrations.xlsx`);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /spreadsheetml\.sheet/);
  assert.match(res.headers['content-disposition'], /Spark26_Workbook_Alpha_Registrations\.xlsx/);
  assert.equal(res.headers['x-export-rows'], '2');

  const wb = await loadWorkbook(res);
  assert.equal(wb.worksheets.length, 1, 'must have exactly one worksheet');

  const sheet = wb.worksheets[0];
  assert.equal(sheet.getRow(1).getCell(1).value, 'Field');
  assert.equal(sheet.getRow(1).getCell(2).value, 'Details');

  const rows = parseSheetKeyValues(sheet);
  const eventNames = rows.filter((r) => r.field === 'Event Name').map((r) => r.details);
  const leaderNames = rows.filter((r) => r.field === 'Team Leader Name').map((r) => r.details);

  assert.equal(eventNames.length, 2);
  assert.ok(eventNames.every((n) => n === 'Workbook Alpha'));
  assert.deepEqual(leaderNames.sort(), [alice.name, bob.name].sort());

  // Check solo team members note
  const teamMemberRows = rows.filter((r) => r.field === 'TEAM MEMBERS');
  assert.equal(teamMemberRows.length, 2);
  assert.ok(teamMemberRows.every((r) => r.details === 'No additional team members'));
});

test('exported attendance reflects a later check-in (database remains authoritative)', async () => {
  const event = await makeEvent({ name: 'Workbook Gamma' });
  const student = studentFixture();
  const pass = await register(event, student);

  const before = await fetchXlsx(ctx.agent, `/api/admin/events/${event.id}/registrations.xlsx`);
  const wbBefore = await loadWorkbook(before);
  const rowsBefore = parseSheetKeyValues(wbBefore.worksheets[0]);
  const attBefore = rowsBefore.find((r) => r.field === 'Attendance Status');
  assert.equal(attBefore.details, 'Pending');

  await ctx.agent.post('/api/admin/attendance/verify').set('x-csrf-token', ctx.csrf).send({ eventId: event.id, code: pass.qr.payload });

  const after = await fetchXlsx(ctx.agent, `/api/admin/events/${event.id}/registrations.xlsx`);
  assert.equal(after.headers['x-export-present'], '1');
  const wbAfter = await loadWorkbook(after);
  const rowsAfter = parseSheetKeyValues(wbAfter.worksheets[0]);
  const attAfter = rowsAfter.find((r) => r.field === 'Attendance Status');
  assert.equal(attAfter.details, 'Present');
});

test('team registrations export all team members directly below their leader in one worksheet', async () => {
  const nfEvent = await makeEvent({ name: 'NeuroForge Team Test', category: 'TECHNICAL' });
  const leader = { ...studentFixture(), phone: '9876543210' };
  const m2 = { name: 'Bob Two', registerNumber: '710023104002', department: 'CSE', academicYear: 'III', section: 'A' };
  const m3 = { name: 'Charlie Three', registerNumber: '710023104003', department: 'ECE', academicYear: 'III', section: 'B' };
  const m4 = { name: 'David Four', registerNumber: '710023104004', department: 'IT', academicYear: 'II', section: 'C' };

  await register(nfEvent, {
    ...leader,
    teamMembers: [m2, m3, m4],
  });

  const res = await fetchXlsx(ctx.agent, `/api/admin/events/${nfEvent.id}/registrations.xlsx`);
  assert.equal(res.status, 200);
  const wb = await loadWorkbook(res);
  assert.equal(wb.worksheets.length, 1, 'must have exactly one worksheet');

  const sheet = wb.worksheets[0];
  const rows = parseSheetKeyValues(sheet);

  // 1. Leader appears first
  const leaderIdx = rows.findIndex((r) => r.field === 'Team Leader Name');
  assert.ok(leaderIdx > 0);
  assert.equal(rows[leaderIdx].details, leader.name);

  // Leader details
  assert.equal(rows[leaderIdx - 2].field, 'Event Name');
  assert.equal(rows[leaderIdx - 2].details, nfEvent.name);
  assert.equal(rows[leaderIdx + 1].field, 'Register Number');
  assert.equal(rows[leaderIdx + 1].details, leader.registerNumber.toUpperCase());
  assert.equal(rows[leaderIdx + 5].field, 'Email');
  assert.equal(rows[leaderIdx + 5].details, leader.email.toLowerCase());
  assert.equal(rows[leaderIdx + 6].field, 'Mobile Number');
  assert.equal(rows[leaderIdx + 6].details, leader.phone);

  // 2. TEAM MEMBERS section immediately below leader
  const tmIdx = rows.findIndex((r) => r.field === 'TEAM MEMBERS');
  assert.ok(tmIdx > leaderIdx, 'TEAM MEMBERS must appear below team leader');
  assert.match(rows[tmIdx].details, /3 Member\(s\)/);

  // 3. Member 1
  assert.equal(rows[tmIdx + 1].field, 'Member 1 Name');
  assert.equal(rows[tmIdx + 1].details, m2.name);
  assert.equal(rows[tmIdx + 2].field, 'Register Number');
  assert.equal(rows[tmIdx + 2].details, m2.registerNumber);
  assert.equal(rows[tmIdx + 3].field, 'Department');
  assert.equal(rows[tmIdx + 3].details, m2.department);

  // 4. Member 2
  assert.equal(rows[tmIdx + 8].field, 'Member 2 Name');
  assert.equal(rows[tmIdx + 8].details, m3.name);
  assert.equal(rows[tmIdx + 9].field, 'Register Number');
  assert.equal(rows[tmIdx + 9].details, m3.registerNumber);

  // 5. Member 3
  assert.equal(rows[tmIdx + 15].field, 'Member 3 Name');
  assert.equal(rows[tmIdx + 15].details, m4.name);
  assert.equal(rows[tmIdx + 16].field, 'Register Number');
  assert.equal(rows[tmIdx + 16].details, m4.registerNumber);
});

test('CSV exports include vertical format with team leader and all members', async () => {
  const event = await makeEvent({ name: 'CSV Test Event' });
  const leader = studentFixture();
  const m2 = { name: 'Alice M2', registerNumber: '710023104010', department: 'CSE', academicYear: 'III', section: 'A' };
  const m3 = { name: 'Bob M3', registerNumber: '710023104011', department: 'CSE', academicYear: 'III', section: 'A' };

  await register(event, { ...leader, teamMembers: [m2, m3] });

  // Event CSV
  const eventCsvRes = await ctx.agent.get(`/api/admin/events/${event.id}/registrations.csv`);
  assert.equal(eventCsvRes.status, 200);
  assert.match(eventCsvRes.headers['content-type'], /text\/csv/);
  assert.match(eventCsvRes.headers['content-disposition'], /Spark26_CSV_Test_Event_Registrations\.csv/);
  assert.ok(eventCsvRes.text.includes('Team Leader Name'));
  assert.ok(eventCsvRes.text.includes('Member 1 Name'));
  assert.ok(eventCsvRes.text.includes('Member 2 Name'));
  assert.ok(eventCsvRes.text.includes(m2.name));
  assert.ok(eventCsvRes.text.includes(m2.registerNumber));
  assert.ok(eventCsvRes.text.includes(m3.name));

  // All registrations CSV
  const allCsvRes = await ctx.agent.get('/api/admin/export/registrations.csv');
  assert.equal(allCsvRes.status, 200);
  assert.match(allCsvRes.headers['content-type'], /text\/csv/);
  assert.match(allCsvRes.headers['content-disposition'], /Spark26_Registrations_.*\.csv/);
  assert.ok(allCsvRes.text.includes('Team Leader Name'));
  assert.ok(allCsvRes.text.includes(m2.name));
});

test('master workbook has exactly one worksheet with all registered teams in vertical layout', async () => {
  const eventA = await makeEvent({ name: 'Master One' });
  const eventB = await makeEvent({ name: 'Master Two' });
  await register(eventA, studentFixture());
  await register(eventA, studentFixture());
  await register(eventB, studentFixture());

  const res = await fetchXlsx(ctx.agent, '/api/admin/export/master.xlsx');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-disposition'], /Spark26_Master_Registrations_.*\.xlsx/);

  const wb = await loadWorkbook(res);
  assert.equal(wb.worksheets.length, 1, 'master workbook must have exactly one worksheet');

  const sheet = wb.worksheets[0];
  const rows = parseSheetKeyValues(sheet);
  const events = rows.filter((r) => r.field === 'Event Name').map((r) => r.details);
  assert.equal(events.filter((e) => e === 'Master One').length, 2);
  assert.equal(events.filter((e) => e === 'Master Two').length, 1);
});

test('exports are gated behind authentication and audited', async () => {
  const anon = require('supertest')(ctx.app);
  const blocked = await anon.get('/api/admin/export/master.xlsx');
  assert.equal(blocked.status, 401);

  const event = await makeEvent({ name: 'Audited Export' });
  await ctx.agent.get(`/api/admin/events/${event.id}/registrations.xlsx`);
  const log = await prisma.auditLog.findFirst({ where: { action: 'export.event_xlsx', entityId: event.id } });
  assert.ok(log, 'export was not audited');
});
