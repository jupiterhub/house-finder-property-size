const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Rightmove debugging
  await page.goto('https://www.rightmove.co.uk/property-to-rent/find.html?useLocationIdentifier=true&locationIdentifier=STATION%5E5162&_includeLetAgreed=false&maxBedrooms=2&index=0&sortType=6&channel=RENT&transactionType=LETTING&displayLocationIdentifier=Kings-Cross-Station.html&maxPrice=5000', { waitUntil: 'networkidle' });
  
  const rmHTML = await page.content();
  const fs = require('fs');
  fs.writeFileSync('rm.html', rmHTML);
  
  await browser.close();
}
run();