'use strict';
const fs = require('fs');
const puppeteer = require('puppeteer');
const assert = require('node:assert/strict');

async function testFull() {
  const chromeExe = process.env.PUPPETEER_EXECUTABLE_PATH ||
    (fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe') ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined);

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: chromeExe,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0' });

  // 1. Select NeuroForge from events
  const selectedName = await page.evaluate(() => {
    const evs = window.sparkEvents ? window.sparkEvents() : [];
    const ev = evs.find(e => /neuroforge/i.test(e.name));
    if (ev && window.sparkSelectEvent) {
      window.sparkSelectEvent(ev);
      window.sparkGo(2);
      return ev.name;
    }
    return null;
  });
  console.log('Selected event for registration:', selectedName);
  assert(selectedName, 'NeuroForge event must be selected');

  // Check that team rules hint says NeuroForge
  const hint = await page.$eval('#teamRulesHint', el => el.textContent.trim());
  console.log('NeuroForge team hint:', hint);
  assert(/NeuroForge/i.test(hint));

  // Check members list has 2 pre-rendered slots for NeuroForge
  const memberCards = await page.$$('#teamMembersList [data-member-idx]');
  console.log('Pre-rendered member cards for NeuroForge:', memberCards.length);
  assert.equal(memberCards.length, 2);

  // Fill in registrant details
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  await page.evaluate((r) => {
    document.getElementById('rName').value = 'Lead Student ' + r;
    document.getElementById('rRegno').value = 'REG-' + r;
    document.getElementById('rDept').value = 'CSE';
    document.getElementById('rYear').value = 'III';
    document.getElementById('rSection').value = 'A';
    document.getElementById('rEmail').value = 'lead_' + r.toLowerCase() + '@example.com';
  }, rand);

  // Fill in Member 2 and Member 3
  await page.evaluate((r) => {
    const cards = document.querySelectorAll('#teamMembersList [data-member-idx]');
    cards[0].querySelector('.m-name').value = 'Member 2 ' + r;
    cards[0].querySelector('.m-regno').value = 'MEM2-' + r;
    cards[1].querySelector('.m-name').value = 'Member 3 ' + r;
    cards[1].querySelector('.m-regno').value = 'MEM3-' + r;
  }, rand);

  // Submit registration
  await page.evaluate(() => document.getElementById('regForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })));

  // Wait for section 3 (My Pass) to show
  await page.waitForFunction(() => document.getElementById('passEvent').textContent.includes('NeuroForge'), { timeout: 15000 });
  const passTitle = await page.$eval('#passEvent', el => el.textContent.trim());
  const passId = await page.$eval('#passId', el => el.textContent.trim());
  const passHint = await page.$eval('#passHint', el => el.textContent.trim());

  console.log('My Pass Event Title:', passTitle);
  console.log('My Pass Registration ID:', passId);
  console.log('My Pass Hint:', passHint);

  assert.equal(passTitle, 'NeuroForge', 'My Pass must display NeuroForge, NOT Capture the Flag!');
  assert(/Lead Student/.test(passHint));
  assert(/Member 2/.test(passHint));
  assert(/Member 3/.test(passHint));

  console.log('\n✔ Full Browser Registration & My Pass verified with NeuroForge and 3 team members!');

  await browser.close();
  process.exit(0);
}

testFull().catch(e => {
  console.error(e);
  process.exit(1);
});
