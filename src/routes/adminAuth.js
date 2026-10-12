'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { asyncHandler, ApiError } = require('../lib/http');
const { validate } = require('../middleware/validate');
const { loginLimiter } = require('../middleware/rateLimit');
const { loginSchema } = require('../lib/validate-schemas');
const { requireAdmin, ensureCsrfToken } = require('../middleware/auth');
const { audit } = require('../lib/audit');

const router = express.Router();

const publicAdmin = (admin) => ({ id: admin.id, name: admin.name, email: admin.email, role: admin.role, lastLoginAt: admin.lastLoginAt });

/** POST /api/admin/auth/login */
router.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const email = req.body.email;
    const admin = await prisma.adminUser.findUnique({ where: { email } });
    // Constant-ish work whether or not the account exists (avoids user enumeration timing).
    const hash = admin ? admin.passwordHash : '$2a$12$0000000000000000000000000000000000000000000000000000';
    const ok = await bcrypt.compare(req.body.password, hash);
    if (!admin || !ok) {
      await audit({ action: 'admin.login_failed', entityType: 'AdminUser', entityId: email, ip: req.ip });
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }
    if (admin.status !== 'ACTIVE') throw ApiError.forbidden('This admin account is disabled.');

    await new Promise((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve()))
    );
    req.session.adminId = admin.id;
    req.session.csrf = undefined;
    const csrfToken = ensureCsrfToken(req);
    await prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    await audit({ adminId: admin.id, action: 'admin.login', entityType: 'AdminUser', entityId: admin.id, ip: req.ip });

    res.json({ ok: true, admin: publicAdmin(admin), csrfToken });
  })
);

/** GET /api/admin/auth/session — who am I? Also hands out the CSRF token for writes. */
router.get(
  '/session',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({ ok: true, admin: req.admin, csrfToken: ensureCsrfToken(req) });
  })
);

/** POST /api/admin/auth/logout */
router.post(
  '/logout',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const adminId = req.session.adminId;
    await audit({ adminId, action: 'admin.logout', entityType: 'AdminUser', entityId: adminId, ip: req.ip });
    req.session.destroy(() => {});
    res.clearCookie('spark26.sid');
    res.json({ ok: true });
  })
);

module.exports = router;
