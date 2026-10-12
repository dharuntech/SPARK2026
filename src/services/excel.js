'use strict';
const ExcelJS = require('exceljs');
const prisma = require('../lib/prisma');
const { ApiError } = require('../lib/http');
const time = require('../lib/time');
const { registrationInclude } = require('./passes');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4C1D95' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const ALT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F3FF' } };

const COLUMNS = [
  { header: 'S.No', key: 'sno', width: 7 },
  { header: 'Registration ID', key: 'registrationId', width: 20 },
  { header: 'Student Name', key: 'name', width: 26 },
  { header: 'Register Number', key: 'registerNumber', width: 20 },
  { header: 'Department', key: 'department', width: 34 },
  { header: 'Year', key: 'academicYear', width: 9 },
  { header: 'Section', key: 'section', width: 10 },
  { header: 'Email', key: 'email', width: 32 },
  { header: 'Phone', key: 'phone', width: 15 },
  { header: 'Registration Date', key: 'regDate', width: 14 },
  { header: 'Registration Time', key: 'regTime', width: 13 },
  { header: 'Method', key: 'source', width: 12 },
  { header: 'Attendance', key: 'attendance', width: 13 },
  { header: 'Checked-in Date', key: 'inDate', width: 16 },
  { header: 'Checked-in Time', key: 'inTime', width: 15 },
];

function iconFor(event) {
  return event.category === 'TECHNICAL' ? '⚙' : '★';
}

/**
 * ExcelJS writes a header row as soon as `sheet.columns` is assigned. We only want
 * column *widths* there, because every sheet starts with a title/meta block — so we
 * set widths directly and add the real header row with addRow() where it belongs.
 */
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

function rowsForEvent(registrations) {
  return registrations.map((r, i) => {
    const regDate = time.dateToIstInputs(r.createdAt);
    const inDate = r.checkedInAt ? time.dateToIstInputs(r.checkedInAt) : { date: '', time: '' };
    return {
      sno: i + 1,
      registrationId: r.registrationId,
      name: r.student.name,
      registerNumber: r.student.registerNumber,
      department: r.student.department,
      academicYear: r.student.academicYear,
      section: r.student.section,
      email: r.student.email,
      phone: r.student.phone || '',
      regDate: regDate.date,
      regTime: time.fmtTime(r.createdAt),
      source: r.source === 'ON_SPOT' ? 'On-Spot' : 'Website',
      attendance: r.attendanceStatus === 'PRESENT' ? 'Present' : r.attendanceStatus === 'ABSENT' ? 'Absent' : 'Pending',
      inDate: inDate.date,
      inTime: r.checkedInAt ? time.fmtTime(r.checkedInAt) : '',
      _attendanceRaw: r.attendanceStatus,
    };
  });
}

function addEventMeta(sheet, event, rows, summary) {
  const title = sheet.addRow([`${event.name}  (${event.code})`]);
  title.font = { bold: true, size: 14, color: { argb: 'FF3B0764' } };
  sheet.mergeCells(title.number, 1, title.number, COLUMNS.length);

  const meta = sheet.addRow([
    `${event.category === 'TECHNICAL' ? 'Technical' : 'Non-Technical'} · ${event.venue} · ${time.fmtRange(event.startsAt, event.endsAt)}`,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    time.fmtDate(event.startsAt),
    '',
    '',
    '',
    '',
    '',
  ]);
  meta.getCell(1).font = { size: 10, italic: true, color: { argb: 'FF6B7280' } };
  sheet.mergeCells(meta.number, 1, meta.number, COLUMNS.length);

  // The totals row is deliberately NOT merged: each figure stays in its own cell so
  // Present / Pending / Absent are all readable in Excel and by other tools.
  const totals = sheet.addRow([
    `Total registrations: ${summary.total}`,
    `Present: ${summary.present}`,
    `Pending: ${summary.pending}`,
    `Absent: ${summary.absent}`,
    '', '', '', '', '', '', '', '', '', '', '',
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
  return { event, registrations };
}

function safeFilePart(name) {
  return String(name || 'Event').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'Event';
}

/** One workbook per event — rows always match the selected event's participant list. */
async function buildEventWorkbook(eventId) {
  const { event, registrations } = await loadEventWithRegistrations(eventId);
  const rows = rowsForEvent(registrations);
  const summary = {
    total: rows.length,
    present: rows.filter((r) => r._attendanceRaw === 'PRESENT').length,
    pending: rows.filter((r) => r._attendanceRaw === 'PENDING').length,
    absent: rows.filter((r) => r._attendanceRaw === 'ABSENT').length,
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Spark’26 Admin Workspace';
  wb.created = new Date();
  const sheet = wb.addWorksheet(sanitizeSheetName('Registrations'));
  applyWidths(sheet, COLUMNS.map((c) => c.key), COLUMNS);
  addEventMeta(sheet, event, rows, summary);

  const headerRow = sheet.addRow(COLUMNS.map((c) => c.header));
  styleHeaderRow(headerRow);
  rows.forEach((r, idx) => {
    const row = sheet.addRow([r.sno, r.registrationId, r.name, r.registerNumber, r.department, r.academicYear, r.section, r.email, r.phone, r.regDate, r.regTime, r.source, r.attendance, r.inDate, r.inTime]);
    if (idx % 2 === 1) row.eachCell((cell) => { cell.fill = ALT_FILL; });
    row.getCell(13).font = { bold: r.attendance === 'Present', color: { argb: r.attendance === 'Present' ? 'FF047857' : 'FF6B7280' } };
    row.alignment = { vertical: 'middle' };
  });

  sheet.views = [{ state: 'frozen', ySplit: headerRow.number }];
  sheet.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: headerRow.number, column: COLUMNS.length } };
  sheet.getColumn(10).numFmt = '@';   // Registration Date  (text, keeps "2026-10-18" intact)
  sheet.getColumn(14).numFmt = '@';   // Checked-in Date

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, filename: `Spark26_${safeFilePart(event.name)}_Registrations.xlsx`, event, count: rows.length, summary };
}

