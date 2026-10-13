'use strict';
const ExcelJS = require('exceljs');
const prisma = require('../lib/prisma');
const { ApiError } = require('../lib/http');
const time = require('../lib/time');
const { registrationInclude } = require('./passes');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4C1D95' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const SECTION_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E8FF' } };
const SECTION_FONT = { bold: true, color: { argb: 'FF5B21B6' }, size: 10.5 };
const FIELD_FONT = { bold: true, color: { argb: 'FF334155' }, size: 10 };
const VALUE_FONT = { color: { argb: 'FF0F172A' }, size: 10 };

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });
  row.height = 24;
}

function styleFieldRow(row) {
  row.getCell(1).font = FIELD_FONT;
  row.getCell(2).font = VALUE_FONT;
  row.height = 19;
  row.getCell(1).alignment = { vertical: 'middle' };
  row.getCell(2).alignment = { vertical: 'middle' };
  row.getCell(2).numFmt = '@';
}

function styleSectionRow(row) {
  row.getCell(1).fill = SECTION_FILL;
  row.getCell(2).fill = SECTION_FILL;
  row.getCell(1).font = SECTION_FONT;
  row.getCell(2).font = { italic: true, color: { argb: 'FF6B7280' }, size: 10 };
  row.height = 20;
  row.getCell(1).alignment = { vertical: 'middle' };
  row.getCell(2).alignment = { vertical: 'middle' };
  row.border = {
    top: { style: 'thin', color: { argb: 'FFDDD6FE' } },
    bottom: { style: 'thin', color: { argb: 'FFDDD6FE' } },
  };
}

