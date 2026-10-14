const puppeteer = require('puppeteer');
const fs = require('fs');

async function testCarouselFiniteDrag() {
  console.log('Testing Carousel Finite Boundaries and Bi-directional Dragging...');
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
  await page.setViewport({ width: 1440, height: 900 });

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
  await page.evaluate(() => {
    if (window.sparkGo) window.sparkGo(1);
    else {
      const btn = document.querySelector('a[href="#events"], [data-section="1"]');
      if (btn) btn.click();
    }
  });
  await new Promise(r => setTimeout(r, 1200));

  // Verify gallery root exists
  const exists = await page.$('#circularGalleryRoot canvas');
  if (!exists) {
    throw new Error('Canvas not found inside #circularGalleryRoot');
  }

  // Check initial state via evaluation
  const initialState = await page.evaluate(() => {
    const listButtons = Array.from(document.querySelectorAll('#circularGalleryRoot [data-gallery-list] button'));
    const names = listButtons.map(b => b.textContent.trim());
    const activeBtn = listButtons.find(b => b.hasAttribute('aria-current'));
    return {
      names,
      activeName: activeBtn ? activeBtn.textContent.trim() : null
    };
  });
  console.log('Initial Events List:', initialState);

  if (!initialState.names[0].toLowerCase().includes('ipl')) {
    throw new Error(`Expected first event to be IPL Auction, got: ${initialState.names[0]}`);
  }

  const canvasBox = await page.evaluate(() => {
    const cv = document.querySelector('#circularGalleryRoot canvas');
    const rect = cv.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
  });

  // Test 1: Drag forward multiple times towards Event 6
  console.log('Testing Forward Dragging towards Event 6...');
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(canvasBox.x + 200, canvasBox.y);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x - 300, canvasBox.y, { steps: 10 });
    await page.mouse.up();
    await new Promise(r => setTimeout(r, 200));
  }
  await new Promise(r => setTimeout(r, 600));

  const endState = await page.evaluate(() => {
    const listButtons = Array.from(document.querySelectorAll('#circularGalleryRoot [data-gallery-list] button'));
    const activeIndex = listButtons.findIndex(b => b.hasAttribute('aria-current'));
    return {
      total: listButtons.length,
      activeIndex,
      activeName: activeIndex >= 0 ? listButtons[activeIndex].textContent.trim() : null
    };
  });
  console.log('End of forward drag state:', endState);

  // Active index must be capped at total - 1 (Event 6, index 5)
  if (endState.activeIndex !== endState.total - 1) {
    throw new Error(`Expected activeIndex to be capped at ${endState.total - 1}, but got ${endState.activeIndex}`);
  }

  // Further forward drag should not advance beyond event 6
  console.log('Testing that forward drag past event 6 DOES NOT loop or reveal extra items...');
  await page.mouse.move(canvasBox.x + 200, canvasBox.y);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x - 400, canvasBox.y, { steps: 10 });
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 500));

  const clampedEndState = await page.evaluate(() => {
    const listButtons = Array.from(document.querySelectorAll('#circularGalleryRoot [data-gallery-list] button'));
    const activeIndex = listButtons.findIndex(b => b.hasAttribute('aria-current'));
    return {
      activeIndex,
      activeName: activeIndex >= 0 ? listButtons[activeIndex].textContent.trim() : null
    };
  });
  console.log('After extra forward drag:', clampedEndState);
  if (clampedEndState.activeIndex !== endState.total - 1) {
    throw new Error(`Carousel looped or exceeded max items! Active index: ${clampedEndState.activeIndex}`);
  }

  // Take screenshot of Event 6
  await page.screenshot({ path: 'scripts/event6_final_position.png' });
  console.log('Event 6 screenshot saved: scripts/event6_final_position.png');

  // Test 2: Reverse dragging backward towards Event 1
  console.log('Testing Reverse Dragging from Event 6 back to Event 1...');
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(canvasBox.x - 200, canvasBox.y);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 300, canvasBox.y, { steps: 10 });
    await page.mouse.up();
    await new Promise(r => setTimeout(r, 200));
  }
  await new Promise(r => setTimeout(r, 600));

  const startState = await page.evaluate(() => {
    const listButtons = Array.from(document.querySelectorAll('#circularGalleryRoot [data-gallery-list] button'));
    const activeIndex = listButtons.findIndex(b => b.hasAttribute('aria-current'));
    return {
      activeIndex,
      activeName: activeIndex >= 0 ? listButtons[activeIndex].textContent.trim() : null
    };
  });
  console.log('Reverse drag returned to:', startState);

  if (startState.activeIndex !== 0) {
    throw new Error(`Expected reverse drag to return to index 0, but got ${startState.activeIndex}`);
  }

  // Reverse drag past event 1 should not reveal negative / previous items
  console.log('Testing that backward drag past event 1 DOES NOT reveal nonexistent previous items...');
  await page.mouse.move(canvasBox.x - 200, canvasBox.y);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 400, canvasBox.y, { steps: 10 });
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 500));

  const clampedStartState = await page.evaluate(() => {
    const listButtons = Array.from(document.querySelectorAll('#circularGalleryRoot [data-gallery-list] button'));
    const activeIndex = listButtons.findIndex(b => b.hasAttribute('aria-current'));
    return {
      activeIndex,
      activeName: activeIndex >= 0 ? listButtons[activeIndex].textContent.trim() : null
    };
  });
  console.log('After extra backward drag:', clampedStartState);
  if (clampedStartState.activeIndex !== 0) {
    throw new Error(`Backward drag past 0 moved to index: ${clampedStartState.activeIndex}`);
  }

  await page.screenshot({ path: 'scripts/event1_initial_position.png' });
  console.log('Event 1 screenshot saved: scripts/event1_initial_position.png');

  await browser.close();
  console.log('ALL FINITE CAROUSEL AND BIDIRECTIONAL DRAGGING TESTS PASSED SUCCESSFULLY!');
}

testCarouselFiniteDrag().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
