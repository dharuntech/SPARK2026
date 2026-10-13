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

const EXPECTED_BASE_11_HEADERS = [
  'Event Name',
  'Team Name',
  'Team Leader Name',
  'Register Number',
  'Department',
  'Year',
  'Section',
  'Email',
  'Mobile Number',
  'Registration ID',
  'Attendance Status',
];

test('Event Participants Excel export has column headers in Row 1 and one row per registration', async () => {
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
  assert.equal(wb.worksheets.length, 1);
  const sheet = wb.worksheets[0];

  // 1. First row must contain column headers
  const headers = sheet.getRow(1).values.slice(1).map(String);
  for (const expected of EXPECTED_BASE_11_HEADERS) {
    assert.ok(headers.includes(expected), `missing header: ${expected}`);
  }

  // 2. Formatting requirements: frozen row 1, auto-filter, bold white text on dark header
  assert.equal(sheet.views[0].state, 'frozen');
  assert.equal(sheet.views[0].ySplit, 1);
  assert.ok(sheet.autoFilter, 'Excel autoFilter missing on headers');
  assert.equal(sheet.getRow(1).getCell(1).font.bold, true);
  assert.equal(sheet.getRow(1).getCell(1).font.color.argb, 'FFFFFFFF');

  // 3. Every subsequent row represents exactly one registration
  // Total rows: 1 header row + 2 data rows = 3 rows
  assert.equal(sheet.rowCount, 3, 'unexpected row count: must be header + 2 registrations');

  const row1 = sheet.getRow(2);
  const row2 = sheet.getRow(3);

  // Column A: Event Name
  assert.equal(row1.getCell(1).value, 'Workbook Alpha');
  assert.equal(row2.getCell(1).value, 'Workbook Alpha');

  // Column C: Team Leader Name
  const names = [row1.getCell(3).value, row2.getCell(3).value];
  assert.deepEqual(names.sort(), [alice.name, bob.name].sort());

  // Column D: Register Number
  const regNos = [row1.getCell(4).value, row2.getCell(4).value];
  assert.deepEqual(regNos.sort(), [alice.registerNumber.toUpperCase(), bob.registerNumber.toUpperCase()].sort());

  // Column J: Registration ID
  assert.ok(String(row1.getCell(10).value).startsWith('SP26-'));
  assert.ok(String(row2.getCell(10).value).startsWith('SP26-'));

  // Column K: Attendance Status
  assert.equal(row1.getCell(11).value, 'Pending');
  assert.equal(row2.getCell(11).value, 'Pending');
});

test('exported attendance reflects a later check-in (database remains authoritative)', async () => {
  const event = await makeEvent({ name: 'Workbook Gamma' });
  const student = studentFixture();
  const pass = await register(event, student);

  const before = await fetchXlsx(ctx.agent, `/api/admin/events/${event.id}/registrations.xlsx`);
  const wbBefore = await loadWorkbook(before);
  const sheetBefore = wbBefore.worksheets[0];
  assert.equal(sheetBefore.getRow(2).getCell(11).value, 'Pending');

  await ctx.agent.post('/api/admin/attendance/verify').set('x-csrf-token', ctx.csrf).send({ eventId: event.id, code: pass.qr.payload });

  const after = await fetchXlsx(ctx.agent, `/api/admin/events/${event.id}/registrations.xlsx`);
  assert.equal(after.headers['x-export-present'], '1');
  const wbAfter = await loadWorkbook(after);
  const sheetAfter = wbAfter.worksheets[0];
  assert.equal(sheetAfter.getRow(2).getCell(11).value, 'Present');
});

test('team registrations export all team members on the same row with member columns', async () => {
  const nfEvent = await makeEvent({ name: 'NeuroForge Team Test', category: 'TECHNICAL' });
  const leader = { ...studentFixture(), phone: '9876543210' };
  const m2 = { name: 'Bob Two', registerNumber: '710023104002', department: 'CSE', academicYear: 'III', section: 'A', email: 'bob@example.com', phone: '9876543212' };
  const m3 = { name: 'Charlie Three', registerNumber: '710023104003', department: 'ECE', academicYear: 'III', section: 'B', email: 'charlie@example.com', phone: '9876543213' };
  const m4 = { name: 'David Four', registerNumber: '710023104004', department: 'IT', academicYear: 'II', section: 'C', email: 'david@example.com', phone: '9876543214' };

  const pass = await register(nfEvent, {
    ...leader,
    teamName: 'Cyber Titans',
    teamMembers: [m2, m3, m4],
  });

  const res = await fetchXlsx(ctx.agent, `/api/admin/events/${nfEvent.id}/registrations.xlsx`);
  assert.equal(res.status, 200);
  const wb = await loadWorkbook(res);
  const sheet = wb.worksheets[0];

  // 1 row for header + 1 row for the registered team = 2 rows
  assert.equal(sheet.rowCount, 2);

  const headers = sheet.getRow(1).values.slice(1).map(String);

  // Check leader columns
  assert.equal(headers[0], 'Event Name');
  assert.equal(headers[1], 'Team Name');
  assert.equal(headers[2], 'Team Leader Name');
  assert.equal(headers[3], 'Register Number');
  assert.equal(headers[4], 'Department');
  assert.equal(headers[5], 'Year');
  assert.equal(headers[6], 'Section');
  assert.equal(headers[7], 'Email');
  assert.equal(headers[8], 'Mobile Number');
  assert.equal(headers[9], 'Registration ID');
  assert.equal(headers[10], 'Attendance Status');

  // Check member 1 columns
  assert.equal(headers[11], 'Member 1 Name');
  assert.equal(headers[12], 'Member 1 Register Number');
  assert.equal(headers[13], 'Member 1 Department');
  assert.equal(headers[14], 'Member 1 Year');
  assert.equal(headers[15], 'Member 1 Section');
  assert.equal(headers[16], 'Member 1 Email');
  assert.equal(headers[17], 'Member 1 Mobile Number');

  // Check member 2 columns
  assert.equal(headers[18], 'Member 2 Name');
  assert.equal(headers[19], 'Member 2 Register Number');

  // Check member 3 columns
  assert.equal(headers[25], 'Member 3 Name');
  assert.equal(headers[26], 'Member 3 Register Number');

  // Check row data
  const dataRow = sheet.getRow(2);
  assert.equal(dataRow.getCell(1).value, nfEvent.name);
  assert.equal(dataRow.getCell(2).value, 'Cyber Titans');
  assert.equal(dataRow.getCell(3).value, leader.name);
  assert.equal(dataRow.getCell(4).value, leader.registerNumber.toUpperCase());
  assert.equal(dataRow.getCell(8).value, leader.email.toLowerCase());
  assert.equal(dataRow.getCell(9).value, leader.phone);
  assert.equal(dataRow.getCell(10).value, pass.registrationId);
  assert.equal(dataRow.getCell(11).value, 'Pending');

  // Member 1 values
  assert.equal(dataRow.getCell(12).value, m2.name);
  assert.equal(dataRow.getCell(13).value, m2.registerNumber);
  assert.equal(dataRow.getCell(14).value, m2.department);
  assert.equal(dataRow.getCell(15).value, m2.academicYear);
  assert.equal(dataRow.getCell(16).value, m2.section);

  // Member 2 values
  assert.equal(dataRow.getCell(19).value, m3.name);
  assert.equal(dataRow.getCell(20).value, m3.registerNumber);

  // Member 3 values
  assert.equal(dataRow.getCell(26).value, m4.name);
  assert.equal(dataRow.getCell(27).value, m4.registerNumber);
});

