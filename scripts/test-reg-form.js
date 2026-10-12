const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

async function testRegForm() {
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
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });
  await page.goto('http://localhost:3000/#s2', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 600));

  // Show registration section
  await page.evaluate(() => {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('show'));
    const s2 = document.getElementById('s2');
    if (s2) s2.classList.add('show');
  });
  await new Promise(r => setTimeout(r, 600));

  const info = await page.evaluate(() => {
    const rRegno = document.getElementById('rRegno');
    const rYear = document.getElementById('rYear');
    const yearOptions = Array.from(rYear.options).map(o => o.text);
    return {
      placeholder: rRegno ? rRegno.placeholder : null,
      yearOptions
    };
  });

  console.log('Registration Form check:', info);

  const shotPath = path.join(__dirname, '..', 'var', 'reg-form-updated.png');
  const formEl = await page.$('#regForm');
  if (formEl) {
    await formEl.screenshot({ path: shotPath });
    console.log('Screenshot saved to', shotPath);
  }

  await browser.close();
}

testRegForm().catch(console.error);
