'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { boot, makeEvent, studentFixture, teardown, prisma } = require('./helpers/harness');

let ctx;
before(async () => { ctx = await boot(); });
after(async () => { await teardown(); });

function binaryParser(res, cb) {
  res.setEncoding('binary');
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => cb(null, Buffer.from(data, 'binary')));
}
const fetchXlsx = (agent, url) => agent.get(url).buffer(true).parse(binaryParser);

test('Online and On-Spot registrations support teamName and full member details in same schema and Excel sheet', async () => {
  const event = await makeEvent({ name: 'Hackathon Sync Test', category: 'TECHNICAL' });

  // 1. Online team registration
  const onlineLeader = {
    ...studentFixture('OL'),
    phone: '9876543210',
  };
  const onlineMembers = [
    {
      name: 'Online Member 1',
      registerNumber: '710023101001',
      department: 'CSE',
      academicYear: 'III',
      section: 'A',
      email: 'ol1@spark26.test',
      phone: '9876543211',
    },
    {
      name: 'Online Member 2',
      registerNumber: '710023101002',
      department: 'ECE',
      academicYear: 'II',
      section: 'B',
      email: 'ol2@spark26.test',
      phone: '9876543212',
    },
  ];

  const onlineRes = await ctx.api.post('/api/registrations').send({
    eventId: event.id,
    ...onlineLeader,
    teamName: 'Cyber Titans Online',
    teamMembers: onlineMembers,
  });
  assert.equal(onlineRes.status, 201);
  const onlinePass = onlineRes.body.pass;
  assert.ok(onlinePass.registrationId);

  // 2. On-Spot team registration
  const spotLeader = {
    ...studentFixture('SP'),
    phone: '9123456780',
  };
  const spotMembers = [
    {
      name: 'Spot Member 1',
      registerNumber: '710023102001',
      department: 'IT',
      academicYear: 'IV',
      section: 'A',
      email: 'sp1@spark26.test',
      phone: '9123456781',
    },
    {
      name: 'Spot Member 2',
      registerNumber: '710023102002',
      department: 'AIDS',
      academicYear: 'I',
      section: 'C',
      email: 'sp2@spark26.test',
      phone: '9123456782',
    },
  ];

  const spotRes = await ctx.agent
    .post('/api/admin/registrations')
    .set('x-csrf-token', ctx.csrf)
    .send({
      eventId: event.id,
      ...spotLeader,
      teamName: 'Spot Warriors',
      teamMembers: spotMembers,
    });
  assert.equal(spotRes.status, 201);
  const spotPass = spotRes.body.pass;
  assert.ok(spotPass.registrationId);

  // 3. Verify SiteSetting storage for team members and team name
  const onlineTeamSetting = await prisma.siteSetting.findUnique({
    where: { key: `team_${onlinePass.registrationId}` },
  });
  assert.ok(onlineTeamSetting, 'Online team setting must exist');
  const onlineSavedMembers = JSON.parse(onlineTeamSetting.value);
  assert.equal(onlineSavedMembers.length, 2);
  assert.equal(onlineSavedMembers[0].name, 'Online Member 1');

  const spotTeamSetting = await prisma.siteSetting.findUnique({
    where: { key: `team_${spotPass.registrationId}` },
  });
  assert.ok(spotTeamSetting, 'On-spot team setting must exist');
  const spotSavedMembers = JSON.parse(spotTeamSetting.value);
  assert.equal(spotSavedMembers.length, 2);
  assert.equal(spotSavedMembers[0].name, 'Spot Member 1');

  const spotNameSetting = await prisma.siteSetting.findUnique({
    where: { key: `team_name_${spotPass.registrationId}` },
  });
  assert.ok(spotNameSetting, 'On-spot team name setting must exist');
  assert.equal(spotNameSetting.value, 'Spot Warriors');

  // 4. Verify Admin participants API returns both with full team members
  const partRes = await ctx.agent.get(`/api/admin/events/${event.id}/participants`);
  assert.equal(partRes.status, 200);
  assert.equal(partRes.body.registrations.length, 2);

  const foundOnline = partRes.body.registrations.find((p) => p.registrationId === onlinePass.registrationId);
  const foundSpot = partRes.body.registrations.find((p) => p.registrationId === spotPass.registrationId);

  assert.ok(foundOnline, 'Online registration should be returned in admin participants');
  assert.equal(foundOnline.teamName, 'Cyber Titans Online');
  assert.equal(foundOnline.teamMembers.length, 2);

  assert.ok(foundSpot, 'On-spot registration should be returned in admin participants');
  assert.equal(foundSpot.teamName, 'Spot Warriors');
  assert.equal(foundSpot.teamMembers.length, 2);

  // 5. Verify Excel export contains both in the same worksheet
  const xlsxRes = await fetchXlsx(ctx.agent, `/api/admin/events/${event.id}/registrations.xlsx`);
  assert.equal(xlsxRes.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsxRes.body);

  assert.equal(wb.worksheets.length, 1, 'Should have exactly 1 worksheet');
  const sheet = wb.worksheets[0];

  // Header row + 2 data rows = 3 rows
  assert.equal(sheet.rowCount, 3, 'Both online and on-spot must be in the same sheet');

  const teamNamesInSheet = [sheet.getRow(2).getCell(2).value, sheet.getRow(3).getCell(2).value];
  assert.ok(teamNamesInSheet.includes('Cyber Titans Online'));
  assert.ok(teamNamesInSheet.includes('Spot Warriors'));
});
