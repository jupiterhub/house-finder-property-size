const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  console.log("Navigating to Rightmove...");
  await page.goto('https://www.rightmove.co.uk/property-to-rent/find.html?useLocationIdentifier=true&locationIdentifier=STATION%5E5162&_includeLetAgreed=false&maxBedrooms=2&index=0&sortType=6&channel=RENT&transactionType=LETTING&displayLocationIdentifier=Kings-Cross-Station.html&maxPrice=5000', { waitUntil: 'domcontentloaded' });
  
  const content = await page.content();
  console.log("Rightmove Title:", await page.title());
  
  if (content.includes('propertyCard')) {
      console.log('Found propertyCard class');
  } else {
      console.log('No propertyCard class found');
  }
  
  console.log("Navigating to Zoopla...");
  await page.goto('https://www.zoopla.co.uk/to-rent/property/station/tube/kings-cross-st-pancras/?beds_max=2&price_frequency=per_month&price_max=5000&q=King%27s%20Cross%20St.%20Pancras%20Station%2C%20London&search_source=to-rent', { waitUntil: 'domcontentloaded' });
  console.log("Zoopla Title:", await page.title());
  
  const zooplaContent = await page.content();
  if (zooplaContent.includes('regular-listings')) {
      console.log('Found regular-listings class/id/data-testid');
  } else {
      console.log('No regular-listings found');
  }
  await browser.close();
}
run();
