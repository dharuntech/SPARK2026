'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const env = require('./config/env');
const { errorHandler, notFoundHandler } = require('./lib/http');

function buildSession(app) {
  const options = {
    name: 'spark26.sid',
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.cookieSecure,
      maxAge: env.sessionTtlHours * 60 * 60 * 1000,
    },
  };

  if (!env.isTest && env.databaseUrl) {
    // Sessions live in PostgreSQL alongside everything else (table auto-created).
    const PgSession = require('connect-pg-simple')(session);
    options.store = new PgSession({
      conString: env.databaseUrl,
      tableName: 'admin_sessions',
      createTableIfMissing: true,
      pruneSessionInterval: 60 * 15,
    });
  }

  app.use(session(options));
}

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          // The single-file Spark'26 frontend relies on inline styles/scripts and data: URIs.
          scriptSrc: ["'self'", "'unsafe-inline'"],
          // Google Fonts (DM Sans / JetBrains Mono) are part of the existing design.
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
          mediaSrc: ["'self'", 'blob:', 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: env.isProd ? ["'self'"] : ['*'],
        },
      },
      // The live-preview iframe embeds this app; production keeps a strict policy.
      frameguard: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'same-origin' },
    })
  );

  const allowedOrigins = new Set(
    [env.appOrigin, `http://localhost:${env.port}`, `http://127.0.0.1:${env.port}`].filter(Boolean)
  );
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || env.isTest) return cb(null, true);
        if (allowedOrigins.has(origin)) return cb(null, true);
        // Same-origin requests proxied by the host (e.g. *.e2b.app previews) are allowed.
        return cb(null, /\.e2b\.app$/.test(new URL(origin).hostname));
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: '200kb' }));
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use(cookieParser());

  buildSession(app);

  app.get('/api/health', (_req, res) =>
    res.json({ ok: true, service: 'spark26', time: new Date().toISOString(), timezone: 'Asia/Kolkata' })
  );

  app.use('/api', require('./routes/public'));
  app.use('/api/admin/auth', require('./routes/adminAuth'));
  app.use('/api/admin', require('./routes/adminEvents'));
  app.use('/api/admin', require('./routes/adminRegistrations'));
  app.use('/api/admin', require('./routes/adminAttendance'));

  app.use('/uploads', express.static(env.uploadDir, { dotfiles: 'deny', index: false, maxAge: '7d', fallthrough: true }));

  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir, { index: 'index.html', extensions: ['html'] }));

  app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  app.use('/api', notFoundHandler);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

const defaultApp = createApp();
defaultApp.createApp = createApp;
module.exports = defaultApp;
