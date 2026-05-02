const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://www.zoopla.co.uk/to-rent/property/station/tube/kings-cross-st-pancras/?beds_max=2&price_frequency=per_month&price_max=5000&q=King%27s%20Cross%20St.%20Pancras%20Station%2C%20London&search_source=to-rent', { waitUntil: 'networkidle' });
  const zHTML = await page.content();
  const fs = require('fs');
  fs.writeFileSync('zoopla.html', zHTML);
  
  await browser.close();
}
run();