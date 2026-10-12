const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

async function testGallery() {
  console.log('Launching browser to test CircularGallery integration...');
  const chromeExe = process.env.PUPPETEER_EXECUTABLE_PATH ||
    [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ].find(p => fs.existsSync(p));

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: chromeExe,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  
  // Listen for console logs & errors
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('BROWSER ERROR:', msg.text());
  });
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  page.on('response', res => {
    if (res.status() >= 400) console.log('HTTP ERROR:', res.status(), res.url());
  });

  // 1. Test Desktop (1440x900)
  console.log('Testing Desktop 1440x900...');
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });

  // Navigate to Events page (section 1)
  await page.evaluate(() => {
    if (window.sparkGo) window.sparkGo(1);
    else document.querySelector('[data-section="1"]').click();
  });

  await new Promise(r => setTimeout(r, 2000));

  // Check if Circular Gallery canvas exists
  const galleryState = await page.evaluate(() => {
    const stage = document.getElementById('galleryStage');
    const root = document.getElementById('circularGalleryRoot');
    const canvas = root ? root.querySelector('canvas') : null;
    const labels = root ? root.querySelectorAll('.circular-gallery-label') : [];
    const stageBox = stage ? stage.getBoundingClientRect() : null;
    return {
      stageFound: !!stage,
      rootFound: !!root,
      canvasFound: !!canvas,
      canvasWidth: canvas ? canvas.width : 0,
      canvasHeight: canvas ? canvas.height : 0,
      labelsCount: labels.length,
      stageHeight: stageBox ? stageBox.height : 0,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    };
  });

  console.log('Desktop Gallery State:', galleryState);

  // Take screenshot of Events page on Desktop
  const desktopPic = path.join(__dirname, 'desktop_events_gallery.png');
  await page.screenshot({ path: desktopPic });
  console.log('Desktop screenshot saved:', desktopPic);

  // Test click on a card to verify event details dialog opens
  console.log('Testing click on gallery item...');
  const clickResult = await page.evaluate(() => {
    const root = document.getElementById('circularGalleryRoot');
    const gallery = root ? root.querySelector('.circular-gallery') : null;
    if (!gallery) return { success: false, reason: 'no gallery' };
    
    // Simulate click in center of gallery
    const rect = gallery.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    
    const down = new PointerEvent('pointerdown', { clientX: cx, clientY: cy, button: 0, bubbles: true });
    gallery.dispatchEvent(down);
    const up = new PointerEvent('pointerup', { clientX: cx, clientY: cy, button: 0, bubbles: true });
    gallery.dispatchEvent(up);

    return { success: true, cx, cy };
  });

  await new Promise(r => setTimeout(r, 1000));

  const modalOpen = await page.evaluate(() => {
    const overlay = document.getElementById('infoOverlay');
    const title = document.getElementById('infoTitle');
    const hasRegisterBtn = !!document.getElementById('detailRegister');
    return {
      isOpen: overlay && overlay.classList.contains('show'),
      titleText: title ? title.textContent : '',
      hasRegisterBtn
    };
  });

  console.log('Event modal after gallery card click:', modalOpen);

  // Close modal if open
  await page.evaluate(() => {
    const closeBtn = document.getElementById('closeInfo');
    if (closeBtn) closeBtn.click();
  });
  await new Promise(r => setTimeout(r, 500));

  // 2. Test Mobile Viewports (360x740, 390x844, 430x932, 768x1024)
  const mobileWidths = [360, 390, 430, 768];
  for (const w of mobileWidths) {
    console.log(`Testing viewport ${w}px...`);
    await page.setViewport({ width: w, height: 800, isMobile: true, hasTouch: true });
    await page.evaluate(() => {
      if (window.sparkGo) window.sparkGo(1);
    });
    await new Promise(r => setTimeout(r, 1200));

    const check = await page.evaluate(() => {
      const scrollW = document.documentElement.scrollWidth;
      const clientW = document.documentElement.clientWidth;
      const root = document.getElementById('circularGalleryRoot');
      const rootBox = root ? root.getBoundingClientRect() : null;
      return {
        scrollWidth: scrollW,
        clientWidth: clientW,
        noHorizontalOverflow: scrollW <= clientW,
        galleryHeight: rootBox ? rootBox.height : 0
      };
    });

    console.log(`Viewport ${w}px result:`, check);
    if (!check.noHorizontalOverflow) {
      console.error(`HORIZONTAL OVERFLOW DETECTED at ${w}px! scrollWidth=${check.scrollWidth}, clientWidth=${check.clientWidth}`);
    }

    // TEST: Dragging inside galleryStage must NOT exit the page!
    const dragGalleryResult = await page.evaluate(async () => {
      const stage = document.getElementById('galleryStage');
      if (!stage) return { success: false, reason: 'no stage' };
      const rect = stage.getBoundingClientRect();
      const startX = rect.left + rect.width * 0.7;
      const endX = rect.left + rect.width * 0.2;
      const centerY = rect.top + rect.height * 0.5;

      // Dispatch pointerdown, move, pointerup
      const down = new PointerEvent('pointerdown', { clientX: startX, clientY: centerY, pointerType: 'touch', bubbles: true });
      stage.dispatchEvent(down);
      await new Promise(r => setTimeout(r, 100));
      const up = new PointerEvent('pointerup', { clientX: endX, clientY: centerY, pointerType: 'touch', bubbles: true });
      stage.dispatchEvent(up);

      return {
        sectionAfterDrag: document.body.dataset.page
      };
    });

    console.log(`Swipe test inside gallery on ${w}px:`, dragGalleryResult);
    if (dragGalleryResult.sectionAfterDrag !== '1') {
      throw new Error(`FAILURE: Dragging gallery changed section to ${dragGalleryResult.sectionAfterDrag}! Expected 1.`);
    }
  }

  // Mobile screenshot at 390px
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await new Promise(r => setTimeout(r, 1000));
  const mobilePic = path.join(__dirname, 'mobile_events_gallery.png');
  await page.screenshot({ path: mobilePic });
  console.log('Mobile screenshot saved:', mobilePic);

  await browser.close();
  console.log('All gallery browser tests completed successfully!');
}

testGallery().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
