#!/usr/bin/env node
'use strict';
/**
 * Cross-platform test runner for Spark'26.
 * Replaces the shell script in package.json "test" that uses Unix-only syntax
 * (NODE_ENV=test prefix) which does not work in Windows PowerShell.
 *
 * Usage: node scripts/run-tests.js [test files glob]
 */
const { execFileSync } = require('child_process');
const path = require('path');

// Step 1: Prepare the test database (migrates spark26_test, never the live DB)
console.log('\n── Step 1: Preparing test database ─────────────────────\n');
execFileSync(process.execPath, [path.join(__dirname, 'test-db-prepare.js')], {
  stdio: 'inherit',
  env: process.env,
});

// Step 2: Run the test suite with NODE_ENV=test
console.log('\n── Step 2: Running test suite ───────────────────────────\n');
const fs = require('fs');
const testsDir = path.join(__dirname, '..', 'tests');
const testFiles = fs.readdirSync(testsDir)
  .filter(f => f.endsWith('.test.js'))
  .map(f => path.join(testsDir, f));

if (!testFiles.length) {
  console.error('No test files found in tests/');
  process.exit(1);
}

execFileSync(
  process.execPath,
  ['--test', '--test-concurrency=1', ...testFiles],
  {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' },
  }
);
