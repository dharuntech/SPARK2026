const puppeteer = require('puppeteer');

(async () => {
  console.log('Launching browser to test swipe navigation & exit prevention...');
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto('http://localhost:3000/#s0', { waitUntil: 'networkidle0' });

  console.log('Page loaded on mobile viewport.');

  const initialSec = await page.evaluate(() => document.body.dataset.page || '0');
  console.log('Initial section:', initialSec);

  // 1. Test touch swipe left (dx = -90, should transition to section 1)
  await page.evaluate(() => {
    const t0 = new Touch({ identifier: 1, target: document.body, clientX: 300, clientY: 400 });
    window.dispatchEvent(new TouchEvent('touchstart', { touches: [t0], changedTouches: [t0], bubbles: true, cancelable: true }));

    const t1 = new Touch({ identifier: 1, target: document.body, clientX: 230, clientY: 402 });
    const moveEv = new TouchEvent('touchmove', { touches: [t1], changedTouches: [t1], bubbles: true, cancelable: true });
    window.dispatchEvent(moveEv);

    const t2 = new Touch({ identifier: 1, target: document.body, clientX: 180, clientY: 400 });
    window.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t2], bubbles: true, cancelable: true }));
  });

  await new Promise(r => setTimeout(r, 600));

  const afterSwipeLeftSec = await page.evaluate(() => document.body.dataset.page);
  console.log('Section after touch swipe left (should be 1):', afterSwipeLeftSec);

  // 2. Test touch swipe right (dx = +120, should return to section 0)
  await page.evaluate(() => {
    const t0 = new Touch({ identifier: 2, target: document.body, clientX: 100, clientY: 400 });
    window.dispatchEvent(new TouchEvent('touchstart', { touches: [t0], changedTouches: [t0], bubbles: true, cancelable: true }));

    const t1 = new Touch({ identifier: 2, target: document.body, clientX: 170, clientY: 402 });
    window.dispatchEvent(new TouchEvent('touchmove', { touches: [t1], changedTouches: [t1], bubbles: true, cancelable: true }));

    const t2 = new Touch({ identifier: 2, target: document.body, clientX: 240, clientY: 400 });
    window.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t2], bubbles: true, cancelable: true }));
  });

  await new Promise(r => setTimeout(r, 600));

  const afterSwipeRightSec = await page.evaluate(() => document.body.dataset.page);
  console.log('Section after touch swipe right (should be 0):', afterSwipeRightSec);

  // 3. Test Desktop Trackpad Wheel swipe (deltaX = 45 -> next section 1)
  await page.setViewport({ width: 1280, height: 800, isMobile: false, hasTouch: false });
  const wheelResult = await page.evaluate(() => {
    const wheelEv = new WheelEvent('wheel', {
      deltaX: 45,
      deltaY: 0,
      bubbles: true,
      cancelable: true
    });
    window.dispatchEvent(wheelEv);
    return { prevented: wheelEv.defaultPrevented };
  });

  await new Promise(r => setTimeout(r, 600));
  const afterWheelSec = await page.evaluate(() => document.body.dataset.page);
  console.log('Wheel defaultPrevented (stops browser exit):', wheelResult.prevented);
  console.log('Section after trackpad horizontal wheel (should be 1):', afterWheelSec);

  // 4. Test Trackpad Wheel swipe back (deltaX = -45 -> section 0)
  const wheelBackResult = await page.evaluate(() => {
    const wheelEv = new WheelEvent('wheel', {
      deltaX: -45,
      deltaY: 0,
      bubbles: true,
      cancelable: true
    });
    window.dispatchEvent(wheelEv);
    return { prevented: wheelEv.defaultPrevented };
  });

  await new Promise(r => setTimeout(r, 600));
  const afterWheelBackSec = await page.evaluate(() => document.body.dataset.page);
  console.log('Wheel back defaultPrevented:', wheelBackResult.prevented);
  console.log('Section after trackpad horizontal wheel back (should be 0):', afterWheelBackSec);

  const jsErrors = consoleErrors.filter(e => !e.includes('status of 401') && !e.includes('status of 404'));
  console.log('Uncaught JavaScript errors:', jsErrors.length ? jsErrors : 'None');
  await browser.close();

  if (afterSwipeLeftSec === '1' && afterSwipeRightSec === '0' && afterWheelSec === '1' && afterWheelBackSec === '0' && jsErrors.length === 0) {
    console.log('🎉 ALL SWIPE AND GESTURE TESTS PASSED WITH 100% SUCCESS!');
  } else {
    console.error('Test results incomplete or unexpected.');
    process.exit(1);
  }
})();
