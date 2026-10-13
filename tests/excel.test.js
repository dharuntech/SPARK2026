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

function findHeaderRow(sheet) {
  let headerRow = null;
  sheet.eachRow((row, n) => {
    if (row.getCell(1).value === 'Serial Number') headerRow = n;
  });
  return headerRow;
}

const EXPECTED_REQUIRED_COLUMNS = [
  'Serial Number',
  'Event Name',
  'Team Name',
  'Team Leader Name',
  'Team Leader Registration Number',
  'Team Leader Email',
  'Team Leader Contact Number',
  'Team Member 1 Name',
  'Team Member 1 Registration Number',
  'Team Member 1 Email',
  'Team Member 1 Contact Number',
  'Team Member 2 Name',
  'Team Member 2 Registration Number',
  'Team Member 2 Email',
  'Team Member 2 Contact Number',
];

test('event workbook is a genuine .xlsx with Worksheet 1 (Team Registrations) and Worksheet 2 (Team Members)', async () => {
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
  assert.equal(wb.worksheets[0].name, 'Team Registrations');
  assert.equal(wb.worksheets[1].name, 'Team Members');

  const sheet = wb.worksheets[0];
  const headerRowNumber = findHeaderRow(sheet);
  assert.ok(headerRowNumber, 'header row missing');

  const headers = sheet.getRow(headerRowNumber).values.slice(1).map((v) => String(v));
  for (const expected of EXPECTED_REQUIRED_COLUMNS) {
    assert.ok(headers.includes(expected), `missing column: ${expected}`);
  }

  const attIdx = headers.indexOf('Attendance Status') + 1;
  const regIdIdx = headers.indexOf('Registration ID') + 1;
  assert.ok(attIdx > 0, 'missing Attendance Status column');
  assert.ok(regIdIdx > 0, 'missing Registration ID column');

  const dataRows = [];
  for (let n = headerRowNumber + 1; n <= sheet.rowCount; n += 1) {
    const row = sheet.getRow(n);
    if (row.getCell(1).value == null || row.getCell(4).value == null) continue;
    dataRows.push({
      sno: row.getCell(1).value,
      eventName: row.getCell(2).value,
      name: row.getCell(4).value,
      registerNumber: row.getCell(5).value,
      email: row.getCell(6).value,
      id: row.getCell(regIdIdx).value,
      attendance: row.getCell(attIdx).value,
    });
  }
  assert.equal(dataRows.length, 2, 'unexpected number of exported rows');
  assert.deepEqual([...dataRows].map((r) => r.name).sort(), [alice.name, bob.name].sort(), 'workbook leaked another event’s students');
  assert.ok(dataRows.every((r) => /^SP26-/.test(r.id)));
  assert.ok(dataRows.every((r) => r.attendance === 'Pending'));

  // structure: filters + frozen header + header styling
  assert.ok(sheet.autoFilter, 'auto filter missing');
  assert.equal(sheet.views[0].state, 'frozen');
  assert.equal(sheet.views[0].ySplit, headerRowNumber);
  assert.equal(sheet.getRow(headerRowNumber).getCell(1).font.bold, true);
  assert.ok(sheet.getColumn(4).width >= 20, 'column widths not set');

  // summary block above the table
  const top = sheet.getCell('A1').value.toString();
  assert.match(top, /Workbook Alpha/);
  assert.match(String(sheet.getCell('A3').value), /Total registrations: 2/);
});

