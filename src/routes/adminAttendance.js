'use strict';
const express = require('express');
const { asyncHandler } = require('../lib/http');
const { validate } = require('../middleware/validate');
const { verifySchema, attendancePatchSchema } = require('../lib/validate-schemas');
const { requireAdmin, requireRole, csrfProtection } = require('../middleware/auth');
const { verifyLimiter } = require('../middleware/rateLimit');
const attendanceService = require('../services/attendance');

const router = express.Router();
router.use(requireAdmin);

/** POST /api/admin/attendance/verify — the QR scanner endpoint (idempotent, transaction safe). */
router.post(
  '/attendance/verify',
  csrfProtection,
  verifyLimiter,
  requireRole('SUPERADMIN', 'ADMIN', 'SCANNER'),
  validate(verifySchema),
  asyncHandler(async (req, res) => {
    const outcome = await attendanceService.verifyAttendance({
      eventId: req.body.eventId,
      code: req.body.code,
      registrationId: req.body.registrationId,
      adminId: req.admin.id,
      ip: req.ip,
    });
    // A scan that was processed is a successful request: the `result` field tells the
    // UI exactly what happened (present / already present / wrong event / invalid).
    // Only a missing event (thrown above) or an unauthenticated caller is an error.
    const recorded = outcome.result === attendanceService.RESULTS.CHECKED_IN
      || outcome.result === attendanceService.RESULTS.ALREADY_CHECKED_IN;
    res.status(200).json({ ok: recorded, recorded, result: outcome.result, ...outcome });
  })
);

/** PATCH /api/admin/registrations/:id/attendance — manual correction by an authorised admin. */
router.patch(
  '/registrations/:id/attendance',
  csrfProtection,
  requireRole('SUPERADMIN', 'ADMIN'),
  validate(attendancePatchSchema),
  asyncHandler(async (req, res) => {
    const registration = await attendanceService.setAttendance({
      registrationDbId: req.params.id,
      attendanceStatus: req.body.attendanceStatus,
      adminId: req.admin.id,
      ip: req.ip,
    });
    res.json({ ok: true, registration, message: `Attendance set to ${req.body.attendanceStatus.toLowerCase()}.` });
  })
);

/** GET /api/admin/attendance/summary — totals for one event or the whole event platform. */
router.get(
  '/attendance/summary',
  asyncHandler(async (req, res) => {
    const summary = await attendanceService.attendanceSummary({ eventId: req.query.eventId });
    res.json({ ok: true, summary });
  })
);

module.exports = router;
