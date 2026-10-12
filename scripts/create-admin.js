#!/usr/bin/env node
'use strict';
/**
 * Creates or rotates an administrator account securely.
 *
 *   node scripts/create-admin.js --email coordinator@college.edu --name "S. Kumar" --role ADMIN
 *   ADMIN_PASSWORD='…' node scripts/create-admin.js --email … --rotate
 *
 * The password is never passed on the command line by default; it is read from
 * ADMIN_PASSWORD (env), or prompted for interactively. There is no public
 * admin-registration endpoint anywhere in the application.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

async function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const stdin = process.stdin;
    process.stdout.write(question);
    const onData = (char) => {
      const s = String(char);
      if (s === '\n' || s === '\r' || s === '\u0004') {
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(buffer);
      } else if (s === '\u0003') {
        process.exit(1);
      } else if (s === '\u007f') {
        buffer = buffer.slice(0, -1);
      } else {
        buffer += s;
      }
    };
    let buffer = '';
    stdin.on('data', onData);
  });
}

async function main() {
  const email = String(arg('email') || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const name = String(arg('name') || process.env.ADMIN_NAME || 'Spark26 Coordinator').trim();
  const role = String(arg('role') || process.env.ADMIN_ROLE || 'ADMIN').toUpperCase();
  const rotate = Boolean(arg('rotate'));

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('Provide a valid --email (or ADMIN_EMAIL).');
    process.exit(1);
  }
  if (!['SUPERADMIN', 'ADMIN', 'SCANNER'].includes(role)) {
    console.error('Role must be SUPERADMIN, ADMIN or SCANNER.');
    process.exit(1);
  }

  let password = process.env.ADMIN_PASSWORD || '';
  if (!password) password = await promptHidden('Password: ');
  if (password.length < 10) {
    console.error('Password must be at least 10 characters.');
    process.exit(1);
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing && !rotate) {
    console.error(`Admin ${email} already exists. Re-run with --rotate to set a new password.`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = existing
    ? await prisma.adminUser.update({ where: { email }, data: { name, role, passwordHash, status: 'ACTIVE' } })
    : await prisma.adminUser.create({ data: { name, email, role, passwordHash, status: 'ACTIVE' } });

  console.log(`${existing ? 'Updated' : 'Created'} admin ${admin.email} (${admin.role}).`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
