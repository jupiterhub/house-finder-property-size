const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log("Navigating to Zoopla listing 59258302...");
  await page.goto('https://www.zoopla.co.uk/to-rent/details/59258302/', { waitUntil: 'domcontentloaded' });
  
  // Accept cookies
  try {
      const acceptBtn = await page.waitForSelector('button:has-text("Accept all cookies"), #onetrust-accept-btn-handler, button[data-testid="cookie-banner-accept-button"], button:has-text("Accept")', { timeout: 3000 });
      if (acceptBtn) {
        await acceptBtn.click();
        await page.waitForTimeout(1000);
      }
  } catch(e) {}

  console.log("Clicking Floor plan...");
  try {
      await page.locator('text=Floor plan').first().click();
      await page.waitForTimeout(3000); // Give plenty of time to render modal or tab
      const html = await page.content();
      require('fs').writeFileSync('zoopla_floorplan.html', html);
      console.log("Saved clicked HTML to zoopla_floorplan.html");
  } catch(e) {
      console.log("Error clicking floor plan:", e);
  }

  // List all images
  const images = await page.$$eval('img', imgs => imgs.map(img => img.src));
  console.log("Total images after click:", images.length);
  
  // Look for any image that looks like it could be a floorplan (either in name or large resolution)
  const interestingImages = images.filter(src => src.includes('zoocdn') && !src.includes('logo') && !src.includes('.svg'));
  console.log("Interesting images:", interestingImages);

  await browser.close();
}
run();