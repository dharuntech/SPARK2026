const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new'
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  await page.goto('https://spark26-gamma.vercel.app/?t=' + Date.now(), { waitUntil: 'networkidle2' });
  
  await page.click('[data-section="1"]');
  await new Promise(r => setTimeout(r, 3500));
  
  // Check canvas rect and test dragging
  const testResults = await page.evaluate(async () => {
    const canvas = document.querySelector('.circular-gallery-canvas');
    if (!canvas) return { error: 'No gallery canvas' };

    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Helper to simulate drag on canvas
    function drag(fromX, toX, y) {
      canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: fromX, clientY: y, pointerId: 1 }));
      canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: toX, clientY: y, pointerId: 1 }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: toX, clientY: y, pointerId: 1 }));
    }

    // Helper to dispatch wheel event
    function wheel(deltaY) {
      canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY }));
    }

    return {
      canvasBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      dragTested: true
    };
  });

  console.log('Canvas Box & Test:', testResults);

  // Now perform actual page.mouse dragging on canvas coordinates!
  const box = testResults.canvasBox;
  const startX = box.x + box.width * 0.7;
  const startY = box.y + box.height * 0.5;

  console.log('Performing mouse dragging to advance forward across all cards...');
  for (let i = 0; i < 15; i++) {
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 300, startY, { steps: 10 });
    await page.mouse.up();
    await new Promise(r => setTimeout(r, 80));
  }
  await new Promise(r => setTimeout(r, 1000));

  await page.screenshot({ path: 'scripts/live_dragged_to_end.png', fullPage: false });
  console.log('Saved scripts/live_dragged_to_end.png');

  console.log('Performing mouse dragging back to Card 1...');
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(startX - 300, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY, { steps: 10 });
    await page.mouse.up();
    await new Promise(r => setTimeout(r, 80));
  }
  await new Promise(r => setTimeout(r, 1000));

  await page.screenshot({ path: 'scripts/live_dragged_back_start.png', fullPage: false });
  console.log('Saved scripts/live_dragged_back_start.png');

  await browser.close();
})();
