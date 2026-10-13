'use strict';
const ExcelJS = require('exceljs');
const prisma = require('../lib/prisma');
const { ApiError } = require('../lib/http');
const time = require('../lib/time');
const { registrationInclude } = require('./passes');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4C1D95' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const ALT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F3FF' } };

/**
 * Columns for Worksheet 1: Team Registrations
 * Exactly matching:
 * 1. Serial Number, 2. Event Name, 3. Team Name, 4. Team Leader Name,
 * 5. Team Leader Registration Number, 6. Team Leader Email, 7. Team Leader Contact Number,
 * 8-11: Team Member 1 Name, RegNo, Email, Contact Number
 * 12-15: Team Member 2 Name, RegNo, Email, Contact Number
 * and dynamically extended for additional members.
 */
function getColumns(maxExtraMembers = 2) {
  const cols = [
    { header: 'Serial Number', key: 'sno', width: 14 },
    { header: 'Event Name', key: 'eventName', width: 26 },
    { header: 'Team Name', key: 'teamName', width: 22 },
    { header: 'Team Leader Name', key: 'leaderName', width: 26 },
    { header: 'Team Leader Registration Number', key: 'leaderRegisterNumber', width: 30 },
    { header: 'Team Leader Email', key: 'leaderEmail', width: 30 },
    { header: 'Team Leader Contact Number', key: 'leaderPhone', width: 26 },
  ];

  const memberSlots = Math.max(2, Number(maxExtraMembers) || 2);
  for (let m = 1; m <= memberSlots; m += 1) {
    cols.push(
      { header: `Team Member ${m} Name`, key: `member${m}Name`, width: 24 },
      { header: `Team Member ${m} Registration Number`, key: `member${m}RegisterNumber`, width: 30 },
      { header: `Team Member ${m} Email`, key: `member${m}Email`, width: 28 },
      { header: `Team Member ${m} Contact Number`, key: `member${m}Phone`, width: 26 }
    );
  }

  cols.push(
    { header: 'Registration ID', key: 'registrationId', width: 22 },
    { header: 'Team Leader Department', key: 'leaderDepartment', width: 32 },
    { header: 'Team Leader Year', key: 'leaderAcademicYear', width: 18 },
    { header: 'Team Leader Section', key: 'leaderSection', width: 18 },
    { header: 'Registration Date', key: 'regDate', width: 18 },
    { header: 'Attendance Status', key: 'attendance', width: 18 }
  );

  return cols;
}

const COLUMNS = getColumns(2);

/**
 * Columns for Worksheet 2: Team Members
 * One row per team member, linked to event and team leader.
 */
const TEAM_MEMBER_COLUMNS = [
  { header: 'Serial Number', key: 'sno', width: 14 },
  { header: 'Registration ID', key: 'registrationId', width: 22 },
  { header: 'Event Name', key: 'eventName', width: 26 },
  { header: 'Team Name', key: 'teamName', width: 22 },
  { header: 'Team Leader Name', key: 'leaderName', width: 26 },
  { header: 'Member Role', key: 'role', width: 18 },
  { header: 'Member Name', key: 'memberName', width: 24 },
  { header: 'Registration Number', key: 'registerNumber', width: 28 },
  { header: 'Email Address', key: 'email', width: 30 },
  { header: 'Contact Number', key: 'phone', width: 22 },
  { header: 'Department', key: 'department', width: 30 },
  { header: 'Year', key: 'academicYear', width: 14 },
  { header: 'Section', key: 'section', width: 14 },
];

function applyWidths(sheet, keys, columns) {
  keys.forEach((key, i) => {
    const col = columns[i];
    if (col) sheet.getColumn(i + 1).width = col.width;
  });
}

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFA78BFA' } } };
  });
  row.height = 22;
}

