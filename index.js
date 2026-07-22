const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const RightmoveAdapter = require('./adapters/RightmoveAdapter');
const JLLAdapter = require('./adapters/JLLAdapter');
const JohnsAndCoAdapter = require('./adapters/JohnsAndCoAdapter');
const KnightFrankAdapter = require('./adapters/KnightFrankAdapter');
const { saveMatch, markAsSeen } = require('./utils/storage');

async function main() {
  console.log('Launching browser with stealth plugin...');
  // Using a persistent context is ideal for retaining cookies/sessions,
  // but for simplicity in this script we launch a normal headless instance.
  // To avoid bot detection, you might want headless: false or use a stealth plugin.
  const isCI = !!(process.env.CI || process.env.GITHUB_ACTIONS);
  const useHeadless = isCI || process.env.HEADLESS !== 'false';
  const browser = await chromium.launch({ 
    headless: useHeadless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  }); 
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    deviceScaleFactor: 1
  });

  // Extra evasion: force webdriver property to false
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
    });
  });
  
  const adapterClasses = [
    RightmoveAdapter,
    // JLLAdapter,
    // JohnsAndCoAdapter,
    // KnightFrankAdapter
  ];

  try {
    await Promise.all(adapterClasses.map(async (AdapterClass) => {
      const page = await context.newPage();
      const adapter = new AdapterClass(page);
      console.log(`Running ${adapter.platformName} adapter in parallel...`);
      try {
        const results = await adapter.run();
        for (const match of results) {
          saveMatch(match);
        }
      } catch (err) {
        console.error(`Error in ${adapter.platformName} adapter:`, err);
      } finally {
        await page.close().catch(() => {});
      }
    }));

    console.log('Scraping complete.');
  } catch (error) {
    console.error('An error occurred during scraping:', error);
  } finally {
    console.log('Closing browser...');
    await browser.close();
  }
}

main();