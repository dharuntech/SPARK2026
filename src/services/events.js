'use strict';
const prisma = require('../lib/prisma');
const { ApiError } = require('../lib/http');
const time = require('../lib/time');

const CATEGORY_LABELS = { TECHNICAL: 'TECHNICAL', NON_TECHNICAL: 'NON-TECHNICAL' };
const MODE_LABELS = {
  WEBSITE: 'Online registration',
  ON_SPOT: 'On-spot registration',
  BOTH: 'Both on-spot and online registration',
};
const STATUS_LABELS = { DRAFT: 'DRAFT', PUBLISHED: 'PUBLISHED', CANCELLED: 'CANCELLED', COMPLETED: 'COMPLETED' };

const categoryLabel = (c) => CATEGORY_LABELS[c] || String(c || '').replace(/_/g, '-');
const modeLabel = (m) => MODE_LABELS[m] || String(m || '').replace(/_/g, ' ');

const closedMessages = {
  ON_SPOT_ONLY: 'This event is on-spot registration only. Please register at the venue desk.',
  DEADLINE_PASSED: 'Online registration for this event has closed.',
  EVENT_STARTED: 'This event has already started — online registration is closed.',
  FULL: 'This event has reached its maximum number of participants.',
  NOT_PUBLISHED: 'This event is not open for registration.',
  CANCELLED: 'This event has been cancelled.',
  COMPLETED: 'This event is completed.',
};

/** Registration availability — the single source of truth used by API and UI. */
function availability(event, registeredCount, now = new Date()) {
  if (event.status === 'CANCELLED') return { open: false, reason: 'CANCELLED' };
  if (event.status === 'COMPLETED') return { open: false, reason: 'COMPLETED' };
  if (event.status !== 'PUBLISHED') return { open: false, reason: 'NOT_PUBLISHED' };
  if (event.registrationMode === 'ON_SPOT') return { open: false, reason: 'ON_SPOT_ONLY' };
  if (event.maxCapacity != null && registeredCount >= event.maxCapacity) return { open: false, reason: 'FULL' };
  if (new Date(event.startsAt) <= now) return { open: false, reason: 'EVENT_STARTED' };
  if (event.registrationDeadline && new Date(event.registrationDeadline) <= now) return { open: false, reason: 'DEADLINE_PASSED' };
  return { open: true, reason: null };
}

