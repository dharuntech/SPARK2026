'use strict';
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const env = require('../config/env');
const prisma = require('../lib/prisma');

const json = (message, retryAfter) => ({
  ok: false,
  error: {
    code: 'RATE_LIMITED',
    message,
    ...(retryAfter ? { retryAfter: Number(retryAfter) } : {}),
  },
});

/**
 * PostgreSQL-backed distributed rate limit store for multi-instance Vercel serverless functions.
 * Uses atomic SQL upsert to avoid race conditions and ensure limits are shared across all instances.
 */
class PostgresStore {
  constructor(options = {}) {
    this.prefix = options.prefix || 'rl:';
    this.windowMs = 60000;
  }

  init(options) {
    this.windowMs = options.windowMs || 60000;
  }

  async increment(key) {
    const fullKey = this.prefix + key;
    const windowMsStr = String(this.windowMs);
    try {
      const rows = await prisma.$queryRawUnsafe(`
        INSERT INTO rate_limits (key, count, reset_at)
        VALUES ($1, 1, NOW() + ($2 || ' milliseconds')::interval)
        ON CONFLICT (key) DO UPDATE
        SET
          count = CASE WHEN rate_limits.reset_at <= NOW() THEN 1 ELSE rate_limits.count + 1 END,
          reset_at = CASE WHEN rate_limits.reset_at <= NOW() THEN NOW() + ($2 || ' milliseconds')::interval ELSE rate_limits.reset_at END
        RETURNING count, reset_at;
      `, fullKey, windowMsStr);

      if (rows && rows.length > 0) {
        return {
          totalHits: rows[0].count,
          resetTime: new Date(rows[0].reset_at),
        };
      }
    } catch (err) {
      // In case table is not ready or connection issue during tests, fail open safely
      if (process.env.NODE_ENV !== 'test') {
        console.warn('Postgres rate limit store fallback:', err.message);
      }
    }
    return {
      totalHits: 1,
      resetTime: new Date(Date.now() + this.windowMs),
    };
  }

  async decrement(key) {
    const fullKey = this.prefix + key;
    try {
      await prisma.$executeRawUnsafe(
        'UPDATE rate_limits SET count = GREATEST(0, count - 1) WHERE key = $1',
        fullKey
      );
    } catch (_) {}
  }

  async resetKey(key) {
    const fullKey = this.prefix + key;
    try {
      await prisma.$executeRawUnsafe(
        'DELETE FROM rate_limits WHERE key = $1',
        fullKey
      );
    } catch (_) {}
  }

  async resetAll() {
    try {
      await prisma.$executeRawUnsafe(
        'DELETE FROM rate_limits WHERE key LIKE $1',
        this.prefix + '%'
      );
    } catch (_) {}
  }
}

/**
 * Builds a configurable rate limiter with PostgreSQL backing in production/development,
 * standard RateLimit headers, Retry-After header on 429, and test skipping.
 */
function build({ windowMs, max, message, keyGenerator, prefix = 'rl:', alwaysOn = false }) {
  // Use PostgresStore when databaseUrl is configured, falling back to memory if test runner requests memory
  const store = (!env.isTest || alwaysOn) && env.databaseUrl ? new PostgresStore({ prefix }) : undefined;

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => (alwaysOn ? false : env.isTest || process.env.DISABLE_RATE_LIMITS === '1'),
    keyGenerator: keyGenerator || ((req) => ipKeyGenerator(req.ip)),
    store,
    handler: (req, res, _next, options) => {
      const retryAfter = res.getHeader('Retry-After');
      const msg = typeof options.message === 'string' ? options.message : message;
      return res.status(429).json(json(msg, retryAfter));
    },
  });
}

/** 1. Public Event Listings: ~120 req/min per IP */
const eventsListLimiter = build({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Too many event list requests. Please slow down.',
  prefix: 'rl:events:',
});

/** 2. Search & Filtering: ~60 req/min per IP */
const searchLimiter = build({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many search requests. Please slow down.',
  prefix: 'rl:search:',
});

/** 3. Event Detail: ~120 req/min per IP */
const eventDetailLimiter = build({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Too many event detail requests. Please slow down.',
  prefix: 'rl:detail:',
});

/** 4. Registration Submissions: ~10 attempts/min per IP + register number */
const registerLimiter = build({
  windowMs: 60 * 1000,
  max: Number(process.env.RL_REGISTER_PER_MIN || 10),
  message: 'Too many registration attempts. Please wait a minute and try again.',
  prefix: 'rl:reg:',
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.registerNumber || '').trim().toUpperCase() || 'anon'}`,
});

/** 5. Admin Login: ~5-10 failed attempts per 15 min per account and IP */
const loginLimiter = build({
  windowMs: 15 * 60 * 1000,
  max: env.rateLimits.login,
  message: 'Too many sign-in attempts. Please wait 15 minutes and try again.',
  prefix: 'rl:login:',
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.email || '').toLowerCase().trim()}`,
});

/** 6. Admin Mutations & Uploads: ~30 requests/minute per authenticated admin */
const adminMutationLimiter = build({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many administrative requests. Please slow down.',
  prefix: 'rl:admin:',
  keyGenerator: (req) => `${req.admin?.id || ipKeyGenerator(req.ip)}`,
});

/** 7. QR Attendance Verification: ~120 scans/min */
const verifyLimiter = build({
  windowMs: 60 * 1000,
  max: env.rateLimits.verify,
  message: 'Scanning too quickly — please slow down.',
  prefix: 'rl:verify:',
});

/** 8. Pass Lookup: ~20 lookups per 15 min */
const lookupLimiter = build({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many pass lookups. Please try again later.',
  prefix: 'rl:lookup:',
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.registerNumber || '').trim().toUpperCase() || 'anon'}`,
});

module.exports = {
  eventsListLimiter,
  searchLimiter,
  eventDetailLimiter,
  registerLimiter,
  loginLimiter,
  adminMutationLimiter,
  verifyLimiter,
  lookupLimiter,
  PostgresStore,
  build,
};
