'use strict';
/**
 * Vercel Serverless Function entry point for Spark'26.
 * Bridges the Express.js application into Vercel's serverless environment.
 */
const { createApp } = require('../src/app');
const { ensureUploadDirs } = require('../src/middleware/upload');

try {
  ensureUploadDirs();
} catch (_) {}

const app = createApp();

module.exports = app;