test('exported attendance reflects a later check-in (database remains authoritative)', async () => {
  const event = await makeEvent({ name: 'Workbook Gamma' });
  const student = studentFixture();
  const pass = await register(event, student);
  const before = await fetchXlsx(ctx.agent, `/api/admin/events/${event.id}/registrations.xlsx`);
  const wbBefore = await loadWorkbook(before);
  const sheetBefore = wbBefore.worksheets[0];
  const hb = findHeaderRow(sheetBefore);
  const headersB = sheetBefore.getRow(hb).values.slice(1).map(String);
  const attIdx = headersB.indexOf('Attendance Status') + 1;
  assert.equal(sheetBefore.getRow(hb + 1).getCell(attIdx).value, 'Pending');

  await ctx.agent.post('/api/admin/attendance/verify').set('x-csrf-token', ctx.csrf).send({ eventId: event.id, code: pass.qr.payload });

  const after = await fetchXlsx(ctx.agent, `/api/admin/events/${event.id}/registrations.xlsx`);
  assert.equal(after.headers['x-export-present'], '1');
  const wbAfter = await loadWorkbook(after);
  const sheetAfter = wbAfter.worksheets[0];
  const ha = findHeaderRow(sheetAfter);
  const row = sheetAfter.getRow(ha + 1);
  assert.equal(row.getCell(attIdx).value, 'Present');
  const totalsLine = sheetAfter.getRow(3).values.map((v) => String(v || '')).join(' ');
  assert.match(totalsLine, /Total registrations: 1/);
  assert.match(totalsLine, /Present: 1/);
});

test('team registrations export all team members with their details in both worksheets', async () => {
  const nfEvent = await makeEvent({ name: 'NeuroForge Team Test', category: 'TECHNICAL' });
  const leader = { ...studentFixture(), phone: '9876543210' };
  const m2 = { name: 'Bob Two', registerNumber: '710023104002', department: 'CSE', academicYear: 'III', section: 'A' };
  const m3 = { name: 'Charlie Three', registerNumber: '710023104003', department: 'ECE', academicYear: 'III', section: 'B' };
  const m4 = { name: 'David Four', registerNumber: '710023104004', department: 'IT', academicYear: 'II', section: 'C' };

  const pass = await register(nfEvent, {
    ...leader,
    teamMembers: [m2, m3, m4],
  });

  const res = await fetchXlsx(ctx.agent, `/api/admin/events/${nfEvent.id}/registrations.xlsx`);
  assert.equal(res.status, 200);
  const wb = await loadWorkbook(res);

  // ── Worksheet 1: Team Registrations ──
  const sheet1 = wb.worksheets[0];
  assert.equal(sheet1.name, 'Team Registrations');
  const headerRowNumber = findHeaderRow(sheet1);
  assert.ok(headerRowNumber);

  const row = sheet1.getRow(headerRowNumber + 1);
  assert.equal(row.getCell(1).value, 1); // Serial Number
  assert.equal(row.getCell(2).value, nfEvent.name); // Event Name
  assert.equal(row.getCell(4).value, leader.name); // Team Leader Name
  assert.equal(row.getCell(5).value, leader.registerNumber.toUpperCase()); // Team Leader Reg
  assert.equal(row.getCell(6).value, leader.email.toLowerCase()); // Team Leader Email
  assert.equal(row.getCell(7).value, leader.phone); // Team Leader Phone

  // Team Member 1 (columns 8–11)
  assert.equal(row.getCell(8).value, m2.name);
  assert.equal(row.getCell(9).value, m2.registerNumber);

  // Team Member 2 (columns 12–15)
  assert.equal(row.getCell(12).value, m3.name);
  assert.equal(row.getCell(13).value, m3.registerNumber);

  // Team Member 3 (columns 16–19)
  assert.equal(row.getCell(16).value, m4.name);
  assert.equal(row.getCell(17).value, m4.registerNumber);

  // ── Worksheet 2: Team Members ──
  const sheet2 = wb.worksheets[1];
  assert.equal(sheet2.name, 'Team Members');
  let memberHeaderRow = null;
  sheet2.eachRow((r, n) => {
    if (r.getCell(1).value === 'Serial Number') memberHeaderRow = n;
  });
  assert.ok(memberHeaderRow, 'member header row missing');

  const memberRows = [];
  for (let n = memberHeaderRow + 1; n <= sheet2.rowCount; n += 1) {
    const r = sheet2.getRow(n);
    if (!r.getCell(1).value) continue;
    memberRows.push({
      sno: r.getCell(1).value,
      regId: r.getCell(2).value,
      eventName: r.getCell(3).value,
      leaderName: r.getCell(5).value,
      role: r.getCell(6).value,
      name: r.getCell(7).value,
      regNo: r.getCell(8).value,
      dept: r.getCell(11).value,
    });
  }

  assert.equal(memberRows.length, 3, 'all 3 extra team members must be listed in Worksheet 2');
  assert.equal(memberRows[0].name, m2.name);
  assert.equal(memberRows[0].regNo, m2.registerNumber);
  assert.equal(memberRows[0].leaderName, leader.name);
  assert.equal(memberRows[0].regId, pass.registrationId);

  assert.equal(memberRows[1].name, m3.name);
  assert.equal(memberRows[1].regNo, m3.registerNumber);

  assert.equal(memberRows[2].name, m4.name);
  assert.equal(memberRows[2].regNo, m4.registerNumber);
});