function safeFilePart(name) {
  return String(name || 'Event').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'Event';
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
 * Appends team blocks vertically to the single worksheet:
 * Team Leader Details -> Team Members Details Below -> Blank Row -> Next Team
 */
function appendTeamsToSheet(sheet, registrations) {
  registrations.forEach((r) => {
    const student = r.student || {};
    const event = r.event || {};
    const members = Array.isArray(r.teamMembers) ? r.teamMembers : [];
    const attText = r.attendanceStatus === 'PRESENT' ? 'Present' : r.attendanceStatus === 'ABSENT' ? 'Absent' : 'Pending';

    // ── TEAM LEADER DETAILS ──
    const leaderRows = [
      ['Event Name', event.name || ''],
      ['Team Name', r.teamName || '—'],
      ['Team Leader Name', student.name || ''],
      ['Register Number', student.registerNumber || ''],
      ['Department', student.department || '—'],
      ['Year', student.academicYear || '—'],
      ['Section', student.section || '—'],
      ['Email', student.email || ''],
      ['Mobile Number', student.phone || '—'],
      ['Registration ID', r.registrationId || ''],
      ['Attendance Status', attText],
    ];

    leaderRows.forEach(([field, details]) => {
      const row = sheet.addRow([field, details]);
      styleFieldRow(row);
      if (field === 'Attendance Status') {
        const cell = row.getCell(2);
        cell.font = { bold: attText === 'Present', color: { argb: attText === 'Present' ? 'FF047857' : 'FF6B7280' } };
      }
    });

    // ── TEAM MEMBERS DETAILS ──
    if (members.length === 0) {
      const teamRow = sheet.addRow(['TEAM MEMBERS', 'No additional team members']);
      styleSectionRow(teamRow);
    } else {
      const teamRow = sheet.addRow(['TEAM MEMBERS', `${members.length} Member(s)`]);
      styleSectionRow(teamRow);

      members.forEach((m, idx) => {
        const memberRows = [
          [`Member ${idx + 1} Name`, m.name || '—'],
          ['Register Number', m.registerNumber || '—'],
          ['Department', m.department || '—'],
          ['Year', m.academicYear || '—'],
          ['Section', m.section || '—'],
          ['Email', m.email || '—'],
          ['Mobile Number', m.phone || '—'],
        ];

        memberRows.forEach(([field, details]) => {
          const row = sheet.addRow([field, details]);
          styleFieldRow(row);
        });
      });
    }

    // Blank row after completing one team's information
    const blank = sheet.addRow([]);
    blank.height = 12;
  });
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
 * Builds event-specific workbook with EXACTLY ONE worksheet.
 * Team Leader Details -> Team Members Details Below -> Blank Row -> Next Team.
 */
async function buildEventWorkbook(eventId) {
  const { event, registrations } = await loadEventWithRegistrations(eventId);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Spark’26 Admin Workspace';
  wb.created = new Date();

  // Exactly ONE worksheet
  const sheet = wb.addWorksheet('Registrations');
  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 52;

  const headerRow = sheet.addRow(['Field', 'Details']);
  styleHeaderRow(headerRow);

  const summary = {
    total: registrations.length,
    present: registrations.filter((r) => r.attendanceStatus === 'PRESENT').length,
    pending: registrations.filter((r) => r.attendanceStatus === 'PENDING').length,
    absent: registrations.filter((r) => r.attendanceStatus === 'ABSENT').length,
  };

  appendTeamsToSheet(sheet, registrations);

  sheet.views = [{ state: 'frozen', ySplit: 1 }];

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
 * Builds master workbook with EXACTLY ONE worksheet.
 * Preserves event order, repeating the vertical team format for all teams.
 */
async function buildMasterWorkbook({ statuses = ['PUBLISHED', 'DRAFT', 'COMPLETED', 'CANCELLED'] } = {}) {
  const events = await prisma.event.findMany({
    where: { status: { in: statuses } },
    orderBy: [{ startsAt: 'asc' }, { code: 'asc' }],
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Spark’26 Admin Workspace';
  wb.created = new Date();

  // Exactly ONE worksheet
  const sheet = wb.addWorksheet('Registrations');
  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 52;

  const headerRow = sheet.addRow(['Field', 'Details']);
  styleHeaderRow(headerRow);

  let totalRegs = 0;

  for (const event of events) {
    const regs = await prisma.registration.findMany({
      where: { eventId: event.id },
      include: registrationInclude,
      orderBy: { createdAt: 'asc' },
    });
    await attachTeamMembers(regs);
    totalRegs += regs.length;

    appendTeamsToSheet(sheet, regs);
  }

  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer();
  return {
    buffer,
    filename: `Spark26_Master_Registrations_${time.dateToIstInputs(new Date()).date}.xlsx`,
    events: events.length,
    totalRegs,
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
 * Builds RFC 4180 CSV matching the single-worksheet vertical format.
 */
function buildRegistrationsCsv(registrations) {
  const lines = ['Field,Details'];
  registrations.forEach((r) => {
    const student = r.student || {};
    const event = r.event || {};
    const members = Array.isArray(r.teamMembers) ? r.teamMembers : [];
    const attText = r.attendanceStatus === 'PRESENT' ? 'Present' : r.attendanceStatus === 'ABSENT' ? 'Absent' : 'Pending';

    lines.push(`Event Name,${toCsvCell(event.name || '')}`);
    lines.push(`Team Name,${toCsvCell(r.teamName || '—')}`);
    lines.push(`Team Leader Name,${toCsvCell(student.name || '')}`);
    lines.push(`Register Number,${toCsvCell(student.registerNumber || '')}`);
    lines.push(`Department,${toCsvCell(student.department || '—')}`);
    lines.push(`Year,${toCsvCell(student.academicYear || '—')}`);
    lines.push(`Section,${toCsvCell(student.section || '—')}`);
    lines.push(`Email,${toCsvCell(student.email || '')}`);
    lines.push(`Mobile Number,${toCsvCell(student.phone || '—')}`);
    lines.push(`Registration ID,${toCsvCell(r.registrationId || '')}`);
    lines.push(`Attendance Status,${toCsvCell(attText)}`);

    if (members.length === 0) {
      lines.push('TEAM MEMBERS,No additional team members');
    } else {
      lines.push(`TEAM MEMBERS,${members.length} Member(s)`);
      members.forEach((m, idx) => {
        lines.push(`Member ${idx + 1} Name,${toCsvCell(m.name || '—')}`);
        lines.push(`Register Number,${toCsvCell(m.registerNumber || '—')}`);
        lines.push(`Department,${toCsvCell(m.department || '—')}`);
        lines.push(`Year,${toCsvCell(m.academicYear || '—')}`);
        lines.push(`Section,${toCsvCell(m.section || '—')}`);
        lines.push(`Email,${toCsvCell(m.email || '—')}`);
        lines.push(`Mobile Number,${toCsvCell(m.phone || '—')}`);
      });
    }

    lines.push(',');
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
  registrationInclude,
};
