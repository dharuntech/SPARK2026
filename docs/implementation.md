# Spark’26 — implementation summary

## A. Files created or changed

### Created — backend
| Path | Purpose |
| --- | --- |
| `src/server.js` | HTTP bootstrap, graceful shutdown |
| `src/app.js` | Express app: helmet/CSP, CORS, body parsing, PostgreSQL session store, route mounting, static hosting, error handling |
| `src/config/env.js` | Environment access + validation (fails fast on missing `SESSION_SECRET`/`DATABASE_URL`) |
| `src/lib/prisma.js` | Single PrismaClient instance |
| `src/lib/time.js` | Asia/Kolkata (IST) parsing/formatting helpers used by API, UI and Excel |
| `src/lib/ids.js` | Registration IDs, 256-bit opaque QR tokens, normalisation, slugify |
| `src/lib/qr.js` | Genuine QR generation (SVG + PNG) and HMAC-signed payload build/verify |
| `src/lib/audit.js` | Audit-log writer (never stores secrets/PII) |
| `src/lib/http.js` | `ApiError`, async wrapper, uniform JSON error handler, Prisma error translation |
| `src/lib/validate-schemas.js` | Zod schemas for registration, pass lookup, login, event, on-spot, verify, attendance |
| `src/middleware/auth.js` | Session auth, role gates, CSRF synchroniser tokens |
| `src/middleware/validate.js` | Zod validation middleware with field-level error maps |
| `src/middleware/rateLimit.js` | Login / registration / verify / lookup limiters (+ test switches) |
| `src/middleware/upload.js` | Memory upload → magic-byte validation → safe filename → persistent storage; traversal-safe delete |
| `src/routes/public.js` | Public events, registration, pass retrieval, settings |
| `src/routes/adminAuth.js` | Login, logout, session (CSRF issuance) |
| `src/routes/adminEvents.js` | Event CRUD, image/brochure upload, publish/unpublish/archive, home-hero, audit |
| `src/routes/adminRegistrations.js` | Registration lists, participants, on-spot registration, Excel exports |
| `src/routes/adminAttendance.js` | QR verification, manual attendance, summaries |
| `src/services/events.js` | Availability rules, shaping for UI, counts, dashboards |
| `src/services/registrations.js` | Transactional registration (advisory lock + unique constraint), lists, secure pass lookup |
| `src/services/passes.js` | Pass shaping incl. server-generated QR |
| `src/services/attendance.js` | Idempotent, transaction-safe check-in and manual corrections |
| `src/services/excel.js` | Event workbook + master workbook (ExcelJS) |

### Created — database, scripts, tests, docs
`prisma/schema.prisma`, `prisma/migrations/*_init/`, `prisma/seed.js`,
`scripts/create-admin.js`, `scripts/check.js`, `scripts/test-db-prepare.js`, `scripts/reset-dev-data.js`,
`scripts/e2e-browser.js`, `scripts/e2e-camera-scan.js`, `scripts/patch-app-a.js`/`patch-app-b.js`/`patch-html.py`
(documented, re-runnable frontend wiring patches),
`tests/helpers/harness.js`, `tests/api.test.js`, `tests/attendance.test.js`, `tests/excel.test.js`, `tests/security.test.js`,
`.env.example`, `.gitignore`, `README.md`, `docs/verification.md`, `docs/implementation.md`.

### Changed — frontend (design preserved)
| File | Change |
| --- | --- |
| `public/index.html` | Inline application `<script>` extracted verbatim to `public/app.js`; mobile **Contact** nav link added; admin event form now has real date/time/deadline/capacity/status controls and an event-image field with preview; new admin panels (participants, QR scanner, on-spot registration); pass switcher/download and *Find my pass* panel; all new styling isolated in one `<style id="sp26-backend-ui">` block |
| `public/app.js` | Mock localStorage store → REST API layer; fake QR grid → server-rendered genuine QR; hardcoded admin credentials → real session login; browser CSV → server `.xlsx`; admin workspace, scanner, on-spot registration, exports and pass retrieval wired to the API |
| `public/vendor/html5-qrcode.min.js` | Vendored camera QR scanner (served locally, no CDN dependency) |

**Unchanged:** the uploaded original at `uploads/Spark26_RoyalBlue_Purple_Light.html`, all CSS/theme,
animations, section markup, component IDs, modals and responsive behaviour.

## B. Commands

```bash
# database (once)
sudo pg_ctlcluster 17 main start
sudo -u postgres psql -c "CREATE ROLE spark26 WITH LOGIN PASSWORD 'spark26dev' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE spark26      OWNER spark26;"
sudo -u postgres psql -c "CREATE DATABASE spark26_test OWNER spark26;"

# application
cd spark26
cp .env.example .env          # then set DATABASE_URL, TEST_DATABASE_URL, SESSION_SECRET, ADMIN_*
npm install
npm run db:deploy             # migrations
npm run db:seed               # first admin + the 8 Spark'26 events
npm run check                 # environment/database report
npm start                     # http://localhost:3000   (npm run dev for auto-reload)

# tests
npm test                      # 50 API/DB/Excel/security tests (isolated test DB)
npm run test:e2e              # 35 browser acceptance checks
npm run test:camera           # camera QR check-in with a synthetic video stream
npm run data:reset            # clear demo data, keep the canonical events
```

First administrator (no public signup):

```bash
npm run admin:create -- --email coordinator@college.edu --name "S. Kumar" --role SUPERADMIN
# or seed from env:
ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run db:seed
```

## C. Schema and endpoints

See `README.md` §3 (tables and constraints) and §4 (complete endpoint table). Summary:

* Tables: `students`, `events`, `registrations`, `admin_users`, `audit_logs`, `site_settings`, `admin_sessions`
* Integrity: `UNIQUE(students.register_number)`, `UNIQUE(students.email)`,
  **`UNIQUE(registrations.student_id, registrations.event_id)`**, `UNIQUE(registrations.qr_token)`,
  foreign keys with `ON DELETE RESTRICT` so attendance history cannot be destroyed,
  indexes on event/status/attendance/created-at columns.
