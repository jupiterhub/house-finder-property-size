const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Rightmove debugging
  await page.goto('https://www.rightmove.co.uk/property-to-rent/find.html?useLocationIdentifier=true&locationIdentifier=STATION%5E5162&_includeLetAgreed=false&maxBedrooms=2&index=0&sortType=6&channel=RENT&transactionType=LETTING&displayLocationIdentifier=Kings-Cross-Station.html&maxPrice=5000', { waitUntil: 'networkidle' });
  
  let rmCards = await page.$$eval('.l-searchResult.is-list', cards => cards.map(c => c.innerHTML).slice(0,1));
  if (rmCards.length === 0) {
      rmCards = await page.$$eval('[data-test="propertyCard-0"]', cards => cards.map(c => c.innerHTML).slice(0,1));
  }
  if (rmCards.length === 0) {
      // Let's just find any links with "properties"
      const allLinks = await page.$$eval('a', links => links.map(l => l.href).filter(h => h.includes('properties/')));
      console.log('Rightmove property links:', allLinks.slice(0, 5));
  } else {
      console.log("Rightmove alternative card found.");
  }
  
  // Zoopla debugging
  await page.goto('https://www.zoopla.co.uk/to-rent/property/station/tube/kings-cross-st-pancras/?beds_max=2&price_frequency=per_month&price_max=5000&q=King%27s%20Cross%20St.%20Pancras%20Station%2C%20London&search_source=to-rent', { waitUntil: 'networkidle' });
  
  const zListings = await page.$$eval('[data-testid="regular-listings"] > div', cards => {
    return cards.map(card => {
      const linkEl = card.querySelector('[data-testid="listing-details-link"]');
      const priceEl = card.querySelector('[data-testid="listing-price"]');
      if (!linkEl || !priceEl) return null;
      return { link: linkEl.href, price: priceEl.textContent };
    }).filter(Boolean);
  });
  
  console.log('Zoopla testid listings count:', zListings.length);
  if (zListings.length === 0) {
      const alternativeLinks = await page.$$eval('a', links => links.map(l => l.href).filter(h => h.includes('/to-rent/details/')));
      console.log('Zoopla alternative links:', alternativeLinks.slice(0, 5));
  } else {
      console.log(zListings[0]);
  }
  
  await browser.close();
}
run();