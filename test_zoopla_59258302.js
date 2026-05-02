const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const ZooplaAdapter = require('./adapters/ZooplaAdapter');

async function run() {
  const browser = await chromium.launch({ headless: false }); // false so we can see CAPTCHAs if needed
  const page = await browser.newPage();
  
  const adapter = new ZooplaAdapter(page);
  console.log("Testing specific Zoopla Listing...");
  
  // We pass a dummy price just to satisfy the listing object structure
  const result = await adapter.processListing({ id: '59258302', price: 2000 });
  
  if (!result) {
    const html = await page.content();
    require('fs').writeFileSync('59258302.html', html);
    console.log("Saved HTML to 59258302.html for debugging");
  }
  
  console.log("Result:", result);
  await browser.close();
}

run();