function sanitizeSheetName(name, used = new Set()) {
  let base = String(name || 'Event').replace(/[*?:/\\[\]]/g, ' ').trim().slice(0, 28) || 'Event';
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base.slice(0, 25)} ${n}`;
    n += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Attaches stored team members and team names from SiteSetting to registration records.
 */
async function attachTeamMembers(registrations) {
  if (!registrations || !registrations.length) return;
  const regKeys = registrations.map((r) => 'team_' + r.registrationId);
  const nameKeys = registrations.map((r) => 'team_name_' + r.registrationId);
  const allKeys = [...regKeys, ...nameKeys];

  const rows = await prisma.siteSetting.findMany({
    where: { key: { in: allKeys } },
  });

  const teamMap = new Map();
  const nameMap = new Map();
  rows.forEach((row) => {
    try {
      if (row.key.startsWith('team_name_')) {
        nameMap.set(row.key.replace(/^team_name_/, ''), row.value);
      } else {
        teamMap.set(row.key.replace(/^team_/, ''), JSON.parse(row.value));
      }
    } catch (_) {}
  });

  registrations.forEach((r) => {
    r.teamMembers = teamMap.get(r.registrationId) || [];
    r.teamName = nameMap.get(r.registrationId) || '';
  });
}

function rowsForEvent(registrations, maxExtraMembers = 2) {
  const memberSlots = Math.max(2, Number(maxExtraMembers) || 2);
  return registrations.map((r, i) => {
    const regDate = time.dateToIstInputs(r.createdAt);
    const members = Array.isArray(r.teamMembers) ? r.teamMembers : [];
    const values = [
      i + 1,
      r.event ? r.event.name : '',
      r.teamName || '',
      r.student ? r.student.name : '',
      r.student ? r.student.registerNumber : '',
      r.student ? r.student.email : '',
      r.student && r.student.phone ? r.student.phone : '',
    ];

    for (let slot = 0; slot < memberSlots; slot += 1) {
      const m = members[slot];
      values.push(
        m ? (m.name || '') : '',
        m ? (m.registerNumber || '') : '',
        m ? (m.email || '') : '',
        m ? (m.phone || '') : ''
      );
    }

    values.push(
      r.registrationId,
      r.student ? r.student.department : '',
      r.student ? r.student.academicYear : '',
      r.student ? r.student.section : '',
      regDate.date,
      r.attendanceStatus === 'PRESENT' ? 'Present' : r.attendanceStatus === 'ABSENT' ? 'Absent' : 'Pending'
    );

    return {
      registrationId: r.registrationId,
      _attendanceRaw: r.attendanceStatus,
      values,
    };
  });
}

function addEventMeta(sheet, event, rows, summary, columnCount) {
  const title = sheet.addRow([`${event.name}  (${event.code})`]);
  title.font = { bold: true, size: 14, color: { argb: 'FF3B0764' } };
  sheet.mergeCells(title.number, 1, title.number, columnCount);

  const meta = sheet.addRow([
    `${event.category === 'TECHNICAL' ? 'Technical' : 'Non-Technical'} · ${event.venue} · ${time.fmtRange(event.startsAt, event.endsAt)}`,
  ]);
  meta.getCell(1).font = { size: 10, italic: true, color: { argb: 'FF6B7280' } };
  sheet.mergeCells(meta.number, 1, meta.number, columnCount);

  const totals = sheet.addRow([
    `Total registrations: ${summary.total}`,
    `Present: ${summary.present}`,
    `Pending: ${summary.pending}`,
    `Absent: ${summary.absent}`,
  ]);
  [1, 2, 3, 4].forEach((c) => {
    const cell = totals.getCell(c);
    cell.font = { bold: true, size: 11, color: { argb: c === 2 ? 'FF047857' : 'FF1D4ED8' } };
  });
  sheet.addRow([]);
  return rows;
}

async function loadEventWithRegistrations(eventId) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw ApiError.notFound('Event not found.');
  const registrations = await prisma.registration.findMany({
    where: { eventId: event.id },
    include: registrationInclude,
    orderBy: { createdAt: 'asc' },
  });
  await attachTeamMembers(registrations);
  return { event, registrations };
}

function safeFilePart(name) {
  return String(name || 'Event').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'Event';
}

/**
 * Builds event workbook with two worksheets:
 * Worksheet 1 — Team Registrations
 * Worksheet 2 — Team Members
 */
async function buildEventWorkbook(eventId) {
  const { event, registrations } = await loadEventWithRegistrations(eventId);
  const maxExtra = Math.max(2, ...registrations.map((r) => (Array.isArray(r.teamMembers) ? r.teamMembers.length : 0)));
  const columns = getColumns(maxExtra);
  const rows = rowsForEvent(registrations, maxExtra);
  const summary = {
    total: rows.length,
    present: rows.filter((r) => r._attendanceRaw === 'PRESENT').length,
    pending: rows.filter((r) => r._attendanceRaw === 'PENDING').length,
    absent: rows.filter((r) => r._attendanceRaw === 'ABSENT').length,
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Spark’26 Admin Workspace';
  wb.created = new Date();

  // ── Worksheet 1: Team Registrations ──
  const sheet1 = wb.addWorksheet('Team Registrations');
  applyWidths(sheet1, columns.map((c) => c.key), columns);
  addEventMeta(sheet1, event, rows, summary, columns.length);

  const headerRow1 = sheet1.addRow(columns.map((c) => c.header));
  styleHeaderRow(headerRow1);
  rows.forEach((r, idx) => {
    const row = sheet1.addRow(r.values);
    if (idx % 2 === 1) row.eachCell((cell) => { cell.fill = ALT_FILL; });
    const attCell = row.getCell(columns.length);
    const isPresent = attCell.value === 'Present';
    attCell.font = { bold: isPresent, color: { argb: isPresent ? 'FF047857' : 'FF6B7280' } };
    row.alignment = { vertical: 'middle' };
  });

  sheet1.views = [{ state: 'frozen', ySplit: headerRow1.number }];
  sheet1.autoFilter = { from: { row: headerRow1.number, column: 1 }, to: { row: headerRow1.number, column: columns.length } };
  sheet1.getColumn(columns.length - 1).numFmt = '@';

  // ── Worksheet 2: Team Members ──
  const sheet2 = wb.addWorksheet('Team Members');
  applyWidths(sheet2, TEAM_MEMBER_COLUMNS.map((c) => c.key), TEAM_MEMBER_COLUMNS);
  const title2 = sheet2.addRow([`${event.name} — Registered Team Members`]);
  title2.font = { bold: true, size: 13, color: { argb: 'FF3B0764' } };
  sheet2.mergeCells(title2.number, 1, title2.number, TEAM_MEMBER_COLUMNS.length);
  sheet2.addRow([]);

  const headerRow2 = sheet2.addRow(TEAM_MEMBER_COLUMNS.map((c) => c.header));
  styleHeaderRow(headerRow2);

  let memberSno = 1;
  registrations.forEach((r) => {
    const members = Array.isArray(r.teamMembers) ? r.teamMembers : [];
    members.forEach((m, idx) => {
      const row = sheet2.addRow([
        memberSno++,
        r.registrationId,
        event.name,
        r.teamName || '',
        r.student ? r.student.name : '',
        `Team Member ${idx + 1}`,
        m.name || '',
        m.registerNumber || '',
        m.email || '',
        m.phone || '',
        m.department || '',
        m.academicYear || '',
        m.section || '',
      ]);
      row.alignment = { vertical: 'middle' };
      if ((memberSno - 1) % 2 === 1) row.eachCell((cell) => { cell.fill = ALT_FILL; });
    });
  });

  sheet2.views = [{ state: 'frozen', ySplit: headerRow2.number }];
  sheet2.autoFilter = { from: { row: headerRow2.number, column: 1 }, to: { row: headerRow2.number, column: TEAM_MEMBER_COLUMNS.length } };

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, filename: `Spark26_${safeFilePart(event.name)}_Registrations.xlsx`, event, count: rows.length, summary };
}

/**
 * Master workbook with:
 * Worksheet 1 — Team Registrations (all registered teams across all events)
 * Worksheet 2 — Team Members (all team members linked to their team leader)
 * Worksheet 3 — Summary (event-wise summary counts)
 * Worksheet 4 — About (provenance note)
 */
async function buildMasterWorkbook({ statuses = ['PUBLISHED', 'DRAFT', 'COMPLETED', 'CANCELLED'] } = {}) {
  const events = await prisma.event.findMany({ where: { status: { in: statuses } }, orderBy: [{ startsAt: 'asc' }, { code: 'asc' }] });
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Spark’26 Admin Workspace';
  wb.created = new Date();

  const allRegistrations = [];
  let globalMaxExtra = 2;

  for (const event of events) {
    const regs = await prisma.registration.findMany({
      where: { eventId: event.id },
      include: registrationInclude,
      orderBy: { createdAt: 'asc' },
    });
    await attachTeamMembers(regs);
    for (const r of regs) {
      allRegistrations.push(r);
      if (Array.isArray(r.teamMembers) && r.teamMembers.length > globalMaxExtra) {
        globalMaxExtra = r.teamMembers.length;
      }
    }
  }

  const columns = getColumns(globalMaxExtra);

  // ── Worksheet 1: Summary ──
  const summary = wb.addWorksheet('Summary');
  const SUMMARY_COLUMNS = [
    { header: 'Code', width: 9 },
    { header: 'Event', width: 32 },
    { header: 'Category', width: 15 },
    { header: 'Venue', width: 26 },
    { header: 'Date', width: 14 },
    { header: 'Time', width: 22 },
    { header: 'Mode', width: 20 },
    { header: 'Status', width: 13 },
    { header: 'Registrations', width: 14 },
    { header: 'Present', width: 10 },
    { header: 'Pending', width: 10 },
    { header: 'Website', width: 10 },
    { header: 'On-Spot', width: 10 },
  ];
  applyWidths(summary, SUMMARY_COLUMNS.map((c) => c.header), SUMMARY_COLUMNS);
  const titleRow = summary.addRow(['Spark’26 — event-wise registration summary']);
  titleRow.font = { bold: true, size: 13, color: { argb: 'FF3B0764' } };
  summary.mergeCells(titleRow.number, 1, titleRow.number, SUMMARY_COLUMNS.length);
  const stamp = summary.addRow([`Generated ${time.fmtDateTime(new Date())} IST · ${events.length} events`]);
  stamp.getCell(1).font = { size: 10, italic: true, color: { argb: 'FF6B7280' } };
  summary.mergeCells(stamp.number, 1, stamp.number, SUMMARY_COLUMNS.length);
  summary.addRow([]);
  const headerRowSum = summary.addRow(SUMMARY_COLUMNS.map((c) => c.header));
  styleHeaderRow(headerRowSum);

  let totalRegs = 0;
  let totalPresent = 0;

  for (const event of events) {
    const eventRegs = allRegistrations.filter((r) => r.eventId === event.id);
    const present = eventRegs.filter((r) => r.attendanceStatus === 'PRESENT').length;
    const pending = eventRegs.filter((r) => r.attendanceStatus === 'PENDING').length;
    const onspot = eventRegs.filter((r) => r.source === 'ON_SPOT').length;
    totalRegs += eventRegs.length;
    totalPresent += present;

    const row = summary.addRow([
      event.code,
      event.name,
      event.category === 'TECHNICAL' ? 'Technical' : 'Non-Technical',
      event.venue,
      time.fmtDate(event.startsAt),
      time.fmtRange(event.startsAt, event.endsAt),
      event.registrationMode === 'ON_SPOT' ? 'On-Spot' : event.registrationMode === 'BOTH' ? 'Both' : 'Website',
      event.status,
      eventRegs.length,
      present,
      pending,
      eventRegs.length - onspot,
      onspot,
    ]);
    row.alignment = { vertical: 'middle' };
  }

  const totalsRow = summary.addRow(['', 'TOTAL', '', '', '', '', '', '', totalRegs, totalPresent, totalRegs - totalPresent, '', '']);
  totalsRow.font = { bold: true, color: { argb: 'FF3B0764' } };
  summary.views = [{ state: 'frozen', ySplit: headerRowSum.number }];
  summary.autoFilter = { from: { row: headerRowSum.number, column: 1 }, to: { row: headerRowSum.number, column: SUMMARY_COLUMNS.length } };

  // ── Worksheet 2: Team Registrations ──
  const sheet1 = wb.addWorksheet('Team Registrations');
  applyWidths(sheet1, columns.map((c) => c.key), columns);
  const title1 = sheet1.addRow(['Spark’26 — All Registered Teams']);
  title1.font = { bold: true, size: 14, color: { argb: 'FF3B0764' } };
  sheet1.mergeCells(title1.number, 1, title1.number, columns.length);
  const stamp1 = sheet1.addRow([`Generated ${time.fmtDateTime(new Date())} IST · Total teams: ${allRegistrations.length}`]);
  stamp1.getCell(1).font = { size: 10, italic: true, color: { argb: 'FF6B7280' } };
  sheet1.mergeCells(stamp1.number, 1, stamp1.number, columns.length);
  sheet1.addRow([]);

  const headerRow1 = sheet1.addRow(columns.map((c) => c.header));
  styleHeaderRow(headerRow1);

  const rows = rowsForEvent(allRegistrations, globalMaxExtra);
  rows.forEach((r, idx) => {
    const row = sheet1.addRow(r.values);
    if (idx % 2 === 1) row.eachCell((cell) => { cell.fill = ALT_FILL; });
    const attCell = row.getCell(columns.length);
    const isPresent = attCell.value === 'Present';
    attCell.font = { bold: isPresent, color: { argb: isPresent ? 'FF047857' : 'FF6B7280' } };
    row.alignment = { vertical: 'middle' };
  });

  sheet1.views = [{ state: 'frozen', ySplit: headerRow1.number }];
  sheet1.autoFilter = { from: { row: headerRow1.number, column: 1 }, to: { row: headerRow1.number, column: columns.length } };
  sheet1.getColumn(columns.length - 1).numFmt = '@';

  // ── Worksheet 3: Team Members ──
  const sheet2 = wb.addWorksheet('Team Members');
  applyWidths(sheet2, TEAM_MEMBER_COLUMNS.map((c) => c.key), TEAM_MEMBER_COLUMNS);
  const title2 = sheet2.addRow(['Spark’26 — All Team Members']);
  title2.font = { bold: true, size: 14, color: { argb: 'FF3B0764' } };
  sheet2.mergeCells(title2.number, 1, title2.number, TEAM_MEMBER_COLUMNS.length);
  const stamp2 = sheet2.addRow([`Generated ${time.fmtDateTime(new Date())} IST`]);
  stamp2.getCell(1).font = { size: 10, italic: true, color: { argb: 'FF6B7280' } };
  sheet2.mergeCells(stamp2.number, 1, stamp2.number, TEAM_MEMBER_COLUMNS.length);
  sheet2.addRow([]);

  const headerRow2 = sheet2.addRow(TEAM_MEMBER_COLUMNS.map((c) => c.header));
  styleHeaderRow(headerRow2);

  let memberSno = 1;
  allRegistrations.forEach((r) => {
    const members = Array.isArray(r.teamMembers) ? r.teamMembers : [];
    members.forEach((m, idx) => {
      const row = sheet2.addRow([
        memberSno++,
        r.registrationId,
        r.event ? r.event.name : '',
        r.teamName || '',
        r.student ? r.student.name : '',
        `Team Member ${idx + 1}`,
        m.name || '',
        m.registerNumber || '',
        m.email || '',
        m.phone || '',
        m.department || '',
        m.academicYear || '',
        m.section || '',
      ]);
      row.alignment = { vertical: 'middle' };
      if ((memberSno - 1) % 2 === 1) row.eachCell((cell) => { cell.fill = ALT_FILL; });
    });
  });

  sheet2.views = [{ state: 'frozen', ySplit: headerRow2.number }];
  sheet2.autoFilter = { from: { row: headerRow2.number, column: 1 }, to: { row: headerRow2.number, column: TEAM_MEMBER_COLUMNS.length } };

  // ── Per-Event Worksheets ──
  const used = new Set(['summary', 'team registrations', 'team members', 'about']);
  for (const event of events) {
    const eventRegs = allRegistrations.filter((r) => r.eventId === event.id);
    const eventMaxExtra = Math.max(2, ...eventRegs.map((r) => (Array.isArray(r.teamMembers) ? r.teamMembers.length : 0)));
    const evCols = getColumns(eventMaxExtra);
    const sheet = wb.addWorksheet(sanitizeSheetName(event.name, used));
    applyWidths(sheet, evCols.map((c) => c.key), evCols);
    const evRows = rowsForEvent(eventRegs, eventMaxExtra);
    const evPresent = evRows.filter((r) => r._attendanceRaw === 'PRESENT').length;
    const evPending = evRows.filter((r) => r._attendanceRaw === 'PENDING').length;
    addEventMeta(sheet, event, evRows, { total: evRows.length, present: evPresent, pending: evPending, absent: evRows.length - evPresent - evPending }, evCols.length);
    const hr = sheet.addRow(evCols.map((c) => c.header));
    styleHeaderRow(hr);
    evRows.forEach((r, idx) => {
      const r2 = sheet.addRow(r.values);
      if (idx % 2 === 1) r2.eachCell((cell) => { cell.fill = ALT_FILL; });
      const attCell = r2.getCell(evCols.length);
      const isPresent = attCell.value === 'Present';
      attCell.font = { bold: isPresent, color: { argb: isPresent ? 'FF047857' : 'FF6B7280' } };
      r2.alignment = { vertical: 'middle' };
    });
    sheet.views = [{ state: 'frozen', ySplit: hr.number }];
    sheet.autoFilter = { from: { row: hr.number, column: 1 }, to: { row: hr.number, column: evCols.length } };
    sheet.getColumn(evCols.length - 1).numFmt = '@';
  }

  // ── Worksheet 4: About ──
  const generated = wb.addWorksheet('About', { properties: { tabColor: { argb: 'FF7C3AED' } } });
  generated.getColumn(1).width = 26;
  generated.getColumn(2).width = 72;
  generated.addRow(['Spark’26 master export']).font = { bold: true, size: 14, color: { argb: 'FF3B0764' } };
  generated.addRow(['Generated', time.fmtDateTime(new Date()) + ' IST']);
  generated.addRow(['Events included', String(events.length)]);
  generated.addRow(['Total registrations', String(totalRegs)]);
  generated.addRow(['Attendance present', String(totalPresent)]);
  generated.addRow(['Note', 'Excel files are exports of the PostgreSQL database. Attendance is only changed inside the admin app — never by editing this file.']);

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, filename: `Spark26_Master_Registrations_${time.dateToIstInputs(new Date()).date}.xlsx`, events: events.length, totalRegs };
}

function toCsvCell(val) {
  if (val == null) return '""';
  const str = String(val);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

/**
 * Builds RFC 4180 CSV matching Worksheet 1 (Team Registrations).
 */
function buildRegistrationsCsv(registrations) {
  const maxExtra = Math.max(2, ...registrations.map((r) => (Array.isArray(r.teamMembers) ? r.teamMembers.length : 0)));
  const columns = getColumns(maxExtra);
  const rows = rowsForEvent(registrations, maxExtra);

  const headerLine = columns.map((c) => toCsvCell(c.header)).join(',');
  const lines = [headerLine];

  rows.forEach((r) => {
    lines.push(r.values.map(toCsvCell).join(','));
  });

  return lines.join('\r\n');
}

module.exports = {
  buildEventWorkbook,
  buildMasterWorkbook,
  buildRegistrationsCsv,
  loadEventWithRegistrations,
  attachTeamMembers,
  safeFilePart,
  getColumns,
  COLUMNS,
  TEAM_MEMBER_COLUMNS,
  registrationInclude,
};
