'use strict';
const express = require('express');
const prisma = require('../lib/prisma');
const { asyncHandler, ApiError } = require('../lib/http');
const { validate } = require('../middleware/validate');
const { eventBodySchema } = require('../lib/validate-schemas');
const { requireAdmin, requireRole, csrfProtection } = require('../middleware/auth');
const { uploadFields, persistUpload, removeUpload } = require('../middleware/upload');
const { audit } = require('../lib/audit');
const time = require('../lib/time');
const eventsService = require('../services/events');
const { countsForEvents } = require('../services/events');

const router = express.Router();
router.use(requireAdmin);

const EVENT_FILES = uploadFields([{ name: 'image', maxCount: 1 }, { name: 'brochure', maxCount: 1 }]);

function parseEventPayload(body) {
  const parsed = eventBodySchema.safeParse(body);
  if (!parsed.success) {
    const details = {};
    for (const issue of parsed.error.issues) details[issue.path.join('.') || '_'] = issue.message;
    throw ApiError.validation(details);
  }
  const data = parsed.data;
  const startsAt = time.istInputToDate(data.eventDate, data.startTime);
  const endsAt = time.istInputToDate(data.eventDate, data.endTime);
  if (!startsAt || !endsAt) throw ApiError.validation({ eventDate: 'Enter a valid date and time' });
  if (endsAt <= startsAt) throw ApiError.validation({ endTime: 'End time must be after the start time' });

  let registrationDeadline = null;
  if (data.registrationDeadline) {
    const [d, t] = data.registrationDeadline.split('T');
    registrationDeadline = time.istInputToDate(d, t);
  }

  return {
    name: data.name,
    category: data.category,
    venue: data.venue,
    startsAt,
    endsAt,
    description: data.description,
    registrationMode: data.registrationMode,
    registrationDeadline,
    maxCapacity: data.maxCapacity === '' || data.maxCapacity == null ? null : Number(data.maxCapacity),
    status: data.status,
    code: data.code,
  };
}

/** GET /api/admin/events — full list (all statuses) + dashboard stats + per-event counts. */
router.get(
  '/events',
  asyncHandler(async (req, res) => {
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || 'ALL').toUpperCase();
    const category = String(req.query.category || 'ALL').toUpperCase();
    const where = {};
    if (status !== 'ALL') where.status = status;
    if (category === 'TECHNICAL') where.category = 'TECHNICAL';
    if (category === 'NON-TECHNICAL' || category === 'NON_TECHNICAL') where.category = 'NON_TECHNICAL';
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { venue: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }
    const events = await prisma.event.findMany({ where, orderBy: [{ startsAt: 'desc' }, { code: 'desc' }] });
    const counts = await countsForEvents(events.map((e) => e.id));
    const now = new Date();
    const [stats, summaries] = await Promise.all([eventsService.dashboardStats(), eventsService.listPublicEvents({})]);
    res.json({
      ok: true,
      events: events.map((e) => eventsService.shapeEvent(e, { ...(counts.get(e.id) || {}), now })),
      eventOptions: summaries.map((e) => ({ id: e.id, code: e.code, name: e.name, category: e.category, status: e.status, registeredCount: e.registeredCount })),
      stats,
    });
  })
);

/** GET /api/admin/events/:id */
router.get(
  '/events/:id',
  asyncHandler(async (req, res) => {
    const event = await prisma.event.findUnique({ where: { id: req.params.id } });
    if (!event) throw ApiError.notFound('Event not found.');
    const counts = await countsForEvents([event.id]);
    res.json({ ok: true, event: eventsService.shapeEvent(event, counts.get(event.id) || {}) });
  })
);

/** POST /api/admin/events — create (draft or published) with optional image/brochure. */
router.post(
  '/events',
  EVENT_FILES,
  csrfProtection,
  requireRole('SUPERADMIN', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const data = parseEventPayload(req.body);
    const slug = await eventsService.uniqueSlug(data.name);
    const code = data.code && data.code.trim() ? data.code.trim().toUpperCase() : await eventsService.nextEventCode();

    const imageFile = req.files?.image?.[0];
    const brochureFile = req.files?.brochure?.[0];
    const image = imageFile ? await persistUpload(imageFile, { category: 'events' }) : null;
    const brochure = brochureFile ? await persistUpload(brochureFile, { category: 'brochures', allowPdf: true }) : null;

    const event = await prisma.event.create({
      data: {
        code,
        slug,
        name: data.name,
        category: data.category,
        venue: data.venue,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        description: data.description,
        registrationMode: data.registrationMode,
        registrationDeadline: data.registrationDeadline,
        maxCapacity: data.maxCapacity,
        status: data.status || 'DRAFT',
        imageUrl: image?.url || null,
        brochureUrl: brochure?.url || null,
        brochureName: brochureFile ? brochureFile.originalname.slice(0, 200) : null,
        createdByAdminId: req.admin.id,
      },
    });

    await audit({
      adminId: req.admin.id,
      action: 'event.created',
      entityType: 'Event',
      entityId: event.id,
      metadata: { name: event.name, code: event.code, status: event.status },
      ip: req.ip,
    });

    res.status(201).json({ ok: true, event: eventsService.shapeEvent(event), message: 'Event saved.' });
  })
);

