'use strict';
const puppeteer = require('puppeteer');
const assert = require('node:assert/strict');

async function testUI() {
  console.log('── Testing Registration Defaults, My Pass, and Team UI via Browser ──\n');
  const fs = require('fs');
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
  await page.evaluate(() => window.sparkGo(2));
  await page.waitForSelector('#rYear');

  // Verify BUG 1: Year field displays "Select Year" as placeholder only, value is empty
  const yearVal = await page.$eval('#rYear', el => el.value);
  const yearText = await page.$eval('#rYear option:checked', el => el.textContent.trim());
  const yearDisabled = await page.$eval('#rYear option:checked', el => el.disabled);

  console.log(`Checking Bug 1: Year value="${yearVal}", text="${yearText}", disabled=${yearDisabled}`);
  assert.equal(yearVal, '', 'Year value must be empty on initial registration page load');
  assert.equal(yearText, 'Select Year', 'Checked option must display "Select Year" placeholder');
  assert.equal(yearDisabled, true, 'Placeholder option must be disabled');

  // Attempt submitting without selecting year
  await page.evaluate(() => document.getElementById('regSubmit').click());
  const errorMsg = await page.$eval('#regError', el => el.textContent.trim());
  console.log('Submit without year error:', errorMsg);
  assert(errorMsg.length > 0, 'Form submission must be blocked when year is unselected');
  console.log('✔ Bug 1 Verified: Year displays "Select Year" as disabled placeholder and blocks empty submission.');

  // Verify BUG 2: Empty state on My Pass section (#s3)
  await page.evaluate(() => window.sparkGo(3));
  await page.waitForSelector('#passEvent');
  const emptyPassTitle = await page.$eval('#passEvent', el => el.textContent.trim());
  const emptyPassStatus = await page.$eval('#passStatus', el => el.textContent.trim());
  console.log(`Checking Bug 2 Empty State: passEvent="${emptyPassTitle}", passStatus="${emptyPassStatus}"`);
  assert.equal(emptyPassTitle, 'No registered events found');
  assert.equal(emptyPassStatus, 'NO PASS');
  console.log('✔ Bug 2 Empty State Verified: Shows "No registered events found" and NO PASS.');

  // Verify Team UI dynamic rules on section 2
  await page.evaluate(() => window.sparkGo(2));
  await page.waitForSelector('#teamRulesHint');

  const rulesHint = await page.$eval('#teamRulesHint', el => el.textContent.trim());
  console.log('Current Team rules hint:', rulesHint);
  const addBtnExists = await page.$('#addMemberBtn');
  assert(addBtnExists, 'Add Member button must be present');
  console.log('✔ Team UI Verified: Dynamic rules hint and Add Member button are present.');

  await browser.close();
  console.log('\nAll browser UI checks passed!\n');
  process.exit(0);
}

testUI().catch(err => {
  console.error('Browser test failed:', err);
  process.exit(1);
});
