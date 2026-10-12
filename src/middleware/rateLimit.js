'use strict';
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const env = require('../config/env');

const json = (message) => ({
  ok: false,
  error: { code: 'RATE_LIMITED', message },
});

/**
 * Rate limiters are always active in development and production.
 * They are skipped only for automated test runs (NODE_ENV=test) and when the
 * operator explicitly exports DISABLE_RATE_LIMITS=1 for a local load test.
 */
function build({ windowMs, max, message, keyGenerator, alwaysOn = false }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => (alwaysOn ? false : env.isTest || process.env.DISABLE_RATE_LIMITS === '1'),
    keyGenerator,
    handler: (_req, res) => res.status(429).json(json(message)),
  });
}

const loginLimiter = build({
  windowMs: 15 * 60 * 1000,
  max: env.rateLimits.login,
  message: 'Too many sign-in attempts. Please wait 15 minutes and try again.',
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.email || '').toLowerCase()}`,
});

const registerLimiter = build({
  windowMs: 15 * 60 * 1000,
  max: env.rateLimits.register,
  message: 'Too many registration attempts from this device. Please try again later.',
});

const verifyLimiter = build({
  windowMs: 60 * 1000,
  max: env.rateLimits.verify,
  message: 'Scanning too quickly — please slow down.',
});

const lookupLimiter = build({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many pass lookups. Please try again later.',
});

module.exports = { loginLimiter, registerLimiter, verifyLimiter, lookupLimiter, build };