/** PATCH /api/admin/events/:id — edit metadata, replace image/brochure. */
router.patch(
  '/events/:id',
  EVENT_FILES,
  csrfProtection,
  requireRole('SUPERADMIN', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.event.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound('Event not found.');

    const data = parseEventPayload({ ...existingToBody(existing), ...req.body });
    const slug = data.name !== existing.name ? await eventsService.uniqueSlug(data.name, existing.id) : existing.slug;

    const imageFile = req.files?.image?.[0];
    const brochureFile = req.files?.brochure?.[0];
    const image = imageFile ? await persistUpload(imageFile, { category: 'events' }) : null;
    const brochure = brochureFile ? await persistUpload(brochureFile, { category: 'brochures', allowPdf: true }) : null;

    const event = await prisma.event.update({
      where: { id: existing.id },
      data: {
        name: data.name,
        slug,
        category: data.category,
        venue: data.venue,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        description: data.description,
        registrationMode: data.registrationMode,
        registrationDeadline: data.registrationDeadline,
        maxCapacity: data.maxCapacity,
        ...(data.status ? { status: data.status } : {}),
        ...(image ? { imageUrl: image.url } : {}),
        ...(brochure ? { brochureUrl: brochure.url, brochureName: brochureFile.originalname.slice(0, 200) } : {}),
      },
    });

    if (image && existing.imageUrl) await removeUpload(existing.imageUrl);
    if (brochure && existing.brochureUrl) await removeUpload(existing.brochureUrl);

    await audit({
      adminId: req.admin.id,
      action: 'event.updated',
      entityType: 'Event',
      entityId: event.id,
      metadata: { name: event.name, imageReplaced: Boolean(image), brochureReplaced: Boolean(brochure) },
      ip: req.ip,
    });

    res.json({ ok: true, event: eventsService.shapeEvent(event), message: 'Event updated.' });
  })
);

function existingToBody(event) {
  const start = time.dateToIstInputs(event.startsAt);
  const end = time.dateToIstInputs(event.endsAt);
  const deadline = event.registrationDeadline ? time.dateToIstInputs(event.registrationDeadline) : null;
  return {
    name: event.name,
    category: event.category,
    venue: event.venue,
    eventDate: start.date,
    startTime: start.time,
    endTime: end.time,
    description: event.description,
    registrationMode: event.registrationMode,
    registrationDeadline: deadline ? `${deadline.date}T${deadline.time}` : '',
    maxCapacity: event.maxCapacity ?? '',
    status: event.status,
    code: event.code,
  };
}

/** POST /api/admin/events/:id/image — dedicated image upload (kept separate from metadata edits). */
router.post(
  '/events/:id/image',
  uploadFields([{ name: 'image', maxCount: 1 }]),
  csrfProtection,
  requireRole('SUPERADMIN', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.event.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound('Event not found.');
    const image = await persistUpload(req.files?.image?.[0], { category: 'events' });
    const event = await prisma.event.update({ where: { id: existing.id }, data: { imageUrl: image.url } });
    if (existing.imageUrl) await removeUpload(existing.imageUrl);
    await audit({ adminId: req.admin.id, action: 'event.image_updated', entityType: 'Event', entityId: event.id, ip: req.ip });
    res.json({ ok: true, event: eventsService.shapeEvent(event), message: 'Event image updated.' });
  })
);

/** POST /api/admin/events/:id/brochure — dedicated brochure upload. */
router.post(
  '/events/:id/brochure',
  uploadFields([{ name: 'brochure', maxCount: 1 }]),
  csrfProtection,
  requireRole('SUPERADMIN', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.event.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound('Event not found.');
    const brochure = await persistUpload(req.files?.brochure?.[0], { category: 'brochures', allowPdf: true });
    const event = await prisma.event.update({
      where: { id: existing.id },
      data: { brochureUrl: brochure.url, brochureName: req.files.brochure[0].originalname.slice(0, 200) },
    });
    if (existing.brochureUrl) await removeUpload(existing.brochureUrl);
    await audit({ adminId: req.admin.id, action: 'event.brochure_updated', entityType: 'Event', entityId: event.id, ip: req.ip });
    res.json({ ok: true, event: eventsService.shapeEvent(event), message: 'Brochure updated.' });
  })
);

