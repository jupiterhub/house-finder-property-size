const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://www.zoopla.co.uk/to-rent/details/59258302/', { waitUntil: 'domcontentloaded' });
  
  try {
      const acceptBtn = await page.waitForSelector('button:has-text("Accept all cookies"), #onetrust-accept-btn-handler, button[data-testid="cookie-banner-accept-button"], button:has-text("Accept")', { timeout: 3000 });
      if (acceptBtn) {
        await acceptBtn.click();
        await page.waitForTimeout(1000);
      }
  } catch(e) {}

  try {
      await page.locator('text=Floor plan').first().click();
      await page.waitForTimeout(3000); 
  } catch(e) {
      console.log("Error clicking floor plan:", e);
  }

  await page.screenshot({ path: 'zoopla_click.png', fullPage: true });
  await browser.close();
}
run();
