const { isSeen, markAsSeen, markAsIgnored } = require('../utils/storage');
const { extractSqmFromText } = require('../utils/parser');
const { extractTextFromImage } = require('../utils/ocr');
const config = require('../config.json');

class ZooplaAdapter {
  constructor(page) {
    this.page = page;
    this.platformName = 'Zoopla';
  }

  async acceptCookies() {
    try {
      // Try iframe first (often used by TrustArc/OneTrust)
      const iframeLocator = this.page.frameLocator('iframe[title*="consent" i], iframe[src*="consent" i]');
      const btn = iframeLocator.locator('button:has-text("Accept all cookies"), button:has-text("Accept All"), button:has-text("Accept")').first();
      await btn.click({ timeout: 3000 });
      console.log('Accepted Zoopla cookies inside iframe.');
      await this.page.waitForTimeout(1000);
      return;
    } catch(e) {}

    try {
      // Fallback to main document
      // The user provided specific text: "We and our 424 third-party vendors use technologies..."
      // Often the button says "Accept All" or "Accept" or "Agree". Let's broaden the selector.
      const acceptBtn = await this.page.waitForSelector('button:has-text("Accept all cookies"), #onetrust-accept-btn-handler, button[data-testid="cookie-banner-accept-button"], button:has-text("Accept"), button:has-text("Agree"), button:has-text("OK")', { timeout: 3000 });
      if (acceptBtn) {
        await acceptBtn.click();
        console.log('Accepted Zoopla cookies in main document.');
        await this.page.waitForTimeout(1000);
      }
    } catch(e) {}
  }

  async checkCaptcha() {
    try {
        let isCaptcha = await this.page.isVisible('text="Verify you are human"');
        if (isCaptcha) {
            console.log("CAPTCHA detected! Waiting for manual intervention...");
            while (isCaptcha) {
                await this.page.waitForTimeout(5000); // Check every 5 seconds
                isCaptcha = await this.page.isVisible('text="Verify you are human"');
            }
            console.log("CAPTCHA resolved! Continuing scraping...");
            await this.page.waitForTimeout(3000); // Give the page a moment to fully load the next screen
        }
    } catch(e) {}
  }

  async run() {
    const results = [];
    console.log(`Starting ${this.platformName} scraping...`);

    for (const url of config.zooplaUrls) {
      console.log(`Navigating to search URL: ${url}`);
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
      
      await this.checkCaptcha();
      await this.acceptCookies();
      
      // Wait for property cards
      await this.page.waitForSelector('[data-testid="listing-details-link"]', { timeout: 10000 }).catch(() => {});
      
      // Extract links and prices
      let listings = await this.page.$$eval('div', els => {
          return Array.from(document.querySelectorAll('div')).map(div => {
              const a = div.querySelector('a[href*="/to-rent/details/"]');
              if (!a) return null;
              const text = div.innerText;
              const priceMatch = text.match(/£[\d,]+/);
              if (priceMatch && a.href.includes('/to-rent/details/')) {
                  if (div.innerText.length < 2000) {
                      const link = a.href;
                      const idMatch = link.match(/details\/(\d+)/);
                      if (!idMatch) return null;
                      
                      const priceText = priceMatch[0].replace(/£|,/g, '').trim();
                      const price = parseInt(priceText, 10);
                      
                      return { id: idMatch[1], link, price, divLength: div.innerText.length };
                  }
              }
              return null;
          }).filter(Boolean).sort((a,b) => a.divLength - b.divLength);
      });

      // Deduplicate by ID
      const seenId = new Set();
      const uniqueListings = [];
      for (const item of listings) {
          if (!seenId.has(item.id)) {
              seenId.add(item.id);
              uniqueListings.push(item);
          }
      }
      listings = uniqueListings;

      console.log(`Found ${listings.length} listings on this page.`);

      for (const listing of listings) {
        if (isSeen(listing.id, this.platformName)) {
          console.log(`Skipping already seen property: ${listing.id}`);
          continue;
        }

        if (listing.price > config.maxPrice) {
          console.log(`Skipping property ${listing.id} (Price ${listing.price} exceeds max ${config.maxPrice})`);
          markAsIgnored(listing.id, this.platformName, `Price £${listing.price} exceeds max £${config.maxPrice}`);
          continue;
        }

        const match = await this.processListing(listing);
        if (match) {
          markAsSeen(listing.id, this.platformName);
          results.push(match);
        }
      }
    }
    
    return results;
  }

