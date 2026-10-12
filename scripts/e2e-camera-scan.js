#!/usr/bin/env node
'use strict';
/**
 * Spark'26 — camera QR check-in verification.
 *
 * Feeds Chrome a synthetic camera stream (Y4M) containing a real Spark'26 pass QR,
 * opens the admin scanner, starts the camera and asserts that the app decodes the
 * code and marks the correct student present — i.e. the full scan → verify →
 * database → UI loop, not just the manual fallback.
 *
 *   node scripts/e2e-camera-scan.js
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { PNG } = require('pngjs');

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@spark26.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@26.spark';
const VAR = path.resolve(__dirname, '..', 'var');
const Y4M = path.join(VAR, 'fake-camera.y4m');

const W = 640;
const H = 480;
const FRAMES = 45;

/* ── build a Y4M (I420) video showing the QR code, centred on white ── */
function buildY4M(pngBuffer) {
  const qr = PNG.sync.read(pngBuffer);
  const side = Math.floor(Math.min(W, H) * 0.62);      // QR occupying ~62% of the frame
  const offX = Math.floor((W - side) / 2);
  const offY = Math.floor((H - side) / 2);
  const frame = Buffer.alloc(W * H + (W / 2) * (H / 2) * 2, 235); // Y=235 light grey

  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const idx = y * W + x;
      const inside = x >= offX && x < offX + side && y >= offY && y < offY + side;
      if (!inside) { frame[idx] = 235; continue; }
      const sx = Math.floor(((x - offX) / side) * qr.width);
      const sy = Math.floor(((y - offY) / side) * qr.height);
      const p = (qr.width * sy + sx) << 2;
      const r = qr.data[p]; const g = qr.data[p + 1]; const b = qr.data[p + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      frame[idx] = Math.max(0, Math.min(255, Math.round(luma)));
    }
  }
  const uOff = W * H;
  const vOff = uOff + (W / 2) * (H / 2);
  for (let i = 0; i < (W / 2) * (H / 2); i += 1) { frame[uOff + i] = 128; frame[vOff + i] = 128; }

  const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F25:1 Ip A1:1 C420\n`);
  const parts = [header];
  for (let f = 0; f < FRAMES; f += 1) {
    parts.push(Buffer.from('FRAME\n'), frame);
  }
  fs.writeFileSync(Y4M, Buffer.concat(parts));
  return fs.statSync(Y4M).size;
}

async function registerStudent() {
  const tag = Math.floor(Math.random() * 900 + 100);
  const student = {
    name: 'Camera Check Student',
    registerNumber: `CAM26${tag}`,
    department: 'Computer Science and Engineering',
    academicYear: 'II',
    section: 'B',
    email: `camera.${tag}@spark26.test`,
  };
  const events = await (await fetch(`${BASE}/api/events`)).json();
  const event = events.events.find((e) => e.registrationOpen);
  if (!event) throw new Error('no open event to register for');
  const res = await fetch(`${BASE}/api/registrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId: event.id, ...student }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error('registration failed: ' + JSON.stringify(body).slice(0, 200));
  return { student, event, pass: body.pass };
}

(async () => {
  fs.mkdirSync(VAR, { recursive: true });
  const { student, event, pass } = await registerStudent();
  console.log(`\n  prepared pass ${pass.registrationId} for ${student.name} @ ${event.name} (${event.code})`);

  const pngBuffer = Buffer.from(pass.qr.pngDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
  const size = buildY4M(pngBuffer);
  console.log(`  synthetic camera stream written (${Math.round(size / 1024)} KB) — QR ${pass.registrationId}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${Y4M}`,
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.click('#navAdmin');
  await page.waitForFunction(() => document.getElementById('loginOverlay').classList.contains('show'), { timeout: 15000 });
  await page.type('#loginEmail', ADMIN_EMAIL);
  await page.type('#loginPassword', ADMIN_PASSWORD);
  await page.click('#loginSubmit');
  await page.waitForFunction(() => document.getElementById('adminPortal').classList.contains('show'), { timeout: 20000 });
  await page.waitForFunction(() => [...document.querySelectorAll('#scanEventSelect option')].some((o) => o.value), { timeout: 20000 });

  await page.select('#scanEventSelect', event.id);
  await page.click('#scanStart');
  const started = await page.waitForFunction(() => /Scanning/.test(document.getElementById('scanResult').textContent), { timeout: 25000 })
    .then(() => true).catch(() => false);
  console.log(`  camera started: ${started}`);

  await page.screenshot({ path: path.join(VAR, 'e2e-shots', '09-camera-view.png'), clip: await page.$eval('#scanView', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) }).catch(() => {});
  let outcome = null;
  try {
    await page.waitForFunction(() => /Present ·|Already checked in/.test(document.getElementById('scanResult').textContent), { timeout: 60000 });
    outcome = await page.$eval('#scanResult', (e) => e.textContent.replace(/\s+/g, ' ').trim());
  } catch (err) {
    outcome = await page.$eval('#scanResult', (e) => 'TIMEOUT — ' + e.textContent.replace(/\s+/g, ' ').trim());
  }
  await page.screenshot({ path: path.join(VAR, 'e2e-shots', '08-camera-scan.png') }).catch(() => {});
  await page.click('#scanStop').catch(() => {});
  await browser.close();

  const ok = /Present ·|Already checked in/.test(outcome);
  console.log(`\n  scan result: ${outcome}`);
  console.log(`  ${ok ? '✓' : '✗'} camera QR scan → attendance ${ok ? 'verified' : 'NOT verified'}`);
  if (errors.length) console.log('  page errors:', errors.slice(0, 2).join(' | '));
  fs.writeFileSync(path.join(VAR, 'e2e-camera-result.json'), JSON.stringify({ ok, outcome, registrationId: pass.registrationId, student, event: event.name }, null, 2));
  process.exitCode = ok ? 0 : 1;
})().catch((err) => {
  console.error('camera scan check crashed:', err.message);
  process.exitCode = 1;
});