test('Registration List CSV export has one registration per row with column headers in row 1', async () => {
  const event = await makeEvent({ name: 'CSV Test Event' });
  const leader = { ...studentFixture(), phone: '9876543299' };
  const m2 = { name: 'Alice M2', registerNumber: '710023104010', department: 'CSE', academicYear: 'III', section: 'A' };
  const m3 = { name: 'Bob M3', registerNumber: '710023104011', department: 'CSE', academicYear: 'III', section: 'A' };

  const pass = await register(event, { ...leader, teamName: 'CSV Team', teamMembers: [m2, m3] });

  // Event CSV
  const eventCsvRes = await ctx.agent.get(`/api/admin/events/${event.id}/registrations.csv`);
  assert.equal(eventCsvRes.status, 200);
  assert.match(eventCsvRes.headers['content-type'], /text\/csv/);
  assert.match(eventCsvRes.headers['content-disposition'], /Spark26_CSV_Test_Event_Registrations\.csv/);

  const lines = eventCsvRes.text.trim().split('\r\n');
  assert.equal(lines.length, 2, 'CSV must have exactly 1 header line and 1 data line for this event');

  const headers = lines[0].split(',');
  assert.equal(headers[0], '"Event Name"');
  assert.equal(headers[1], '"Team Name"');
  assert.equal(headers[2], '"Team Leader Name"');
  assert.equal(headers[3], '"Register Number"');
  assert.equal(headers[4], '"Department"');
  assert.equal(headers[5], '"Year"');
  assert.equal(headers[6], '"Section"');
  assert.equal(headers[7], '"Email"');
  assert.equal(headers[8], '"Mobile Number"');
  assert.equal(headers[9], '"Registration ID"');
  assert.equal(headers[10], '"Attendance Status"');

  const dataLine = lines[1];
  assert.ok(dataLine.includes(pass.registrationId));
  assert.ok(dataLine.includes(leader.name));
  assert.ok(dataLine.includes('CSV Team'));
  assert.ok(dataLine.includes(m2.name));
  assert.ok(dataLine.includes(m3.name));

  // All registrations CSV
  const allCsvRes = await ctx.agent.get('/api/admin/export/registrations.csv');
  assert.equal(allCsvRes.status, 200);
  assert.match(allCsvRes.headers['content-type'], /text\/csv/);
  const allLines = allCsvRes.text.trim().split('\r\n');
  assert.ok(allLines.length >= 2);
  assert.ok(allLines[0].includes('Event Name'));
  assert.ok(allCsvRes.text.includes(leader.name));
});

test('Master workbook contains All Registrations sheet and per-event worksheets', async () => {
  const eventA = await makeEvent({ name: 'Master Alpha' });
  const eventB = await makeEvent({ name: 'Master Beta' });
  await register(eventA, studentFixture());
  await register(eventA, studentFixture());
  await register(eventB, studentFixture());

  const res = await fetchXlsx(ctx.agent, '/api/admin/export/master.xlsx');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-disposition'], /Spark26_Master_Registrations_.*\.xlsx/);

  const wb = await loadWorkbook(res);
  const sheetNames = wb.worksheets.map((w) => w.name);
  assert.equal(sheetNames[0], 'All Registrations');
  assert.ok(sheetNames.some((n) => n.includes('Master Alpha')));
  assert.ok(sheetNames.some((n) => n.includes('Master Beta')));

  const allSheet = wb.worksheets[0];
  assert.equal(allSheet.getRow(1).getCell(1).value, 'Event Name');
  assert.equal(allSheet.getRow(1).getCell(3).value, 'Team Leader Name');
  assert.equal(allSheet.views[0].state, 'frozen');
  assert.ok(allSheet.autoFilter);
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
