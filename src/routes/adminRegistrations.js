'use strict';
const express = require('express');
const { asyncHandler, ApiError } = require('../lib/http');
const { validate } = require('../middleware/validate');
const { onSpotSchema } = require('../lib/validate-schemas');
const { requireAdmin, requireRole, csrfProtection } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const eventsService = require('../services/events');
const registrationsService = require('../services/registrations');
const excel = require('../services/excel');
const { adminMutationLimiter } = require('../middleware/rateLimit');

const router = express.Router();
router.use(requireAdmin);

/** GET /api/admin/registrations — paginated, filterable by event + search + attendance. */
router.get(
  '/registrations',
  asyncHandler(async (req, res) => {
    const result = await registrationsService.listRegistrations({
      eventId: req.query.eventId,
      search: String(req.query.search || '').trim(),
      attendance: String(req.query.attendance || 'ALL').toUpperCase(),
      page: req.query.page,
      pageSize: req.query.pageSize,
      sort: req.query.sort,
    });
    res.json({ ok: true, ...result });
  })
);

/** GET /api/admin/events/:id/participants — participants for one selected event. */
router.get(
  '/events/:id/participants',
  asyncHandler(async (req, res) => {
    const event = await eventsService.publicEventDetail(req.params.id).catch(async () => {
      const e = await (require('../lib/prisma').event.findUnique({ where: { id: req.params.id } }));
      if (!e) throw ApiError.notFound('Event not found.');
      return eventsService.shapeEvent(e);
    });
    const result = await registrationsService.listRegistrations({
      eventId: event.id,
      search: String(req.query.search || '').trim(),
      attendance: String(req.query.attendance || 'ALL').toUpperCase(),
      page: req.query.page,
      pageSize: req.query.pageSize || 200,
      sort: req.query.sort,
    });
    res.json({ ok: true, event, ...result });
  })
);

/** POST /api/admin/registrations — on-spot registration (creates the same records as a website signup). */
router.post(
  '/registrations',
  adminMutationLimiter,
  csrfProtection,
  requireRole('SUPERADMIN', 'ADMIN'),
  validate(onSpotSchema),
  asyncHandler(async (req, res) => {
    const { eventId, ...student } = req.body;
    const { event } = await eventsService.getEventByIdOrCode(eventId, { includeUnpublished: true });
    const pass = await registrationsService.createRegistration({
      event,
      student,
      source: 'ON_SPOT',
      adminId: req.admin.id,
      ip: req.ip,
    });
    res.status(201).json({ ok: true, message: 'On-spot registration created.', pass });
  })
);

/** GET /api/admin/events-summary — per-event counts for selectors and dashboard. */
router.get(
  '/events-summary',
  asyncHandler(async (_req, res) => {
    const events = await registrationsService.eventSummaries();
    res.json({ ok: true, events });
  })
);

/** GET /api/admin/events/:id/registrations.xlsx — event-wise workbook. */
router.get(
  '/events/:id/registrations.xlsx',
  asyncHandler(async (req, res) => {
    const { buffer, filename, count, summary, event } = await excel.buildEventWorkbook(req.params.id);
    await audit({
      adminId: req.admin.id,
      action: 'export.event_xlsx',
      entityType: 'Event',
      entityId: event.id,
      metadata: { filename, rows: count },
      ip: req.ip,
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Rows', String(count));
    res.setHeader('X-Export-Present', String(summary.present));
    res.send(Buffer.from(buffer));
  })
);

/** GET /api/admin/export/master.xlsx — summary sheet + one worksheet per event. */
router.get(
  '/export/master.xlsx',
  asyncHandler(async (req, res) => {
    const { buffer, filename, totalRegs, events } = await excel.buildMasterWorkbook({});
    await audit({
      adminId: req.admin.id,
      action: 'export.master_xlsx',
      entityType: 'Event',
      entityId: null,
      metadata: { filename, events, rows: totalRegs },
      ip: req.ip,
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  })
);

/** GET /api/admin/events/:id/registrations.csv — event-wise CSV export */
router.get(
  '/events/:id/registrations.csv',
  asyncHandler(async (req, res) => {
    const { event, registrations } = await excel.loadEventWithRegistrations(req.params.id);
    const csvContent = excel.buildRegistrationsCsv(registrations);
    const filename = `Spark26_${excel.safeFilePart(event.name)}_Registrations.csv`;
    await audit({
      adminId: req.admin.id,
      action: 'export.event_csv',
      entityType: 'Event',
      entityId: event.id,
      metadata: { filename, rows: registrations.length },
      ip: req.ip,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Rows', String(registrations.length));
    res.send(csvContent);
  })
);

/** GET /api/admin/export/registrations.csv — all registrations CSV export */
router.get(
  '/export/registrations.csv',
  asyncHandler(async (req, res) => {
    const registrations = await (require('../lib/prisma')).registration.findMany({
      include: excel.registrationInclude,
      orderBy: [{ eventId: 'asc' }, { createdAt: 'asc' }],
    });
    await excel.attachTeamMembers(registrations);
    const csvContent = excel.buildRegistrationsCsv(registrations);
    const time = require('../lib/time');
    const filename = `Spark26_Registrations_${time.dateToIstInputs(new Date()).date}.csv`;
    await audit({
      adminId: req.admin.id,
      action: 'export.master_csv',
      entityType: 'Registration',
      entityId: null,
      metadata: { filename, rows: registrations.length },
      ip: req.ip,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Rows', String(registrations.length));
    res.send(csvContent);
  })
);

/** DELETE /api/admin/registrations/:id — permanently delete an individual registration record (admin only). */
router.delete(
  '/registrations/:id',
  adminMutationLimiter,
  csrfProtection,
  requireRole('SUPERADMIN', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const deleted = await registrationsService.deleteRegistration({
      id: req.params.id,
      adminId: req.admin.id,
      ip: req.ip,
    });
    res.json({ ok: true, message: 'Registration deleted successfully.', deleted });
  })
);

module.exports = router;