  async processListing(listing) {
    const floorplanUrl = `https://www.zoopla.co.uk/to-rent/details/${listing.id}/?tab=floor_plans`;
    console.log(`Processing listing: ${floorplanUrl}`);
    
    try {
      await this.page.goto(floorplanUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await this.checkCaptcha();
      
      let sqm = null;

      // 1. Check page text for sqm/sqft
      const pageText = await this.page.evaluate(() => {
        // Grab text from common detail containers (features, description, etc.)
        const contentContainers = Array.from(document.querySelectorAll('[data-testid="listing-description"], [data-testid="listing-features"]'));
        if (contentContainers.length > 0) {
            return contentContainers.map(c => c.innerText).join('\n');
        }
        // Fallback to body if specific containers aren't found
        return document.body.innerText;
      });

      if (pageText) {
          sqm = extractSqmFromText(pageText);
          if (sqm) console.log(`Found SQM (${sqm}) in page text.`);
      }

      // 2. Check metadata scripts if not found in text
      if (!sqm) {
          const scriptTexts = await this.page.evaluate(() => {
            const scripts = Array.from(document.querySelectorAll('script'));
            return scripts.map(s => s.textContent).filter(t => t && (t.includes('__NEXT_DATA__') || t.includes('self.__next_f.push')));
          });
          for (const text of scriptTexts) {
            sqm = extractSqmFromText(text);
            if (sqm) {
                console.log(`Found SQM (${sqm}) in metadata script.`);
                break;
            }
          }
      }

      // 3. Look for floorplan image OCR
      if (!sqm) {
        // Specifically click the floor plan tab if it exists
        try {
            const floorplanTab = this.page.locator('button:has(svg use[href*="floorplan"]), button:has-text("Floor plan"), button:has-text("Floorplan")').first();
            if (await floorplanTab.isVisible({ timeout: 3000 })) {
                await floorplanTab.click();
                await this.page.waitForTimeout(3000); // give the tab plenty of time to open/load the images
            }
        } catch (e) {
            console.log(`Note: No floorplan button to click on ${listing.id}`);
        }

        const rawUrls = await this.page.$$eval('img, source', els => {
            const urls = [];
            for (const el of els) {
                if (el.src) urls.push(el.src);
                if (el.srcset) {
                    urls.push(el.srcset);
                }
            }
            return urls;
        });

        // Flatten any srcset strings into individual URLs
        const imageUrls = [];
        for (const urlStr of rawUrls) {
            const parts = urlStr.split(',').map(p => p.trim().split(' ')[0]); // Get the URL part of "url 480w"
            for (const part of parts) {
                if (part && (part.includes('floor-plan') || part.includes('floorplan') || part.includes('fp.jpg') || (part.includes('zoocdn.com') && !part.includes('logo') && !part.includes('.svg')))) {
                    // Try to upgrade to high-res if it's a known Zoopla pattern
                    let upgraded = part;
                    if (part.includes('lid.zoocdn.com/u/480/360/')) {
                        upgraded = part.replace('/u/480/360/', '/u/1200/900/');
                    }
                    imageUrls.push(upgraded);
                }
            }
        }

        if (imageUrls.length > 0) {
          // Zoopla's floorplans usually have the highest resolution versions available via 'lc.zoocdn.com' or 'lid.zoocdn.com'
          let targetImage = imageUrls.find(src => src.includes('lc.zoocdn.com')) || imageUrls.find(src => src.includes('/u/1200/900/')) || imageUrls.find(src => src.includes('lid.zoocdn.com')) || imageUrls[imageUrls.length - 1];
          console.log(`Found floorplan image, running OCR on: ${targetImage}`);
          
          // Scale image using Playwright for better OCR
          const imageBuffer = await this.page.evaluate(async (url) => {
              return new Promise((resolve) => {
                  const img = new Image();
                  img.crossOrigin = "Anonymous";
                  img.onload = () => {
                      const canvas = document.createElement('canvas');
                      // Scale by 3x for Tesseract
                      canvas.width = img.width * 3;
                      canvas.height = img.height * 3;
                      const ctx = canvas.getContext('2d');
                      ctx.scale(3, 3);
                      ctx.drawImage(img, 0, 0);
                      resolve(canvas.toDataURL('image/png'));
                  };
                  img.onerror = () => resolve(null);
                  img.src = url;
              });
          }, targetImage);

          const text = await extractTextFromImage(imageBuffer || targetImage);
          sqm = extractSqmFromText(text);
        } else {
          console.log(`No floorplan image found for ${listing.id}. Discarding.`);
          markAsIgnored(listing.id, this.platformName, "No floorplan image found");
          return null;
        }
      }

      if (sqm && sqm >= config.minSqm) {
        return {
          platform: this.platformName,
          id: listing.id,
          price: listing.price,
          sqm: sqm,
          url: `https://www.zoopla.co.uk/to-rent/details/${listing.id}/`
        };
      } else {
        const reason = sqm ? `Size ${sqm} sqm below min ${config.minSqm}` : "Could not determine size";
        console.log(`Property ${listing.id} ignored: ${reason}`);
        markAsIgnored(listing.id, this.platformName, reason);
        return null;
      }

    } catch (error) {
      console.error(`Error processing ${listing.id}:`, error.message);
      return null;
    }
  }
}

module.exports = ZooplaAdapter;