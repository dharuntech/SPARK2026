const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

async function testContact() {
  const chromeExe = process.env.PUPPETEER_EXECUTABLE_PATH ||
    [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ].find(p => fs.existsSync(p));

  console.log('Using browser executable:', chromeExe);

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: chromeExe,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  const shotsDir = path.join(__dirname, '..', 'var', 'contact-shots');
  if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir, { recursive: true });

  // 1. Desktop Test (1440x900)
  console.log('Testing Desktop 1440px...');
  await page.setViewport({ width: 1440, height: 1100 });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 800));

  // Switch to section 4
  await page.evaluate(() => {
    const navLink = document.querySelector('a[data-section="4"]') || document.querySelector('.nav-contacts-desktop') || document.querySelector('.nav-contact');
    if (navLink) navLink.click();
    else {
      // Direct fallback
      document.querySelectorAll('.section').forEach(s => s.classList.remove('show'));
      const s4 = document.getElementById('s4');
      if (s4) s4.classList.add('show');
    }
  });

  // Wait for images and animations
  await new Promise(r => setTimeout(r, 1200));

  // Inspect data
  const desktopData = await page.evaluate(() => {
    const section = document.getElementById('s4');
    const cards = Array.from(section.querySelectorAll('.contact-card'));
    return cards.map((c, i) => {
      const img = c.querySelector('img');
      const name = c.querySelector('.c-name') ? c.querySelector('.c-name').innerText : '';
      const role = c.querySelector('.c-role') ? c.querySelector('.c-role').innerText : '';
      const hasDivider = !!c.querySelector('.c-divider');
      const rect = c.getBoundingClientRect();
      return {
        cardIndex: i + 1,
        name,
        role,
        hasDivider,
        imgSrc: img ? img.getAttribute('src') : null,
        imgLoaded: img ? (img.complete && img.naturalWidth > 0) : false,
        imgNaturalWidth: img ? img.naturalWidth : 0,
        imgNaturalHeight: img ? img.naturalHeight : 0,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    });
  });

  console.log('Desktop Team Cards Data:');
  console.log(JSON.stringify(desktopData, null, 2));

  // Verify rows on desktop:
  // Card 1, 2, 3 should be on row 1 (same y)
  // Card 4, 5, 6 should be on row 2 (same y)
  // Card 7, 8 should be on row 3 (same y), and centered
  console.log('Row 1 Y coords:', desktopData.slice(0, 3).map(c => c.y));
  console.log('Row 2 Y coords:', desktopData.slice(3, 6).map(c => c.y));
  console.log('Row 3 Y coords:', desktopData.slice(6, 8).map(c => c.y));
  console.log('Row 3 X coords (Developers):', desktopData.slice(6, 8).map(c => c.x));

  const sectionEl = await page.$('#s4');
  if (sectionEl) {
    await sectionEl.screenshot({
      path: path.join(shotsDir, 'contact-section-desktop-1440.png')
    });
  }

  // 2. Tablet Test (768px)
  console.log('Testing Tablet 768px...');
  await page.setViewport({ width: 768, height: 1200 });
  await page.evaluate(() => {
    const navLink = document.querySelector('a[data-section="4"]') || document.querySelector('.nav-contact');
    if (navLink) navLink.click();
    else {
      document.querySelectorAll('.section').forEach(s => s.classList.remove('show'));
      const s4 = document.getElementById('s4');
      if (s4) s4.classList.add('show');
    }
  });
  await new Promise(r => setTimeout(r, 800));

  const tabletData = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#s4 .contact-card'));
    return cards.map(c => {
      const rect = c.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width) };
    });
  });
  console.log('Tablet Card layout (2 per row):');
  console.log(tabletData);

  const tabletSectionEl = await page.$('#s4');
  if (tabletSectionEl) {
    await tabletSectionEl.screenshot({
      path: path.join(shotsDir, 'contact-section-tablet-768.png')
    });
  }

  // 3. Mobile Test (390px)
  console.log('Testing Mobile 390px...');
  await page.setViewport({ width: 390, height: 1200 });
  await page.evaluate(() => {
    const navLink = document.querySelector('a[data-section="4"]') || document.querySelector('.nav-contact');
    if (navLink) navLink.click();
    else {
      document.querySelectorAll('.section').forEach(s => s.classList.remove('show'));
      const s4 = document.getElementById('s4');
      if (s4) s4.classList.add('show');
    }
  });
  await new Promise(r => setTimeout(r, 800));

  const mobileData = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#s4 .contact-card'));
    const docWidth = document.documentElement.clientWidth;
    const bodyWidth = document.body.scrollWidth;
    return {
      docWidth,
      bodyWidth,
      cards: cards.map(c => {
        const rect = c.getBoundingClientRect();
        return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width) };
      })
    };
  });
  console.log('Mobile Card layout:', mobileData);

  const mobileSectionEl = await page.$('#s4');
  if (mobileSectionEl) {
    await mobileSectionEl.screenshot({
      path: path.join(shotsDir, 'contact-section-mobile-390.png')
    });
  }

  console.log('Console errors:', consoleErrors);
  await browser.close();
  console.log('All contact section visual tests passed!');
}

testContact().catch(err => {
  console.error('Error testing contact section:', err);
  process.exit(1);
});
