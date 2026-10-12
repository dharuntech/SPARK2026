#!/usr/bin/env node
'use strict';
/** Applies Prisma migrations to the dedicated TEST database (never the live one). */
const { execFileSync } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error('TEST_DATABASE_URL is not set — refusing to run tests without an isolated database.');
  process.exit(1);
}
if (/\/spark26(\?|$)/.test(url) && !/_test/.test(url)) {
  console.error('TEST_DATABASE_URL does not look like a test database. Aborting.');
  process.exit(1);
}

console.log('Preparing test database…');
execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  shell: true, // required on Windows where npx resolves as npx.cmd
  env: { ...process.env, DATABASE_URL: url },
  cwd: path.join(__dirname, '..'),
});
console.log('Test database ready.\n');
