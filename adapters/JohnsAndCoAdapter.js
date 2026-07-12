const { isSeen, markAsSeen, markAsIgnored } = require('../utils/storage');
const { extractSqmFromText } = require('../utils/parser');
const { extractTextFromImage } = require('../utils/ocr');
const { isDesiredAvailability } = require('../utils/availability');
const config = require('../config.json');

class JohnsAndCoAdapter {
  constructor(page) {
    this.page = page;
    this.platformName = 'Johns&Co';
  }

  async run() {
    const results = [];
    console.log(`Starting ${this.platformName} scraping...`);

    const priceMin = config.minPrice !== undefined ? config.minPrice : 2000;
    const priceMax = config.maxPrice !== undefined ? config.maxPrice : 2700;

    const url = `https://www.johnsand.co/rent?location=E14&minBedrooms=1&maxBedrooms=2&minPrice=${priceMin}&maxPrice=${priceMax}&order=newest`;

    console.log(`Navigating to ${this.platformName} search URL: ${url}`);
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(3000);

      const links = await this.page.$$eval('a', els =>
        els.map(a => a.href).filter(h => h.includes('/properties/') && h.match(/-(\d+)$/))
      );
      const uniqueLinks = [...new Set(links)];
      console.log(`Found ${uniqueLinks.length} unique property links on ${this.platformName}.`);

      for (const link of uniqueLinks) {
        const idMatch = link.match(/-(\d+)$/);
        const id = idMatch ? idMatch[1] : link;

        if (isSeen(id, this.platformName)) {
          console.log(`[${this.platformName}] Property ${id} already seen. Skipping.`);
          continue;
        }

        const match = await this.processListing({ id, link });
        if (match) {
          results.push(match);
          markAsSeen(id, this.platformName);
        }
      }
    } catch (err) {
      console.error(`Error scraping ${this.platformName}:`, err.message);
    }

    return results;
  }

  async processListing({ id, link }) {
    console.log(`[${this.platformName}] Processing listing: ${link}`);
    try {
      await this.page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(2000);

      const pageData = await this.page.evaluate(() => {
        const bodyText = document.body.innerText || '';
        const title = document.title || '';
        const h1 = document.querySelector('h1')?.innerText || '';
        return { bodyText, title, h1 };
      });

      const { bodyText, title, h1 } = pageData;

      let propertyName = h1 || title.split('|')[0].trim() || 'Unknown';

      // Extract price
      let price = null;
      const monthlyMatch = bodyText.match(/£([\d,]+)\s*(?:pcm|\/month|per month|monthly)/i);
      if (monthlyMatch) {
        price = parseInt(monthlyMatch[1].replace(/,/g, ''), 10);
      } else {
        const weeklyMatch = bodyText.match(/£([\d,]+)\s*(?:pcw|p\/w|pw|per week|weekly)/i);
        if (weeklyMatch) {
          const weekly = parseInt(weeklyMatch[1].replace(/,/g, ''), 10);
          price = Math.round((weekly * 52) / 12);
        }
      }

      if (!price) {
        const priceMatch = bodyText.match(/£([\d,]+)/);
        if (priceMatch) {
          price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
        }
      }

      if (price && price > config.maxPrice) {
        const reason = `Price £${price} above max £${config.maxPrice}`;
        console.log(`[${this.platformName}] Property ${id} ignored: ${reason}`);
        markAsIgnored(id, this.platformName, reason);
        return null;
      }

      let sqm = extractSqmFromText(bodyText);

      // Fallback: Check floorplan image OCR if not found in text
      if (!sqm) {
        try {
          const imageUrls = await this.page.$$eval('img', imgs =>
            imgs.map(img => img.src).filter(src => /floorplan|floor-plan|floor_plan/i.test(src) || /floorplan/i.test(img.alt || ''))
          );
          if (imageUrls.length > 0) {
            console.log(`[${this.platformName}] Running OCR on floorplan image...`);
            const text = await extractTextFromImage(imageUrls[0]);
            sqm = extractSqmFromText(text);
          }
        } catch (ocrErr) {}
      }

      if (sqm && sqm >= config.minSqm) {
        const letAvailableDate = 'Now';
        return {
          platform: this.platformName,
          id: id,
          price: price || 0,
          sqm: sqm,
          location: 'Canary Wharf (E14)',
          propertyName: propertyName,
          agent: 'JOHNS&CO',
          url: link,
          listingUpdate: new Date().toISOString().split('T')[0],
          listingStatus: 'Available',
          letAvailableDate: letAvailableDate
        };
      } else {
        const reason = sqm ? `Size ${sqm} sqm below min ${config.minSqm}` : 'Could not determine size';
        console.log(`[${this.platformName}] Property ${id} ignored: ${reason}`);
        markAsIgnored(id, this.platformName, reason);
        return null;
      }
    } catch (err) {
      console.error(`[${this.platformName}] Error processing ${id}:`, err.message);
      return null;
    }
  }
}

module.exports = JohnsAndCoAdapter;