test('CSV exports include complete team leader and member columns', async () => {
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
  assert.ok(eventCsvRes.text.includes('Team Member 1 Name'));
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

test('master workbook has a summary sheet plus one worksheet per event', async () => {
  const eventA = await makeEvent({ name: 'Master One' });
  const eventB = await makeEvent({ name: 'Master Two' });
  await register(eventA, studentFixture());
  await register(eventA, studentFixture());
  await register(eventB, studentFixture());
  // the draft event must still appear as a worksheet in the master export
  await prisma.event.update({ where: { id: eventB.id }, data: { status: 'DRAFT' } });

  const res = await fetchXlsx(ctx.agent, '/api/admin/export/master.xlsx');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-disposition'], /Spark26_Master_Registrations_.*\.xlsx/);

  const wb = await loadWorkbook(res);
  const names = wb.worksheets.map((w) => w.name);
  assert.equal(names[0], 'Summary');
  assert.ok(names.includes('Team Registrations'), 'Team Registrations sheet missing: ' + names.join(', '));
  assert.ok(names.includes('Team Members'), 'Team Members sheet missing: ' + names.join(', '));
  assert.ok(names.some((n) => n.includes('Master One')), 'event sheet missing: ' + names.join(', '));
  assert.ok(names.some((n) => n.includes('Master Two')), 'draft event sheet missing: ' + names.join(', '));

  const summary = wb.getWorksheet('Summary');
  let headerRowNumber = null;
  summary.eachRow((row, n) => { if (row.getCell(1).value === 'Code') headerRowNumber = n; });
  assert.ok(headerRowNumber, 'summary header row missing');
  const headers = summary.getRow(headerRowNumber).values.slice(1).map(String);
  assert.deepEqual(headers.slice(0, 5), ['Code', 'Event', 'Category', 'Venue', 'Date']);
  assert.ok(String(summary.getCell('A1').value).includes('summary'), 'summary title block missing');
  let rowForA = null;
  summary.eachRow((row) => { if (row.getCell(2).value === 'Master One') rowForA = row; });
  assert.ok(rowForA, 'summary row missing for the fixture event');
  assert.equal(rowForA.getCell(9).value, 2, 'summary registration count wrong');
  assert.equal(rowForA.getCell(12).value, 2, 'website registration column wrong');
  let rowForB = null;
  summary.eachRow((row) => { if (row.getCell(2).value === 'Master Two') rowForB = row; });
  assert.ok(rowForB, 'draft event row missing from the summary');
  assert.equal(rowForB.getCell(8).value, 'DRAFT', 'master export should show the draft status');
  assert.ok(summary.autoFilter, 'summary auto filter missing');

  const sheetA = wb.worksheets.find((w) => w.name.includes('Master One'));
  const rowsA = [];
  sheetA.eachRow((row) => {
    const val = String(row.getCell(1).value || '');
    if (/^\d+$/.test(val) && row.getCell(4).value) rowsA.push(row);
  });
  assert.equal(rowsA.length, 2, 'event sheet row count mismatch');
});

test('the master workbook records its own provenance note', async () => {
  const res = await fetchXlsx(ctx.agent, '/api/admin/export/master.xlsx');
  const wb = await loadWorkbook(res);
  const about = wb.getWorksheet('About');
  assert.ok(about, 'About sheet missing');
  const text = about.getColumn(2).values.join(' ');
  assert.match(text, /exports of the PostgreSQL database/i);
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
