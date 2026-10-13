'use strict';
const ExcelJS = require('exceljs');
const prisma = require('../lib/prisma');
const { ApiError } = require('../lib/http');
const time = require('../lib/time');
const { registrationInclude } = require('./passes');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E1B4B' } }; // Dark indigo / purple
const HEADER_FONT = { name: 'Segoe UI', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const ALT_ROW_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }; // Subtle slate-50
const BORDER_STYLE = {
  top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
};

function safeFilePart(name) {
  return String(name || 'Event').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'Event';
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
  const regKeys = registrations.flatMap((r) => ['team_' + r.registrationId, 'team_' + r.id]);
  const nameKeys = registrations.flatMap((r) => ['team_name_' + r.registrationId, 'team_name_' + r.id]);
  const allKeys = [...new Set([...regKeys, ...nameKeys])];

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
    if (!r.teamMembers || !r.teamMembers.length) {
      r.teamMembers = teamMap.get(r.registrationId) || teamMap.get(r.id) || [];
    }
    if (!r.teamName) {
      r.teamName = nameMap.get(r.registrationId) || nameMap.get(r.id) || '';
    }
  });
}

/**
 * ── 5. Shared Data-Mapping Layer ──
 * Normalizes a single registration record into a consistent flat structure.
 */
function normalizeRegistration(r) {
  const student = r.student || {};
  const event = r.event || {};
  const members = Array.isArray(r.teamMembers) ? r.teamMembers : [];
  const attendanceStatus =
    r.attendanceStatus === 'PRESENT' ? 'Present' : r.attendanceStatus === 'ABSENT' ? 'Absent' : 'Pending';

  return {
    eventName: event.name || '',
    teamName: r.teamName || '',
    leaderName: student.name || '',
    registerNumber: student.registerNumber || '',
    department: student.department || '',
    year: student.academicYear || '',
    section: student.section || '',
    email: student.email || '',
    phone: student.phone || '',
    registrationId: r.registrationId || '',
    attendanceStatus,
    rawAttendance: r.attendanceStatus,
    teamMembers: members.map((m) => ({
      name: m.name || '',
      registerNumber: m.registerNumber || '',
      department: m.department || '',
      academicYear: m.academicYear || '',
      section: m.section || '',
      email: m.email || '',
      phone: m.phone || '',
    })),
  };
}

/**
 * Generates the unified column definitions.
 * Columns A–K are the standard 11 columns, followed by dynamically
 * added Member 1, Member 2, ... Member N columns when team members exist.
 */
function getExportColumns(maxMembers = 0) {
  const cols = [
    { header: 'Event Name', key: 'eventName', width: 26 },
    { header: 'Team Name', key: 'teamName', width: 22 },
    { header: 'Team Leader Name', key: 'leaderName', width: 26 },
    { header: 'Register Number', key: 'registerNumber', width: 22, isText: true },
    { header: 'Department', key: 'department', width: 28 },
    { header: 'Year', key: 'year', width: 10 },
    { header: 'Section', key: 'section', width: 10 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Mobile Number', key: 'phone', width: 20, isText: true },
    { header: 'Registration ID', key: 'registrationId', width: 22, isText: true },
    { header: 'Attendance Status', key: 'attendanceStatus', width: 18 },
  ];

  for (let m = 1; m <= maxMembers; m += 1) {
    cols.push(
      { header: `Member ${m} Name`, key: `member${m}Name`, width: 24 },
      { header: `Member ${m} Register Number`, key: `member${m}RegisterNumber`, width: 22, isText: true },
      { header: `Member ${m} Department`, key: `member${m}Department`, width: 24 },
      { header: `Member ${m} Year`, key: `member${m}Year`, width: 10 },
      { header: `Member ${m} Section`, key: `member${m}Section`, width: 10 },
      { header: `Member ${m} Email`, key: `member${m}Email`, width: 28 },
      { header: `Member ${m} Mobile Number`, key: `member${m}Phone`, width: 20, isText: true }
    );
  }

  return cols;
}

/**
 * Converts a normalized registration into an array of cell values matching getExportColumns.
 */
function rowFromNormalized(norm, maxMembers = 0) {
  const values = [
    norm.eventName,
    norm.teamName,
    norm.leaderName,
    norm.registerNumber,
    norm.department,
    norm.year,
    norm.section,
    norm.email,
    norm.phone,
    norm.registrationId,
    norm.attendanceStatus,
  ];

  for (let m = 0; m < maxMembers; m += 1) {
    const mem = norm.teamMembers[m] || {};
    values.push(
      mem.name || '',
      mem.registerNumber || '',
      mem.department || '',
      mem.academicYear || '',
      mem.section || '',
      mem.email || '',
      mem.phone || ''
    );
  }

  return values;
}

/**
 * Populates and formats an ExcelJS worksheet according to professional spreadsheet standards:
 *  • Row 1: Bold white text on dark purple/indigo header, centered, wrap text.
 *  • Rows 2..N: Exactly one registration per row, alternating row fill, text borders.
 *  • Text format (@) for numbers/IDs so leading zeros and precision are never lost.
 *  • Frozen header at row 1.
 *  • Excel auto-filter enabled across all columns.
 */
function populateSheet(sheet, columns, normalizedRows, maxMembers) {
  // Set column widths and number formats
  columns.forEach((col, idx) => {
    sheet.getColumn(idx + 1).width = col.width || 20;
    if (col.isText) {
      sheet.getColumn(idx + 1).numFmt = '@';
    }
  });

  // Row 1: Column Headers
  const headerRow = sheet.addRow(columns.map((c) => c.header));
  headerRow.height = 26;
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FF4338CA' } },
    };
  });

  // Rows 2..N: Registration Data (one row per registration)
  normalizedRows.forEach((norm, idx) => {
    const rowValues = rowFromNormalized(norm, maxMembers);
    const row = sheet.addRow(rowValues);
    row.height = 20;
    const isAlt = idx % 2 === 1;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (isAlt) {
        cell.fill = ALT_ROW_FILL;
      }
      cell.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF0F172A' } };
      cell.border = BORDER_STYLE;
      cell.alignment = { vertical: 'middle', horizontal: 'left' };

      const colDef = columns[colNumber - 1];
      if (colDef && colDef.isText) {
        cell.numFmt = '@';
      }
    });

    // Attendance Status styling in column 11
    const attCell = row.getCell(11);
    if (attCell.value === 'Present') {
      attCell.font = { name: 'Segoe UI', bold: true, color: { argb: 'FF047857' }, size: 10 };
    } else if (attCell.value === 'Absent') {
      attCell.font = { name: 'Segoe UI', color: { argb: 'FFDC2626' }, size: 10 };
    } else {
      attCell.font = { name: 'Segoe UI', color: { argb: 'FF6B7280' }, size: 10 };
    }
  });

  // Freeze Row 1 so headers remain visible while scrolling
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // Enable Excel auto-filter on all headers
  if (columns.length > 0) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };
  }
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

