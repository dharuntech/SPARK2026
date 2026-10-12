'use strict';

class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  static badRequest(message, details) { return new ApiError(400, 'BAD_REQUEST', message, details); }
  static unauthorized(message = 'Authentication required.') { return new ApiError(401, 'UNAUTHORIZED', message); }
  static forbidden(message = 'You are not allowed to perform this action.') { return new ApiError(403, 'FORBIDDEN', message); }
  static notFound(message = 'Resource not found.') { return new ApiError(404, 'NOT_FOUND', message); }
  static conflict(code, message, details) { return new ApiError(409, code, message, details); }
  static tooMany(message = 'Too many requests. Please slow down.') { return new ApiError(429, 'RATE_LIMITED', message); }
  static validation(details, message = 'Some fields need attention.') { return new ApiError(422, 'VALIDATION_ERROR', message, details); }
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Uniform JSON envelope: { ok:false, error:{ code, message, details } } */
function errorHandler(err, req, res, _next) {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  const isProd = process.env.NODE_ENV === 'production';
  res.status(status).json({
    ok: false,
    error: {
      code: err.code || (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR'),
      message: status >= 500 && isProd ? 'Something went wrong on the server.' : err.message,
      ...(err.details ? { details: err.details } : {}),
    },
  });
}

function notFoundHandler(_req, res) {
  res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
}

/** Prisma error → readable API error (unique violations become 409s). */
function translatePrismaError(err) {
  if (err && err.code === 'P2002') {
    const target = Array.isArray(err.meta?.target) ? err.meta.target.join(', ') : err.meta?.target || 'field';
    return ApiError.conflict('DUPLICATE', `A record with the same ${target} already exists.`);
  }
  if (err && err.code === 'P2003') return ApiError.conflict('FK_CONSTRAINT', 'Related record is missing or still referenced.');
  if (err && err.code === 'P2025') return ApiError.notFound('Record not found.');
  return err;
}

module.exports = { ApiError, asyncHandler, errorHandler, notFoundHandler, translatePrismaError };
