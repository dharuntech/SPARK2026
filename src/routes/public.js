'use strict';
const express = require('express');
const prisma = require('../lib/prisma');
const { asyncHandler, ApiError } = require('../lib/http');
const { validate } = require('../middleware/validate');
const { registerLimiter, lookupLimiter } = require('../middleware/rateLimit');
const { registerSchema, passLookupSchema } = require('../lib/validate-schemas');
const eventsService = require('../services/events');
const registrationsService = require('../services/registrations');

const router = express.Router();

/** GET /api/events — published events only, with live counts and availability. */
router.get(
  '/events',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const search = String(req.query.search || '').slice(0, 80);
    const category = String(req.query.category || 'ALL').toUpperCase();
    const events = await eventsService.listPublicEvents({ search, category });
    res.json({ ok: true, count: events.length, events, serverTime: new Date().toISOString(), timezone: 'Asia/Kolkata' });
  })
);

/** GET /api/events/:idOrCode — published event detail. */
router.get(
  '/events/:idOrCode',
  asyncHandler(async (req, res) => {
    const event = await eventsService.publicEventDetail(req.params.idOrCode);
    res.json({ ok: true, event });
  })
);

/** POST /api/registrations — website registration; returns the real QR pass. */
router.post(
  '/registrations',
  registerLimiter,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { eventId, ...student } = req.body;
    const { event } = await eventsService.getEventByIdOrCode(eventId);
    const pass = await registrationsService.createRegistration({
      event,
      student,
      source: 'WEBSITE',
      ip: req.ip,
    });
    res.status(201).json({ ok: true, message: 'Registration confirmed.', pass });
  })
);

/** GET /api/passes/token/:token — capability-based pass retrieval (token is the secret). */
router.get(
  '/passes/token/:token',
  asyncHandler(async (req, res) => {
    const pass = await registrationsService.findPassByToken(req.params.token);
    res.json({ ok: true, pass });
  })
);

/** POST /api/passes/lookup — retrieve every pass for a student (register number + email must match). */
router.post(
  '/passes/lookup',
  lookupLimiter,
  validate(passLookupSchema),
  asyncHandler(async (req, res) => {
    const passes = await registrationsService.findPassesByStudent(req.body);
    if (!passes.length) throw ApiError.notFound('No registrations found for those details.');
    res.json({ ok: true, count: passes.length, passes });
  })
);

/** GET /api/settings — public site settings (home hero image). */
router.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    const hero = await prisma.siteSetting.findUnique({ where: { key: 'homeHeroImageUrl' } });
    res.json({ ok: true, settings: { homeHeroImageUrl: hero ? hero.value : null } });
  })
);

module.exports = router;
