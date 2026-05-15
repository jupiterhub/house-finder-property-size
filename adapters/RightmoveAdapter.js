const { isSeen, markAsSeen, markAsIgnored, updateLocationIfUnknown } = require('../utils/storage');
const { extractSqmFromText } = require('../utils/parser');
const { extractTextFromImage } = require('../utils/ocr');
const config = require('../config.json');

class RightmoveAdapter {
  constructor(page) {
    this.page = page;
    this.platformName = 'Rightmove';
  }

  async acceptCookies() {
    try {
      const acceptBtn = await this.page.waitForSelector('#onetrust-accept-btn-handler, button:has-text("Allow all cookies"), button:has-text("Accept all")', { timeout: 3000 });
      if (acceptBtn) {
        await acceptBtn.click();
        console.log('Accepted Rightmove cookies.');
        await this.page.waitForTimeout(1000);
      }
    } catch(e) {}
  }

  async run() {
    const results = [];
    console.log(`Starting ${this.platformName} scraping...`);

    for (let i = 0; i < config.rightmoveUrls.length; i++) {
      const url = config.rightmoveUrls[i];
      const locationName = config.locations[i] || 'Unknown';
      
      console.log(`Navigating to search URL: ${url} (${locationName})`);
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
      
      await this.acceptCookies();
      
      // Wait for property cards
      await this.page.waitForSelector('.propertyCard-link', { timeout: 10000 }).catch(() => {});
      
      // Extract links and prices
      let listings = await this.page.$$eval('div', els => {
          return Array.from(document.querySelectorAll('div')).map(div => {
              const a = div.querySelector('a[href*="/properties/"]');
              if (!a) return null;
              const text = div.innerText;
              const priceMatch = text.match(/£[\d,]+/);
              if (priceMatch && a.href.includes('properties/')) {
                  if (div.innerText.length < 2000) {
                      const link = a.href;
                      const idMatch = link.match(/properties\/(\d+)/);
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

        const match = await this.processListing(listing, locationName);
        if (match) {
          markAsSeen(listing.id, this.platformName);
          results.push(match);
        }
      }
    }
    
    return results;
  }

  async processListing(listing, locationName) {
    const floorplanUrl = `https://www.rightmove.co.uk/properties/${listing.id}#/floorplan`;
    console.log(`Processing listing: ${floorplanUrl}`);
    
    try {
      await this.page.goto(floorplanUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      
      // 1. Try to extract from PAGE_MODEL first
      const pageModelText = await this.page.evaluate(() => {
        const script = Array.from(document.querySelectorAll('script')).find(s => s.textContent && s.textContent.includes('PAGE_MODEL'));
        return script ? script.textContent : null;
      });

      let sqm = null;

      if (pageModelText) {
        sqm = extractSqmFromText(pageModelText); // A bit brute-force, but fast.
      }

      // 2. If not in text, look for floorplan image
      if (!sqm) {
        const imageUrls = await this.page.$$eval('img', imgs => 
          imgs.map(img => img.src).filter(src => src.includes('dir/crop') || src.includes('floorplan'))
        );

        if (imageUrls.length > 0) {
          console.log(`Found floorplan image, running OCR...`);
          const targetImage = imageUrls[0];
          
          // Scale image using Playwright for better OCR
          const imageBuffer = await this.page.evaluate(async (url) => {
              return new Promise((resolve) => {
                  const img = new Image();
                  img.crossOrigin = "Anonymous";
                  img.onload = () => {
                      if (img.width < 10 || img.height < 10) {
                          console.log("Image too small to scale!");
                          resolve(null);
                          return;
                      }
                      const canvas = document.createElement('canvas');
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
          location: locationName,
          url: `https://www.rightmove.co.uk/properties/${listing.id}`
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

module.exports = RightmoveAdapter;
module.exports = RightmoveAdapter;