const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,1000']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  await page.goto('https://spark26-gamma.vercel.app/?t=' + Date.now(), { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));

  console.log('Navigating to Events section via window.go(1)...');
  await page.evaluate(() => {
    if (typeof window.go === 'function') window.go(1);
    else document.querySelector('[data-section="1"]')?.click();
  });
  await new Promise(r => setTimeout(r, 2000));

  // Step 1: Capture initial position (Card 1: IPL Auction)
  await page.screenshot({ path: 'scripts/live_card1_ipl.png', fullPage: false });
  console.log('Saved scripts/live_card1_ipl.png');

  // Step 2: Drag left repeatedly across all 6 cards until reaching the end
  console.log('Dragging forward to the last card...');
  await page.evaluate(async () => {
    const root = document.getElementById('circularGalleryRoot') || document.getElementById('galleryStage');
    const rect = root.getBoundingClientRect();
    const startX = rect.left + rect.width * 0.7;
    const startY = rect.top + rect.height * 0.5;

    for (let i = 0; i < 20; i++) {
      root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: startX, clientY: startY, pointerId: 1 }));
      root.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: startX - 350, clientY: startY, pointerId: 1 }));
      root.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: startX - 350, clientY: startY, pointerId: 1 }));
      await new Promise(r => setTimeout(r, 60));
    }
  });
  await new Promise(r => setTimeout(r, 1200));

  // Step 3: Capture end position (Card 6: NeuraForge)
  await page.screenshot({ path: 'scripts/live_card6_neuraforge.png', fullPage: false });
  console.log('Saved scripts/live_card6_neuraforge.png');

  // Step 4: Try dragging further forward to verify firm boundary stop (no looping)
  console.log('Attempting to drag further forward to test finite boundary stop...');
  await page.evaluate(async () => {
    const root = document.getElementById('circularGalleryRoot') || document.getElementById('galleryStage');
    const rect = root.getBoundingClientRect();
    const startX = rect.left + rect.width * 0.7;
    const startY = rect.top + rect.height * 0.5;

    for (let i = 0; i < 8; i++) {
      root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: startX, clientY: startY, pointerId: 1 }));
      root.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: startX - 350, clientY: startY, pointerId: 1 }));
      root.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: startX - 350, clientY: startY, pointerId: 1 }));
      await new Promise(r => setTimeout(r, 60));
    }
  });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: 'scripts/live_card6_stopped.png', fullPage: false });
  console.log('Saved scripts/live_card6_stopped.png');

  // Step 5: Reverse drag back to the beginning
  console.log('Dragging reverse back to Card 1...');
  await page.evaluate(async () => {
    const root = document.getElementById('circularGalleryRoot') || document.getElementById('galleryStage');
    const rect = root.getBoundingClientRect();
    const startX = rect.left + rect.width * 0.3;
    const startY = rect.top + rect.height * 0.5;

    for (let i = 0; i < 25; i++) {
      root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: startX, clientY: startY, pointerId: 1 }));
      root.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: startX + 350, clientY: startY, pointerId: 1 }));
      root.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: startX + 350, clientY: startY, pointerId: 1 }));
      await new Promise(r => setTimeout(r, 60));
    }
  });
  await new Promise(r => setTimeout(r, 1200));

  // Step 6: Capture returned position (Card 1: IPL Auction)
  await page.screenshot({ path: 'scripts/live_card1_returned.png', fullPage: false });
  console.log('Saved scripts/live_card1_returned.png');

  await browser.close();
  console.log('ALL SCREENSHOTS CAPTURED ON LIVE SITE!');
})();
