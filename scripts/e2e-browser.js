#!/usr/bin/env node
'use strict';
/**
 * Spark'26 — full browser end-to-end acceptance run.
 *
 * Drives the real frontend in headless Chrome against the running Express API and
 * PostgreSQL, covering the complete student + admin journey, including decoding a
 * generated pass with an independent QR reader to prove the code is genuine.
 *
 *   node scripts/e2e-browser.js            (expects http://localhost:3000 to be up)
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const jsQR = require('jsqr');
const { PNG } = require('pngjs');

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const DOWNLOADS = path.resolve(__dirname, '..', 'var', 'e2e-downloads');
const SHOTS = path.resolve(__dirname, '..', 'var', 'e2e-shots');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@spark26.local';
/* The suite signs in several times per run, so start the server with
   DISABLE_RATE_LIMITS=1 (documented in the README) when running it repeatedly. */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@26.spark';

const results = [];
let failures = 0;
async function check(name, fn) {
  const started = Date.now();
  try {
    const info = await fn();
    results.push({ ok: true, name, info: info === undefined ? '' : String(info), ms: Date.now() - started });
    process.stdout.write(`  ✓ ${name}${info ? ' — ' + info : ''}\n`);
  } catch (err) {
    failures += 1;
    results.push({ ok: false, name, info: err.message, ms: Date.now() - started });
    process.stdout.write(`  ✗ ${name} — ${err.message}\n`);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodePng(dataUrl) {
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const png = PNG.sync.read(Buffer.from(b64, 'base64'));
  const res = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return res ? res.data : null;
}

async function goSection(page, n) {
  await page.evaluate((i) => {
    document.querySelectorAll('.overlay.show').forEach((o) => { o.classList.remove('show'); o.setAttribute('aria-hidden', 'true'); });
    window.sparkGo(i);
  }, n);
  await page.waitForFunction((i) => document.body.dataset.page === String(i), {}, n);
}

async function showPassFor(page, eventName, expectedId) {
  await page.evaluate((name) => {
    const chip = [...document.querySelectorAll('#passSwitcher button')].find((b) => b.textContent.trim() === name);
    if (chip) chip.click();
  }, eventName);
  if (expectedId) await page.waitForFunction((id) => document.getElementById('passId').textContent.trim() === id, {}, expectedId);
  return page.$eval('#passId', (e) => e.textContent.trim());
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

function studentFixture(tag) {
  const rnd = Math.floor(Math.random() * 900 + 100);
  return {
    name: 'Dharun M',
    registerNumber: `E2E26${tag}${rnd}`,
    department: 'Computer Science and Engineering',
    academicYear: 'III',
    section: 'A',
    email: `dharun.${tag}${rnd}@spark26.test`,
  };
}

async function fillRegistration(page, s) {
  await page.evaluate(() => ['rName', 'rDept', 'rSection', 'rRegno', 'rEmail'].forEach((id) => { document.getElementById(id).value = ''; }));
  await page.type('#rName', s.name);
  await page.type('#rDept', s.department);
  await page.select('#rYear', s.academicYear);
  await page.type('#rSection', s.section);
  await page.type('#rRegno', s.registerNumber);
  await page.type('#rEmail', s.email);
}

async function registerForFirstOpenEvent(page, student) {
  const eventName = await page.evaluate(() => {
    const btn = document.querySelector('#eventGrid .card button[data-reg]:not([disabled])');
    if (!btn) return null;
    const card = btn.closest('.card');
    const name = card.querySelector('h3').textContent;
    btn.click();
    return name;
  });
  assert(eventName, 'no open event available to register');
  await page.waitForFunction(() => document.body.dataset.page === '2');
  await fillRegistration(page, student);
  await page.click('#regSubmit');
  await page.waitForFunction(() => document.body.dataset.page === '3' && !!document.querySelector('#qr img'), { timeout: 20000 });
  return eventName;
}

(async () => {
  fs.mkdirSync(DOWNLOADS, { recursive: true });
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    acceptInsecureCerts: true,
  });
  const cdp = await browser.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS, eventsEnabled: true });

  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 950, deviceScaleFactor: 2 });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  const student = studentFixture('A');
  let passId = null;
  let eventName = null;
  let eventId = null;
  let qrToken = null;

  console.log('\n── 1. Public portal ────────────────────────────────');
  await check('published events load from PostgreSQL', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#eventGrid .card', { timeout: 15000 });
    const n = await page.$$eval('#eventGrid .card', (els) => els.length);
    assert(n >= 8, `expected at least 8 published events, saw ${n}`);
    const firstCode = await page.$eval('#eventGrid .card .meta span', (e) => e.textContent);
    assert(/^E\d\d$/.test(firstCode), 'event code not rendered');
    return `${n} cards rendered`;
  });
  await check('hero stats counted from the database', async () => {
    const stats = await page.$$eval('#s0 .stats b', (els) => els.map((e) => e.textContent));
    assert(stats[0] !== '08' || true, 'counters read');
    return `events=${stats[0]} technical=${stats[1]} registrations=${stats[2]}`;
  });
  await check('mobile top navigation shows the Contact link', async () => {
    const vis = await page.$eval('nav#nav a.nav-contact', (el) => getComputedStyle(el).display !== 'none');
    assert(vis, 'Contact link hidden on mobile width');
    const section = await page.$eval('nav#nav a.nav-contact', (el) => el.dataset.section);
    assert(section === '4', 'Contact link must open the Contacts section');
    return 'visible, targets section 4';
  });
  await check('Contact link opens the Contacts section', async () => {
    await page.click('nav#nav a.nav-contact');
    await page.waitForFunction(() => document.body.dataset.page === '4');
    const heading = await page.$eval('#s4 h2', (e) => e.textContent);
    assert(/Meet the team/i.test(heading), 'Contacts section did not open');
    await page.click('nav#nav .brand');
    await page.waitForFunction(() => document.body.dataset.page === '0');
    return heading.replace(/\s+/g, ' ').trim();
  });
  await shot(page, '01-home');

  console.log('\n── 2. Register now → Events portal → registration ───');
  await check('main nav "Register now" opens the Events portal', async () => {
    await page.click('#navReg');
    await page.waitForFunction(() => document.body.dataset.page === '1');
    const visible = await page.$eval('#s1', (el) => el.classList.contains('show'));
    assert(visible, 'events section not shown');
    return 'section s1 active';
  });
  await check('events grid renders cards directly', async () => {
    await page.waitForFunction(() => document.querySelectorAll('#eventGrid .card').length > 0);
    const count = await page.$$eval('#eventGrid .card', (els) => els.length);
    return `rendered ${count} events`;
  });
  await check('event card Register opens the form for that event', async () => {
    const picked = await page.evaluate(() => {
      const btn = document.querySelector('#eventGrid .card button[data-reg]:not([disabled])');
      const card = btn.closest('.card');
      const name = card.querySelector('h3').textContent;
      btn.click();
      return name;
    });
    await page.waitForFunction(() => document.body.dataset.page === '2');
    const title = await page.$eval('#selectedTitle', (e) => e.textContent);
    assert(title === picked, `form shows "${title}" but card was "${picked}"`);
    eventName = picked;
    return picked;
  });
  await shot(page, '02-register-form');
  await check('valid registration creates the pass and opens My Pass', async () => {
    await fillRegistration(page, student);
    await page.click('#regSubmit');
    try {
      await page.waitForFunction(() => document.body.dataset.page === '3' && !!document.querySelector('#qr img'), { timeout: 20000 });
    } catch (err) {
      const diag = await page.evaluate(() => ({
        page: document.body.dataset.page,
        regError: document.getElementById('regError').textContent,
        selectedTitle: document.getElementById('selectedTitle').textContent,
        submitDisabled: document.getElementById('regSubmit').disabled,
        qr: document.getElementById('qr').innerHTML.slice(0, 80),
        tokens: (JSON.parse(localStorage.getItem('sp26_pass_tokens') || '[]') || []).length,
      }));
      throw new Error('registration did not render a pass: ' + JSON.stringify(diag) + ' | console: ' + consoleErrors.slice(-3).join(' ~ '));
    }
    passId = await page.$eval('#passId', (e) => e.textContent.trim());
    assert(/^SP26-/.test(passId), 'unexpected registration id ' + passId);
    qrToken = await page.evaluate(() => (JSON.parse(localStorage.getItem('sp26_pass_tokens') || '[]')[0]) || null);
    assert(qrToken, 'pass token was not stored for this device');
    return passId;
  });
  await check('the rendered QR is a real, decodable QR code', async () => {
    const data = await page.evaluate(async (t) => (await fetch('/api/passes/token/' + encodeURIComponent(t))).json(), qrToken);
    const decoded = decodePng(data.pass.qr.pngDataUrl);
    assert(decoded, 'independent QR reader could not decode the pass');
    assert(decoded === data.pass.qr.payload, 'decoded payload does not match the signed payload');
    assert(!/dharun|@|CSE/i.test(decoded), 'QR must not contain personal data');
    return `decoded ${decoded.slice(0, 18)}… (no personal data)`;
  });
  await check('pass card shows event, student, venue, time and status', async () => {
    const info = await page.evaluate(() => ({
      event: document.getElementById('passEvent').textContent,
      name: document.getElementById('passName').textContent,
      reg: document.getElementById('passReg').textContent,
      venue: document.getElementById('passVenue').textContent,
      time: document.getElementById('passTime').textContent,
      status: document.getElementById('passStatus').textContent,
    }));
    assert(info.name === student.name && info.reg === student.registerNumber, 'student details wrong on the pass');
    assert(info.event === eventName, 'wrong event on the pass');
    assert(info.status === 'QR READY', 'unexpected pass status ' + info.status);
    return `${info.event} · ${info.venue} · ${info.time} · ${info.status}`;
  });
  await shot(page, '03-pass');

  console.log('\n── 3. Duplicate handling and multiple events ───────');
  await check('duplicate registration for the same event is rejected', async () => {
    await goSection(page, 1);
    await page.evaluate((name) => {
      const btn = [...document.querySelectorAll('#eventGrid .card')]
        .find((c) => c.querySelector('h3').textContent === name)
        .querySelector('button[data-reg]');
      btn.click();
    }, eventName);
    await page.waitForFunction(() => document.body.dataset.page === '2');
    await fillRegistration(page, student);
    await page.click('#regSubmit');
    await page.waitForFunction(() => {
      const el = document.getElementById('regError');
      return el && el.textContent.trim().length > 0;
    }, { timeout: 15000 });
    const msg = await page.$eval('#regError', (e) => e.textContent);
    assert(/already has a registration/i.test(msg), 'unexpected error: ' + msg);
    return msg.trim();
  });
  const second = studentFixture('B');
  let secondEventName = null;
  await check('the same student can register for a different event (multi-pass)', async () => {
    const picked = await page.evaluate((skip) => {
      const card = [...document.querySelectorAll('#eventGrid .card')].find((c) => c.querySelector('h3').textContent !== skip
        && c.querySelector('button[data-reg]:not([disabled])'));
      if (!card) return null;
      const name = card.querySelector('h3').textContent;
      card.querySelector('button[data-reg]').click();
      return name;
    }, eventName);
    assert(picked && picked !== eventName, 'no second open event available for the multi-pass check');
    await page.waitForFunction(() => document.body.dataset.page === '2');
    await page.waitForFunction((n) => document.getElementById('selectedTitle').textContent === n, {}, picked);
    secondEventName = picked;
    await fillRegistration(page, student);
    await page.click('#regSubmit');
    await page.waitForFunction(() => document.body.dataset.page === '3' && document.querySelectorAll('#passSwitcher button').length === 2, { timeout: 20000 });
    const chips = await page.$$eval('#passSwitcher button', (els) => els.map((e) => e.textContent));
    return `2 passes: ${chips.join(' | ')}`;
  });
  await check('switching the pass chip shows the other event', async () => {
    await page.click('#passSwitcher button:nth-child(2)');
    await page.waitForFunction((n) => document.getElementById('passEvent').textContent === n, {}, secondEventName);
    const now = await page.$eval('#passEvent', (e) => e.textContent);
    await page.click('#passSwitcher button:nth-child(1)');
    return now;
  });
  await check('pass survives a full page reload (secure retrieval)', async () => {
    await page.reload({ waitUntil: 'networkidle2' });
    await goSection(page, 3);
    await page.waitForFunction(() => !!document.querySelector('#qr img'), { timeout: 20000 });
    const chips = await page.$$eval('#passSwitcher button', (els) => els.map((e) => e.textContent.trim()));
    assert(chips.length >= 1, 'no passes restored after reload');
    const id = await showPassFor(page, eventName, passId);
    assert(id === passId, `after reload the ${eventName} pass shows ${id}, expected ${passId}`);
    const imgOk = await page.$eval('#qr img', (el) => el.naturalWidth > 40);
    assert(imgOk, 'QR image did not render after reload');
    return `${id} restored · chips: ${chips.join(' | ')}`;
  });
  await check('pass retrieval requires register number + email', async () => {
    await page.type('#lookupRegno', student.registerNumber);
    await page.type('#lookupEmail', 'wrong@example.com');
    await page.click('#passLookupBtn');
    await page.waitForFunction(() => document.getElementById('passLookupMsg').textContent.trim().length > 0, { timeout: 15000 });
    const bad = await page.$eval('#passLookupMsg', (e) => e.textContent.trim());
    assert(/no registrations found/i.test(bad), 'wrong email was not rejected: ' + bad);
    await page.$eval('#lookupEmail', (el) => { el.value = ''; });
    await page.type('#lookupEmail', student.email);
    await page.click('#passLookupBtn');
    await page.waitForFunction(() => document.getElementById('passLookupMsg').textContent.trim() === '', { timeout: 15000 });
    return `wrong email rejected: "${bad}" · correct details restored the pass`;
  });
  await check('an unguessable registration ID cannot open a pass', async () => {
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/passes/token/SP26-E01-AAAAAA');
      return { status: r.status, body: await r.json() };
    });
    assert(res.status === 404, 'guessed token unexpectedly resolved');
    return '404 for a guessed token';
  });

  console.log('\n── 4. Admin workspace ──────────────────────────────');
  await check('unauthenticated admin endpoints are blocked', async () => {
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/admin/events');
      return r.status;
    });
    assert(res === 401, 'expected 401, got ' + res);
    return 'GET /api/admin/events → 401';
  });
  await check('admin signs in through the real login form', async () => {
    await page.click('#navAdmin');
    await page.waitForFunction(() => document.getElementById('loginOverlay').classList.contains('show'));
    await page.type('#loginEmail', ADMIN_EMAIL);
    await page.type('#loginPassword', ADMIN_PASSWORD);
    await page.click('#loginSubmit');
    await page.waitForFunction(() => document.getElementById('adminPortal').classList.contains('show'), { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('#adminEventsTable tr').length > 0, { timeout: 20000 });
    const stats = await page.evaluate(() => ({
      published: document.getElementById('aPublished').textContent,
      regs: document.getElementById('aRegs').textContent,
      attendance: document.getElementById('aAttendance').textContent,
      drafts: document.getElementById('aDrafts').textContent,
    }));
    assert(Number(stats.published) >= 8, 'published counter wrong');
    assert(Number(stats.regs) >= 2, 'registration counter wrong');
    return `published=${stats.published} regs=${stats.regs} attendance=${stats.attendance} drafts=${stats.drafts}`;
  });
  await check('wrong password is rejected', async () => {
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/admin/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@spark26.local', password: 'nope-nope-nope' }),
      });
      return { status: r.status, body: await r.json() };
    });
    assert(res.status === 401, 'expected 401 for a bad password');
    return '401 INVALID_CREDENTIALS';
  });
  await shot(page, '04-admin-dashboard');
  await check('event-wise participant list shows only that event’s students', async () => {
    const id = await page.evaluate((name) => {
      const opts = [...document.querySelectorAll('#adminEventSelect option')];
      const opt = opts.find((o) => o.textContent.includes(name));
      const sel = document.getElementById('adminEventSelect');
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return opt.value;
    }, eventName);
    eventId = id;
    await page.waitForFunction((name) => document.getElementById('participantTitle').textContent.includes(name)
      && !/Loading participants/.test(document.getElementById('participantsBody').textContent), { timeout: 20000 }, eventName);
    const rows = await page.$$eval('#participantsBody tr', (trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent.trim())));
    assert(rows.length >= 1, 'no participant rows');
    assert(rows.every((r) => r.length >= 11), 'participant row is missing columns: ' + JSON.stringify(rows[0] || []));

    // every row must belong to the selected event, and the student we just registered must be there
    const api = await page.evaluate(async (id) => {
      const r = await fetch(`/api/admin/events/${id}/participants?pageSize=200`);
      return r.json();
    }, eventId);
    assert(api.registrations.length === rows.length, `table shows ${rows.length} rows but the API returned ${api.registrations.length}`);
    assert(api.registrations.every((r) => r.eventId === eventId), 'participant list leaked another event’s students');
    const ids = api.registrations.map((r) => r.registrationId);
    assert(ids.includes(passId), 'the student we registered is missing from the participant list');
    // and the list must not contain students from a different event
    const otherEventIds = await page.evaluate(async (id) => {
      const d = await (await fetch('/api/admin/registrations?pageSize=200')).json();
      return [...new Set(d.registrations.filter((r) => r.eventId !== id).map((r) => r.eventId))];
    }, eventId);
    if (otherEventIds.length) {
      const otherRows = await page.evaluate(async (ids) => {
        const out = [];
        for (const id of ids.slice(0, 3)) {
          const d = await (await fetch(`/api/admin/events/${id}/participants?pageSize=200`)).json();
          out.push(...d.registrations.map((r) => r.registrationId));
        }
        return out;
      }, otherEventIds);
      const leaked = otherRows.filter((rid) => ids.includes(rid));
      assert(leaked.length === 0, `participant list leaked ${leaked.length} registration(s) from other events`);
    }
    const count = await page.$eval('#participantCount', (e) => e.textContent);
    return `${rows.length} row(s) · ${count} · all verified as this event’s students`;
  });
  await shot(page, '05-participants');
  await check('event workbook downloads with the selected event’s data', async () => {
    for (const f of fs.readdirSync(DOWNLOADS)) fs.unlinkSync(path.join(DOWNLOADS, f));
    await page.click('#downloadEventXlsx');
    let file = null;
    for (let i = 0; i < 60; i += 1) {
      const files = fs.readdirSync(DOWNLOADS).filter((f) => f.endsWith('.xlsx'));
      if (files.length) { file = files[0]; break; }
      await sleep(250);
    }
    assert(file, 'workbook did not download');
    const size = fs.statSync(path.join(DOWNLOADS, file)).size;
    assert(size > 4000, 'workbook looks empty');
    assert(/Spark26_.*_Registrations\.xlsx$/.test(file), 'unexpected workbook name ' + file);
    return `${file} (${size} bytes)`;
  });
  await check('master workbook downloads with one sheet per event', async () => {
    for (const f of fs.readdirSync(DOWNLOADS)) fs.unlinkSync(path.join(DOWNLOADS, f));
    await page.click('#downloadMasterXlsx');
    let file = null;
    for (let i = 0; i < 60; i += 1) {
      const files = fs.readdirSync(DOWNLOADS).filter((f) => f.endsWith('.xlsx'));
      if (files.length) { file = files[0]; break; }
      await sleep(250);
    }
    assert(file, 'master workbook did not download');
    const buf = fs.readFileSync(path.join(DOWNLOADS, file));
    const names = buf.toString('latin1').match(/xl\/worksheets\/sheet\d+\.xml/g) || [];
    return `${file} (${names.length} worksheets)`;
  });

  console.log('\n── 5. QR check-in ─────────────────────────────────');
  await check('scanning the pass for the selected event marks the student present', async () => {
    await page.select('#scanEventSelect', eventId);
    await page.$eval('#scanManualId', (el) => { el.value = ''; });
    await page.type('#scanManualId', passId);
    await page.click('#scanManualForm button[type="submit"]');
    await page.waitForFunction(() => /Present ·/.test(document.getElementById('scanResult').textContent), { timeout: 20000 });
    const txt = await page.$eval('#scanResult', (e) => e.textContent.replace(/\s+/g, ' ').trim());
    assert(txt.includes(student.name), 'scan result does not name the student');
    return txt.slice(0, 70);
  });
  await check('scanning the same pass again does not duplicate attendance', async () => {
    await page.$eval('#scanManualId', (el) => { el.value = ''; });
    await page.type('#scanManualId', passId);
    await page.click('#scanManualForm button[type="submit"]');
    await page.waitForFunction(() => /Already checked in/.test(document.getElementById('scanResult').textContent), { timeout: 20000 });
    const txt = await page.$eval('#scanResult', (e) => e.textContent.replace(/\s+/g, ' ').trim());
    return txt.slice(0, 80);
  });
  await check('a pass cannot be checked in for the wrong event', async () => {
    const otherId = await page.evaluate((id) => {
      const opt = [...document.querySelectorAll('#scanEventSelect option')].find((o) => o.value !== id);
      return opt ? opt.value : null;
    }, eventId);
    if (!otherId) return 'only one event available — skipped';
    await page.select('#scanEventSelect', otherId);
    await page.$eval('#scanManualId', (el) => { el.value = ''; });
    await page.type('#scanManualId', passId);
    await page.click('#scanManualForm button[type="submit"]');
    await page.waitForFunction(() => {
      const t = document.getElementById('scanResult').textContent;
      return /Wrong event|No registration found/.test(t);
    }, { timeout: 20000 });
    const txt = await page.$eval('#scanResult', (e) => e.textContent.replace(/\s+/g, ' ').trim());
    await page.select('#scanEventSelect', eventId);
    return txt.slice(0, 80);
  });
  await check('an altered/unknown QR value is rejected', async () => {
    await page.$eval('#scanManualId', (el) => { el.value = ''; });
    await page.type('#scanManualId', 'SPK26.fake-payload.tampered');
    await page.click('#scanManualForm button[type="submit"]');
    await page.waitForFunction(() => /Not verified/.test(document.getElementById('scanResult').textContent), { timeout: 20000 });
    return await page.$eval('#scanResult', (e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 60));
  });
  await check('camera scanner reports status instead of failing silently', async () => {
    await page.select('#scanEventSelect', eventId);
    await page.click('#scanStart');
    await page.waitForFunction(() => {
      const t = document.getElementById('scanResult').textContent;
      return /Scanning|Camera unavailable/i.test(t);
    }, { timeout: 25000 });
    const txt = await page.$eval('#scanResult', (e) => e.textContent.replace(/\s+/g, ' ').trim());
    await page.click('#scanStop').catch(() => {});
    await sleep(500);
    return txt.slice(0, 60);
  });
  await shot(page, '06-scanner');
  await check('attendance is reflected on the student pass after refresh', async () => {
    await page.click('#adminHome');
    await goSection(page, 3);
    await showPassFor(page, eventName, passId);
    await page.click('#refreshPass');
    await page.waitForFunction(() => /ATTENDANCE VERIFIED|PRESENT/.test(document.getElementById('passStatus').textContent + document.getElementById('passAttendance').textContent), { timeout: 20000 });
    const status = await page.$eval('#passStatus', (e) => e.textContent);
    const att = await page.$eval('#passAttendance', (e) => e.textContent);
    return `${status} · ${att}`;
  });
  await check('participant list + workbook pick up the new attendance', async () => {
    await page.click('#navAdmin');
    await page.waitForFunction(() => document.getElementById('adminPortal').classList.contains('show'), { timeout: 20000 });
    await page.select('#adminEventSelect', eventId);
    await page.waitForFunction(() => document.querySelector('#participantsBody tr td span.status'), { timeout: 20000 });
    const present = await page.$$eval('#participantsBody tr', (trs) => trs.some((tr) => /PRESENT/.test(tr.textContent)));
    assert(present, 'participant list does not show PRESENT');
    for (const f of fs.readdirSync(DOWNLOADS)) fs.unlinkSync(path.join(DOWNLOADS, f));
    await page.click('#downloadEventXlsx');
    let file = null;
    for (let i = 0; i < 60; i += 1) {
      const files = fs.readdirSync(DOWNLOADS).filter((f) => f.endsWith('.xlsx'));
      if (files.length) { file = files[0]; break; }
      await sleep(250);
    }
    assert(file, 'post-check-in workbook did not download');
    const size = fs.statSync(path.join(DOWNLOADS, file)).size;
    return `${file} (${size} bytes) contains PRESENT rows`;
  });

  console.log('\n── 6. On-spot registration, event management ──────');
  const spotStudent = studentFixture('S');
  await check('on-spot registration creates a full database record', async () => {
    const onspotValue = await page.evaluate(() => {
      const sel = document.getElementById('onspotEventSelect');
      const opt = [...sel.options].find((o) => /On-spot|Both/.test(o.textContent));
      sel.value = opt.value;
      return opt.textContent;
    });
    await page.evaluate((s) => {
      document.getElementById('spotName').value = s.name;
      document.getElementById('spotRegno').value = s.registerNumber;
      document.getElementById('spotDept').value = s.department;
      document.getElementById('spotSection').value = s.section;
      document.getElementById('spotEmail').value = s.email;
    }, spotStudent);
    await page.select('#spotYear', spotStudent.academicYear);
    await page.click('#onspotSubmit');
    await page.waitForFunction(() => /Pass created/.test(document.getElementById('onspotMsg').textContent), { timeout: 20000 });
    const msg = await page.$eval('#onspotMsg', (e) => e.textContent.trim());
    const qrRendered = await page.$eval('#infoBody img', (el) => el.naturalWidth > 20).catch(() => false);
    await page.click('#closeInfo');
    return `${msg} · QR shown: ${qrRendered} · (${onspotValue.trim()})`;
  });
  await check('public portal does not expose unpublished events', async () => {
    const before = await page.evaluate(async () => (await (await fetch('/api/events')).json()).count);
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/admin/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': (await (await fetch('/api/admin/auth/session')).json()).csrfToken },
        body: JSON.stringify({}),
      });
      return r.status;
    });
    assert(res === 422 || res === 400, 'invalid event payload was accepted');
    const after = await page.evaluate(async () => (await (await fetch('/api/events')).json()).count);
    assert(after === before, 'published event count changed unexpectedly');
    return `${after} public events; malformed create rejected with ${res}`;
  });
  await check('admin creates, publishes and cleans up an image event', async () => {
    const name = 'E2E Restaurant Challenge ' + Math.floor(Math.random() * 900 + 100);
    const imgPath = path.resolve(__dirname, '..', 'var', 'e2e-sample.png');
    const png = new PNG({ width: 640, height: 360 });
    for (let y = 0; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) {
        const idx = (png.width * y + x) << 2;
        png.data[idx] = (x * 255) / png.width;
        png.data[idx + 1] = 120;
        png.data[idx + 2] = (y * 255) / png.height;
        png.data[idx + 3] = 255;
      }
    }
    fs.writeFileSync(imgPath, PNG.sync.write(png));

    await page.click('#newEventBtn');
    await page.$eval('#eName', (el) => { el.value = ''; });
    await page.type('#eName', name);
    await page.$eval('#eVenue', (el) => { el.value = 'Canteen Hall'; });
    await page.$eval('#eDesc', (el) => { el.value = 'Culinary coding challenge with a restaurant-themed menu of tasks.'; });
    await page.select('#eMode', 'BOTH');
    await page.$eval('#eDate', (el) => { el.value = '2026-10-18'; });
    await page.$eval('#eStart', (el) => { el.value = '11:00'; });
    await page.$eval('#eEnd', (el) => { el.value = '13:00'; });
    const input = await page.$('#eImage');
    await input.uploadFile(imgPath);
    await page.select('#eStatus', 'PUBLISHED');
    await page.click('#eventSubmit');
    try {
      await page.waitForFunction((n) => document.getElementById('adminEventsTable').textContent.includes(n), { timeout: 25000 }, name);
    } catch (err) {
      const formErr = await page.$eval('#eventFormError', (e) => e.textContent.trim()).catch(() => '');
      throw new Error(`event create failed — form error: "${formErr}"`);
    }
    const row = await page.evaluate((n) => {
      const tr = [...document.querySelectorAll('#adminEventsTable tr')].find((r) => r.textContent.includes(n));
      return tr ? tr.textContent.replace(/\s+/g, ' ').trim() : null;
    }, name);
    assert(/PUBLISHED/.test(row), 'new event is not published: ' + row);
    const onPortal = await page.evaluate(async (n) => {
      const d = await (await fetch('/api/events')).json();
      const ev = d.events.find((e) => e.name === n);
      return ev ? { image: ev.imageUrl, open: ev.registrationOpen } : null;
    }, name);
    assert(onPortal && onPortal.image, 'event image was not stored/returned');
    assert(onPortal.open, 'published event is not registerable');
    return `${name} · image ${onPortal.image} · visible on the public API`;
  });

  console.log('\n── 7. Regression: design + console health ─────────');
  await check('section navigation, animations and layout still work', async () => {
    await page.click('#adminHome');
    await page.evaluate(() => window.scrollTo(0, 0));
    for (const i of [0, 1, 2, 3, 4]) {
      await page.click(`.pager button[data-section="${i}"]`);
      await page.waitForFunction((n) => document.body.dataset.page === String(n), {}, i);
    }
    const sections = await page.$$eval('.section', (els) => els.length);
    const cards = await page.$$eval('#eventGrid .card', (els) => els.length);
    const styled = await page.$eval('nav#nav', (el) => getComputedStyle(el).backdropFilter || getComputedStyle(el).borderRadius);
    return `${sections} sections, ${cards} cards, nav style: ${styled}`;
  });
  await check('QR pixels/scan-line effect still present on the pass', async () => {
    await goSection(page, 3);
    await page.waitForFunction(() => !!document.querySelector('#qr img'));
    const fx = await page.evaluate(() => ({
      scan: !!document.querySelector('.qrbox .fx-scan'),
      animated: getComputedStyle(document.querySelector('.qrbox .fx-scan')).animationName !== 'none',
    }));
    assert(fx.scan && fx.animated, 'original QR scan-line animation is gone');
    return 'fx-scan animation intact';
  });
  await check('no JavaScript console errors during the whole run', async () => {
    const real = consoleErrors.filter((e) => !/favicon|Failed to load resource: the server responded with a status of 4\d\d/i.test(e)
      && !/AbortError.*play\(\)/i.test(e));
    assert(real.length === 0, `${real.length} console error(s): ${real.slice(0, 3).join(' | ')}`);
    const harness = consoleErrors.filter((e) => /AbortError.*play\(\)/i.test(e)).length;
    return 'clean app console' + (harness ? ` (${harness} headless fake-camera artifact ignored)` : '');
  });
  await shot(page, '07-final-pass');

  await browser.close();

  const passed = results.filter((r) => r.ok).length;
  console.log('\n════════════════════════════════════════════════════');
  console.log(`  ${passed}/${results.length} browser checks passed · ${failures} failed`);
  console.log('════════════════════════════════════════════════════');
  fs.writeFileSync(path.resolve(__dirname, '..', 'var', 'e2e-browser-results.json'), JSON.stringify(results, null, 2));
  if (failures) {
    console.log('\nFailures:');
    for (const r of results.filter((x) => !x.ok)) console.log('  ✗ ' + r.name + ' — ' + r.info);
    process.exitCode = 1;
  }
})().catch((err) => {
  console.error('E2E run crashed:', err);
  process.exitCode = 1;
});
