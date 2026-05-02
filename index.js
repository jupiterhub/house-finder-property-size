const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const RightmoveAdapter = require('./adapters/RightmoveAdapter');
const ZooplaAdapter = require('./adapters/ZooplaAdapter');
const { saveMatch, markAsSeen } = require('./utils/storage');

async function main() {
  console.log('Launching browser with stealth plugin...');
  // Using a persistent context is ideal for retaining cookies/sessions,
  // but for simplicity in this script we launch a normal headless instance.
  // To avoid bot detection, you might want headless: false or use a stealth plugin.
  const browser = await chromium.launch({ headless: false }); 
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();

  const rightmove = new RightmoveAdapter(page);
  const zoopla = new ZooplaAdapter(page);

  try {
    const rightmoveResults = await rightmove.run();
    for (const match of rightmoveResults) {
      saveMatch(match);
    }
    
    const zooplaResults = await zoopla.run();
    for (const match of zooplaResults) {
      saveMatch(match);
    }

    console.log('Scraping complete.');
  } catch (error) {
    console.error('An error occurred during scraping:', error);
  } finally {
    console.log('Closing browser...');
    await browser.close();
  }
}

main();