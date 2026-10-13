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
    if (row.getCell(1).value === 'Registration ID') headerRow = n;
  });
  return headerRow;
}

const EXPECTED_27_COLUMNS = [
  'Registration ID',
  'Event Name',
  'Team Name',
  'Team Leader Name',
  'Team Leader Register Number',
  'Team Leader Department',
  'Team Leader Year',
  'Team Leader Section',
  'Team Leader Email',
  'Team Leader Mobile Number',
  'Team Member 2 Name',
  'Team Member 2 Register Number',
  'Team Member 2 Department',
  'Team Member 2 Year',
  'Team Member 2 Section',
  'Team Member 3 Name',
  'Team Member 3 Register Number',
  'Team Member 3 Department',
  'Team Member 3 Year',
  'Team Member 3 Section',
  'Team Member 4 Name',
  'Team Member 4 Register Number',
  'Team Member 4 Department',
  'Team Member 4 Year',
  'Team Member 4 Section',
  'Registration Date',
  'Attendance Status',
];

test('event workbook is a genuine .xlsx with all 27 columns and the selected event’s students only', async () => {
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
  const sheet = wb.worksheets[0];
  const headerRowNumber = findHeaderRow(sheet);
  assert.ok(headerRowNumber, 'header row missing');

  const headers = sheet.getRow(headerRowNumber).values.slice(1).map((v) => String(v));
  for (const expected of EXPECTED_27_COLUMNS) {
    assert.ok(headers.includes(expected), `missing column: ${expected}`);
  }

  const dataRows = [];
  for (let n = headerRowNumber + 1; n <= sheet.rowCount; n += 1) {
    const row = sheet.getRow(n);
    if (row.getCell(1).value == null || row.getCell(4).value == null) continue;
    dataRows.push({
      id: row.getCell(1).value,
      eventName: row.getCell(2).value,
      name: row.getCell(4).value,
      registerNumber: row.getCell(5).value,
      email: row.getCell(9).value,
      attendance: row.getCell(27).value,
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
  assert.equal(sheetBefore.getRow(hb + 1).getCell(27).value, 'Pending');

  await ctx.agent.post('/api/admin/attendance/verify').set('x-csrf-token', ctx.csrf).send({ eventId: event.id, code: pass.qr.payload });

  const after = await fetchXlsx(ctx.agent, `/api/admin/events/${event.id}/registrations.xlsx`);
  assert.equal(after.headers['x-export-present'], '1');
  const wbAfter = await loadWorkbook(after);
  const sheetAfter = wbAfter.worksheets[0];
  const ha = findHeaderRow(sheetAfter);
  const row = sheetAfter.getRow(ha + 1);
  assert.equal(row.getCell(27).value, 'Present');
  const totalsLine = sheetAfter.getRow(3).values.map((v) => String(v || '')).join(' ');
  assert.match(totalsLine, /Total registrations: 1/);
  assert.match(totalsLine, /Present: 1/);
});

test('team registrations export all team members with their details in Excel', async () => {
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
  const sheet = wb.worksheets[0];
  const headerRowNumber = findHeaderRow(sheet);
  assert.ok(headerRowNumber);

  const row = sheet.getRow(headerRowNumber + 1);
  assert.equal(row.getCell(1).value, pass.registrationId);
  assert.equal(row.getCell(4).value, leader.name);
  assert.equal(row.getCell(5).value, leader.registerNumber.toUpperCase());
  assert.equal(row.getCell(9).value, leader.email.toLowerCase());
  assert.equal(row.getCell(10).value, leader.phone);

  // Member 2
  assert.equal(row.getCell(11).value, m2.name);
  assert.equal(row.getCell(12).value, m2.registerNumber);
  assert.equal(row.getCell(13).value, m2.department);
  assert.equal(row.getCell(14).value, m2.academicYear);
  assert.equal(row.getCell(15).value, m2.section);

  // Member 3
  assert.equal(row.getCell(16).value, m3.name);
  assert.equal(row.getCell(17).value, m3.registerNumber);
  assert.equal(row.getCell(18).value, m3.department);
  assert.equal(row.getCell(19).value, m3.academicYear);
  assert.equal(row.getCell(20).value, m3.section);

  // Member 4
  assert.equal(row.getCell(21).value, m4.name);
  assert.equal(row.getCell(22).value, m4.registerNumber);
  assert.equal(row.getCell(23).value, m4.department);
  assert.equal(row.getCell(24).value, m4.academicYear);
  assert.equal(row.getCell(25).value, m4.section);

  assert.equal(row.getCell(27).value, 'Pending');
});

test('CSV exports include full 27 columns and all team member details', async () => {
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
  assert.ok(eventCsvRes.text.includes('Team Member 2 Name'));
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
  sheetA.eachRow((row) => { if (row.getCell(1).value && String(row.getCell(1).value).startsWith('SP26-')) rowsA.push(row); });
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
