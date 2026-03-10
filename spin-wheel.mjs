import { chromium } from 'playwright';

const url = 'https://winner-wheel.peter.cloudmallinc.com/';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
});
const page = await context.newPage();

console.log('Loading wheel...');
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2000);

// Close the about overlay first - click outside it or find close button
console.log('Closing overlay...');
try {
  // Try clicking the overlay itself (outside the modal) to close it
  await page.click('#about-overlay', { position: { x: 10, y: 10 }, timeout: 3000 });
  await page.waitForTimeout(500);
} catch(e) {
  // Try pressing Escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

// Screenshot before spin
await page.screenshot({ path: '/Users/mike/vito3.0/user/drive/screenshots/wheel-before.png' });
console.log('Before screenshot taken');

// Find and click spin button
const spinButton = await page.locator('#spin-btn').first();
console.log('Clicking spin...');
await spinButton.click({ timeout: 5000 });

// Wait for wheel to stop spinning (give it a good 8 seconds)
console.log('Waiting for wheel to stop...');
await page.waitForTimeout(8000);

// Take screenshot of result
await page.screenshot({ path: '/Users/mike/vito3.0/user/drive/screenshots/wheel-result.png' });
console.log('Result screenshot taken!');

// Try to extract the winner text
const bodyText = await page.evaluate(() => document.body.innerText);
console.log('\n--- PAGE TEXT ---');
console.log(bodyText);

await browser.close();
