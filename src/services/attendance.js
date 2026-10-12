'use strict';
const prisma = require('../lib/prisma');
const { ApiError } = require('../lib/http');
const qr = require('../lib/qr');
const time = require('../lib/time');
const { audit } = require('../lib/audit');
const { shapeRegistrationRow } = require('./registrations');

const RESULTS = {
  CHECKED_IN: 'CHECKED_IN',
  ALREADY_CHECKED_IN: 'ALREADY_CHECKED_IN',
  WRONG_EVENT: 'WRONG_EVENT',
  INVALID_CODE: 'INVALID_CODE',
  UNKNOWN_REGISTRATION: 'UNKNOWN_REGISTRATION',
  CANCELLED_REGISTRATION: 'CANCELLED_REGISTRATION',
  EVENT_NOT_SCANNABLE: 'EVENT_NOT_SCANNABLE',
};

const MESSAGES = {
  CHECKED_IN: 'Attendance verified. Student is marked present.',
  ALREADY_CHECKED_IN: 'This pass was already checked in for this event.',
  WRONG_EVENT: 'This pass belongs to a different event.',
  INVALID_CODE: 'This QR code is not a valid Spark’26 pass.',
  UNKNOWN_REGISTRATION: 'No registration found for that code.',
  CANCELLED_REGISTRATION: 'This registration was cancelled — attendance cannot be recorded.',
  EVENT_NOT_SCANNABLE: 'This event is not open for check-in (draft or cancelled).',
};

function lockedRegistrationInclude() {
  return { student: true, event: true };
}

/**
 * Verifies a scanned QR / manual registration ID for a specific event and marks
 * attendance atomically. Idempotent: concurrent or repeated scans can never
 * create a second check-in for the same registration.
 */
async function verifyAttendance({ eventId, code, registrationId, adminId, ip = null }) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw ApiError.notFound('Choose a valid event before scanning.');
  if (event.status === 'DRAFT' || event.status === 'CANCELLED') {
    return { result: RESULTS.EVENT_NOT_SCANNABLE, message: MESSAGES.EVENT_NOT_SCANNABLE, registration: null };
  }

  let token = null;
  let manualRegistrationId = null;

  if (code) {
    const parsed = qr.parseQrPayload(code);
    if (!parsed.ok) {
      return {
        result: RESULTS.INVALID_CODE,
        message: parsed.reason === 'signature'
          ? 'This QR code failed its security check — it may have been altered.'
          : MESSAGES.INVALID_CODE,
        registration: null,
      };
    }
    if (parsed.payload.r && parsed.payload.t) {
      // Signed payload → confirm the embedded registration id and token agree before trusting it.
      token = parsed.payload.t;
      manualRegistrationId = parsed.payload.r;
    } else {
      token = parsed.payload.t;
    }
  } else if (registrationId) {
    manualRegistrationId = String(registrationId).trim().toUpperCase();
  }

  if (!token && !manualRegistrationId) {
    return { result: RESULTS.INVALID_CODE, message: MESSAGES.INVALID_CODE, registration: null };
  }

  const registration = await prisma.registration.findFirst({
    where: token ? { qrToken: token } : { registrationId: manualRegistrationId },
    include: lockedRegistrationInclude(),
  });

  if (!registration) {
    return { result: RESULTS.UNKNOWN_REGISTRATION, message: MESSAGES.UNKNOWN_REGISTRATION, registration: null };
  }
  if (manualRegistrationId && token && registration.registrationId !== manualRegistrationId) {
    return { result: RESULTS.INVALID_CODE, message: 'This QR code is not a valid Spark’26 pass.', registration: null };
  }
  if (registration.status !== 'CONFIRMED') {
    return {
      result: RESULTS.CANCELLED_REGISTRATION,
      message: MESSAGES.CANCELLED_REGISTRATION,
      registration: shapeRegistrationRow(registration),
    };
  }
  if (registration.eventId !== event.id) {
    return {
      result: RESULTS.WRONG_EVENT,
      message: `This pass belongs to “${registration.event.name}” (${registration.event.code}), not the selected event.`,
      registration: shapeRegistrationRow(registration),
    };
  }

  const now = new Date();
  // Atomic compare-and-set: only one concurrent scan can flip PENDING → PRESENT.
  const updated = await prisma.registration.updateMany({
    where: { id: registration.id, attendanceStatus: 'PENDING' },
    data: { attendanceStatus: 'PRESENT', checkedInAt: now, checkedInByAdminId: adminId },
  });

  const fresh = await prisma.registration.findUnique({ where: { id: registration.id }, include: lockedRegistrationInclude() });
  const row = shapeRegistrationRow(fresh);

  if (updated.count === 1) {
    await audit({
      adminId,
      action: 'attendance.verified',
      entityType: 'Registration',
      entityId: fresh.registrationId,
      metadata: { eventId: event.id, eventCode: event.code },
      ip,
    });
    return {
      result: RESULTS.CHECKED_IN,
      message: MESSAGES.CHECKED_IN,
      student: row,
      registration: row,
      checkedInAt: fresh.checkedInAt,
      checkedInAtLabel: time.fmtDateTime(fresh.checkedInAt),
      checkedInBy: adminId,
    };
  }

  return {
    result: RESULTS.ALREADY_CHECKED_IN,
    message: MESSAGES.ALREADY_CHECKED_IN,
    student: row,
    registration: row,
    checkedInAt: fresh.checkedInAt,
    checkedInAtLabel: time.fmtDateTime(fresh.checkedInAt),
  };
}

/** Manual attendance correction by an authorised admin (audited). */
async function setAttendance({ registrationDbId, attendanceStatus, adminId, ip = null }) {
  const registration = await prisma.registration.findUnique({ where: { id: registrationDbId }, include: lockedRegistrationInclude() });
  if (!registration) throw ApiError.notFound('Registration not found.');

  const data = { attendanceStatus };
  if (attendanceStatus === 'PRESENT') {
    data.checkedInAt = registration.checkedInAt || new Date();
    data.checkedInByAdminId = adminId;
  } else {
    data.checkedInAt = null;
    data.checkedInByAdminId = null;
  }
  const updated = await prisma.registration.update({ where: { id: registration.id }, data, include: lockedRegistrationInclude() });

  await audit({
    adminId,
    action: 'attendance.manual_update',
    entityType: 'Registration',
    entityId: updated.registrationId,
    metadata: { eventId: updated.eventId, attendanceStatus },
    ip,
  });

  return shapeRegistrationRow(updated);
}

async function attendanceSummary({ eventId } = {}) {
  const where = eventId && eventId !== 'ALL' ? { eventId } : {};
  const [total, present, pending, absent] = await Promise.all([
    prisma.registration.count({ where }),
    prisma.registration.count({ where: { ...where, attendanceStatus: 'PRESENT' } }),
    prisma.registration.count({ where: { ...where, attendanceStatus: 'PENDING' } }),
    prisma.registration.count({ where: { ...where, attendanceStatus: 'ABSENT' } }),
  ]);
  return { total, present, pending, absent, percent: total ? Math.round((present / total) * 1000) / 10 : 0 };
}

module.exports = { verifyAttendance, setAttendance, attendanceSummary, RESULTS, MESSAGES };
