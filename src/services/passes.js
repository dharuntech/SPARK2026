'use strict';
const time = require('../lib/time');
const qr = require('../lib/qr');
const { categoryLabel, modeLabel, availability } = require('./events');

const ATTENDANCE_LABELS = { PENDING: 'PENDING', PRESENT: 'PRESENT', ABSENT: 'ABSENT' };

const studentOf = (registration) => registration.student || null;
const eventOf = (registration) => registration.event || null;

/**
 * Shapes a registration into everything the "My Pass" view needs.
 * The QR string contains only internal references (HMAC signed) — never
 * personal data, credentials or admin access.
 */
async function shapePass(registration, { withQr = true } = {}) {
  const student = studentOf(registration);
  const event = eventOf(registration);
  if (!student || !event) throw new Error('Registration is missing its student or event relation');

  const base = {
    registrationId: registration.registrationId,
    registrationDbId: registration.id,
    source: registration.source,
    sourceLabel: registration.source === 'ON_SPOT' ? 'On-spot registration' : 'Website registration',
    status: registration.status,
    attendanceStatus: registration.attendanceStatus,
    attendanceLabel: ATTENDANCE_LABELS[registration.attendanceStatus] || registration.attendanceStatus,
    attendanceVerified: registration.attendanceStatus === 'PRESENT',
    checkedInAt: registration.checkedInAt,
    checkedInAtLabel: time.fmtDateTime(registration.checkedInAt),
    createdAt: registration.createdAt,
    createdAtLabel: time.fmtDateTime(registration.createdAt),
    registrationOpen: availability(event, 0).open,
    student: {
      name: student.name,
      registerNumber: student.registerNumber,
      department: student.department,
      academicYear: student.academicYear,
      section: student.section,
      email: student.email,
      phone: student.phone || null,
    },
    event: {
      id: event.id,
      code: event.code,
      slug: event.slug,
      name: event.name,
      category: event.category,
      categoryLabel: categoryLabel(event.category),
      venue: event.venue,
      description: event.description,
      imageUrl: event.imageUrl || null,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      dateLabel: time.fmtDate(event.startsAt),
      timeLabel: time.fmtRange(event.startsAt, event.endsAt),
      registrationMode: event.registrationMode,
      modeLabel: modeLabel(event.registrationMode),
      status: event.status,
    },
    teamName: registration.teamName || '',
    teamMembers: Array.isArray(registration.teamMembers) ? registration.teamMembers : [],
  };

  if (registration.registrationId) {
    try {
      const prismaClient = require('../lib/prisma');
      if (!base.teamMembers.length) {
        const row = await prismaClient.siteSetting.findUnique({ where: { key: 'team_' + registration.registrationId } });
        if (row && row.value) base.teamMembers = JSON.parse(row.value);
      }
      if (!base.teamName) {
        const row = await prismaClient.siteSetting.findUnique({ where: { key: 'team_name_' + registration.registrationId } });
        if (row && row.value) base.teamName = row.value;
      }
    } catch (_) {}
  }

  if (!withQr) return base;

  const payload = qr.buildQrPayload({
    registrationId: registration.registrationId,
    qrToken: registration.qrToken,
    eventCode: event.code,
  });
  const images = await qr.qrImages(payload);

  return {
    ...base,
    qr: {
      /** The exact string encoded in the image — the scanner sends this back to the server. */
      payload,
      token: registration.qrToken,
      svgDataUrl: images.svgDataUrl,
      pngDataUrl: images.pngDataUrl,
    },
  };
}

const registrationInclude = { student: true, event: true };

module.exports = { shapePass, registrationInclude, ATTENDANCE_LABELS };
