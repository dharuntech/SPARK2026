'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

function required(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

const isProd = (process.env.NODE_ENV || 'development') === 'production';
const isTest = process.env.NODE_ENV === 'test';

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd,
  isTest,
  port: Number(process.env.PORT || 3000),
  appOrigin: process.env.APP_ORIGIN || `http://localhost:${process.env.PORT || 3000}`,
  databaseUrl: isTest
    ? (process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '')
    : (process.env.DATABASE_URL || ''),
  sessionSecret: required('SESSION_SECRET'),
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 12),
  cookieSecure: String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true' || isProd,
  uploadDir: path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'var/uploads'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 5) * 1024 * 1024,
  timezone: 'Asia/Kolkata',
  rateLimits: {
    login: Number(process.env.RL_LOGIN_PER_15MIN || 10),
    register: Number(process.env.RL_REGISTER_PER_15MIN || 40),
    verify: Number(process.env.RL_VERIFY_PER_MIN || 120),
  },
};

if (!env.databaseUrl) throw new Error('DATABASE_URL is not configured');
if (!isTest && env.sessionSecret.length < 24) {
  throw new Error('SESSION_SECRET must be at least 24 characters long');
}

module.exports = env;