/**
 * ── 2. Event Participants — Excel Export ──
 * Generates properly formatted .xlsx workbook with one row per registration.
 * Column headers in row 1, team leader details followed by all team members in columns.
 */
async function buildEventWorkbook(eventId) {
  const { event, registrations } = await loadEventWithRegistrations(eventId);
  const normalized = registrations.map(normalizeRegistration);
  const maxMembers = Math.max(0, ...normalized.map((r) => r.teamMembers.length));
  const columns = getExportColumns(maxMembers);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Spark’26 Admin Workspace';
  wb.created = new Date();

  // Single event worksheet named after the event
  const sheet = wb.addWorksheet(sanitizeSheetName(event.name));
  populateSheet(sheet, columns, normalized, maxMembers);

  const summary = {
    total: registrations.length,
    present: normalized.filter((r) => r.rawAttendance === 'PRESENT').length,
    pending: normalized.filter((r) => r.rawAttendance === 'PENDING').length,
    absent: normalized.filter((r) => r.rawAttendance === 'ABSENT').length,
  };

  const buffer = await wb.xlsx.writeBuffer();
  return {
    buffer,
    filename: `Spark26_${safeFilePart(event.name)}_Registrations.xlsx`,
    event,
    count: registrations.length,
    summary,
  };
}

/**
 * ── Master Workbook Export ──
 * Generates master workbook with:
 *  1. Sheet 1: "All Registrations" — all registered participants across all events.
 *  2. Event-specific worksheets for each event tab.
 */
async function buildMasterWorkbook({ statuses = ['PUBLISHED', 'DRAFT', 'COMPLETED', 'CANCELLED'] } = {}) {
  const events = await prisma.event.findMany({
    where: { status: { in: statuses } },
    orderBy: [{ startsAt: 'asc' }, { code: 'asc' }],
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Spark’26 Admin Workspace';
  wb.created = new Date();

  const allRegistrations = [];
  const eventRegMap = new Map();

  for (const event of events) {
    const regs = await prisma.registration.findMany({
      where: { eventId: event.id },
      include: registrationInclude,
      orderBy: { createdAt: 'asc' },
    });
    await attachTeamMembers(regs);
    eventRegMap.set(event.id, regs);
    allRegistrations.push(...regs);
  }

  const allNormalized = allRegistrations.map(normalizeRegistration);
  const globalMaxMembers = Math.max(0, ...allNormalized.map((r) => r.teamMembers.length));
  const globalColumns = getExportColumns(globalMaxMembers);

  // ── Worksheet 1: All Registrations (Master Sheet) ──
  const masterSheet = wb.addWorksheet('All Registrations');
  populateSheet(masterSheet, globalColumns, allNormalized, globalMaxMembers);

  // ── Per-Event Worksheets ──
  const usedSheetNames = new Set(['all registrations']);
  for (const event of events) {
    const regs = eventRegMap.get(event.id) || [];
    const eventNorm = regs.map(normalizeRegistration);
    const eventMaxMembers = Math.max(0, ...eventNorm.map((r) => r.teamMembers.length));
    const eventColumns = getExportColumns(eventMaxMembers);

    const sheet = wb.addWorksheet(sanitizeSheetName(event.name, usedSheetNames));
    populateSheet(sheet, eventColumns, eventNorm, eventMaxMembers);
  }

  const buffer = await wb.xlsx.writeBuffer();
  return {
    buffer,
    filename: `Spark26_Master_Registrations_${time.dateToIstInputs(new Date()).date}.xlsx`,
    events: events.length,
    totalRegs: allRegistrations.length,
  };
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
 * ── 1. Registration List — CSV Export ──
 * Exports one registration per row with column headers in the first row.
 * Uses shared normalization layer to ensure 100% consistent data mapping.
 */
function buildRegistrationsCsv(registrations, { includeMembers = true } = {}) {
  const normalized = registrations.map(normalizeRegistration);
  const maxMembers = includeMembers
    ? Math.max(0, ...normalized.map((r) => r.teamMembers.length))
    : 0;
  const columns = getExportColumns(maxMembers);

  const headerLine = columns.map((c) => toCsvCell(c.header)).join(',');
  const lines = [headerLine];

  normalized.forEach((norm) => {
    const rowValues = rowFromNormalized(norm, maxMembers);
    lines.push(rowValues.map(toCsvCell).join(','));
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
  normalizeRegistration,
  getExportColumns,
  rowFromNormalized,
  registrationInclude,
};
