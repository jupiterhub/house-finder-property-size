const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log("=== Rightmove ===");
  await page.goto('https://www.rightmove.co.uk/property-to-rent/find.html?useLocationIdentifier=true&locationIdentifier=STATION%5E5162&_includeLetAgreed=false&maxBedrooms=2&index=0&sortType=6&channel=RENT&transactionType=LETTING&displayLocationIdentifier=Kings-Cross-Station.html&maxPrice=5000', { waitUntil: 'networkidle' });
  
  const rmListings = await page.$$eval('div:has(> a[href*="/properties/"]), a[href*="/properties/"]', els => {
      // Find the closest common ancestor or just extract from the link itself
      // In newer Rightmove React UI, it's often a div containing an 'a' tag.
      // Let's just find all elements that have a text matching £... pcm
      return Array.from(document.querySelectorAll('div')).map(div => {
          const a = div.querySelector('a[href*="/properties/"]');
          if (!a) return null;
          const text = div.innerText;
          const priceMatch = text.match(/£[\d,]+(\s*pcm|)/i);
          if (priceMatch && a.href.includes('properties/')) {
              // We only want relatively small divs to avoid the whole page
              if (div.innerText.length < 2000) {
                  return { link: a.href, priceText: priceMatch[0], divLength: div.innerText.length };
              }
          }
          return null;
      }).filter(Boolean).sort((a,b) => a.divLength - b.divLength);
  });
  
  // Deduplicate by link
  const seenRm = new Set();
  const rmFiltered = [];
  for (const item of rmListings) {
      if (!seenRm.has(item.link)) {
          seenRm.add(item.link);
          rmFiltered.push(item);
      }
  }
  console.log('Extracted RM listings:', rmFiltered.length);
  console.log(rmFiltered.slice(0, 2));

  console.log("=== Zoopla ===");
  await page.goto('https://www.zoopla.co.uk/to-rent/property/station/tube/kings-cross-st-pancras/?beds_max=2&price_frequency=per_month&price_max=5000&q=King%27s%20Cross%20St.%20Pancras%20Station%2C%20London&search_source=to-rent', { waitUntil: 'networkidle' });
  
  const zpListings = await page.$$eval('div', els => {
      return Array.from(document.querySelectorAll('div')).map(div => {
          const a = div.querySelector('a[href*="/to-rent/details/"]');
          if (!a) return null;
          const text = div.innerText;
          const priceMatch = text.match(/£[\d,]+(\s*pcm|)/i);
          if (priceMatch && a.href.includes('/to-rent/details/')) {
              if (div.innerText.length < 2000) {
                  return { link: a.href, priceText: priceMatch[0], divLength: div.innerText.length };
              }
          }
          return null;
      }).filter(Boolean).sort((a,b) => a.divLength - b.divLength);
  });
  
  const seenZp = new Set();
  const zpFiltered = [];
  for (const item of zpListings) {
      if (!seenZp.has(item.link)) {
          seenZp.add(item.link);
          zpFiltered.push(item);
      }
  }
  console.log('Extracted Zoopla listings:', zpFiltered.length);
  console.log(zpFiltered.slice(0, 2));

  await browser.close();
}
run();