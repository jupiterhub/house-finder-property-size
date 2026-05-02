const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://www.rightmove.co.uk/property-to-rent/find.html?useLocationIdentifier=true&locationIdentifier=STATION%5E5162&_includeLetAgreed=false&maxBedrooms=2&index=0&sortType=6&channel=RENT&transactionType=LETTING&displayLocationIdentifier=Kings-Cross-Station.html&maxPrice=5000', { waitUntil: 'networkidle' });
  
  // Try to find the exact elements
  const cards = await page.$$('.propertyCard');
  console.log(`Number of .propertyCard elements: ${cards.length}`);
  
  if (cards.length > 0) {
    const html = await page.$eval('.propertyCard', el => el.innerHTML);
    console.log("First card HTML:", html.substring(0, 1000));
    
    const linkEl = await page.$eval('.propertyCard .propertyCard-link', el => el.href).catch(() => 'No link');
    const priceEl = await page.$eval('.propertyCard .propertyCard-priceValue', el => el.textContent).catch(() => 'No price');
    console.log("First card link:", linkEl);
    console.log("First card price:", priceEl);
  }
  
  // Let's do the same for Zoopla
  await page.goto('https://www.zoopla.co.uk/to-rent/property/station/tube/kings-cross-st-pancras/?beds_max=2&price_frequency=per_month&price_max=5000&q=King%27s%20Cross%20St.%20Pancras%20Station%2C%20London&search_source=to-rent', { waitUntil: 'networkidle' });
  const zooplaCards = await page.$$('[data-testid="regular-listings"] > div');
  console.log(`Number of Zoopla cards: ${zooplaCards.length}`);
  
  if (zooplaCards.length > 0) {
    const zHtml = await page.$eval('[data-testid="regular-listings"] > div', el => el.innerHTML);
    console.log("First Zoopla card HTML:", zHtml.substring(0, 1000));
  }
  
  await browser.close();
}
run();