/** POST /api/admin/events/:id/status — publish / unpublish / cancel / complete. */
router.post(
  '/events/:id/status',
  csrfProtection,
  requireRole('SUPERADMIN', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const status = String(req.body.status || '').toUpperCase();
    if (!['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'].includes(status)) {
      throw ApiError.badRequest('Unknown event status.');
    }
    const event = await prisma.event.update({ where: { id: req.params.id }, data: { status } });
    await audit({
      adminId: req.admin.id,
      action: status === 'PUBLISHED' ? 'event.published' : 'event.status_changed',
      entityType: 'Event',
      entityId: event.id,
      metadata: { status },
      ip: req.ip,
    });
    res.json({ ok: true, event: eventsService.shapeEvent(event), message: `Event is now ${status.toLowerCase()}.` });
  })
);

/** POST /api/admin/events/:id/archive — soft delete; keeps registrations + attendance history. */
router.post(
  '/events/:id/archive',
  csrfProtection,
  requireRole('SUPERADMIN', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const event = await prisma.event.update({ where: { id: req.params.id }, data: { status: 'CANCELLED' } });
    await audit({ adminId: req.admin.id, action: 'event.archived', entityType: 'Event', entityId: event.id, ip: req.ip });
    res.json({ ok: true, event: eventsService.shapeEvent(event), message: 'Event archived. Registration history is preserved.' });
  })
);

/** DELETE /api/admin/events/:id — only possible when no registration history exists. */
router.delete(
  '/events/:id',
  csrfProtection,
  requireRole('SUPERADMIN', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const registrations = await prisma.registration.count({ where: { eventId: req.params.id } });
    if (registrations > 0) {
      throw ApiError.conflict('EVENT_HAS_REGISTRATIONS', 'This event has registrations. Unpublish or archive it instead so attendance history is preserved.');
    }
    const event = await prisma.event.findUnique({ where: { id: req.params.id } });
    if (!event) throw ApiError.notFound('Event not found.');
    await prisma.event.delete({ where: { id: event.id } });
    if (event.imageUrl) await removeUpload(event.imageUrl);
    if (event.brochureUrl) await removeUpload(event.brochureUrl);
    await audit({ adminId: req.admin.id, action: 'event.deleted', entityType: 'Event', entityId: event.id, metadata: { name: event.name }, ip: req.ip });
    res.json({ ok: true, message: 'Event deleted.' });
  })
);

/** POST /api/admin/settings/home-hero — persistent homepage photo upload. */
router.post(
  '/settings/home-hero',
  uploadFields([{ name: 'image', maxCount: 1 }]),
  csrfProtection,
  requireRole('SUPERADMIN', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const previous = await prisma.siteSetting.findUnique({ where: { key: 'homeHeroImageUrl' } });
    const image = await persistUpload(req.files?.image?.[0], { category: 'site' });
    await prisma.siteSetting.upsert({
      where: { key: 'homeHeroImageUrl' },
      update: { value: image.url },
      create: { key: 'homeHeroImageUrl', value: image.url },
    });
    if (previous?.value) await removeUpload(previous.value);
    await audit({ adminId: req.admin.id, action: 'settings.home_hero_updated', entityType: 'SiteSetting', entityId: 'homeHeroImageUrl', ip: req.ip });
    res.json({ ok: true, homeHeroImageUrl: image.url, message: 'Home page photo updated.' });
  })
);

/** DELETE /api/admin/settings/home-hero — revert to the built-in hero styling. */
router.delete(
  '/settings/home-hero',
  csrfProtection,
  requireRole('SUPERADMIN', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const previous = await prisma.siteSetting.findUnique({ where: { key: 'homeHeroImageUrl' } });
    await prisma.siteSetting.deleteMany({ where: { key: 'homeHeroImageUrl' } });
    if (previous?.value) await removeUpload(previous.value);
    await audit({ adminId: req.admin.id, action: 'settings.home_hero_reset', entityType: 'SiteSetting', entityId: 'homeHeroImageUrl', ip: req.ip });
    res.json({ ok: true, homeHeroImageUrl: null, message: 'Home page photo removed.' });
  })
);

/** GET /api/admin/audit — recent audit trail (no secrets are stored). */
router.get(
  '/audit',
  requireRole('SUPERADMIN', 'ADMIN'),
  asyncHandler(async (_req, res) => {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { admin: { select: { name: true, email: true } } },
    });
    res.json({ ok: true, logs });
  })
);

module.exports = router;
