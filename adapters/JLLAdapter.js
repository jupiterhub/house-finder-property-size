const { isSeen, markAsSeen, markAsIgnored } = require('../utils/storage');
const { extractSqmFromText } = require('../utils/parser');
const { extractTextFromImage } = require('../utils/ocr');
const { isDesiredAvailability } = require('../utils/availability');
const config = require('../config.json');

class JLLAdapter {
  constructor(page) {
    this.page = page;
    this.platformName = 'JLL';
  }

  async run() {
    const results = [];
    console.log(`Starting ${this.platformName} scraping...`);

    const priceMin = config.minPrice !== undefined ? config.minPrice : 2000;
    const priceMax = config.maxPrice !== undefined ? config.maxPrice : 2700;

    const url = `https://residential.jll.co.uk/search?tenureType=rent&placeId=ChIJuZV87v-n2EcRQWuoaOCPFzg&placeName=London%20E14%2C%20UK&priceMin=${priceMin}&priceMax=${priceMax}&bedMin=1&bedMax=2&currencyType=GBP&latEnc=51.50686602787108&lngEnc=-0.015439010925319078&radius=3.123&sortBy=newestListed&sortDirection=desc&page=1&frequency=monthly`;

    console.log(`Navigating to ${this.platformName} search URL: ${url}`);
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(3000);

      const links = await this.page.$$eval('a', els =>
        els.map(a => a.href).filter(h => h.includes('/rent-') && h.match(/-p\d+/i))
      );
      const uniqueLinks = [...new Set(links)];
      console.log(`Found ${uniqueLinks.length} unique property links on ${this.platformName}.`);

      for (const link of uniqueLinks) {
        const idMatch = link.match(/-p(\d+)/i);
        const id = idMatch ? `P${idMatch[1]}` : link;

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
        const nextScript = document.querySelector('script#__NEXT_DATA__');
        let nextJson = null;
        if (nextScript) {
          try {
            nextJson = JSON.parse(nextScript.textContent);
          } catch (e) {}
        }

        const bodyText = document.body.innerText || '';
        return {
          nextJson,
          bodyText,
          title: document.title
        };
      });

      const prop = pageData.nextJson?.props?.pageProps?.property || {};
      const bodyText = pageData.bodyText;

      // Extract property name
      let propertyName = prop.title || prop.addressLine1 || pageData.title || 'Unknown';
      propertyName = propertyName.split(' - ')[0].trim();

      // Extract price (monthly PCM)
      let price = null;
      const monthlyMatch = bodyText.match(/£([\d,]+)\s*(?:\/month|pcm|per month|monthly)/i);
      if (monthlyMatch) {
        price = parseInt(monthlyMatch[1].replace(/,/g, ''), 10);
      } else {
        const weeklyMatch = bodyText.match(/£([\d,]+)\s*(?:p\/w|pw|per week|weekly)/i);
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

      // Extract sqm from text
      let combinedTextForSqm = bodyText;
      if (prop.description) combinedTextForSqm += ' ' + prop.description;
      if (Array.isArray(prop.amenities)) {
        combinedTextForSqm += ' ' + prop.amenities.join(' ');
      }
      let sqm = extractSqmFromText(combinedTextForSqm);

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
          agent: 'JLL',
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

module.exports = JLLAdapter;
