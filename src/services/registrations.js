'use strict';
const prisma = require('../lib/prisma');
const { ApiError, translatePrismaError } = require('../lib/http');
const ids = require('../lib/ids');
const time = require('../lib/time');
const { audit } = require('../lib/audit');
const { shapePass, registrationInclude } = require('./passes');
const { availability, shapeEvent, countsForEvents } = require('./events');

const DUPLICATE_MESSAGE = 'This student already has a registration for the selected event.';

/** Resolves (or creates) the single student row for a person, keyed on the college register number. */
async function resolveStudent(tx, data) {
  const registerNumber = ids.normalizeRegisterNumber(data.registerNumber);
  const email = ids.normalizeEmail(data.email);
  const name = ids.normalizeName(data.name);

  const byRegisterNumber = await tx.student.findUnique({ where: { registerNumber } });
  const emailOwner = await tx.student.findUnique({ where: { email } });

  if (emailOwner && byRegisterNumber && emailOwner.id !== byRegisterNumber.id) {
    throw ApiError.conflict('EMAIL_IN_USE', 'That email address is already linked to a different register number.');
  }
  if (!byRegisterNumber && emailOwner) {
    // Same email, new register number → treat as the same person correcting their number only if numbers match loosely.
    throw ApiError.conflict('EMAIL_IN_USE', 'That email address is already registered with another register number.');
  }
  if (byRegisterNumber && byRegisterNumber.email !== email && emailOwner && emailOwner.id !== byRegisterNumber.id) {
    throw ApiError.conflict('EMAIL_IN_USE', 'That email address is already linked to a different student.');
  }

  if (byRegisterNumber) {
    return tx.student.update({
      where: { id: byRegisterNumber.id },
      data: {
        name,
        email,
        department: data.department.trim(),
        academicYear: data.academicYear.trim(),
        section: data.section.trim(),
        phone: data.phone ? String(data.phone).trim() : byRegisterNumber.phone,
      },
    });
  }

  return tx.student.create({
    data: {
      name,
      email,
      registerNumber,
      department: data.department.trim(),
      academicYear: data.academicYear.trim(),
      section: data.section.trim(),
      phone: data.phone ? String(data.phone).trim() : null,
    },
  });
}

/**
 * Creates one registration (website or on-spot) inside a serialised transaction:
 *  • per-event advisory lock prevents concurrent duplicate/capacity races
 *  • database unique constraint (studentId, eventId) is the final guard
 */
async function createRegistration({ event, student: studentInput, source, adminId = null, ip = null }) {
  if (!['WEBSITE', 'ON_SPOT'].includes(source)) throw ApiError.badRequest('Unknown registration source.');
  const isOnline = source === 'WEBSITE';

  const av = availability(event, await prisma.registration.count({ where: { eventId: event.id } }));
  if (isOnline) {
    if (!av.open) {
      const CODES = {
        FULL: 'EVENT_FULL',
        ON_SPOT_ONLY: 'ON_SPOT_ONLY',
        DEADLINE_PASSED: 'DEADLINE_PASSED',
        EVENT_STARTED: 'REGISTRATION_CLOSED',
        NOT_PUBLISHED: 'EVENT_NOT_PUBLISHED',
        CANCELLED: 'EVENT_CANCELLED',
        COMPLETED: 'EVENT_COMPLETED',
      };
      throw ApiError.conflict(CODES[av.reason] || 'REGISTRATION_CLOSED', require('./events').closedMessages[av.reason] || 'Registration is closed for this event.');
    }
    if (!['WEBSITE', 'BOTH'].includes(event.registrationMode)) {
      throw ApiError.conflict('ONLINE_REGISTRATION_DISABLED', 'Online registration is disabled for this event. Please register at the venue.');
    }
  } else {
    if (event.status !== 'PUBLISHED') throw ApiError.conflict('EVENT_NOT_PUBLISHED', 'Publish the event before registering students on-spot.');
    if (event.maxCapacity != null && av.reason === 'FULL') {
      throw ApiError.conflict('EVENT_FULL', require('./events').closedMessages.FULL);
    }
  }

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      // 1. Pessimistic ANSI SQL row-level lock on the target event row: guarantees strict serialization
      // for concurrent registrations targeting this event, immune to hash collisions and transaction poolers.
      const lockedEvents = await tx.$queryRaw`
        SELECT id, max_capacity, status, registration_mode
        FROM events
        WHERE id = ${event.id}
        FOR UPDATE
      `;
      const lockedEvent = lockedEvents && lockedEvents[0];
      const maxCapacity = lockedEvent ? lockedEvent.max_capacity : event.maxCapacity;

      // 2. Strict capacity check evaluated while holding the exclusive row lock.
      if (maxCapacity != null) {
        const confirmed = await tx.registration.count({ where: { eventId: event.id, status: 'CONFIRMED' } });
        if (confirmed >= maxCapacity) {
          throw ApiError.conflict('EVENT_FULL', require('./events').closedMessages.FULL);
        }
      }

      // 3. Resolve student record (normalized, unique register number)
      const student = await resolveStudent(tx, studentInput);

      // 4. Duplicate check inside transaction
      const existing = await tx.registration.findUnique({
        where: { one_registration_per_student_per_event: { studentId: student.id, eventId: event.id } },
      });
      if (existing) {
        throw ApiError.conflict('DUPLICATE_REGISTRATION', DUPLICATE_MESSAGE, {
          registrationId: existing.registrationId,
          eventId: event.id,
          attendanceStatus: existing.attendanceStatus,
        });
      }

      // 5. Generate unique registration pass with collision retry and constraint safety
      let registration = null;
      for (let attempt = 0; attempt < 5 && !registration; attempt += 1) {
        try {
          registration = await tx.registration.create({
            data: {
              registrationId: ids.generateRegistrationId(event.code),
              studentId: student.id,
              eventId: event.id,
              source,
              qrToken: ids.generateQrToken(),
              createdByAdminId: adminId,
            },
            include: registrationInclude,
          });
        } catch (err) {
          if (err.code === 'P2002' && String(err.meta?.target || '').includes('registration_id')) continue; // retry id collision
          if (err.code === 'P2002') {
            // Concurrent race on studentId + eventId unique constraint
            const duplicate = await tx.registration.findUnique({
              where: { one_registration_per_student_per_event: { studentId: student.id, eventId: event.id } },
            });
            if (duplicate) {
              throw ApiError.conflict('DUPLICATE_REGISTRATION', DUPLICATE_MESSAGE, {
                registrationId: duplicate.registrationId,
                eventId: event.id,
                attendanceStatus: duplicate.attendanceStatus,
              });
            }
          }
          throw err;
        }
      }
      if (!registration) throw new ApiError(500, 'ID_GENERATION_FAILED', 'Could not allocate a registration ID. Please retry.');
      return registration;
    }, { timeout: 15000, isolationLevel: 'ReadCommitted' });
  } catch (err) {
    throw translatePrismaError(err);
  }

  await audit({
    adminId,
    action: source === 'ON_SPOT' ? 'registration.created_on_spot' : 'registration.created',
    entityType: 'Registration',
    entityId: created.registrationId,
    metadata: { eventId: event.id, eventCode: event.code, source },
    ip,
  });

  const pass = await shapePass(created);
  return pass;
}