function shapeEvent(event, { registeredCount = 0, presentCount = 0, now = new Date() } = {}) {
  const av = availability(event, registeredCount, now);
  const seatsLeft = event.maxCapacity != null ? Math.max(0, event.maxCapacity - registeredCount) : null;
  return {
    id: event.id,
    code: event.code,
    slug: event.slug,
    name: event.name,
    category: event.category,
    categoryLabel: categoryLabel(event.category),
    venue: event.venue,
    description: event.description,
    imageUrl: event.imageUrl || null,
    brochureUrl: event.brochureUrl || null,
    brochureName: event.brochureName || null,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    dateLabel: time.fmtDate(event.startsAt),
    dayLabel: `${time.fmtWeekday(event.startsAt)} · ${time.fmtDayMonth(event.startsAt)}`,
    timeLabel: time.fmtRange(event.startsAt, event.endsAt),
    dateTimeLabel: `${time.fmtDate(event.startsAt)} · ${time.fmtRange(event.startsAt, event.endsAt)}`,
    dateInput: time.dateToIstInputs(event.startsAt).date,
    startInput: time.dateToIstInputs(event.startsAt).time,
    endInput: time.dateToIstInputs(event.endsAt).time,
    registrationMode: event.registrationMode,
    modeLabel: modeLabel(event.registrationMode),
    registrationDeadline: event.registrationDeadline,
    registrationDeadlineLabel: time.fmtDateTime(event.registrationDeadline),
    registrationDeadlineInput: event.registrationDeadline
      ? `${time.dateToIstInputs(event.registrationDeadline).date}T${time.dateToIstInputs(event.registrationDeadline).time}`
      : '',
    maxCapacity: event.maxCapacity,
    registeredCount,
    presentCount,
    seatsLeft,
    registrationOpen: av.open,
    closedReason: av.reason,
    closedMessage: av.reason ? closedMessages[av.reason] : null,
    status: event.status,
    statusLabel: STATUS_LABELS[event.status],
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

async function countsForEvents(eventIds) {
  if (!eventIds.length) return new Map();
  const [regs, present] = await Promise.all([
    prisma.registration.groupBy({ by: ['eventId'], where: { eventId: { in: eventIds } }, _count: { _all: true } }),
    prisma.registration.groupBy({ by: ['eventId'], where: { eventId: { in: eventIds }, attendanceStatus: 'PRESENT' }, _count: { _all: true } }),
  ]);
  const map = new Map(eventIds.map((id) => [id, { registeredCount: 0, presentCount: 0 }]));
  for (const r of regs) map.get(r.eventId).registeredCount = r._count._all;
  for (const r of present) map.get(r.eventId).presentCount = r._count._all;
  return map;
}

/** Public listing: only PUBLISHED events are ever exposed. */
async function listPublicEvents({ search = '', category = 'ALL', limit = 100 } = {}) {
  const where = { status: 'PUBLISHED' };
  if (category && category !== 'ALL') {
    where.category = category === 'NON-TECHNICAL' ? 'NON_TECHNICAL' : category;
  }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { venue: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
    ];
  }
  const events = await prisma.event.findMany({ where, orderBy: [{ startsAt: 'asc' }, { code: 'asc' }], take: limit });
  const counts = await countsForEvents(events.map((e) => e.id));
  const now = new Date();
  return events.map((e) => {
    const c = counts.get(e.id) || { registeredCount: 0, presentCount: 0 };
    return shapeEvent(e, { ...c, now });
  });
}

async function getEventByIdOrCode(idOrCode, { includeUnpublished = false } = {}) {
  const key = String(idOrCode || '').trim();
  if (!key) throw ApiError.badRequest('Event is required.');
  const event = await prisma.event.findFirst({
    where: { OR: [{ id: key }, { code: key }, { slug: key.toLowerCase() }] },
  });
  if (!event) throw ApiError.notFound('That event could not be found.');
  if (!includeUnpublished && event.status !== 'PUBLISHED') {
    throw ApiError.notFound('That event is not open for registration.');
  }
  const registeredCount = await prisma.registration.count({ where: { eventId: event.id } });
  return { event, registeredCount };
}

async function publicEventDetail(idOrCode) {
  const { event, registeredCount } = await getEventByIdOrCode(idOrCode);
  const presentCount = await prisma.registration.count({ where: { eventId: event.id, attendanceStatus: 'PRESENT' } });
  return shapeEvent(event, { registeredCount, presentCount });
}

async function nextEventCode() {
  const rows = await prisma.event.findMany({ select: { code: true } });
  let max = 0;
  for (const r of rows) {
    const m = /^E(\d{1,4})$/.exec(r.code || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `E${String(max + 1).padStart(2, '0')}`;
}

async function uniqueSlug(name, ignoreEventId = null) {
  const { slugify } = require('../lib/ids');
  const base = slugify(name) || 'event';
  let slug = base;
  let n = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const clash = await prisma.event.findFirst({ where: { slug, ...(ignoreEventId ? { id: { not: ignoreEventId } } : {}) } });
    if (!clash) return slug;
    slug = `${base}-${n}`;
    n += 1;
  }
}

async function dashboardStats() {
  const [published, drafts, registrations, present, events, today] = await Promise.all([
    prisma.event.count({ where: { status: 'PUBLISHED' } }),
    prisma.event.count({ where: { status: 'DRAFT' } }),
    prisma.registration.count(),
    prisma.registration.count({ where: { attendanceStatus: 'PRESENT' } }),
    prisma.event.count(),
    prisma.registration.count({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
  ]);
  return { published, drafts, registrations, attendance: present, totalEvents: events, last24h: today };
}

module.exports = {
  CATEGORY_LABELS,
  MODE_LABELS,
  categoryLabel,
  modeLabel,
  availability,
  shapeEvent,
  countsForEvents,
  listPublicEvents,
  getEventByIdOrCode,
  publicEventDetail,
  nextEventCode,
  uniqueSlug,
  dashboardStats,
  closedMessages,
};