/** Master workbook: summary sheet + one worksheet per event. */
async function buildMasterWorkbook({ statuses = ['PUBLISHED', 'DRAFT', 'COMPLETED', 'CANCELLED'] } = {}) {
  const events = await prisma.event.findMany({ where: { status: { in: statuses } }, orderBy: [{ startsAt: 'asc' }, { code: 'asc' }] });
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Spark’26 Admin Workspace';
  wb.created = new Date();

  const summary = wb.addWorksheet(sanitizeSheetName('Summary'));
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
  const headerRow = summary.addRow(SUMMARY_COLUMNS.map((c) => c.header));
  styleHeaderRow(headerRow);

  const used = new Set(['summary']);
  let totalRegs = 0;
  let totalPresent = 0;

  for (const event of events) {
    const registrations = await prisma.registration.findMany({ where: { eventId: event.id }, include: registrationInclude, orderBy: { createdAt: 'asc' } });
    const rows = rowsForEvent(registrations);
    const present = rows.filter((r) => r._attendanceRaw === 'PRESENT').length;
    const pending = rows.filter((r) => r._attendanceRaw === 'PENDING').length;
    const onspot = rows.filter((r) => r.source === 'On-Spot').length;
    totalRegs += rows.length;
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
      rows.length,
      present,
      pending,
      rows.length - onspot,
      onspot,
    ]);
    row.alignment = { vertical: 'middle' };

    const sheet = wb.addWorksheet(sanitizeSheetName(`${iconFor(event)} ${event.name}`, used));
    applyWidths(sheet, COLUMNS.map((c) => c.key), COLUMNS);
    addEventMeta(sheet, event, rows, { total: rows.length, present, pending, absent: rows.length - present - pending });
    const hr = sheet.addRow(COLUMNS.map((c) => c.header));
    styleHeaderRow(hr);
    rows.forEach((r, idx) => {
      const r2 = sheet.addRow([r.sno, r.registrationId, r.name, r.registerNumber, r.department, r.academicYear, r.section, r.email, r.phone, r.regDate, r.regTime, r.source, r.attendance, r.inDate, r.inTime]);
      if (idx % 2 === 1) r2.eachCell((cell) => { cell.fill = ALT_FILL; });
    });
    sheet.views = [{ state: 'frozen', ySplit: hr.number }];
    sheet.autoFilter = { from: { row: hr.number, column: 1 }, to: { row: hr.number, column: COLUMNS.length } };
  }

  const totalsRow = summary.addRow(['', 'TOTAL', '', '', '', '', '', '', totalRegs, totalPresent, totalRegs - totalPresent, '', '']);
  totalsRow.font = { bold: true, color: { argb: 'FF3B0764' } };
  summary.views = [{ state: 'frozen', ySplit: headerRow.number }];
  summary.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: headerRow.number, column: SUMMARY_COLUMNS.length } };

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

module.exports = { buildEventWorkbook, buildMasterWorkbook, COLUMNS };
