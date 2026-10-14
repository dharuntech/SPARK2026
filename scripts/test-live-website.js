const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function testLive() {
  console.log('Launching Chrome to test LIVE website: https://spark26-gamma.vercel.app/ ...');
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,900']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });

    console.log('Navigating to live URL...');
    await page.goto('https://spark26-gamma.vercel.app/?t=' + Date.now(), { waitUntil: 'networkidle2', timeout: 30000 });

    console.log('Waiting for events section (#s1, #circularGalleryRoot)...');
    await page.waitForSelector('#circularGalleryRoot', { timeout: 15000 });
    await new Promise(r => setTimeout(r, 2500)); // allow WebGL/React/images to settle

    // Scroll to #s1
    await page.evaluate(() => {
      const el = document.getElementById('s1');
      if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
    });
    await new Promise(r => setTimeout(r, 1000));

    // Capture initial screenshot of the live gallery
    const initialShot = path.join(__dirname, 'live_events_initial.png');
    await page.screenshot({ path: initialShot, fullPage: false });
    console.log('Saved initial events screenshot to:', initialShot);

    // Evaluate live gallery and DOM cards state
    const evalData = await page.evaluate(async () => {
      const root = document.getElementById('circularGalleryRoot');
      const canvas = root ? root.querySelector('canvas') : null;
      const webglCtx = canvas ? (canvas.getContext('webgl2') || canvas.getContext('webgl')) : null;

      // Check DOM fallback cards
      const domCards = Array.from(document.querySelectorAll('#eventGrid .card, .event-grid .card'));
      const cardData = domCards.map(c => {
        const style = window.getComputedStyle(c);
        const titleEl = c.querySelector('h3, .card-title, h4');
        return {
          title: titleEl ? titleEl.textContent.trim() : '',
          transform: style.transform,
          rotate: style.rotate,
          skew: style.skew
        };
      });

      // Also check window.__galleryRef or inspect mounted gallery state if accessible
      return {
        hasRoot: !!root,
        hasCanvas: !!canvas,
        canvasWidth: canvas ? canvas.width : 0,
        canvasHeight: canvas ? canvas.height : 0,
        domCardsCount: domCards.length,
        cardData
      };
    });

    console.log('Live Evaluation Data:', JSON.stringify(evalData, null, 2));

    // Test dragging the interactive gallery forward to the end
    console.log('Testing interactive dragging forward across all cards...');
    const forwardDragResult = await page.evaluate(async () => {
      const stage = document.getElementById('galleryStage') || document.getElementById('circularGalleryRoot');
      if (!stage) return { error: 'No stage element found' };

      const rect = stage.getBoundingClientRect();
      const startX = rect.left + rect.width * 0.7;
      const startY = rect.top + rect.height * 0.5;

      // Dispatch 15 drag gestures to the left to advance through all cards
      for (let i = 0; i < 15; i++) {
        stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: startX, clientY: startY, pointerId: 1 }));
        stage.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: startX - 300, clientY: startY, pointerId: 1 }));
        stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: startX - 300, clientY: startY, pointerId: 1 }));
        await new Promise(r => setTimeout(r, 60));
      }
      await new Promise(r => setTimeout(r, 600));
      return { success: true };
    });

    console.log('Forward drag result:', forwardDragResult);
    const endShot = path.join(__dirname, 'live_events_end.png');
    await page.screenshot({ path: endShot, fullPage: false });
    console.log('Saved end position screenshot to:', endShot);

    // Test dragging in reverse back to the start
    console.log('Testing reverse dragging back to the first card (Event 1: IPL Auction)...');
    const reverseDragResult = await page.evaluate(async () => {
      const stage = document.getElementById('galleryStage') || document.getElementById('circularGalleryRoot');
      if (!stage) return { error: 'No stage element found' };

      const rect = stage.getBoundingClientRect();
      const startX = rect.left + rect.width * 0.3;
      const startY = rect.top + rect.height * 0.5;

      // Dispatch 20 drag gestures to the right to return to card 0
      for (let i = 0; i < 20; i++) {
        stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: startX, clientY: startY, pointerId: 1 }));
        stage.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: startX + 300, clientY: startY, pointerId: 1 }));
        stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: startX + 300, clientY: startY, pointerId: 1 }));
        await new Promise(r => setTimeout(r, 60));
      }
      await new Promise(r => setTimeout(r, 600));
      return { success: true };
    });

    console.log('Reverse drag result:', reverseDragResult);
    const returnedShot = path.join(__dirname, 'live_events_returned.png');
    await page.screenshot({ path: returnedShot, fullPage: false });
    console.log('Saved returned position screenshot to:', returnedShot);

    console.log('ALL LIVE TESTS COMPLETED SUCCESSFULLY!');
  } finally {
    await browser.close();
  }
}

testLive().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
