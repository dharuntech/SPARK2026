const puppeteer = require('puppeteer');
const http = require('http');
const path = require('path');

(async () => {
  console.log('── Starting Spark26 Scroll & Event Registration Verification ──\n');

  // 1. Start the server if not already running
  const { createApp } = require('../src/app');
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(3002, '127.0.0.1', () => {
      console.log('✓ Test server started on http://127.0.0.1:3002');
      resolve();
    });
    server.on('error', reject);
  });

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,900']
  });

  try {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => consoleErrors.push(err.message));

    // ─────────────────────────────────────────────────────────────
    // TEST 1: DESKTOP VIEWPORT SCROLL SEQUENCE
    // ─────────────────────────────────────────────────────────────
    console.log('\n[Scenario 1 & 2] Loading homepage directly and scrolling down through sections...');
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto('http://127.0.0.1:3002/#s0', { waitUntil: 'networkidle0' });

    let curPage = await page.evaluate(() => document.body.dataset.page);
    console.log('  Initial page:', curPage, '(Expected: 0)');
    if (curPage !== '0') throw new Error(`Expected initial page 0, got ${curPage}`);

    // Helper to dispatch wheel event
    async function scrollWheel(deltaY, deltaX = 0) {
      await page.evaluate((dy, dx) => {
        window.dispatchEvent(new WheelEvent('wheel', {
          deltaX: dx,
          deltaY: dy,
          bubbles: true,
          cancelable: true
        }));
      }, deltaY, deltaX);
      await new Promise(r => setTimeout(r, 700));
    }

    // Scroll down from Home (0) -> should go to Events (1)
    console.log('  Scrolling down from Home...');
    await page.evaluate(() => window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight - window.innerHeight)));
    await new Promise(r => setTimeout(r, 200));
    await scrollWheel(60);
    curPage = await page.evaluate(() => document.body.dataset.page);
    console.log('  Page after scroll down:', curPage, '(Expected: 1)');
    if (curPage !== '1') throw new Error(`Expected page 1 (Events), got ${curPage}`);

    // Scroll down from Events (1) -> MUST go to My Pass (3), SKIPPING Section 2!
    console.log('  Scrolling down from Events...');
    const s1Metrics = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      scrollY: window.scrollY,
      s1ScrollHeight: document.getElementById('s1') ? document.getElementById('s1').scrollHeight : null,
      s1ClientHeight: document.getElementById('s1') ? document.getElementById('s1').clientHeight : null,
    }));
    console.log('  s1 metrics before scroll down:', s1Metrics);
    await page.evaluate(() => window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight - window.innerHeight)));
    await new Promise(r => setTimeout(r, 200));
    await scrollWheel(60);
    curPage = await page.evaluate(() => document.body.dataset.page);
    console.log('  Page after scroll down:', curPage, '(Expected: 3 - My Pass)');
    if (curPage !== '3') throw new Error(`CRITICAL: Expected page 3 (My Pass), but got ${curPage} (IPL Auction registration page appeared!)`);
    console.log('  ✓ SUCCESS: Section 2 (Registration) was skipped! Landed on Section 3 (My Pass)');

    // Scroll down from My Pass (3) -> should go to Contacts (4)
    console.log('  Scrolling down from My Pass...');
    await scrollWheel(60);
    curPage = await page.evaluate(() => document.body.dataset.page);
    console.log('  Page after scroll down:', curPage, '(Expected: 4 - Contacts)');
    if (curPage !== '4') throw new Error(`Expected page 4 (Contacts), got ${curPage}`);

    // Scroll down to the bottom of Contacts (4) and scroll down -> should go to About (5)
    console.log('  Scrolling to bottom of Contacts and scrolling down...');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await new Promise(r => setTimeout(r, 200));
    await scrollWheel(60);
    curPage = await page.evaluate(() => document.body.dataset.page);
    console.log('  Page after scroll down:', curPage, '(Expected: 5 - About SPARK)');
    if (curPage !== '5') throw new Error(`Expected page 5 (About), got ${curPage}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 2: REVERSE SCROLLING (Back up)
    // ─────────────────────────────────────────────────────────────
    console.log('\n[Scenario 3] Scrolling back up in reverse...');
    // Scroll up from About (5) -> Contacts (4)
    await page.evaluate(() => window.scrollTo(0, 0));
    await scrollWheel(-60);
    curPage = await page.evaluate(() => document.body.dataset.page);
    console.log('  Page after scroll up from About:', curPage, '(Expected: 4)');
    if (curPage !== '4') throw new Error(`Expected page 4, got ${curPage}`);

    // Scroll up from Contacts (4) -> My Pass (3)
    await page.evaluate(() => window.scrollTo(0, 0));
    await scrollWheel(-60);
    curPage = await page.evaluate(() => document.body.dataset.page);
    console.log('  Page after scroll up from Contacts:', curPage, '(Expected: 3)');
    if (curPage !== '3') throw new Error(`Expected page 3, got ${curPage}`);

    // Scroll up from My Pass (3) -> Events (1), MUST SKIP Section 2!
    console.log('  Scrolling up from My Pass...');
    await scrollWheel(-60);
    curPage = await page.evaluate(() => document.body.dataset.page);
    console.log('  Page after scroll up from My Pass:', curPage, '(Expected: 1 - Events)');
    if (curPage !== '1') throw new Error(`CRITICAL: Expected page 1 (Events), but got ${curPage} (IPL Auction registration page appeared in reverse!)`);
    console.log('  ✓ SUCCESS: Section 2 was skipped in reverse! Landed directly on Events (1)');

    // Scroll up from Events (1) -> Home (0)
    await scrollWheel(-60);
    curPage = await page.evaluate(() => document.body.dataset.page);
    console.log('  Page after scroll up from Events:', curPage, '(Expected: 0 - Home)');
    if (curPage !== '0') throw new Error(`Expected page 0, got ${curPage}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 3: KEYBOARD NAVIGATION (ArrowDown / ArrowUp)
    // ─────────────────────────────────────────────────────────────
    console.log('\n[Scenario 8A] Testing Keyboard Navigation (Arrow keys)...');
    await page.keyboard.press('ArrowDown');
    await new Promise(r => setTimeout(r, 600));
    curPage = await page.evaluate(() => document.body.dataset.page);
    console.log('  ArrowDown from 0 ->', curPage, '(Expected: 1)');
    if (curPage !== '1') throw new Error(`Expected 1, got ${curPage}`);

    await page.keyboard.press('ArrowDown');
    await new Promise(r => setTimeout(r, 600));
    curPage = await page.evaluate(() => document.body.dataset.page);
    console.log('  ArrowDown from 1 ->', curPage, '(Expected: 3)');
    if (curPage !== '3') throw new Error(`Expected 3, got ${curPage}`);

    await page.keyboard.press('ArrowUp');
    await new Promise(r => setTimeout(r, 600));
    curPage = await page.evaluate(() => document.body.dataset.page);
    console.log('  ArrowUp from 3 ->', curPage, '(Expected: 1)');
    if (curPage !== '1') throw new Error(`Expected 1, got ${curPage}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 4: PAGER DOTS
    // ─────────────────────────────────────────────────────────────
    console.log('\n[Scenario 4] Checking pager buttons in DOM...');
    const pagerSections = await page.$$eval('.pager button', btns => btns.map(b => b.dataset.section));
    console.log('  Pager sections:', pagerSections);
    if (pagerSections.includes('2')) {
      throw new Error('CRITICAL: Section 2 is still in the pager!');
    }
    console.log('  ✓ SUCCESS: Section 2 is excluded from pager buttons');

    // ─────────────────────────────────────────────────────────────
    // TEST 5: EVENT-SPECIFIC REGISTRATION (IPL Auction)
    // ─────────────────────────────────────────────────────────────
    console.log('\n[Scenario 5] Testing Register for IPL Auction...');
    // Fetch published events from API
    const eventsData = await page.evaluate(async () => {
      const res = await fetch('/api/events');
      return await res.json();
    });
    const iplEvent = eventsData.events.find(e => (e.name || '').toLowerCase().includes('ipl'));
    if (!iplEvent) throw new Error('Could not find IPL Auction event');
    console.log('  Found IPL Event:', iplEvent.name, `(${iplEvent.id})`);

    // Click Register on IPL Event using window.sparkSelectEvent and go(2) or clicking card
    await page.evaluate((ev) => {
      window.sparkSelectEvent(ev);
      window.sparkGo(2);
    }, iplEvent);
    await new Promise(r => setTimeout(r, 600));

    curPage = await page.evaluate(() => document.body.dataset.page);
    console.log('  Page after clicking Register for IPL:', curPage, '(Expected: 2)');
    if (curPage !== '2') throw new Error(`Expected page 2, got ${curPage}`);

    const selectedTitleIPL = await page.$eval('#selectedTitle', el => el.textContent.trim());
    console.log('  Registration page title:', selectedTitleIPL);
    if (!selectedTitleIPL.toLowerCase().includes('ipl')) {
      throw new Error(`Expected IPL title, got: ${selectedTitleIPL}`);
    }
    console.log('  ✓ SUCCESS: IPL Auction registration page opened with correct title and details');

    // Click "Browse all events" button to return to Events
    await page.click('#backToEventsBtn');
    await new Promise(r => setTimeout(r, 600));
    curPage = await page.evaluate(() => document.body.dataset.page);
    console.log('  Page after clicking Browse all events:', curPage, '(Expected: 1)');
    if (curPage !== '1') throw new Error(`Expected page 1 after back button, got ${curPage}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 6: EVENT-SPECIFIC REGISTRATION (Other events)
    // ─────────────────────────────────────────────────────────────
    console.log('\n[Scenario 6] Testing Register for at least 2 other distinct events...');
    const otherEvents = eventsData.events.filter(e => !(e.name || '').toLowerCase().includes('ipl') && e.registrationOpen);
    if (otherEvents.length < 2) throw new Error(`Need at least 2 other open events, found: ${otherEvents.length}`);

    for (let i = 0; i < 2; i++) {
      const testEv = otherEvents[i];
      console.log(`  Testing Event ${i + 1}: ${testEv.name} (${testEv.id})`);
      await page.evaluate((ev) => {
        window.sparkSelectEvent(ev);
        window.sparkGo(2);
      }, testEv);
      await new Promise(r => setTimeout(r, 600));

      const title = await page.$eval('#selectedTitle', el => el.textContent.trim());
      console.log(`    Selected title on registration form: "${title}"`);
      if (title.toLowerCase() !== testEv.name.toLowerCase()) {
        throw new Error(`Expected "${testEv.name}", got "${title}"! (Did IPL Auction appear instead?)`);
      }
      console.log(`    ✓ Verified: opened correct registration page for ${testEv.name}`);

      await page.click('#backToEventsBtn');
      await new Promise(r => setTimeout(r, 600));
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 7: SUBMISSION RETAINS CORRECT EVENT ID
    // ─────────────────────────────────────────────────────────────
    console.log('\n[Scenario 7] Testing registration submission retains selected event ID...');
    const targetEvent = otherEvents[0];
    console.log(`  Registering student for: ${targetEvent.name} (${targetEvent.id})`);
    await page.evaluate((ev) => {
      window.sparkSelectEvent(ev);
      window.sparkGo(2);
    }, targetEvent);
    await new Promise(r => setTimeout(r, 600));

    const rnd = Math.floor(Math.random() * 90000 + 10000);
    const regNo = '9100261' + rnd;
    const email = `testuser${rnd}@spark26.edu`;

    await page.$eval('#rName', el => el.value = 'Scroll Test Student');
    await page.$eval('#rDept', el => el.value = 'CSE');
    await page.select('#rYear', 'III');
    await page.$eval('#rSection', el => el.value = 'B');
    await page.$eval('#rRegno', (el, v) => el.value = v, regNo);
    await page.$eval('#rEmail', (el, v) => el.value = v, email);
    await page.$eval('#rPhone', el => el.value = '9876543210');

    await page.click('#regSubmit');
    await page.waitForFunction(() => document.body.dataset.page === '3', { timeout: 15000 });
    console.log('  ✓ Submitted! Automatically transitioned to My Pass (page 3)');

    const passEventTitle = await page.$eval('#passEvent', el => el.textContent.trim());
    console.log(`  My Pass Event Title: "${passEventTitle}" (Expected: "${targetEvent.name}")`);
    if (passEventTitle.toLowerCase() !== targetEvent.name.toLowerCase()) {
      throw new Error(`Pass event title mismatch: Expected "${targetEvent.name}", got "${passEventTitle}"`);
    }

    const passId = await page.$eval('#passId', el => el.textContent.trim());
    console.log(`  Generated Registration ID: "${passId}"`);
    if (!passId.startsWith('SP26-') || passId === '—') {
      throw new Error(`Invalid pass ID generated: ${passId}`);
    }
    console.log('  ✓ SUCCESS: Registration submission retained selected event ID and created pass!');

    // ─────────────────────────────────────────────────────────────
    // TEST 8: MOBILE VIEWPORT & TOUCH SCROLLING
    // ─────────────────────────────────────────────────────────────
    console.log('\n[Scenario 9 & 8B] Testing Mobile Viewport and Touch Gestures...');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.evaluate(() => window.sparkGo(0));
    await new Promise(r => setTimeout(r, 600));

    // Touch swipe left on mobile (from 0 -> 1)
    await page.evaluate(() => {
      const t0 = new Touch({ identifier: 1, target: document.body, clientX: 300, clientY: 400 });
      window.dispatchEvent(new TouchEvent('touchstart', { touches: [t0], changedTouches: [t0], bubbles: true, cancelable: true }));
      const t1 = new Touch({ identifier: 1, target: document.body, clientX: 200, clientY: 400 });
      window.dispatchEvent(new TouchEvent('touchmove', { touches: [t1], changedTouches: [t1], bubbles: true, cancelable: true }));
      const t2 = new Touch({ identifier: 1, target: document.body, clientX: 150, clientY: 400 });
      window.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t2], bubbles: true, cancelable: true }));
    });
    await new Promise(r => setTimeout(r, 600));
    curPage = await page.evaluate(() => document.body.dataset.page);
    console.log('  Mobile swipe left from 0 ->', curPage, '(Expected: 1)');
    if (curPage !== '1') throw new Error(`Expected mobile page 1, got ${curPage}`);

    // Touch swipe left on mobile (from 1 -> MUST GO TO 3, NOT 2)
    await page.evaluate(() => {
      const t0 = new Touch({ identifier: 2, target: document.body, clientX: 300, clientY: 400 });
      window.dispatchEvent(new TouchEvent('touchstart', { touches: [t0], changedTouches: [t0], bubbles: true, cancelable: true }));
      const t1 = new Touch({ identifier: 2, target: document.body, clientX: 200, clientY: 400 });
      window.dispatchEvent(new TouchEvent('touchmove', { touches: [t1], changedTouches: [t1], bubbles: true, cancelable: true }));
      const t2 = new Touch({ identifier: 2, target: document.body, clientX: 150, clientY: 400 });
      window.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t2], bubbles: true, cancelable: true }));
    });
    await new Promise(r => setTimeout(r, 600));
    curPage = await page.evaluate(() => document.body.dataset.page);
    console.log('  Mobile swipe left from 1 ->', curPage, '(Expected: 3 - My Pass)');
    if (curPage !== '3') throw new Error(`CRITICAL: Mobile swipe left landed on ${curPage} instead of 3!`);
    console.log('  ✓ SUCCESS: Mobile swipe skipped registration section directly to My Pass!');

    // Touch swipe right on mobile (from 3 -> MUST GO TO 1, NOT 2)
    await page.evaluate(() => {
      const t0 = new Touch({ identifier: 3, target: document.body, clientX: 100, clientY: 400 });
      window.dispatchEvent(new TouchEvent('touchstart', { touches: [t0], changedTouches: [t0], bubbles: true, cancelable: true }));
      const t1 = new Touch({ identifier: 3, target: document.body, clientX: 200, clientY: 400 });
      window.dispatchEvent(new TouchEvent('touchmove', { touches: [t1], changedTouches: [t1], bubbles: true, cancelable: true }));
      const t2 = new Touch({ identifier: 3, target: document.body, clientX: 250, clientY: 400 });
      window.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t2], bubbles: true, cancelable: true }));
    });
    await new Promise(r => setTimeout(r, 600));
    curPage = await page.evaluate(() => document.body.dataset.page);
    console.log('  Mobile swipe right from 3 ->', curPage, '(Expected: 1 - Events)');
    if (curPage !== '1') throw new Error(`CRITICAL: Mobile swipe right landed on ${curPage} instead of 1!`);
    console.log('  ✓ SUCCESS: Mobile swipe back skipped registration section directly to Events!');

    // ─────────────────────────────────────────────────────────────
    // TEST 9: CONSOLE ERRORS CHECK
    // ─────────────────────────────────────────────────────────────
    console.log('\n[Scenario 10] Checking console error logs...');
    const relevantErrors = consoleErrors.filter(e => !/favicon|Failed to load resource: the server responded with a status of 4\d\d/i.test(e));
    console.log('  Relevant JS console errors:', relevantErrors.length === 0 ? 'None (Clean!)' : relevantErrors);
    if (relevantErrors.length > 0) throw new Error(`Console errors found: ${relevantErrors.join(', ')}`);

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('🎉 ALL 10 USER SCENARIOS VERIFIED AND PASSED 100%!');
    console.log('═══════════════════════════════════════════════════════\n');

  } finally {
    await browser.close();
    server.close();
  }
})().catch(err => {
  console.error('\n❌ Test Failure:', err);
  process.exit(1);
});