function shapeRegistrationRow(registration) {
  return {
    registrationId: registration.registrationId,
    dbId: registration.id,
    source: registration.source,
    sourceLabel: registration.source === 'ON_SPOT' ? 'On-spot' : 'Website',
    status: registration.status,
    attendanceStatus: registration.attendanceStatus,
    checkedInAt: registration.checkedInAt,
    checkedInAtLabel: time.fmtDateTime(registration.checkedInAt),
    createdAt: registration.createdAt,
    createdAtLabel: time.fmtDateTime(registration.createdAt),
    name: registration.student.name,
    registerNumber: registration.student.registerNumber,
    department: registration.student.department,
    academicYear: registration.student.academicYear,
    section: registration.student.section,
    email: registration.student.email,
    phone: registration.student.phone || null,
    eventId: registration.eventId,
    eventName: registration.event.name,
    eventCode: registration.event.code,
    eventDateLabel: time.fmtDate(registration.event.startsAt),
  };
}

/** Admin participant list — always filtered by event when an eventId is supplied. */
async function listRegistrations({ eventId, search = '', attendance = 'ALL', page = 1, pageSize = 50, sort = 'recent' } = {}) {
  const where = {};
  if (eventId && eventId !== 'ALL') where.eventId = eventId;
  if (attendance && attendance !== 'ALL') where.attendanceStatus = attendance;
  if (search) {
    where.OR = [
      { registrationId: { contains: search, mode: 'insensitive' } },
      { student: { is: { name: { contains: search, mode: 'insensitive' } } } },
      { student: { is: { email: { contains: search, mode: 'insensitive' } } } },
      { student: { is: { registerNumber: { contains: search, mode: 'insensitive' } } } },
      { event: { is: { name: { contains: search, mode: 'insensitive' } } } },
    ];
  }
  const take = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
  const orderBy = sort === 'name'
    ? [{ student: { name: 'asc' } }]
    : [{ createdAt: 'desc' }];

  const [rows, total] = await Promise.all([
    prisma.registration.findMany({ where, include: registrationInclude, orderBy, take, skip }),
    prisma.registration.count({ where }),
  ]);

  return {
    registrations: rows.map(shapeRegistrationRow),
    pagination: { page: Number(page) || 1, pageSize: take, total, pages: Math.max(1, Math.ceil(total / take)) },
  };
}

/** Secure pass retrieval: unguessable token, or register-number + email match. */
async function findPassByToken(token) {
  const registration = await prisma.registration.findUnique({ where: { qrToken: String(token || '') }, include: registrationInclude });
  if (!registration) throw ApiError.notFound('No pass found for that code.');
  return shapePass(registration);
}

async function findPassesByStudent({ registerNumber, email }) {
  const register = ids.normalizeRegisterNumber(registerNumber);
  const mail = ids.normalizeEmail(email);
  const student = await prisma.student.findFirst({ where: { registerNumber: register, email: mail } });
  if (!student) throw ApiError.notFound('No registrations found for those details. Check your register number and email.');
  const registrations = await prisma.registration.findMany({
    where: { studentId: student.id, status: 'CONFIRMED' },
    include: registrationInclude,
    orderBy: { createdAt: 'asc' },
  });
  return Promise.all(registrations.map((r) => shapePass(r)));
}

/** Event-wise summary rows used by the admin dashboard/selectors. */
async function eventSummaries() {
  const events = await prisma.event.findMany({ orderBy: [{ startsAt: 'asc' }, { code: 'asc' }] });
  const counts = await countsForEvents(events.map((e) => e.id));
  const now = new Date();
  return events.map((e) => shapeEvent(e, { ...(counts.get(e.id) || {}), now }));
}

module.exports = {
  createRegistration,
  listRegistrations,
  findPassByToken,
  findPassesByStudent,
  shapeRegistrationRow,
  eventSummaries,
  resolveStudent,
  DUPLICATE_MESSAGE,
};
