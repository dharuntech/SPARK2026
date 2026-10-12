'use strict';
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { ApiError } = require('../lib/http');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function ensureCsrfToken(req) {
  if (!req.session) return null;
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('base64url');
  return req.session.csrf;
}

/** Session must exist → otherwise 401. Re-reads the admin so revoked/disabled accounts lose access instantly. */
async function requireAdmin(req, _res, next) {
  try {
    const adminId = req.session && req.session.adminId;
    if (!adminId) throw ApiError.unauthorized('Please sign in to the admin workspace.');
    const admin = await prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin || admin.status !== 'ACTIVE') {
      req.session.destroy(() => {});
      throw ApiError.unauthorized('Your admin session is no longer valid. Please sign in again.');
    }
    req.admin = { id: admin.id, name: admin.name, email: admin.email, role: admin.role };
    next();
  } catch (err) { next(err); }
}

function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.admin) return next(ApiError.unauthorized());
    if (roles.length && !roles.includes(req.admin.role)) {
      return next(ApiError.forbidden('Your admin role does not permit this action.'));
    }
    return next();
  };
}

/** Double-submit synchroniser-token CSRF protection for cookie-authenticated writes. */
function csrfProtection(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const expected = req.session && req.session.csrf;
  const provided = req.get('x-csrf-token') || (req.body && req.body._csrf);
  if (!expected || !provided) return next(new ApiError(403, 'CSRF_MISSING', 'Missing CSRF token. Refresh the page and try again.'));
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(provided));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return next(new ApiError(403, 'CSRF_INVALID', 'Invalid CSRF token. Refresh the page and try again.'));
  }
  return next();
}

module.exports = { requireAdmin, requireRole, csrfProtection, ensureCsrfToken };
